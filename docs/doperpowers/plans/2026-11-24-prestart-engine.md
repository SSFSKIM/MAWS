# Prestart: a new chat's engine starts on the composer's first keystroke

> **Ticket:** board ticket 851. Its "Done when" is the contract; "Acceptance" restates it line by line.
>
> **Root:** `docs/charter.md`. D-1 binds: the engine is driven over its wire, never patched. Nothing here changes X1 (the session record), X6 (the launch spec) or the host. X2 gains two commands (M2). §4.4 is read in D10. The prewarmed spare pool (§P1, `claim_session`) stays deferred (D14).
>
> **Parent pin:** master `f2b32d6c9`. Every statement about the code below was checked against that commit.
>
> **Branch:** `ux-wave/prestart-engine`.
>
> **Revision 2 (2026-11-24).** The adversarial review of revision 1 (`258d98442`) came back "needs-attention" with eight P1 and three P2 findings. Each was checked in the code it cites and found real; "Review of revision 1" says what each one moved. In short:
> - The prestart now has one positive identity, a durable note that names its generation. The prestart sweep, recovery, the desk filter and the host-restart rule read that note and nothing else.
> - The session record is the commit point. It is written only after the claimed generation has been checked.
> - The owner channel's reservation lives in the note until commit.
> - Each intent has at most one generation, registered before any await.
> - Everything that faces the person or a plugin is gated on the record.
> - Route equivalence is decided on the spec the host actually receives.
> - Scope is narrowed: every difference relaunches. Nothing is applied through the control protocol (D6).
> - The measure is rebuilt: paired runs with a fixed key-to-Send interval, plus an acceptance run on the pinned engine.

## Purpose

A new chat today launches its engine at Send. The person waits for the engine to boot, run its SessionStart hooks and answer `initialize` before the first prompt is even written: about 2.2 s of the 4–5 s from Send to the first drawn row, measured on the owner's Mac on 2026-11-23.

After this plan, a New chat's engine starts on the first keystroke, with the launch spec as it stands at that moment. Send hands the first prompt to an engine that is already initialized. A pick changed before Send relaunches the engine while the person is still typing, so the session at Send is the one the composer shows.

Until Send, the engine is a draft's engine, not a session. It has no record, and it reaches no surface, no plugin's view of the composer, no listing and no other machine (sminos aside, Known limits 2). A draft that is never sent leaves nothing behind in MAWS.

## Words used in this document

- **Prestart:** an engine launched for an unstarted New chat before its first Send. It runs under the intent's own `appSessionId` and has no session record.
- **Generation:** one launch attempt of a prestart. Each has its own number, launch and pin.
- **Note:** the prestart's durable identity (D2).
- **Commit:** the moment Send makes a prestart the session's own launch by writing its record (D5).
- **Spine:** the session service (`src/services/sessions/`, run by `mawsd`).
- **Host:** the engine host.

## What the wire says (evidence)

| | Fact | Evidence |
|---|---|---|
| W1 | SessionStart hooks run inside `initialize`, before its response. With `--await-initialize` they wait for it. Nothing in this sequence waits for a user message. | `fixtures/p4/p4-r7y-stub-command.jsonl` seq 4–7; `pass2/real-settings-idle-1.jsonl` seq 4–10; `p5/p5-o16-holder-await-resume.jsonl` seq 4–10; `uxwave/uxwave-851-hook-idle` |
| W2 | `system/init` arrives only with the first user message. | `p4-r7y-stub-command-plain.jsonl`; `real-settings-idle-1.jsonl`; `uxwave/uxwave-851-idle` |
| W3 | A new session writes no transcript before its first message, including when a SessionStart hook returned `additionalContext`. | bundle 2.1.322 `insertMessageChain`; `findings-p4-w2a-rewind.txt` 7–11; `findings-uxwave-851-prestart.txt` Q1, Q2 |
| W4 | While it waits, the engine makes one `HEAD /api/hello` and no `/v1/messages` request: 60 s held on 2.1.331. | `uxwave/uxwave-851-idle`; `pass3/launch-env-unset.jsonl` seq 116–118 |
| W5 | `set_permission_mode`, `set_model` and `apply_flag_settings {effortLevel}` sent before the first message hold for the first turn. Revision 2 does not use them (D6); they are recorded for a follow-up. | `uxwave/u1-plan-*-seeded-1`; `uxwave/uxwave-851-set-model`, `-set-mode`, `-effort-live` |
| W6 | Additional directories have no live control. A folder decides the trust key, the project settings, `.mcp.json`, CLAUDE.md and the hooks the engine has already run. | bundle 2.1.322 control subtypes; `src/engine-host/launch.ts` |
| W7 | An idle engine uses 215–420 MB of tree RSS and starts its stdio MCP servers before `initialize` is answered. | `real-settings-idle-1.jsonl`; `uxwave/uxwave-851-idle` exit row; `findings-p5-o16-veto-mcp.txt` 41–43 |
| W8 | The host's work after `initialize` takes 40–55 ms. The ticket's "first-prompt hold" is the boot and the hooks inside `initialize`. | `pass3/p1-maws-send-file.jsonl`, `p2-no-prompt-resume-setup.jsonl`, `steer-now.jsonl` |

