# Prestart: a new chat's engine starts on the composer's first keystroke

> **Ticket:** board ticket 851. Its "Done when" is the contract; "Acceptance" restates it line by line.
>
> **Root:** `docs/charter.md`. D-1 binds: the engine is driven over its wire, never patched. Nothing here changes X1 (the session record), X6 (the launch spec) or the host. X2 gains one command (M2). The plan's reading of §4.4 is in D9. The prewarmed spare pool (§P1, `claim_session`) stays deferred (D12).
>
> **Parent pin:** master `f2b32d6c9`. Every statement about the code below was checked against that commit. Wire statements cite `spikes/protocol-probe/` fixtures, or name the probe that still has to answer them (M0).
>
> **Branch:** `ux-wave/prestart-engine`.

## Purpose

A new chat today launches its engine at Send. The person then waits for the engine to boot, its SessionStart hooks to run and `initialize` to be answered before the first prompt is even written: about 2.2 s of the 4–5 s from Send to the first drawn row, measured on the owner's Mac on 2026-11-23. After this plan, a New chat's engine starts when the person types the first key, using the launch spec as it stands at that moment. Send then hands the first prompt to an engine that is already initialized. Picks changed before Send are carried to the running engine, either by a relaunch while the person is still typing or through the control protocol, so the session at Send is the one the composer shows. A draft that is never sent leaves nothing behind: no record, no transcript, no row anywhere in MAWS.

## Words used in this document

- **Prestart**: an engine launched for an unstarted New chat before its first Send, under the intent's own `appSessionId`, with no session record.
- **Spine**: the session service (`src/services/sessions/`, run by `mawsd`). **Host**: the engine host.
- **Adopt**: at Send, take a prestart as the session's launch instead of launching again.
- **Launch key**: the part of a launch spec that cannot change on a running engine (D5). Two specs with the same key differ only in what the control protocol can set.

## What the wire says (evidence)

| | Fact | Evidence |
|---|---|---|
| W1 | SessionStart hooks run inside `initialize`, before its response. With `--await-initialize` they wait for it. Nothing waits on a user message. | `fixtures/p4/p4-r7y-stub-command.jsonl` seq 4–7; `pass2/real-settings-idle-1.jsonl` seq 4–10; `p5/p5-o16-holder-await-resume.jsonl` seq 4–10 |
| W2 | `system/init` arrives only with the first user message. | `p4-r7y-stub-command-plain.jsonl` (user seq 7, init seq 11); `real-settings-idle-1.jsonl` (idle with no init); `findings-pass3-p2-a-u1.txt` 46–60 |
| W3 | A new session writes no transcript before its first message. Entries wait in memory until a user, assistant or system message creates the file. | bundle 2.1.322 `insertMessageChain` / `pendingEntries`; `findings-p4-w2a-rewind.txt` 7–11; `findings-p4-r8-mcp-servers.txt` 49–50 |
| W4 | Before the first message the engine makes one `HEAD /api/hello` and no `/v1/messages` request. The first request follows the user frame by 17 ms. | `pass3/launch-env-unset.jsonl` seq 116–118 (and `-fork`, `-todo`, `-state-events*`); `findings-pass3-p2-a-u1.txt` 62–84 (0 requests in 55 s after ready) |
| W5 | `set_permission_mode` sent before the first message holds: the first turn's `system/init` carries the new mode. | `uxwave/u1-plan-acceptEdits-seeded-1.jsonl` seq 12–19 (and `u1-plan-{auto,default,none}-seeded-1`); `pass3/plan-outcomes.jsonl` seq 9–17 |
| W6 | `set_model` and `apply_flag_settings {effortLevel}` sent before the first message hold for the first turn: the first turn's requests carry the new model, `system/init` names it, and the main request's `output_config.effort` is the one set, as when the launch set it. Neither moves the permission mode. (M0, engine 2.1.331.) | `findings-uxwave-851-prestart.txt` Q3; `uxwave/uxwave-851-set-model`, `-effort-live`, `-effort-launch`, `-effort-none` |
| W7 | There is no live control for additional directories. `set_cwd` exists, but a folder decides the trust key, the project settings, `.mcp.json`, CLAUDE.md and the hooks the engine has already run. | bundle 2.1.322 control subtypes; `src/engine-host/launch.ts` (`--add-dir`) |
| W8 | An idle engine uses 270–420 MB (tree RSS) and starts its stdio MCP servers before `initialize` is answered. | `real-settings-idle-1.jsonl` seq 11–13; `findings-p5-o16-veto-mcp.txt` 41–43 |
| W9 | A launch's host work after `initialize` (surface attach, the gateway's `get_status`, the fallback mode) takes 40–55 ms. The rest of the ticket's "first-prompt hold" is the boot and hooks inside `initialize` (W1). No MAWS timer delays the first prompt. | `pass3/p1-maws-send-file.jsonl`, `p2-no-prompt-resume-setup.jsonl`, `steer-now.jsonl`; `src/engine-host/session.ts` `handshake` |

