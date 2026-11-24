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
> Recovery therefore never meets a prestart. After any crash the engine is gone and Send launches as today. The first two reviews' nineteen findings are accounted for under "The findings of both reviews", and the stop rule is answered in "Does the structure close it?".

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

**D2 · An uncommitted row is visible to nothing outside the host.** Revision 2 had a filter per reader; revision 3 has a single gate in the host. Until commit:
- **No events and no listing.** The host emits no `session.status` or `session.eventBatch` for the row. `engine.sessions` leaves it out, so no listing of the spine, the renderer, the budget or the connectors sees it, and RL10 has no app id to join it to (D11). `session.status` and every other command naming the id answer as for an id with no row. The exceptions are the ones D3, D4 and D10 define.
- **No surface.** The handshake skips `ui_attach` and `ui_panes` (`surface.ts`), so no plugin pane, roster, focus request or prompt ask can reach a window. The engine may still send surface requests before attach. The host answers them itself and forwards nothing: `ui_copy` with `copied: false` (the clipboard untouched), `ui_prompt_read` with an empty box, `ui_prompt_fill` with `filled: false`, `ui_prompt_suggest` with `shown: false`. A decoded `plugin.toast` is dropped.
- **In the budget.** The budget sheets' lists leave the row out. Under memory pressure, the budget releases it before any idle session.
- **Interest and idle release** treat it as a row (D9).

**D3 · Nothing durable, and it dies with its owner.**
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

**D4 · Commit is one host operation: `session.launch` with `adopt`.** At Send, `runIntentSetup` runs exactly as today. The only difference is that `launchOnHost` sends `adopt: { key }` beside the spec. The host handles it under the id's serialization:
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

**D10 · The spine and the trigger.**
- **The trigger.** The composer calls `session.intent.prestart { appSessionId }` on the leading edge of the first change that leaves the document non-empty. After that it calls at most once every 10 s while the draft stays non-empty, so a prestart that was killed comes back with the next keystroke.
  - *Beaten:* the draft save, whose 750 ms trailing debounce waits for a pause in typing.
- **The spine:**
  - for an eligible intent, it builds the spec and the key and sends `session.prestart`;
  - for an ineligible one, it answers `skipped` with the reason;
  - it returns the generation either way.
- **What the spine keeps.** It keeps only an in-memory set of the ids it asked for. After an `intent.patch` that changes a launch-relevant field of one of them, it asks again, or withdraws if the intent is no longer eligible. The patch answers once the intent is written, and the request follows. A chip's acknowledgement never waits for a boot, and ticket 854's barrier (Send waits for every write it started) is unchanged.
- **Losing the set** (a spine restart) loses nothing: the host killed those rows when the connection ended.

**D11 · The desk and sminos (step 3 of the coordinator's brief).**
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

## The findings of both reviews

Round 1 reviewed `258d98442`; round 2 reviewed `b3ec9b017`. Each row says whether the finding is closed by the structure (S), closed by a specific change (C), or still open (O).

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

No finding is left open. One trace remains on purpose and is new in revision 3: the session host's roster entry, marked `prestart` (D3). Its only reader is the successor that stops it.

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

### M0 · The probe (done)
`findings-uxwave-851-prestart.txt`; four tests in `fixtures.test.mjs`. Run on the MacBook, isolated as the architect ruled.

### M1 · The host
- **What:** the admission and generation; the uncommitted flag and its gate (events, `engine.sessions`, budget lists, surface skipped and its requests answered); the buffered journal and deferred state file; `adopt` in `session.launch`; the kills (connection end, `forget`/`stop`, mismatched launch, withdraw, idle release, budget first); the roster mark, the successor rule and the handover drain; at most one uncommitted row; the capability.
- **Tests first,** each case on its own:
  - the admission cancelled before spawn by each canceller;
  - the connection ending while the launch is held before row reservation;
  - nothing emitted or listed before commit;
  - surface requests answered and the clipboard untouched;
  - adopt with an equal spec;
  - adopt refused for a different spec, a different key, a different binary, or an exited row;
  - commit while the handshake is still running;
  - the journal whole after commit;
  - no file left after a kill;
  - a successor stopping a marked host;
  - a second intent's prestart killing the first;
  - withdraw of a committed and of a replaced generation doing nothing.
- **Proof:** `tsc -p tsconfig.node.json`; eslint; vitest over `src/engine-host`.

### M2 · The spine and the window
- **What:** the prestart verdict and spec through Send's own functions; `reserve: false`; `adopt` on `launchOnHost`, with the engine session id written to progress; the patch hook; the window's two commands; the trigger with its spawn-target gate and withdraw.
- **Tests:**
  - the spec equal to Send's, machine route included;
  - the settings-only base URL change;
  - Send adopting, and Send falling back;
  - a crash at each step of today's order with an adopted launch (each injected after its write);
  - the owner reservation at Send with a mod that declares 9, and a refused reservation giving 8 and a fresh launch;
  - both orders of a spawn-target change;
  - the trigger's leading edge.
- **Proof:** both typechecks, eslint, vitest over the touched directories, the tokens guard, `src/shared/machine`, and the desk-web importer check.

### M3 · The endpoint and the measure
- **Endpoint:** the re-join at commit, tested on hub publication and on a direct desk read.
- **Stub:** `LATENCY_STUB_INIT_MS` and `LATENCY_STUB_STARTS_FILE`.
- **Specs:**
  - `e2e/prestart-latency.spec.ts` (`prestart-latency`, measured);
  - `e2e/prestart-engine.spec.ts` (`prestart-engine`, measured);
  - `e2e/prestart.spec.ts` (default group): type, wait, Send, one start, a reply; a blank-tab close leaving no row; the held Tools pick; a pick changed while typing.
- **Registration:** both measured groups go into `MEASURED_E2E` and the group lists.
- **Proof:** the gate's script tests. The e2e runs go through the architect's Mac queue.

### M4 · The gate
One high review. Then the typechecks, eslint, vitest over the touched directories, `src/shared/machine`, and class 1a once.

## Known limits

1. The person's SessionStart hooks run at the keystroke, again at each relaunch, and for drafts that are never sent (D12).
2. sminos takes a prestart as a member at SessionStart. An abandoned draft leaves a sminos member that ended without doing any work (D11).
3. A hidden row is not counted as the holder of its folder. A worktree cleanup could therefore remove the folder under a prestart; the next Send then meets the location rule, as today. This is rare and benign.
4. One prestart per machine: drafting in two New chats at once prewarms only the latest (D1).
5. A pick made in the last moments before Send, or a settings change outside the intent, costs that Send a boot (D6).
6. `ownerChannelLaunched` swallows its write error for every launch (today's behaviour, round 2 finding 1). It is logged to the tracker and not changed here.
7. A spawn to another machine does not prestart (D8).

## Progress

- [x] M0 · The probe. (2026-11-24.)
- [ ] M1 · The host.
- [ ] M2 · The spine and the window.
- [ ] M3 · The endpoint and the measure.
- [ ] M4 · The gate.

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

## Outcomes & Retrospective

(At the end.)