## Design

**D1 · A prestart is an ordinary launch under the intent's own id, with no record until commit.** The spec is built exactly as `runIntentSetup` builds it at its `launching` step: the served tool set, `intentLaunchSpec`, the owner channel's decision (D7) and `specForHost` (D8), with a fresh pin. The intent file is never written by a prestart, so neither its schema nor an older build's reading of it changes.
*Why the intent's id:* Send can commit without the host having to rename a row, and the open tab's interest holds the row (D10).
*Beaten:* a separate id, which the host cannot rename and which would be reaped 10 minutes after going idle even with its tab open.

**D2 · One positive identity: the note.** `<userData>/sessions/prestarts/<appSessionId>.json`, in the style of the bootstrap notes (`BootstrapNotes`, `intents.ts`). It holds:

    { appSessionId, generation, pin, launchId | null, hostStartedAt, keyDigest, owner: { number, plugin, at } | null, state }
    // state: 'launching' | 'ready' | 'retiring' | 'claimed'

- **Write order.** The note is written before `session.launch` is sent. It is updated with the launch's answer, and removed only after the row has been both stopped and forgotten (D11), or once commit has completed (D5).
- **Who reads it.** Every "is this a prestart" question asks the note, and only the note: the recovery sweep (D11), the desk filter (D13), the host-restart rule (D12) and the spine's own registry after a restart.
- **What is never taken for a prestart.** A row or a store file with no note. A failed ordinary attempt keeps its store file and journal as evidence until discard, as today (`setup.ts` rollback step 4). A prestart never runs on an intent that holds such evidence (D3).

**D3 · Which composers prestart: a New chat on this machine, when Send would launch without a card.** Eligibility:
- the intent is of kind `create`, with no `lineage` and no `launchedBy`;
- its location is a `directory` or an `existingWorktree`;
- `progress.lastFailure` and `progress.bootstrap` are both null;
- no start is in flight;
- every one of Send's guards would pass with no card and no bootstrap: the location and directory rules, the direct-route model rule, the machine route with neither a refusal nor a relay sheet, a trust key already trusted (or declined), a healthy relay on the gateway route (the cached read), the launch gate, and a served tool set. The guard code is shared with `guardIntentStart`, and nothing is written.
- the composer's spawn target is this machine (D9).

Every other case answers `skipped` with its reason, and Send works as today.
- **The floating chat:** in. It draws the active tab's own `Composer` for the same intent.
- **A new-worktree location:** out. Its checkout doesn't exist until Send.
- **A key that needs the trust card or the trust bootstrap:** out. The card is the person's decision, and the bootstrap is a launch of its own.
- **A spawn to another machine:** out (D9).
- **A fork, a side thread, a blank start:** out. None of them has an unstarted composer stage.

**D4 · One generation at a time per intent, owned by a registry entry made before any await.** `Prestarts` holds per intent:

    { generation: number; pending: Promise<void>; owner: 'prestart' | 'send' | 'discard'; launchId: string | null }