M0 re-checked W2–W5 on engine 2.1.331 with a scratch config home: a new session held 60 s after `initialize` made only `HEAD /api/hello`, wrote no file and emitted no `system/init`; a SessionStart hook's `additionalContext` wrote no file before a message (`findings-uxwave-851-prestart.txt` Q1, Q2).

## Design

**D1 · A prestart is an ordinary launch under the intent's own id, with no record until Send.** `SessionService.prestart(appSessionId)` builds the spec exactly as `runIntentSetup` would at its `launching` step: the served tool set, `intentLaunchSpec`, the owner channel's decision, and a fresh engine pin. It then sends `session.launch` and keeps an in-memory entry `{ spec, decision, pin, launchId, launchedAt, state }`. The intent file is not written, so its schema, the record and the host are unchanged.
*Why:* this is the trust bootstrap's precedent: a launch with no record that every record-keyed reader already drops (read model, index source, channel, attention store, notifier, browser, spine mirror). The id is the session's own, so Send can adopt the row with no rename at the host, and the tab's interest holds the row (D9).
*Beaten:* a separate prestart id. The host cannot rename a row, and that row would be reaped 10 minutes after it went idle, whether or not its tab was open. Also beaten: a note in `intent.progress`, which would make an older build skip the intent file (it strict-parses it) and lose the draft.

**D2 · Only a New chat on this machine prestarts, and only when Send would launch with no card.** Eligible: an intent of kind `create`, with no `lineage` and no `launchedBy`, whose location is a `directory` or an `existingWorktree`. It must not be starting, and every one of Send's guards must pass with no card and no bootstrap: the location and directory rules, the direct-route model rule, the machine route with neither a refusal nor a relay sheet, a trust key already trusted (or a decision of `declined`), a healthy relay on the gateway route (the cached read, not a forced one), the launch gate, and a served set. The guard code is shared with `guardIntentStart`, and nothing is written. Every other case answers `skipped` with its reason, and Send works as today.
- **A `newWorktree` location:** out. Its checkout does not exist until Send, and creating a worktree on a keystroke is an effect nobody asked for.
- **A key that needs the trust bootstrap or the trust card:** out. The card is the person's decision, and the bootstrap is a launch of its own. The second chat in a folder prestarts once the first has recorded trust.
- **The floating chat:** in. The floating card draws the active tab's own `Composer` for the same intent.
- **A spawn to another machine:** out. Its engine would run on the other machine, which needs a new remote command, and the local intent is discarded at Send. That is a ticket of its own.
- **A fork and a side thread:** out. Each starts at once (`session.fork`, `openSideThread`) and has no unstarted stage.
- **A blank start** (artifacts, gateway; `session.start` with no message): out. It has no composer.

**D3 · The trigger is the composer's first change that leaves the document non-empty.** Through a new command, `session.intent.prestart`. The renderer calls it on the leading edge and then at most once every 10 s while the draft stays non-empty, so a prestart that was reaped or retired (D9, D10) comes back with the next keystroke. The spine is idempotent: a running prestart answers `running`.
*Beaten:* starting the prestart from the spine when the draft is saved. The draft writer debounces at the trailing edge (`DRAFT_DELAY_MS`, 750 ms after the last change), so the first save can come only after the person stops typing.