The entry is registered synchronously, in the same tick as the command or patch that causes it. Generations never overlap at the host: a relaunch first retires the old generation fully (it joins the old one's pending launch answer, stops the row, waits for the exit, forgets), then launches the new one. Only the entry's current owner acts on replies, and each reply is checked against the generation it was sent for.
- **The watch.** A generation's `LaunchWatch` is given the previous generation's `launchId` (the C3 corrective's `previousLaunchId`). The previous generation's late exit can then never fail the new one's watch.
- **Send claims the entry.** The owner becomes `send` and the entry stops reacting to patches. Send then waits for `pending`, bounded by the watchdog.
- **Discard cancels and joins.** The owner becomes `discard`. A launch the host hasn't acknowledged yet is waited for and then retired, so a late launch is never missed. (The launcher awaits its binary, relay and environment probes before it reserves a row: `launcher.ts`.)
- **Ticket 854 keeps its barrier.** `session.intent.patch` answers once the intent is written. The relaunch it triggers runs on the entry's chain, after the answer, so a chip's acknowledgement never waits for a boot, and Send still waits for every write it started (`intentWritesSettled`).

**D5 · Commit: the record is written only after the claimed generation has been checked.** Send runs, in order:
1. Claim the entry, then wait for it (D4).
2. Build the spec Send would launch, through `specForHost` (D8).
3. Compare that spec with the generation's. Read the host's row and check it: its `launchId` is the generation's, it is `ready`, no turn is open, and its `hostStartedAt` is the note's.
4. **If anything differs or is in doubt:** retire the generation (stop, exit, forget, remove the note) and run the ordinary launch, with the prompt still unsent. A prestart's own failure is never shown.
5. **If all agree:**
   - write the note's state `claimed`;
   - write the intent's `progress.engineSessionId` (the generation's pin) and `progress.launch` (its launch);
   - **commit:** `createForLaunch`, then the owner channel's reservation and launch (D7), then `setRoute` with the route the host was sent (D8);
   - remove the note;
   - go on to `binding` and `session.send` as today.

Recovery meets either side of the commit and is correct on both:
- **Before commit:** there is no record, so `reconcileIntent` answers `none`. `markInterrupted` gives the intent, with its message, a Retry card. The sweep (D11) retires the noted generation.
- **After commit:** a record and a ready row whose spec equals the intent's. `sendUnsent` sends the retained prompt to an engine that is exactly what the record says, the same case today's recovery already handles.
- **The `claimed` note:** if the record exists, the note is stale and is removed. If it doesn't, the generation is retired.

Nothing is set on the engine between the check and `session.send` (D6), so the two sides of the commit leave no third state.

**D6 · Every difference relaunches; nothing goes through the control protocol (scope narrowed in revision 2).** The launch key is the whole spec the host receives (D8) less the pin. A change to the folder, additional directories, route, model, effort, permission mode, launch profile, MCP servers, tool set, question tool, owner decision or cua socket gives a different key.
- **A change while the person types** relaunches at once (D4).
- **A difference found at Send** (a pick in the last moment, or a setting changed outside the intent) takes the ordinary launch.

*Why:* M0 shows mode, model and effort could be set live (W5). But each answer can carry a refusal, a different effective mode, or `ok: false` inside a normal answer (`ipc.ts` `session.setPermissionMode`, `setModel`). A reset to the default is unproven. And setting anything between the check and the commit opens a third state for recovery. Since a relaunch while typing is already hidden, the control path buys only a pick made in the last ~2 s before Send.
*Beaten:* revision 1's D6. It can return as a follow-up if the measure shows late picks are common.

**D7 · The owner channel: the decision at prestart, the reservation held in the note, moved into the owner store at commit.** `ownerChannelLaunch` today reserves the advertisement in the owner store before the launch is sent (rule R2: "a 9 that cannot be reserved is never sent"). `reserveLaunch` refuses a session with no record (`store.ts`, `known`), so a prestart would fall from 9 to 8.
- **The split.** `ownerChannelLaunch` gains a `reserve` seam. An ordinary launch reserves in the store as today. A prestart's reservation is written into its note, durably, before the launch is sent, so R2 still holds: a 9 never reaches an engine unless it is reserved somewhere durable.
- **At commit,** after `createForLaunch`: `reserveLaunch` with the note's reservation, then `launched` with the generation's launch answer. The first `system/init` that `launched` waits for comes with the first prompt (W2).
- **If the store refuses at commit,** the engine was told 9 with no reservation behind it. The record is removed, the generation retired, and the ordinary launch runs (its own decision may answer 8).
- **Why not skip prestarts that would advertise 9:** with the built-in to-human mod on by default (D-21) and its plugin installed, that is every such session, so a skip would leave out nearly all of the owner's new chats.
- **Test:** a real owner store, with a mod that declares 9.

**D8 · Route equivalence is decided on what the host receives, and the route is written at commit.**
- The key includes `specForHost`'s output. On the machine route, that output carries the legacy field derived from the layered base URL, which `machineBaseUrl` reads after `ownerChannelLaunch`. The key also includes that resolution itself.
- A resolution that is `unresolved`, or a machine route on a host that doesn't list `engine.route-machine`, means equivalence can't be established, so no adoption.
- A settings change that moves the base URL with the composer untouched gives a different key, and the ordinary launch.
- `launchOnHost`'s `setRoute` is a no-op without a record (`index/sessions.ts`), so the commit writes the route the host was sent once the record exists. A later resume then reads the right route.
- **Test:** a settings change with the same composer fields, then a resume.

**D9 · The spawn target gates the prestart.** The machine a chat will start on is a renderer pick (`useRemoteSpawn`, `remote-spawn.ts`), not an intent field. The composer asks for a prestart only while `spawnTargetOf(tab)` is this machine. Picking another machine withdraws the prestart through `session.intent.prestart.withdraw` (retire, as D11 does) and leaves the draft alone. Picking this machine again lets the next keystroke start one. Both orders are tested: pick then type, and type then pick.

**D10 · Reaping is the idle release, as for any idle session.** The row is under the intent's id, so the window's interest (`main.tabs` and the sessions on screen) holds it while the New chat's tab is open. Once interest ends, the host's `IdleRelease` releases it after the idle time (`supervisor.idleExitMinutes`, 10 min by default; 24 h on a server). The memory budget may release it sooner.

Interest ends when:
- the tab closes;
- the tab is set aside to ⌘⇧T ("Draft kept");
- the window closes or the app quits (mawsd and the engine outlive the window).

When the spine sees a noted generation exit, it forgets the row and removes the note. Other ends:
- **Discard** (the tab closed on a blank or confirmed draft, New chat closing other empty chats, the relaunch sweep) retires before the intent goes (D11).
- **A launch-key change** relaunches (D4, D6).
- **Send** commits (D5).
- **Emptying the draft** does not end the prestart. Emptying and retyping is the common case, and the idle release covers a draft that is really abandoned.

*Why no timer of its own:* §4.4 rules out a fixed timer while an app holds a session, and the owner's words are "reaped like any idle session".

**D11 · Retiring a generation, and what a crash leaves.** To retire a generation:
1. Join its pending launch.
2. `session.stop`, then wait for the exit.
3. `session.forget`, then remove the note.
The note stays until both stop and forget have succeeded, so a failure leaves the cleanup key for the next try.

`discard` retires first and drops the intent only after that. Today's discard drops the intent even when `forgetQuietly` fails. With a prestart, that failure leaves the note: the intent goes, and the note's retirement is retried at the next recovery. A discard with no note behaves exactly as today.

What each crash leaves:
- **A window quit or crash:** mawsd, the spine and the engine keep running, and D10's release applies.
- **A restart of mawsd or the spine:** the recovery retires every noted generation that is not `claimed` with a record (D5), whatever its row's state, and touches nothing it holds no note for.
- **On disk:** only the host's row files for a noted id, which retirement forgets. No transcript is written (W3), and neither the record nor the intent changes.

**D12 · A host restart retires unclaimed prestarts.** An adopted engine's crons are seeded `unknown` when its state file holds no cron record (`work-state.ts`, `adoptedWith`). A prestart has never reached a Stop, so it holds no record. Unknown work blocks the idle release (`budget.ts`, `holdsWork`), so an adopted prestart would never be reaped.
- The note keeps the `startedAt` from the host's welcome at its launch.
- At a welcome with another `startedAt`, or a status with `holder.adopted`, every generation that is not `claimed` is retired. The next keystroke starts a new one (D15).
- **Test:** a host restart with a prestart live.

**D13 · Nothing of a prestart reaches a surface, a plugin or the desk before commit.** The record, written only at commit (D5), is the gate.
- **Already gated on the record:** the read model, the index source, the project channel, the attention store, the notifier, the browser and the spine mirror.
- **Readers that take any live row get the bootstrap's rule, "a row with no record is not a session":**
  - in the renderer: `PluginsWidget`'s ready count, Customize's choice of a ready process, the connectors list, the relay monitor, and the budget sheets' rows and their Stop (`BudgetSheets.tsx`);
  - in the spine: connector routing (`engine-route.ts`), the owner-delivery pass and connector sign-in.
- **Plugins** (`engine-surface/asks.ts`, `app/plugin-toasts.ts`). A surface ask for an id with no record gets a safe negative: `prompt_read` answers `{ text: '', cursor: 0 }`, `prompt_fill` answers `filled: false`, `prompt_suggest` answers `shown: false`. A plugin toast for such an id is not shown. `copy` is unchanged: it doesn't read the draft. Without this, a plugin in the draft's engine could read or fill the composer, because the asks follow the active tab's id, which is the intent's.
- **The intent's own `Composer`** still reads the session as unstarted: `useSetupIntent` needs a record as well as a status. A test pins this.
- **Holder authority** keeps counting the row: an engine does run in that folder (Known limits 3).
- **The desk** (finding 6). RL10 joins an engine pin to its app id through `engine.sessions` (`rl10/members.ts` `#join`), whether or not a record exists. Both the hub's listings (`#report`) and a direct desk read (`endpoint.listings`, `calls.ts` `#listings`) read the joined members. The filter goes where the two paths share their source: a lane B member whose joined app id has a note that isn't `claimed` is left out of `members()`. It is keyed by app id and launch id, so a later generation is matched as well.
  - It holds across restarts: the note is on disk, so an endpoint or spine restart still sees it.
  - At commit (or retirement) the spine tells the endpoint, which re-evaluates the member, and the session is listed from then on.
  - **Tests:** both hub publication and a direct desk read.

**D14 · Cost, hooks, sminos; the spare pool stays deferred.**
- **Tokens:** the engine spends none before Send (W4).
- **Hooks:** a prestart runs the person's SessionStart hooks at the keystroke and at each relaunch. Whatever a hook spends is its own.
- **Memory:** a prestart costs an idle engine's memory and its MCP servers (W7).
- **sminos:** a prestart carries `SMNS_MEMBER`, so sminos takes it as a member at its SessionStart (accepted, Decision Log 2; Known limits 2).
- **The spare pool:** `claim_session` stays unused. A prestart is one engine for one draft with its exact spec.

**D15 · The trigger, and its switches.**
- **The trigger.** The first composer change that leaves the document non-empty calls `session.intent.prestart` on the leading edge. After that it calls again at most once every 10 s while the draft stays non-empty, so a retired or reaped prestart comes back with the next keystroke. The spine is idempotent.
  - *Beaten:* the draft save, whose 750 ms trailing debounce (`DRAFT_DELAY_MS`) delays the first save until typing pauses.
- **The switches.** With `MAWS_E2E=1` the spine prestarts only under `MAWS_E2E_PRESTART=1`. It never prestarts under the replay seam or the stub session source, because each launch there takes the next fixture.

**D16 · The measure.**
- **The flag.** The "before" arm is the flag-off path on this branch, not a master build: with `MAWS_E2E_PRESTART` unset the spine never prestarts, so Send takes exactly today's code path (accepted, Decision Log 2).
- **(a) Regression bound,** group `prestart-latency`, measured.
  - **Setup:** the latency stub engine with a new `LATENCY_STUB_INIT_MS=2000`.
  - **Runs:** paired flag-off and flag-on Sends, with the same fixed interval from the first real key press to Send (1.5 s, about a short prompt's typing time), in alternating order.
  - **Timing:** each run stamps the first key press (Playwright's `keyboard.press`, read in the page as the `keydown` event's time) and the first assistant row drawn (the paint marker of `local-latency.spec.ts`).
  - **Engine starts:** counted outside the journal, which `forget` erases. The stub appends one line per process start to `LATENCY_STUB_STARTS_FILE`.
  - **The bound:** flag-on's median key-to-row time is at least 1.5 s below flag-off's at the same interval. A flag-on run also counts exactly one engine start per Send with no pick changed.
  - The revision 1 arm that waited for ready stays only as a regression case inside the functional scene (M3). It no longer bounds the gain, since waiting removed the delay by construction.
- **(b) Acceptance,** group `prestart-engine`, measured; it runs on one Mac and spends nothing.
  - **Setup:** the pinned engine (`MAWS_E2E_ENGINE_BIN` set to a version path, recorded in the result) with the API at the scripted Messages stand-in (`MAWS_RELAY_URL` pointed at it on the gateway route; the stand-in answers `GET /api/hello` 200). The config is a scratch one holding three representative SessionStart hooks that sleep 200 ms each, about the 0.5–0.7 s the ticket measured.
  - **Runs and output:** the same paired runs and timestamps as (a). It reports flag-off and flag-on medians and their difference.
  - What the live model adds (its `message_start` time, 0.6–1.4 s on 2026-11-23) is the same in both arms, and is reported only as that estimate, apart from the measured difference.
  - A live run with the owner's own hooks spends a message per Send, so it waits for the owner's word.

## Acceptance (ticket 851's "Done when")

- **A1.** Typing into a fresh New chat composer starts its engine with the launch spec as it stands then: the folder, model, effort, mode, profile, route and tool set.
  *Proof:* a unit test (the generation's spec equals the one Send builds); e2e `prestart.spec.ts`.
- **A2.** Sending reuses the running engine: one engine start (counted outside the journal), and the record's pin is the generation's.
  *Proof:* a unit test; e2e.
- **A3.** A change to the launch spec before Send relaunches it (D6), and a difference found at Send takes the ordinary launch.
  *Proof:* unit tests for each field, a settings-only change on the machine route, and the held Tools pick with prestart on.
- **A4.** An abandoned draft's engine is reaped like an idle session (D10). Discard, recovery, an exit and a host restart retire it without touching a failed attempt's evidence (D11, D12).
  *Proof:* unit tests for each case separately.
- **A5.** The spare pool stays deferred (D14).
- **A6.** The first-row time is measured flag-off and flag-on on the same machine (D16), on the Mac lane.

## Interfaces

    // X2, additive (WIRE_MINOR +1)
    'session.intent.prestart':          { appSessionId } -> { status: 'started' | 'running' | 'skipped'; reason?: string }
    'session.intent.prestart.withdraw': { appSessionId } -> void

    // src/services/sessions/prestart.ts (new)
    PrestartNotes                      // <userData>/sessions/prestarts/<id>.json (D2)
    Prestarts                          // the registry (D4): request(id), onPatch(id), claim(id) -> Claimed | null, cancel(id), retire(id), onStatus(status), onHostWelcome(startedAt)
    prestartVerdict(s, intent)         // D3: the guards, shared with guardIntentStart, nothing written
    launchKey(sent: LaunchSpec, resolution)  // D6, D8

    // src/services/owner/launch.ts
    ownerChannelLaunch(s, spec, ctx, reserve?: (reservation) => Promise<void>)  // D7: an ordinary launch reserves in the store; a prestart in its note

    // src/endpoint/rl10/members.ts
    members() leaves out a lane B member whose app id is noted unclaimed; `prestartChanged(appSessionId)` re-evaluates it (D13)

An older spine refuses the unknown commands, and the renderer reads a refusal as `skipped`. An older window never calls them. The intent, the record and the host are unchanged.

## Milestones

### M0 · The probe (done)
- **Scenario:** `spikes/protocol-probe/scenarios/pass3/uxwave-851-prestart.mjs`.
- **Results:** `findings-uxwave-851-prestart.txt`, with four tests in `fixtures.test.mjs`.
- **How it ran:** on the MacBook, as the architect ruled: a scratch `CLAUDE_CONFIG_DIR` per arm holding the probe's hook, engine 2.1.331 named by its version path, the API at the stand-in with a stand-in token, every sminos variable unset, no app window.

### M1 · The prestart in the spine
- **What:** the note, the registry, the commit order, retirement, the recovery sweep and the host-restart rule (D2, D4, D5, D7, D8, D11, D12).
- **Tests first,** each case separately:
  - eligibility, including a failed attempt's evidence and a pending bootstrap (D3);
  - the generation's spec equals Send's, machine route included;
  - commit with one launch, the pin carried and the route written;
  - every field's difference relaunching while typing;
  - a difference at Send taking the ordinary launch with the prompt unsent;
  - a Send while a generation is retiring;
  - a Send while it is still booting;
  - a discard before the launch is acknowledged;
  - a late exit of an old generation, which must not fail the new watch;
  - a crash before the commit (`none`, Retry card, note retired) and after it (`sendUnsent` to an equal engine);
  - recovery retiring a noted generation and leaving a failed attempt's store and journal;
  - `forget` failing, so the note stays;
  - a host restart retiring an unclaimed generation;
  - the owner reservation: in the note, moved at commit, a store refusal at commit falling back. This runs against a real owner store with a mod that declares 9.
- **Proof:** `tsc -p tsconfig.node.json`; eslint on the changed files; vitest over `src/services/sessions` and `src/services/owner`.

### M2 · The commands, the trigger and the gates
- **What:** the two commands; the trigger with its spawn-target gate and withdraw (D9, D15); the readers, surface asks, toasts and budget sheets (D13); the endpoint's member filter (D13).
- **Tests:**
  - the trigger's leading edge;
  - both orders of a spawn-target change;
  - `useSetupIntent` still reads unstarted with a ready status;
  - each reader leaving out a row with no record;
  - the asks' negatives and the toast held back;
  - the member filter on hub publication and on a direct desk read, across an endpoint restart, and re-evaluated at commit.
- **Proof:** both typechecks, eslint, vitest over the touched directories and the tokens guard. For each touched renderer file, find its importers in `apps/desk-web`; if a file changes shape, add desk-web's typecheck, build and tests. Run `src/shared/machine` if the commands reach the machine router.

### M3 · The measure and the scenes
- **Stub changes:** the stub's `LATENCY_STUB_INIT_MS` and `LATENCY_STUB_STARTS_FILE`, with its unit test.
- **Specs:**
  - `e2e/prestart-latency.spec.ts` (group `prestart-latency`, measured);
  - `e2e/prestart-engine.spec.ts` (group `prestart-engine`, measured: the pinned engine against the stand-in with the three hooks);
  - `e2e/prestart.spec.ts`, in the default group, with the stub engine and `MAWS_E2E_PRESTART=1`. Its scenes: type, wait, Send, one engine start, a reply; a blank-tab close leaving no host row; the held Tools pick of `e2e/sessions.spec.ts` with prestart on; a pick changed while typing, relaunching.
- **Registration:** both measured groups go into `gate.yml`'s `MEASURED_E2E` and the group lists.
- **Proof:** the gate's script tests. The e2e runs go to the architect's Mac queue.

### M4 · The gate
- One high review of the range. Fix what this change introduced; log the rest in `docs/tech-debt-tracker.md` and in Known limits.
- Then: the typecheck of the touched projects, eslint, vitest over the touched directories, `src/shared/machine` if a schema moved, and class 1a once.

## Review of revision 1 (2026-11-24): what each finding moved

| # | Finding (checked in the code) | Revision 2 |
|---|---|---|
| 1 | D4 made the record before the wait and the controls. `reconcileIntent` reads a record plus a live row as "send the retained prompt" (`recovery.ts` `sendUnsent`). | The record is the commit point, written after the generation has been checked. Nothing is set between the check and the send (D5, D6). Tested with a crash on each side. |
| 2 | `ownerChannelLaunch` reserves before launch. `reserveLaunch` refuses an unknown session (`store.ts` `known`), so 9 falls to 8. | The decision and the reservation are split. The prestart's reservation is held durably in its note and moved into the store at commit; a refusal there falls back. Skipping such sessions would leave out nearly all of them (D7). |
| 3 | `adopt` could not tell "no launch" from "retiring, replacement not yet answered". The host awaits before reserving a row (`launcher.ts`), and the watch was keyed on the app id alone. | A per-intent generation is registered before any await. Send claims it and discard cancels and joins it. Watches take the previous launch's id. 854's barrier is kept (D4). |
| 4 | Rows with no record are not only prestarts: rollback keeps a failed attempt's store and journal. Discard drops the intent even when forget fails. | The note is the positive identity. Recovery retires only noted generations, and the note stays until stop and forget both succeed (D2, D11). |
| 5 | Surface asks and plugin toasts follow the active tab's id, which is the intent's, and the budget sheets list rows with no record. | Asks for an id with no record get safe negatives, toasts are held back, and the budget rows and Stop are filtered (D13). |
| 6 | RL10 joins the pin to the app id with no record. `endpoint.listings` builds listings on its own. | The filter is at `members()`, the source both paths share, keyed by app id and launch id. It is held by the durable note and re-evaluated at commit (D13). |
| 7 | On the machine route, `specForHost` reads the layered base URL after the owner decision, and `setRoute` is a no-op without a record. | The key is the spec the host receives plus the resolution. No adoption when equivalence can't be established. The route is written at commit (D8). |
| 8 | The control answers carry refusals, other effective modes and `ok: false`. A reset to default is unproven. | No control path. Every difference relaunches while typing, or takes the ordinary launch at Send (D6). |
| 9 | An adopted prestart's crons seed `unknown`, which blocks the idle release. | A host restart retires every unclaimed generation (D12). |
| 10 | The spawn target is a renderer pick, not an intent field. | The trigger is gated on `spawnTargetOf`, and a change of target withdraws the prestart without touching the draft (D9). |
| 11 | Waiting for ready removed the delay by construction. The journal can't count starts after `forget`. | Paired runs with a fixed key-to-Send interval, the real key press and the first assistant row stamped, starts counted in a file. A second measured group runs the pinned engine against the stand-in with representative hooks (D16). |

## Is it proportionate?

Revision 2 roughly doubles revision 1's build: a note store and registry, a reordered commit, an owner-reservation seam, an endpoint filter and seven renderer and spine gates, besides the measure. The gain is about 2 s off every new chat's first reply, the most frequent wait the owner sits through in MAWS.

The note is what keeps the growth in check. One positive identity answers findings 1, 4, 6, 9 and part of 2. Gating the surfaces on the record, which the commit writes last, answers 5. Dropping the control path takes 8 out entirely.

The narrowest scope that keeps the gain is this plan. A narrower one would have to drop the machine route or the owner channel's 9, and either would leave out nearly every new chat, since both are the defaults (D-19 as amended 2026-11-04; D-21).

What could still be cut, at a known cost:
- **D9's withdraw:** if dropped, a remote pick would simply never prestart, and a prestart already running would be reaped by the idle release after the tab closes.
- **The second measured group** (b): if dropped, acceptance would rest on the synthetic stub alone.

I'd keep both.

## Known limits

1. A prestart runs the person's SessionStart hooks at the keystroke, again at each relaunch, and for drafts that are never sent (D14).
2. sminos sees a prestart as a member from its start (D14). An abandoned draft leaves a sminos member that ended without doing any work.
3. A prestart in an existing worktree counts as that folder's holder. A worktree cleanup while a draft there has a running engine meets a holder with no record. This is rare; the fix is for cleanup to retire a noted prestart, and it is logged, not built.
4. A prestart takes an idle engine's memory. Under budget pressure, it can be the reason another idle session is released.
5. A pick made in the last moments before Send, or a setting changed outside the intent, costs that Send a boot (D6).
6. A spawn to another machine does not prestart (D3, D9).

## Progress

- [x] M0 · The probe. (2026-11-24; `findings-uxwave-851-prestart.txt`, four tests in `fixtures.test.mjs`.)
- [ ] M1 · The prestart in the spine.
- [ ] M2 · The commands, the trigger and the gates.
- [ ] M3 · The measure and the scenes.
- [ ] M4 · The gate.

## Decision Log

1. **2026-11-24.** Revision 1: thirteen decisions and the measure, written before any product code and sent to the architect.
2. **2026-11-24.** The architect's answers:
   - D11 of revision 1 (now D14) accepted: a prestart joins sminos at SessionStart, and Known limits 2 says what an abandoned draft leaves there.
   - The measure's "before" arm is the flag-off path on this branch, not a master build.
   - M0 runs on the MacBook, isolated.
3. **2026-11-24.** M0 answered: mode, model and effort hold when set before the first message (W5).
4. **2026-11-24.** Revision 2, after the adversarial review of revision 1 (eight P1, three P2, all real; the table above). The decisions that moved:
   - one durable identity for a prestart (D2);
   - the record as the commit point (D5);
   - no control path, every difference relaunching (D6), which supersedes the use of entry 3;
   - the owner reservation held in the note (D7);
   - route equivalence on the host's spec (D8);
   - the spawn-target gate (D9);
   - host-restart retirement (D12);
   - surfaces, plugins and the desk gated on the record or the note (D13);
   - a paired measure and an acceptance group on the pinned engine (D16).

## Outcomes & Retrospective

(At the end.)