**D4 · Send adopts.** At its `launching` step, `runIntentSetup` builds the spec it would launch and compares its launch key with the prestart's (D5).
- **Same key:** `createForLaunch`, as today. The intent's `progress.engineSessionId` takes the prestart's pin, and `progress.launch` is written with the prestart's launch. `ownerChannelLaunched` gets the decision and the prestart's launch answer; the first `system/init` it waits for comes only with the first prompt (W2). Send then waits for the prestart's `ready` with the same `LaunchWatch` and watchdog, sets any control-applied fields that differ (D6), and goes on to `binding` and `session.send` unchanged.
- **Different key, or the prestart exited or failed:** the prestart is stopped and forgotten, and the setup launches as it does today. A prestart's failure is never shown; if the fresh launch fails too, that failure is shown as today.
- **A live row under the intent's id that the spine has no entry for** (a spine restarted without its recovery reaching it): stopped and forgotten before the launch, which would otherwise be refused `already_live`.

**D5 · The launch key is the spec less what the control protocol can set.** The key is every field of `LaunchSpec` (after `ownerChannelLaunch`) except `sessionId` (the pin, D4) and the fields D6 admits. So a change of folder, additional directories, route, launch profile, MCP servers, tool set, question tool (with its supplement), owner-channel decision, cua socket or subagent model relaunches. These are fixed when the engine boots (W7; for the tool set, the tool-choice plan's D1).

**D6 · Permission mode, model and effort go through the control protocol** (W5, W6; M0 answered for model and effort).
- **Mode:** a change between two modes neither of which is `auto` is set at Send with `session.setPermissionMode`. A change to or from `auto` relaunches, because the auto fallback (W3 of C10, `permissionFallback`) runs only in the launch's handshake.
- **Model and effort:** set at Send with `session.setModel` and `session.setEffort`. One exception: a model change while the mode Send asks for is `auto` relaunches, since whether auto is available depends on the model and the fallback runs only at launch (M0 ran in default mode and did not observe that case).

**D7 · Relaunch happens while the person types, not at Send.** After an `intent.patch` that changes a launch-relevant field of an intent with a prestart, the spine re-reads the verdict (D2).
- **No longer eligible:** the prestart is stopped and forgotten.
- **Launch key changed:** the old prestart is stopped and forgotten, and a new one launches at once.
- **Only D6's fields changed:** nothing happens until Send.

A change made during a boot is applied once that boot has answered: the spine compares again and relaunches if it has to. Only the latest pick is kept, so a burst of picks costs at most two boots. A draft-only patch is never re-read. Settings that change outside the intent (the profile, the MCP servers) are caught by D4's comparison at Send.

**D8 · Nothing of a prestart reaches a surface before Send.** The record-keyed readers already drop it (D1). The readers that take any live row are given the bootstrap's rule, "a row with no record is not a session":
- in the renderer: `PluginsWidget`'s ready count, Customize's choice of a ready process in a folder, the connectors list, and the relay monitor;
- in the spine: connector routing (`engine-route.ts`), the owner-delivery pass, and connector sign-in.

Two readers keep the row, on purpose:
- The intent's own `Composer` still treats the session as unstarted: `useSetupIntent` needs a record as well as a status. A test pins this.
- Holder authority keeps counting it. An engine does run in that folder, and the bootstrap counts there too (Known limits 3).

The desk's listings (`src/endpoint/listings.ts`) list what sminos reports, so they skip a session whose engine id is a live prestart's pin until Send binds it (D11).

**D9 · Reaping is the idle release, the same one any idle session has.** The row is under the intent's id, so the window's interest (`main.tabs` and the sessions on screen) holds it while the New chat's tab is open, as it holds an open session. When interest ends, the host's `IdleRelease` releases it after the idle time (`supervisor.idleExitMinutes`, 10 min by default; 24 h on a server role), and the memory budget can release it sooner, least recently used first. Interest ends when the tab closes, when the tab is set aside to ⌘⇧T ("Draft kept"), or when the window closes or the app quits (mawsd and the engine outlive the window). A release stops the process (`stop('idle')`). The spine sees the row exit and forgets it, so the host keeps no state file or journal for it.
Some ends come before the idle time:
- the intent discarded (the tab closed on a blank or confirmed draft, New chat closing other empty chats, the relaunch sweep): `discard` stops and waits for the exit, then forgets. Today's `forgetQuietly` on a live row is refused and leaves an orphan.
- the folder or another launch-key field changed: a relaunch (D7).
- Send: adoption (D4).
- the spine's start-time recovery (D10).

A draft that is emptied does not end the prestart. Emptying and retyping is the common case, and the idle release covers a draft that is really abandoned.
*Why not a timer of its own:* §4.4 rules out a fixed timer for sessions while an app holds them, and the owner's words are "reaped like any idle session". The release keyed to interest is that rule as P5 amended it.

**D10 · What a crash or quit leaves.** A window quit or crash leaves mawsd, the spine and the prestart running, and D9's release applies. A restart of `mawsd` or the spine loses the in-memory entry. The start-time recovery then retires every row, live or released, whose id is an intent with no record: it stops the row and forgets it, as `retireBootstrap` does. Such a row can only be a prestart, because a setup creates its record before its launch. A restart of the host alone keeps the row (adoption) and the spine's entry. Nothing is ever on disk beyond the host's row files, which recovery forgets: no transcript (W3), no record, and no change to the intent.

**D11 · Cost, hooks and sminos.** A prestart spends no tokens through the engine before Send: its only request is `HEAD /api/hello` (W4), and M0 re-checks this on the current engine for an idle new session held 60 s. A prestart runs the person's SessionStart hooks at the keystroke, and again at each relaunch. A hook does what it would do when a terminal session opens, and anything it spends is its own; MAWS cannot see inside a hook. A prestart costs one idle engine's memory and its MCP servers (W8).

A prestart carries `SMNS_MEMBER` like every launch, so sminos takes it as a member at its SessionStart, as it takes a terminal session that has just opened. Leaving the variable out would cost the session its membership for good, because the mark cannot be added after launch. So the plan keeps it, and keeps the desk's listings out until Send (D8). Of everything in this plan, this is the one effect a person can see before Send, through sminos's own `list`. Accepted by the architect (Decision Log 2).

**D12 · The spare pool stays deferred.** A prestart is one engine for one draft with its exact spec, and it is never claimed by another chat. `claim_session` stays unused (`controls.ts` defines it; nothing calls it).

**D13 · Under the end-to-end harness a prestart is off unless asked for.**
- With `MAWS_E2E=1`, the spine prestarts only under `MAWS_E2E_PRESTART=1`.
- Under the replay seam (`MAWS_E2E_REPLAY_FIXTURES`) and the stub session source, it never prestarts: each launch takes the next fixture, and a prestart would shift every fixture after it.
*Why:* existing scenes count launches, journals and fixtures. Their behaviour stays as it is, and the measure's "before" arm is today's path on the same build (D14).

**D14 · The measure is a new measured e2e group, `prestart-latency`.** The spec is `e2e/prestart-latency.spec.ts`, run with `pnpm e2e:prestart-latency`. The engine is `test/support/latency-engine-stub.mjs`, launched through `MAWS_E2E_ENGINE_BIN` with a new `LATENCY_STUB_INIT_MS=2000`: the stub holds its `initialize` response 2 s, standing in for the ticket's boot, hooks and initialize. The prompt and fixture are the same in each arm, and there are ten Sends per arm:
- **before** (`MAWS_E2E_PRESTART` unset): type, Send.
- **after** (`MAWS_E2E_PRESTART=1`): type, wait for the row's `ready`, then Send.
- **early** (`MAWS_E2E_PRESTART=1`): Send 200 ms after the first keystroke, so Send joins a prestart that is still booting.

Each Send is timed to the user row drawn and to the first assistant row drawn, using `local-latency.spec.ts`'s marker (a MutationObserver, then rAF, then the arrival of a MessageChannel message). The spec writes `test-results/prestart-latency.json` and one summary line. Its bound: the median "after" time to the assistant row is at least 1.5 s below the median "before" time, written in one of the forms the gate's bound guard admits.
The "before" arm is the flag-off path on this branch, not a master build: with `MAWS_E2E_PRESTART` unset the spine never prestarts, so Send takes exactly today's code path (D13). A run on master would need the stub's new delay ported back, and would measure the same path. Accepted by the architect (Decision Log 2). A live arm on the real engine with the owner's hooks would be the owner's own diagnosis; it spends a message per Send, so it waits for the owner's word.

## Acceptance (ticket 851's "Done when")

- **A1.** Typing in a fresh New chat composer starts its engine with the launch spec as it stands then: the folder, model, effort, mode, profile, route and tool set. Proof: a spine unit test (the spec equals the one Send would build); e2e `prestart.spec.ts`.
- **A2.** Sending reuses the running engine: no second spawn, and the record's pin is the prestart's. Proof: a unit test, and the e2e journal check (one `spawn` row).
- **A3.** A change to the launch spec before Send relaunches, or applies through the control protocol where one is proven (D5–D7). Proof: a unit test for each field class.
- **A4.** An abandoned draft's engine is reaped like an idle session (D9), and a discard, a recovery and an exit leave nothing at the host (D9, D10). Proof: unit tests for the spine's side. The host's `IdleRelease` itself is unchanged and has its own tests.
- **A5.** The spare pool stays deferred (D12).
- **A6.** The first-row time is measured before and after on the same machine (D14), on the Mac lane.

## Interfaces

    // src/shared/ipc/schema/session.ts (X2, additive; WIRE_MINOR +1)
    'session.intent.prestart': { appSessionId } -> { status: 'started' | 'running' | 'skipped'; reason?: string }

    // src/services/sessions/prestart.ts (new)
    interface Prestart { appSessionId; spec: LaunchSpec; decision: LaunchDecision | null; pin: SessionId; launchId: string | null; launchedAt: string | null; state: 'launching' | 'ready' | 'exited' }
    prestartVerdict(s, intent): Promise<{ ok: true; spec; decision } | { ok: false; reason: string }>   // D2: guards shared with guardIntentStart, nothing written
    launchKey(spec): string                                                                             // D5
    class Prestarts { start(id); reconcile(id); adopt(id, spec): Prestart | null; retire(id); onStatus(status) }

    SessionService: prestart(id), plus the hooks in patch (D7), discard (D9), recover (D10) and runIntentSetup (D4)

An older spine refuses the unknown command. The renderer reads any refusal as `skipped` and says nothing. An older window never calls the command. Nothing stored changes.

## Milestones

### M0 · The probe (done, before product code)
- **Scenario:** `spikes/protocol-probe/scenarios/pass3/uxwave-851-prestart.mjs`, against the scripted Messages API stand-in, so nothing is spent.
- **Arms:**
  - (a) a new session held idle 60 s after `initialize`: every request made, and whether a transcript is written;
  - (b) `set_model` before the first message: the first request's `model`, and `system/init.model` and `permissionMode`;
  - (c) `apply_flag_settings {effortLevel}` before the first message: the first request's effort;
  - (d) a SessionStart hook that returns `additionalContext`, with the session stopped before any message: whether a file is written.
- **Outputs:** fixtures under `fixtures/uxwave/uxwave-851-*`, a findings file, and tests in `fixtures.test.mjs`.
- **Where it ran:** on the MacBook, as the architect ruled: a scratch `CLAUDE_CONFIG_DIR` per arm holding the hook, engine 2.1.331 named by its version path, the API base at the stand-in with a stand-in token, every sminos variable unset (the environment rebuilt from the base keys), no app window. Arms (e) `set_permission_mode` and the effort references (at launch, none) were added beside (a)–(d).
- **What it decides:** D6's model and effort row; D11's spend statement.

### M1 · The prestart in the spine
- **Code:** `prestart.ts`, and the four hooks into the service (D4, D7, D9, D10).
- **Tests first,** in `src/services/sessions/prestart.test.ts` beside `service.test.ts`'s harness:
  - eligibility, case by case (D2);
  - the spec equals Send's;
  - adoption, with no second launch and the pin carried;
  - a key change at Send relaunches;
  - a mode change at Send goes by control;
  - a Send while the prestart is still booting joins it;
  - a failed prestart falls back unseen;
  - an unknown live row is retired before the launch;
  - a patch relaunches, and a burst of patches keeps the latest;
  - a discard stops, then forgets;
  - an exit is forgotten;
  - recovery retires a row with an intent and no record;
  - D13's switches.
- **Proof:** `tsc -p tsconfig.node.json`; eslint on the changed files; vitest over `src/services/sessions`.

### M2 · The command, the trigger and the readers
- **The command:** its schema and main's relay. `src/shared/machine` coverage runs if the command reaches the machine router.
- **The trigger:** the composer's leading edge, then at most once every 10 s (D3).
- **The readers (D8):** the renderer and spine readers get the record filter. The desk's listings skip a live prestart's pin.
- **Tests:** the trigger; `useSetupIntent` still reads unstarted with a ready status; each reader filters a row with no record; the listing skip.
- **Proof:** both typechecks, eslint, vitest over the touched directories, and the tokens guard. The importers in `apps/desk-web` are checked for each touched renderer file; if a file changes shape, desk-web's typecheck, build and tests are added.

### M3 · The measure and the scene
- **Code:** the stub's `LATENCY_STUB_INIT_MS`, with its unit test; `e2e/prestart-latency.spec.ts` (group `prestart-latency`, measured, added to `gate.yml`'s `MEASURED_E2E` and the group lists); and `e2e/prestart.spec.ts`, which runs in the default group with `MAWS_E2E_PRESTART=1` and the stub engine. That scene types, waits for the prestart, sends, and checks one spawn row and a drawn reply. It also checks that a tab closed on a blank draft leaves no host row.
- **Proof:** the gate's script tests (`node --test .github/scripts/*.test.mjs scripts/*.test.mjs`). The e2e runs go on the architect's Mac queue.

### M4 · The gate
- One high review of the range. Fix what this change introduced. Log the rest in `docs/tech-debt-tracker.md` and in Known limits.
- Then the typecheck of the touched projects, eslint, vitest over the touched directories, and `src/shared/machine` if a schema moved.
- Class 1a once: `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label pse`.

## Known limits

1. A prestart runs the person's SessionStart hooks at the keystroke, and again at each relaunch and for drafts that are never sent (D11).
2. sminos sees a prestart as a member from its start (D11). A draft that is abandoned leaves a sminos member that ended without doing any work.
3. A prestart in an existing worktree counts as that folder's holder. A worktree cleanup while a draft there has a running engine meets a holder with no record. This is rare, and the right fix is that cleanup stops a prestart; it is logged, not built.
4. A prestart takes one idle engine's memory. Under budget pressure it can be the reason another idle session is released.
5. Settings changed outside the intent (the launch profile, the app's MCP servers) are found only at Send, and that Send then pays for a boot.
6. A spawn to another machine does not prestart (D2).

## Progress

- [x] M0 · The probe. (2026-11-24; `findings-uxwave-851-prestart.txt`, four tests in `fixtures.test.mjs`.) Model and effort hold through the control protocol before the first message (D6); an idle new session makes no Messages API request and writes no file.
- [ ] M1 · The prestart in the spine.
- [ ] M2 · The command, the trigger and the readers.
- [ ] M3 · The measure and the scene.
- [ ] M4 · The gate.

## Decision Log

1. 2026-11-24. The plan's thirteen decisions (D1–D13) and its measure (D14), written before any product code and sent to the architect for review. Open for the architect: D11 (sminos sees a prestart from its start), D13 with D14 (the measure's "before" arm runs on this branch with the prestart off, rather than on a master build), and M0's run on the Mac mini.

2. 2026-11-24. The architect's answers. D11 accepted: a prestart joins sminos at SessionStart; Known limits 2 says what an abandoned draft leaves there. D13 and D14 accepted: the "before" arm is the flag-off path on this branch. M0 to run on the MacBook, isolated (the conditions are in M0). The plan itself is in an adversarial review; no product code before its findings.
3. 2026-11-24. M0's answer moves D6: model and effort are set through the control protocol at Send, like the mode (W6), with one relaunch case kept, a model change under a requested `auto`, since the auto fallback runs only at launch and M0 did not observe it.

## Outcomes & Retrospective

(At the end.)
