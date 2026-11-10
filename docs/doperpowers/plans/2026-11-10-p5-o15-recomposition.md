# P5 O15 — Recomposition and the owner's week (2026-11-10)

> **Parent:** `docs/doperpowers/plans/2026-10-27-p5-org.md` (P5), child **O15**, §"O15: Recomposition and the owner's week". Parent pin: blob `534e5d344a793894ec787fdd61ebdb447fe982cf` at master `f221bd3c2` (P5's Decision Logs 1–265; 266 lands with this document).
>
> **What binds.** O15's section in P5 is this document's design, and P5's approval covers it. Binding with it:
> - P5's parent-level acceptance, items 1 to 16, as worded there.
> - P5 §2, "Two composition roots" and "One daemon per profile", and OX1 (wire compatibility): nothing here narrows a schema that a process of another build reads.
> - The owner's two answers of 2026-11-10 (P5 Decision Log 266): when `mawsd` cannot start, MAWS opens a repair screen and runs nothing of the machine's inside the app; and the deletion is built now and reaches the three machines before the verdict.
> - The project's rules (`CLAUDE.md`): the engine is never patched (D-1); components use tokens only, light theme the default; gates run through `scripts/ci-gate.sh`.
>
> **Inputs.** Two inventories written on 2026-11-10 by research agents from master a839e6bb2 and read by the architect, committed beside this file: `2026-11-10-p5-o15-inventory-embedded-root.md` (what the app's main process still composes, every selector of it, its history) and `2026-11-10-p5-o15-inventory-evidence.md` (each acceptance item split into checkable claims, 67 in all, with the evidence on record for each). They are maps pinned to that commit. Where one disagrees with the code or with this document, the code and this document are right.
>
> **What this file holds.** The execution only. M1 and M2 are code, built by a plan executor on one branch. M3 to M5 are the architect's operations with the owner, the desk track and mini-ops, and no executor runs them.

## Purpose

P5 moved everything that belongs to a machine out of the app: sessions, terminals, the index of transcripts, attention, files, git, connectors and the library now run in `mawsd`, the machine daemon. `mawsd` is a background process, one per profile, started at login by a LaunchAgent for the owner's main profile and started by the app for every other profile (`src/mawsd/`). The app is a client of it. Two things remain before P5 can close.

**The app still contains a second way to run the machine.** `src/main/app.ts` can compose the same services inside Electron's main process (the *embedded shape*, P5 §2's second composition root), and it does so in three cases: a saved setting `supervisor.shape: embedded`, an environment variable `MAWS_HOST_MODE=detached` or `utility`, and, without anyone asking, whenever the main profile's LaunchAgent is absent, turned off or fails to start. In that last case MAWS looks normal and every promise of P5 is quietly off: sessions end with the app, and other machines cannot reach this one. After M1 and M2 the app has one arrangement on every profile. On the owner's Macs the difference shows in one place: when `mawsd` cannot start, MAWS opens a small window that says why, shows the daemon's last log lines and offers the repair, and it runs nothing of the machine's until `mawsd` answers. A developer sees it too: a development build on the main profile of a Mac with no installed MAWS shows that window, which names `pnpm dev:scratch`.

**P5's acceptance has never been checked as a whole on one build.** Each child proved its part when it landed, on the build of its day. The evidence inventory counts 67 claims in the 16 items: 31 have something seen on the owner's production machines, only 3 of those in full, and 36 have nothing live (11 a gate or a bench only, 10 staging only, 15 neither). After M3 to M5 every claim has a dated result on one final build, or the owner's ruling on it, written into P5's Outcomes, and the owner's verdict on the week closes P5.

**How to see it working.** After M2, in the suites: an app launched with a daemon that cannot start opens the repair window and nothing else, and its Try Again opens the app once the daemon can start; a profile saved on the embedded shape opens on `mawsd` with every session and setting present. After M3, on each Mac: `ps` shows no engine host or pty host whose parent is MAWS, and Settings › Background supervisor has no "Run sessions under the machine daemon" switch. After M5: P5's Outcomes holds the table of 67 results and the owner's words.

## Progress

- [ ] M1 — No suite launches the app's embedded shape
- [ ] M2 — One launch outcome: `mawsd`, or the repair window
- [ ] M3 — The final build on the three machines
- [ ] M4 — The closing run
- [ ] M5 — The record and the verdict

## Acceptance

O15 is done when all of these hold.

1. **One arrangement.** No launch of the app, on any profile and with any environment or saved setting, opens the machine's data, takes `spine.lock` (the lock the one writer of a profile's machine files holds), or starts an engine host or a pty host from the app's main process. The suites show it by a check that the app's bundle holds no module of the services' composition, and by launches that read which process holds the lock.
2. **The repair window.** A launch on the main profile whose daemon cannot start shows one window that names the reason in a sentence, the daemon's last log lines where there are any, and the actions that apply; nothing else of MAWS opens. The retry action opens the app in the same process once the daemon starts. Closing the window quits MAWS. A profile with a private daemon is outside this: it starts as it does today, and a private daemon that fails to start, like any daemon that fails after the launch, shows where it shows today, in the supervisor's status row and Settings › Background supervisor.
3. **Nothing lost.** A profile last run on the embedded shape, with `supervisor.shape: embedded` saved, opens on `mawsd` with its sessions, projects, artifacts, library, drafts, layout and every other setting as they were, and no re-index.
4. **The acceptance as a whole.** Each of the 67 claims of P5's acceptance has, in P5's Outcomes, one of: a pass seen on the final build with its evidence; a citation of earlier evidence with the reason a new check adds nothing; or the owner's ruling, with a tracker row where something is carried.
5. **The record.** P5's Outcomes and retrospective is written; the risk row on the org root's key says what the key is; the items other children handed to O15 by name are each closed or carried; the owner's verdict (acceptance 16) is recorded in their words.

## Constraints that bind every milestone

1. **`mawsd`'s side does not change.** `src/services/` (the library both roots compose), `src/mawsd/` and the engine host keep their behaviour. `detached` stays: it is the transport `mawsd` and the app's relay links use, and the engine host's own mode. Only the app's use of it to reach an engine host directly goes.
2. **No bound moves.** OX7's limits (p50 26.45 ms, p95 42.56 ms, P5 Decision Log 33), acceptance 14's bound (99,145 KiB and 1.12 s per 600 s, Decision Log 128) and every other measured limit keep their recorded numbers. A ported test that cannot hold its limit on `mawsd` stops the work with the numbers; it is not loosened.
3. **Rollback stays possible.** Each machine keeps its previous build, cf30dafdd, beside the new one. So no stored file takes a version an older build cannot read: the client settings file stays at version 21 (a build that meets a newer version falls back to defaults and would overwrite the owner's settings), and the index is not touched.
4. **The wire is additive.** OX1: no command, event, capability or schema member that a process of another build sends or reads is removed or narrowed. If a change here has to be named in `src/shared/ipc/wire-manifest.json`, it is an addition and takes a minor.
5. **The older-`mawsd` paths stay.** Where the app answers `artifacts.export` or `delivery.send` itself because the connected `mawsd` does not advertise `machine.render` or `machine.delivery`, and where the artifact scheme serves locally before a welcome, the code serves an app that meets an older daemon, not the embedded shape. It stays, and M5 files its retirement.
6. **No Electron and no typecheck on the MacBook.** The executor runs no Electron, no e2e, no packaged build and no typecheck (`tsc`, `pnpm typecheck`, any `tsc --noEmit`, whatever the heap) on this Mac: every suite runs through `scripts/ci-gate.sh` from the branch's worktree. What may run locally is a focused run alone, one at a time: eslint on one file, vitest's node project on one test file. Lint over the repository, vitest over several files or a directory, and the unit suite are class 1a's on CI. After every commit that touches product or test TypeScript, a static-only or class 1a run comes before any run that holds the CI Mac.
7. **Tests never touch the owner's daemon.** A test or harness launch on the main profile is refused before any work, as today (`testLaunchRefusal`).
8. **The repository is public.** Evidence that shows the owner's sessions (screenshots, transcripts, logs with their content) stays on the architect's disk under `~/.local/share/maws-architect/o15-evidence/`; the record carries times, counts, builds and verdicts. Neither of the owner's email addresses is written anywhere.

## Plan of Work

M1 takes the suites off the embedded shape while the shape still exists, so M2's deletion is judged by suites that already pass on `mawsd`. M2 deletes the shape and builds what replaces its one useful effect, a launch that survives a daemon that cannot start. They land together as one pull request. M3 puts the resulting master on the three machines. M4 checks P5's acceptance on it. M5 writes the record.

### M1 — No suite launches the app's embedded shape

**At its end.** Every package script, gate list and test that launched the tested build with the machine's services inside the app either launches it on `mawsd` or is gone. The embedded shape still exists in the app. Its own unit tests (`src/main/hosts/mode.test.ts`, `daemon.test.ts`) and the settings group's shape-flip case still run, and go with their code in M2.

**Touches.** `package.json`; `.github/workflows/gate.yml`, `.github/scripts/gate-plan.test.mjs`, `.github/scripts/e2e-default-specs.test.mjs` and `scripts/ci-gate-alerts.test.mjs`; `e2e/support/supervisor-scratch.ts`, `e2e/supervisor-packaged.spec.ts`, `e2e/supervisor.spec.ts`, `e2e/cross-build.spec.ts`, `e2e/local-latency.spec.ts`, `e2e/daemon-idle.spec.ts`, `e2e/artifacts-store.spec.ts`, `e2e/support/connector-cold-delivery.ts` with `e2e/delivery.spec.ts`, `e2e/p1-live-keep-quit.spec.ts`, `e2e/c12-quit.spec.ts`; `src/main/lifecycle.test.ts`, `src/main/sessions/main-wiring.test.ts`, `src/main/profile-upgrade.test.ts`. The inventory's §2 lists each site.

**Decisions.**

- *Scripts.* Deleted: `e2e:c7-utility`, `e2e:supervisor`, `e2e:supervisor:packaged`, `e2e:local-latency`, `e2e:daemon-idle-baseline`, `e2e:daemon-idle-aba`, `e2e:keep-quit-live`. The scripts that already run on `mawsd` keep their names (`e2e:c7`, `e2e:supervisor-daemon`, `e2e:supervisor-daemon:packaged`, `e2e:local-latency-daemon`, the other `e2e:daemon-idle*`), so every gate list, document and tracker row that names them stays true; `verify` names the kept ones. The alternative, giving the daemon scripts the shorter names, was not taken: it renames what a dozen records cite for no gain.
- *A case that only the embedded shape has* (the quit question's keep or stop, the app as the engine host's only client) is deleted, and the report lists it with one line on what it pinned. A case both shapes have runs on `mawsd`. `e2e/support/supervisor-scratch.ts` defaults to `mawsd`.
- *Cross-build* (`e2e/cross-build.spec.ts`, the two-build check behind acceptance 13). The tested build launches on `mawsd` in every scene. The update and downgrade scenes that ran both builds embedded run both on `mawsd`, which is the crossing the three machines make at every swap; the scenes that pin the peer to the embedded shape (an old app's engine host adopted by the new `mawsd`, and back) keep the peer there, since the peer's own code decides its shape. If a scene fails on `mawsd` for a reason in the product, that is a finding: stop and report it, and do not weaken the scene.
- *The measured groups.* `e2e/daemon-idle.spec.ts` loses its embedded baseline and A-B-A legs; the bound's constants stay as recorded, with the commit that could last re-derive them (this branch's merge base) named beside them. `e2e:artifacts-perf` moves to `mawsd` with the profile's daemon and hosts ended before each cold trial, since a relaunch of the app no longer makes them cold; its first-sync, durable-acknowledgement and acknowledged-loss assertions and its limits are unchanged.
- *Cold connector delivery* (`e2e/support/connector-cold-delivery.ts`) proved that an HTTP connector's delivery completes with the app gone, by standing in for the app on the engine host's socket. On `mawsd` the daemon is the engine host's permanent client and delivery is the daemon's (O4). Re-express the case as that: the app quits and `mawsd` completes the delivery, observed the way O4's no-app cases observe. If an O4 case already asserts exactly this, delete the embedded case and name the O4 case in the report.
- *The live keep-quit probe* (`e2e/p1-live-keep-quit.spec.ts`, E11's paid probe of a kept turn across an embedded quit) is deleted with its script and never run: its subject no longer exists, and acceptance 2 is checked live in M4.
- *The two mocked app startups* (`src/main/lifecycle.test.ts`, `src/main/sessions/main-wiring.test.ts`) start the app on the daemon branch, as `src/main/daemon-root.test.ts` does. Their assertions on main's shutdown order stay. Their assertions on what main hands its own session service move to where that service is composed now, the services' or the daemon root's tests. `src/main/profile-upgrade.test.ts` keeps its data-migration coverage as a test of the services' `openSpineData`, called directly; which process owns the data is `profile-upgrade-mawsd.test.ts`'s. `test/support/o2-profile.ts` keeps writing `shape: embedded`: it is the legacy profile M2's migration case needs.
- *Gate lists.* The deleted scripts leave `CLASS1_E2E`, `HOSTED_MAC_E2E`, `MAC_VM_E2E`, `MEASURED_E2E` and the packaged job together with `gate-plan.test.mjs`'s assertions. Two more tests in the static job derive from the real workflow and `package.json` and change with them: `.github/scripts/e2e-default-specs.test.mjs` expects the deleted keep-quit spec in the default set and pins that set's count, and `scripts/ci-gate-alerts.test.mjs` asks a plan for the retired `e2e:supervisor`. The rule: after the deletions, no file under `.github/` or `scripts/` names a deleted script or spec. CI-opt has two pull requests in flight on the same files (static's checks in parallel; a docs-only check). Rebase onto master before the branch's gates and keep both sides' edits.

**Does not touch.** Any file under `src/` that is not a test. Any limit. The peer build's behaviour in cross-build.

**Proves.** `--gates all` is green on M1's head with the job set less the deleted groups, and each ported measured group is within its unchanged limit. The report lists every deleted case with what it pinned and where that behaviour is still covered, or that it no longer exists.

### M2 — One launch outcome: `mawsd`, or the repair window

**At its end.** The app's hosts are always `mawsd`'s three relay links. Main never opens the machine's data, never takes `spine.lock`, never forks an engine host or a pty host. A launch whose daemon cannot start opens the repair window (acceptance 2). `supervisor.shape` no longer selects anything, Settings has no shape switch, and `MAWS_HOST_MODE` is read by nothing in the app. `pnpm dev:scratch` runs a development build on a profile of its own.

**Touches.** `src/main/app.ts`; `src/main/hosts/` (`mode.ts`, `index.ts`, `daemon.ts`, `status.ts`); `src/main/ipc/router.ts`; `src/main/client/settings-store.ts`; `src/main/lifecycle/` (`engine-quit.ts`, `quit-guard.ts`); `src/main/connectors/index.ts`; `src/services/machine/identity.ts` and the home of `COMMAND_BUDGETS_MS`, for what main imports of them; new `src/main/repair/`, `src/preload/repair.ts`, `src/renderer/repair.html`, `src/renderer/src/repair/`; `electron.vite.config.ts`; `src/shared/settings/defaults.ts`; `src/renderer/src/settings-tab/` (`SupervisorSettings.tsx`, `copy.ts`) and the status row's dead branches; `package.json`; `test/services/boundary.test.ts` and a bundle check beside `src/engine-host/bundle-guard.test.ts`; the unit tests of all of these; `e2e/settings.spec.ts`; new `e2e/repair.spec.ts`; the comments that describe two roots (the inventory's §4.4 lists them).

**Interfaces.** §A (the launch outcome), §B (the repair window), §C (the e2e fault), below.

**Decisions.**

- *The launch has two outcomes and no third* (§A's table). The rows that returned `detached` with a reason now return that reason as a failure. On a failure main does not call `startMain`: it creates no hosts, installs no router and opens no store of the machine's. The profile's machine identity (`<userData>/machine.json`, OX2) is still read or minted first, as today, since OX2 gives that to whichever of the app and `mawsd` runs first.
- *What the window does not cover.* It is the main profile's launch outcome and nothing else. A profile that is not the main one answers `private` at once and starts nothing, as today: its daemon is started by the app's transports inside `startMain`, and making that start a condition of the launch would put a start and a welcome in front of every scratch launch the suites make, for a failure that only a broken build or a held lock produces and that the status row already reports. A daemon that fails after the launch, on any profile, is the transports' retry and the same status row, unchanged.
- *A development build on the main profile.* It uses the main profile's unit when one is installed and loaded, as today, and never installs one. With none it fails with `no-unit` and the window names `pnpm dev:scratch`, a new script that runs `electron-vite dev` with `MAWS_USER_DATA` defaulting to `~/Library/Application Support/MAWS-dev`, beside `dev:stub`'s and `dev:harness`'s profiles; a profile that is not the main one gets a private `mawsd` as always. The alternative, a private `mawsd` on the main profile when no unit exists, was not taken: the main profile's services would then be the unit's on one day and a private daemon's on another, and a unit the owner turned off in Login Items would be bypassed by the next development launch. The rule that results is one sentence: the main profile's machine runs under its unit or not at all.
- *The repair window is a page of its own* (§B): its own renderer entry and preload, built in every build, with the app's tokens. The alternative, a native alert, was not taken: the suites cannot drive one without a seam that skips it, it cannot show log lines a person can select, and it cannot change in place while an attempt runs. The page imports nothing of the app's stores or IPC: it must load when nothing else can.
- *Retrying.* One attempt runs at a time; it re-reads the unit's state and runs §A's table from the top. Besides the button, one attempt starts when the window regains focus after Open Login Items was used, and when a second launch of MAWS arrives. No timer retries: a kickstart every few seconds against a job the owner turned off is noise in their system log. On success the window closes and the same process continues into `startMain`.
- *Settings.* No version bump (constraint 3). `supervisor.shape` and `supervisor.keepRunningDefault` are retired fields: both stay in the schema with their present types, so every existing file parses. `shape` reads and is stored as `daemon` whatever the file or a caller says, by one normalising function used at the client store's read and at its set; `keepRunningDefault` is kept as stored and read by nothing. Settings loses the shape switch and the "When quitting with work in flight" control with the copy only they used. `readLaunchShape` goes: the launch no longer depends on the settings file.
- *`MAWS_HOST_MODE` is retired.* Nothing in the app reads it to choose anything. Set to a value other than `daemon`, main logs once: `[hosts] MAWS_HOST_MODE is retired and ignored: the app runs on mawsd`. The scripts stop setting it. The helpers that strip it from a child's environment keep stripping it, since a peer build in cross-build still reads it.
- *Quitting.* The app's quit never stops, and never asks about, the machine's sessions or terminals; the unsaved-files question stays. The embedded keep-or-stop policy goes from `engine-quit.ts` and `quit-guard.ts`. The guard's behaviour on `mawsd` is not re-tuned here: tracker row #608's flake is not this milestone's.
- *What main keeps of the machine, on purpose* (constraint 5): the artifact scheme and render composition in `src/main/artifacts/`, and the two older-daemon answers. In `src/main/artifacts/index.ts` only the configuration that existed for a launch with no daemon to ask goes, and only if it separates cleanly from the older-daemon path; otherwise it stays and the report says so.
- *The absence checks.* `test/services/boundary.test.ts` reverses its allowance: no module under `src/main/`, `src/preload/` or `src/renderer/` imports `src/services/spine-root.ts`, `src/services/entry.ts` or `src/services/checkouts-root.ts`, directly or through a re-export. Main takes `COMMAND_BUDGETS_MS` and the identity bootstrap from modules that import none of the three; the command registration that `startMachineIdentity` did for the embedded shape goes with it. A bundle check reads the built `out/main/index.js` and `out/main/app.js` with their chunks and fails if any of the three modules is in their graph. If, after the move, the app's graph holds no module under `src/services/` at all, assert that wider rule instead.
- *`host.status`* reports `daemon` as its transport and no unavailability on every launch that reaches the app. The renderer's branches and copy for the other values go. A schema member is removed only if no process of another build sends or reads it (constraint 4).
- *Where there is no unit manager* (the app run on a platform that is not a Mac), the main profile's outcome is `no-unit`.

**Does not touch.** `src/services/**`, `src/mawsd/**` and the engine host beyond the import move above; `src/shared/host/detached-transport.ts`; the older-daemon answers; the build check that asks a daemon of another build to restart; the index; the client settings version; anything of the project registry.

**Proves.** Acceptance 1, 2 and 3. Unit: every row of §A's table; the normalisation at read and at set, with every other setting kept; one attempt at a time, the focus retry and the second-launch retry; the log tail's cut. E2e (`e2e/repair.spec.ts`, added to the `e2e:supervisor-daemon` script's file list so that no gate list changes, and skipping without that script's `MAWS_SUPERVISOR_E2E=1` as `supervisor.spec.ts` does; `e2e-default-specs.test.mjs`'s count moves again): cases 1 to 4 under §C. `e2e/settings.spec.ts`'s shape-flip case becomes §C's case 5. Acceptance 3's data is the cross-build scene §C names. The unit's own path end to end, a LaunchAgent under a scratch label, stays the `daemon-unit` group's. `--gates all` and `--gates packaged` are green on the branch's head.

### M3 — The final build on the three machines

**At its end.** The MacBook, the mini and `dc-linux171-1e68` run one master commit, **F**, that holds M1 and M2; production's hub is deployed from a master that holds PR #538; staging runs F. Each machine keeps cf30dafdd as its rollback.

**Decisions.**

- *F is fixed when the first machine swaps.* A docs-only landing after that does not move it. A code landing after that reopens M4 for the claims it can reach, by the architect's reading of the diff, recorded in the Decision Log.
- *Gates on F before the swap*, each through `scripts/ci-gate.sh`: `--gates all` and `--gates packaged` (acceptance 1b); the measured groups `e2e:local-latency-daemon` (1c), `e2e:daemon-idle`, `e2e:daemon-idle-render`, `e2e:daemon-idle-session-host` and `e2e:daemon-idle-enrolled` (14, the mini's series), `e2e:remote-latency` (4m to 4q, the one-host leg); `e2e:cross-build` against the newest master commit one wire minor below F, 63443a3bd while F is at 3.33 (13: the gate script runs the two-build check only across a minor, and one minor is what the item names). A job that is green only on a rerun is recorded with its failure's signature. A job red twice blocks the swap.
- *The hub deploy is the owner's command*, from a checkout of F (`production-run.sh checkout`, then the deploy command it prints). The desk track deploys staging.
- *The swap is the live check of two claims*, so two things are staged first. For 1d, on each Mac, a read of the profile's counts (projects, sessions, artifacts, library items, drafts, open tabs in the layout) and of the index file's identity. For 13, on the mini, a lane B session mid-turn with a background shell running and a permission pending. After the swap the counts are read again, the index is the same file with no rebuild line in `mawsd.log`, and the staged turn completes with its input applied once, its permission card shown once and the shell's completion reported once.
- *The swap needs the owner's approval* at the time. The desk track swaps the MacBook and the VM, mini-ops the mini, as at every swap. Each reports its times, builds, wire, sminos version, the count of error lines, and how long the hub took to connect.

**Proves.** Acceptance 1b, 1c, 1d, 13, and the mini's half of 14, on F.

### M4 — The closing run

**At its end.** Every claim has its result on F. The table below is the run. Its claim ids are the evidence inventory's, which also holds each claim's earlier evidence.

**How a claim is checked.**

- **G**, a gate or a measured group on F's tree (M3 ran them).
- **S**, the swap itself, staged before and read after (M3).
- **L**, live on the production machines on F, driven by an agent: the MacBook's MAWS through `cua_repl` with the owner's approval and the window given for the time, the mini's through mini-ops, the VM through the desk track. Every Touch ID is the owner's.
- **T**, the desk track's run on staging on F, for the cases the item names staging for or that production cannot host.
- **B**, the real-network bench from the MacBook.
- **O**, the owner's own hands.
- **C**, cited from the record, with the reason a new check adds nothing.

A claim that fails is not retried until it passes. It is recorded as failed with what was seen, and then either fixed (a code landing, which moves F by M3's rule) or put to the owner as a ruling: waive, or carry with a tracker row. Nothing is waived by the architect.

| Claim | How | What is done on F | Passes when |
|---|---|---|---|
| 1a signed-out parity | L | F's packaged app on a scratch profile on the MacBook, signed out, with a private `mawsd`: open a project, a new chat with one real turn and one permission, Files open, edit and save, Source Control's diff, a terminal, an artifact made and opened, the library, a browser tab, a setting changed and kept across a relaunch, a quit with the turn still running | each surface works as at c3507722d, with nothing asking to sign in |
| 1b e2e groups on `mawsd` | G | `--gates all`, `--gates packaged` | green; rerun passes named |
| 1c OX7 | G | `e2e:local-latency-daemon` on the mini | p50 ≤ 26.45 ms, p95 ≤ 42.56 ms |
| 1d everything present, no re-index | S | counts and the index's identity before and after the swap, on both Macs; Settings › Connectors read on each Mac for O4's adoption record | every count equal or higher by what was made since; same index file; no rebuild line; the connectors' grants listed with no new sign-in |
| 2a tool calls with the app quit | L | on the MacBook, a lane B session told to wait a minute, then write an artifact and refresh a dataset with its `maws` tools; MAWS quit during the wait for three minutes | both calls completed inside the quit window, by their times |
| 2b index and attention keep deriving | L | in the same run: the session's state read from the mini's MAWS while the MacBook's is quit; a terminal session's transcript written during the quit | the mini shows Working, then the next state, with no pause; the transcript is listed at reopening |
| 2c no gap at reopening | L | the same session reopened | the transcript is whole, the card shows once; the record says whether the replay came from the journal, and if the ring never overflowed that half stays on O3-D's gate |
| 3a one sidebar, by org project, with machines | L | the MacBook's sidebar read with sessions live on all three machines | sessions of the mini and the VM sit under the org projects this Mac holds, each row with its machine. Projects this Mac does not hold group only with the registry (Decision Log 265), carried |
| 3b states match `sminos list --org` within 2 s | L | five state changes of one mini session, each timed at the row and at `sminos list --org` on one clock | each pair within 2 s |
| 3c no project, under the machine | L | a session at the machine's home on the mini and on the VM | each sits under its machine |
| 4a to 4l, twelve actions on each machine | L | from the MacBook, one fresh lane B session on the mini and one on the VM, in a scratch folder with no output style: stream, send, steer, interrupt, approve, deny, answer a question, send an image, show a diff with an untracked file in it, open and edit a file, run a terminal, and open, edit and screenshot an artifact | all 24 cells pass; for 4a the reply's text is seen to grow at three or more readings in one turn |
| 4m to 4p the remote bounds | G, B | `e2e:remote-latency` on the mini (M3); `e2e:remote-latency-live` from the MacBook against a bench machine on the mini and on the VM, enrolled for the run and removed after (O7's document, "The live bench"; tracker row #605) | on each carrier, delta to paint p50 ≤ local p50 + one round trip + 10 ms; a command ≤ two round trips + 20 ms; open to first row ≤ 1.5 s; resume ≤ engine start + one round trip. A run its own precheck or clock check voids is void, never averaged in |
| 4q each transport | B, L | the bench's direct and relay legs; the link's hover read during 4a to 4l | both legs measured; the hover names the carrier in use |
| 5a, 5b spawn in the sidebar within 5 s | L | "+ Session" on the mini and on the VM from the MacBook, the row's first sight timed against the engine's first event in the machine's log | ≤ 5 s on each |
| 6a, 6b lane A's controls | L | a terminal session on the MacBook and one on the mini, from the MacBook's MAWS: send, steer, interrupt, answer a question, approve, set the model, set the effort | each takes effect in the terminal session |
| 6c unreachable controls say why | L | the disabled controls of those two sessions read | each is disabled with its reason |
| 6d no bridge, read only | L | a terminal session started without sminos's bridge | its row opens read-only |
| 7a to 7d the laptop asleep | O | the MacBook asleep for an hour with MAWS open; before it, a session on the mini and one on the VM given an hour's work that asks a question at about minute 10 and meets a permission prompt at about minute 25 | both sessions worked through the hour by their logs; each card reached the phone and was answered there; each waited until its answer |
| 7e resume within 1 s of the network | O, L | MAWS started from a terminal for this sitting so main's log is kept (tracker row #586); a probe on the MacBook timing the first connection that succeeds after the wake | every link, the org feed and every open subscription resumed within 1 s of that time, each from its cursor, no event missing or doubled against the machine's journal |
| 8a, 8b two clients | L | one mini session open in the MacBook's MAWS and the mini's; a question answered from each side in turn | both show the same turn's text growing; each answer settles the other side's card |
| 9a, 9b, 9c the trust cases | T, C | the desk track's trust run on staging on F: an action and an event placed by the hub, a request card altered after its digest, a device removed and then used. Cited beside it: O10's production run (Decision Log 145) and version 24's adoption (263, 264) | each is refused with its reason |
| 9x the admin device | C, L | Decision Logs 263 and 264; the Org page read on F | one root, this Mac's; "This Mac signs the org state." |
| 10a to 10c tools with no app | L | on `dc-linux171-1e68`, no app attached, a scripted lane B session calls `artifact_screenshot` and `artifact_export` and reads the browser capability (the owner's ruling that a scripted run closes this item, Decision Log 169) | a PNG and a PDF come back; the capability is offered, or refused with its reason before any call |
| 11a owners on shared rows | C | Decision Log 263's step 7, on staging at cf30dafdd. Production has no session with two owners, and M2 does not touch the rows | cited |
| 11b a `say` carries its owners | L | a `sminos say` from a MacBook session to one on the mini and one on the VM | each receiver reads the owner's label, `verified`, signed by the machine |
| 11c drawn as a peer message | L | the receiving session's pane and the project's Channel tab read in the MacBook's MAWS, which is also O8's item 7 (Decision Log 264) and the migrated-history label's check (Decision Log 155) | the message shows as that agent's, with its owner; the Channel tab shows the three machines' sessions; an event from before the move reads "attested at migration by" its machine |
| 12a to 12c the people model | T | the desk track's staging run on F with a second member added by an org-state edit: listings by visibility, the member's own sessions in full, and `converse` and `approve` refused at `listed` | all three stated in the run's output |
| 13a to 13c upgrades mid-turn | S, G | the staged session across the swap (M3), which restarts `mawsd`, replaces the app and hands the engine host over; `e2e:cross-build`. The swap crosses one build within a minor; a minor's crossing rests on the gate's runs (Decision Logs 209, 217) | M3's conditions |
| 14a, 14b the MacBook's idle cost | O, L | a window of about 25 minutes with MAWS quit on both Macs (a watching app keeps the other machine loaded, Decision Log 173) and no session on the MacBook working; a sampler started beforehand reads `mawsd` and the engine host | over ten minutes, CPU ≤ 1.30 s and footprint ≤ 107,337 KiB: Decision Log 128's bound plus the enrolled endpoint's 0.18 s and 8 MiB (Decision Logs 114, 124) |
| 14c idle sessions released | O, L | a lane B session left idle at the window's start | released after the profile's idle minutes |
| 14d, 14e the endpoint's budget | G | `e2e:daemon-idle-enrolled` on the mini | ≤ 8 MiB and ≤ 0.18 s per 600 s over the unenrolled reading |
| 15a to 15c the local boundary | G, L | the socket suites in `--gates all`; on each machine, every socket under the profile listed with its owner and mode, and the listening TCP ports of `mawsd` and its hosts | every socket is the owner's, mode 0600 in a 0700 directory, none a symlink; no listening loopback port but the connectors' sign-in listener while a sign-in runs |
| 16a to 16c the verdict | O | from 2026-11-14, the owner asked: is MAWS the one interface, and what still sent you to a terminal or to desk-web | their words, recorded |
| O15's acceptance 2, the repair window for real | O, L | on the MacBook in the quiet window, after the idle reading: the owner turns MAWS off under Login Items & Extensions and opens MAWS; then turns it on from the window's Open Login Items… and comes back to the window | the window shows with `install-refused` and macOS's own words, and no other MAWS window; no engine host or pty host is a child of MAWS; on the return the window closes without a click and the app opens with its sessions |

**The owner's time.** What only the owner can do: the hub deploy; the swap's approval; a sitting of about two hours in which the agent drives MAWS on the MacBook and the owner gives Touch ID where asked (rows marked L on the MacBook); the quiet window of about 45 minutes (14a to 14c, the repair window's live check, then the bench with its four Touch IDs for the bench machines' enrollment and removal); the asleep hour (7); the verdict. The owner agreed to all three sittings on 2026-11-10 (Decision Log 3); their times are set with the owner after the swap.

### M5 — The record and the verdict

**At its end.** P5's "Outcomes and retrospective" holds: the table of 67 results with each one's date, build and evidence; what each child delivered against P5's purpose; what is carried, each with its tracker row; the lessons. The tracking map's O15 row reads done, and P5's Decision Log has the closing entries. The registry's execution document records F in its Progress, which releases its constraint 1.

**Decisions.**

- *The risk row on the org root's key is corrected, not closed.* It reads today "Production's org root is a software key until O8". Since O8 M8 the root is this Mac's step-up key, and it is still a software key: a P-256 private JWK in `<userData>/device/keys.json` (directory 0700, file 0600, excluded from Time Machine where the exclusion succeeds), beside the device's channel key. Touch ID gates the app's signing flow, not the key: a process running as the owner that can read the profile can read both keys. The row says that, with what bounds it (FileVault, the paper recovery key offline) and what would end it (keys bound to the Secure Enclave, which need a build signed with a Developer ID, deferred with it). A tracker row carries it.
- *Tracker rows written here:* the older-`mawsd` render and delivery answers in main, to retire once every `mawsd` the app can meet advertises both capabilities; the two retired settings fields, to drop at the next client settings version; the idle bound's re-derivation, which now needs the build before M2 as its comparator; the key custody row above.
- *Items handed to O15 by name* are each closed in Outcomes: the migrated-history label (11c's row); RL10's projects (the registry); O8's item 7 (11c's row); the admin device (9x); O17 (landed whole, Decision Logs 209 and 210); the MacBook's cold idle reading (14a, 14b); O4's Keychain adoption (1d's row); Decision Log 161's field check (answered by Decision Log 239's swap counts and M3's); O14 B2's step 9, the owner's look at the hub's logs of 2026-10-29, whose failure #345 fixed and whose logs are past retention, put to the owner to close.
- *P5 §2's "Two composition roots" paragraph* gets one dated sentence that the embedded root was deleted, with the Decision Log's number. Children's documents are history and are not edited.
- *The verdict is asked from 2026-11-14*, a week after the swap that began the owner's week (Decision Log 249), through `mcp__sminos__AskUserQuestion`, and recorded in the owner's words.

## Concrete Steps

**M1 and M2, the executor.** One branch, `p5-o15`, in a worktree of the architect's checkout:

    cd /Users/new/.local/share/maws-architect/maws-arch
    git fetch && git worktree add .claude/worktrees/p5-o15 -b p5-o15 origin/master
    cd .claude/worktrees/p5-o15 && pnpm install

Locally, only a focused run that starts no Electron and checks no types, one at a time (constraint 6):

    pnpm exec eslint <one file>
    pnpm vitest run --project node <one test file>

Everything else through the gate script, from the worktree, the typecheck, the whole lint and the unit suite included. Class 1a alone is cheap and may run at any time, and runs green on a head before any of the Mac runs below:

    ./scripts/ci-gate.sh . --gates static,unit,probes --class1a linux --runner macos --peer none --label p5-o15

The runs below hold the one CI Mac, the mini, for up to 70 minutes, and the measured groups need it quiet. Before each, tell the architect, who clears the time with CI-opt:

    ./scripts/ci-gate.sh . --gates all --class1a linux --runner macos --label p5-o15-all
    ./scripts/ci-gate.sh . --gates packaged --runner macos --label p5-o15-pkg
    ./scripts/ci-gate.sh . --gates e2e:artifacts-perf,e2e:daemon-idle,e2e:local-latency-daemon --runner macos --peer none --label p5-o15-measured
    ./scripts/ci-gate.sh . --gates e2e:cross-build --runner macos --peer 63443a3bd --label p5-o15-cross

The gate script runs the two-build check only between trees a wire minor apart, so its peer is 63443a3bd, the newest master commit at 3.32 while this tree is at 3.33; if this branch takes a minor (constraint 4), the peer is cf30dafdd instead. Each run prints every job's conclusion and ends `ci-gate: run <id> success`. A red job's report is under `/tmp/maws-review/gates/`. What M2's cases show, in `e2e/repair.spec.ts`'s own words once written:

    the daemon cannot start: the repair window, and nothing else
    the daemon can start again: Reinstall and Start or Try Again opens the app
    Open Login Items, then the window's focus, tries once
    closing the repair window quits MAWS
    a profile saved on the embedded shape opens on mawsd with everything present

The executor's report goes to `docs/doperpowers/plans/2026-11-10-p5-o15-report.md`. It opens a pull request to master and does not merge it; the architect lands it.

**M3, the architect with the desk track, mini-ops and the owner.**

    # the architect, in the architect's checkout at F
    ./scripts/ci-gate.sh <checkout> --gates all --class1a linux --runner macos --peer 63443a3bd --label o15-final   # a minor apart, so the plan adds e2e:cross-build
    ./scripts/ci-gate.sh <checkout> --gates packaged --runner macos --label o15-final-pkg
    ./scripts/ci-gate.sh <checkout> --gates e2e:local-latency-daemon,e2e:daemon-idle,e2e:daemon-idle-render,e2e:daemon-idle-session-host,e2e:daemon-idle-enrolled,e2e:remote-latency --runner macos --peer none --label o15-final-measured

    # the owner, in a Terminal window, never an agent
    zsh apps/desk-hub/deploy/production-run.sh checkout     # prints the deploy command for F
    zsh apps/desk-hub/deploy/production-run.sh wait <F's first 8 characters>

The swap follows the earlier swaps' steps (P5 Decision Logs 249, 256, 259, 262), with M3's two stagings before it and its reads after it.

**M4.** Each row of the table is run as its "What is done" says, by the role its method names. Evidence goes to `~/.local/share/maws-architect/o15-evidence/<claim>/`, and each row's result (time, build, pass or fail, one line of what was seen) goes into this document's Progress as it is obtained.

## Interfaces and Dependencies

### §A. The launch outcome (`src/main/hosts/daemon.ts`)

    export type LaunchShape = { daemon: 'unit' | 'private' };
    export type UnavailableKind = 'no-unit' | 'not-loaded' | 'install-refused' | 'not-started';
    export interface Unavailable { kind: UnavailableKind; why: string }   // why: the system's or mawsd's own words, one line
    export type LaunchOutcome = { ok: true; launch: LaunchShape } | { ok: false; unavailable: Unavailable };

`resolveLaunch` answers a `LaunchOutcome`, and its input no longer carries the setting.

| Profile | Build | The main profile's unit | Outcome |
|---|---|---|---|
| not the main one | any | not read | `private` |
| main | packaged | any | the unit is installed or repaired to run this bundle, asked to start, and must welcome a hello within `UNIT_READY_MS`: then `unit`. The install refused: `install-refused`. No welcome: `not-started` |
| main | unpackaged | installed and loaded | asked to start, and must welcome: then `unit`. No welcome: `not-started` |
| main | unpackaged | installed, not loaded | `not-loaded` |
| main | unpackaged | not installed, or no unit manager | `no-unit` |

A test or harness launch on the main profile exits before the table, as today. The first row is today's and starts nothing (M2, "What the window does not cover").

### §B. The repair window (`src/main/repair/`, `src/preload/repair.ts`, `src/renderer/repair.html`, `src/renderer/src/repair/`)

    export interface RepairState {
      kind: UnavailableKind;
      why: string;
      packaged: boolean;      // decides the retry action's label
      attempting: boolean;    // an attempt is running: the actions are disabled
      log: { path: string; lines: string[] } | null;
    }
    export type RepairAction = 'retry' | 'open-login-items' | 'reveal-log' | 'quit';

The preload exposes `window.repair`: `state(): Promise<RepairState>`, `onState(listener): () => void`, `act(action: RepairAction): void`, over three channels of its own, `repair.state`, `repair.changed` and `repair.act`. Main's side is one function that takes the first failure and a function that attempts the launch again, resolves with the `LaunchShape` of the first attempt that succeeds, and quits MAWS when the window is closed or `quit` is acted.

`log` is the last 20 lines of `<profile>/mawsd/mawsd.log`, each cut at 300 characters, read at every state change; of `mawsd.out` when the log has none; null when neither has any. `open-login-items` opens `x-apple.systempreferences:com.apple.LoginItems-Settings.extension`. `reveal-log` shows the file in Finder.

The words. The window's title is `MAWS`. While an attempt runs the page shows `Starting mawsd…`.

| Kind | Headline | Body |
|---|---|---|
| `no-unit` | This development build has no machine daemon for your main profile | MAWS runs its sessions, terminals and index in a background process, mawsd, which only an installed MAWS.app sets up for the main profile. Run this build on a profile of its own with `pnpm dev:scratch`, or install MAWS.app and open this build again. |
| `not-loaded` | MAWS's machine daemon is turned off | mawsd is installed, but macOS has not loaded it. In System Settings › General › Login Items & Extensions, under Allow in the Background, turn MAWS on, then come back to this window. |
| `install-refused` | macOS did not let MAWS set up its machine daemon | MAWS runs its sessions, terminals and index in a background process, mawsd, and could not load it: {why}. If MAWS is turned off in System Settings › General › Login Items & Extensions, under Allow in the Background, turn it on, then come back to this window. |
| `not-started` | MAWS's machine daemon did not start | macOS loaded mawsd, but it did not answer within 10 seconds: {why}. Its last log lines are below. |

| Kind | Actions, the first the default |
|---|---|
| `no-unit` | Quit MAWS; Try Again |
| `not-loaded` | Open Login Items…; Try Again; Quit MAWS |
| `install-refused` | Open Login Items…; Reinstall and Start; Quit MAWS |
| `not-started` | Reinstall and Start on a packaged build, Try Again on a development build; Show Log in Finder; Quit MAWS |

Reinstall and Start and Try Again are the same action, `retry`: on a packaged build §A's table installs or repairs the unit before it starts it, and the label says so.

### §C. The e2e fault, the five cases and acceptance 3's scene

`MAWS_E2E_UNIT_FAULT=<absolute path>` is honoured only when `MAWS_E2E=1` and the app is unpackaged, on a profile that is not the main one. While the file exists and its trimmed content is one of the four kinds, the launch's outcome is that failure with `why` `e2e fault`; otherwise the row's own outcome, `private`. A packaged app ignores it. The fault replaces the table's answer, so it proves the window and what main does and does not compose around it. The table's own rows (the unit installed, refused, started, welcomed or silent) are pinned by unit tests over a faked unit runner, as `src/main/hosts/daemon.test.ts` does today, and are seen for real once, in M4's live check of the window.

1. *The daemon cannot start.* With the fault `not-started`, the first window is the repair page with that headline; no app window exists; `spine.lock` is held by no process; the profile's `mawsd/` directory holds no lock this launch made.
2. *It can start again.* The fault file removed and the retry action pressed: the repair window closes, the app's window opens, and its session list loads.
3. *Login Items.* With `not-loaded`, Open Login Items… asks for the settings URL (read through the suite's record of external opens where one exists, else pinned in the unit test alone), and the window's next focus starts exactly one attempt.
4. *Closing quits.* The repair window closed: the process exits with code 0.
5. *A saved `embedded`* (`e2e/settings.spec.ts`). A scratch profile whose client `settings.json` holds `supervisor.shape: embedded` beside three other settings off their defaults: the launch runs on `mawsd`, whose pid holds `spine.lock`; the three settings read as written; after the first settings write the file's `shape` reads `daemon` and its version is still 21.

*Acceptance 3's data.* A hand-built profile cannot prove it: `test/support/o2-profile.ts` seeds the index alone, and the library's first reconcile with the engine host deletes rows the host does not hold. The proof is the cross-build scene whose peer runs embedded (M1 keeps it): the peer, a real build with the embedded shape, makes a session, an artifact, a draft and a layout of more than one tab on a profile and quits; the tested build opens that profile on `mawsd`. The scene asserts, after the library's first sync and again after a relaunch of the tested build: the session listed, the artifact in the library and openable, the draft, the layout's tabs, and no index rebuild in `mawsd.log`. It needs a peer that still has the embedded shape and skips, saying so, against a later one; M5 files its retirement.

### Dependencies

No new package. The repair page uses the renderer's existing build (React, Tailwind, the tokens). CI-opt's two pull requests on `.github/` (M1's gate lists). The desk track's registry M1 and M2 may land before F and are part of it.

## Surprises & Discoveries

- Observation: the embedded shape was not only a setting. A launch on the main profile whose LaunchAgent is absent, not loaded, refused or silent ran embedded without anyone choosing it (`planShape`, `prepareShape` in `src/main/hosts/daemon.ts`).
  Evidence: the inventory of the embedded root, §1.3, read against the code on 2026-11-10.
- Observation: both of a native Mac's signing keys, the channel key and the step-up key that is now production's root, are plaintext private JWKs in one file; Touch ID is a step in the app's flow and binds nothing to the key.
  Evidence: `src/main/device/keys.ts` (the record and its write), `src/main/device/step-up.ts`; the inventory's §5.
- Observation: a client settings file of a version newer than a build knows is read as the defaults, so a version bump here would cost a rolled-back machine its settings.
  Evidence: `migrateSettings` in `src/shared/settings/defaults.ts`: any other version throws, "which a store turns into the defaults with a warning".

## Decision Log

1. **2026-11-10, the architect, at authoring: the verification.** This document's M1 and M2 are reviewed for buildability by `doperpowers:adversarial-reviewer` before the executor starts. The executor's loop reviews each milestone at its boundary. The branch is reviewed at `doperpowers:reviewer-high` before it lands, for two things above all: what a launch on the owner's main profile does when the daemon cannot start, and that no path leaves the machine's data with two writers or none. Its gates are `--gates all` and `--gates packaged` on the head, with the measured groups M1 ported. M3 to M5 are verified by their records: every result in M4's table names its evidence, and a result with none is not a pass.
2. **2026-11-10, the architect, at the adversarial review of M1 and M2 (three findings, all taken).** (a) The first draft's launch table let a profile with a private daemon succeed at once while acceptance 2 promised the window for any daemon that cannot start. The contract is narrowed, not the code widened: the window is the main profile's launch outcome, and a private daemon that fails to start, or any daemon that fails after the launch, shows where it does today (acceptance 2; M2, "What the window does not cover"). The alternative, a start and a welcome awaited for every private daemon before the app composes, was not taken: it changes the start of every launch the suites make, for a failure only a broken build produces. Because §C's fault then proves the window and not the unit's rows, the rows stay on unit tests over a faked runner and M4 gains a live check of the window on the MacBook. (b) Acceptance 3's proof moved from a hand-built profile, which the library's first reconcile would empty, to the cross-build scene whose peer really runs embedded; §C's fifth case keeps only the saved setting. (c) M1 names two more tests of the static job that read the real workflow and `package.json` (`e2e-default-specs.test.mjs`, `ci-gate-alerts.test.mjs`), with the rule that nothing under `.github/` or `scripts/` names a deleted script or spec.
3. **2026-11-10, the owner, on the closing run (three questions through sminos).** An agent drives the live checks on the MacBook and the owner gives Touch ID ("Agent drives, I give Touch ID"); one 45-minute quiet window for item 14's reading and the real-network bench ("Yes, one 45-minute window"); the full hour asleep for item 7 ("Yes, the full hour"). So no claim of items 4, 7 or 14 starts as a ruling.
4. **2026-11-10, the executor, at pre-flight: the branch's base and its integration.** The architect's dispatch puts the branch on `origin/o15-doc` at 8e7fb3c40 (this document and its inventories, landing on master in parallel), not on `origin/master` as Concrete Steps say, and integrates master by merge, never by rebase. So M1's "Rebase onto master before the branch's gates" reads as: merge `origin/master` into the branch once the architect says `o15-doc` has landed, keeping both sides' edits of CI-opt's `.github/` changes. A merge keeps every commit this document and the report cite. M1's own proof (`--gates all` on M1's head, and the measured groups it ported) runs before M2 is built on it only if the architect clears the Mac for it then; otherwise the same runs on the branch's head carry both milestones, and the report says which.
5. **2026-11-10, the architect, answering the executor's checkpoint: no local typecheck, and the Mac at M1's boundary.** (a) The first draft allowed `pnpm typecheck` on the MacBook (constraint 6, Concrete Steps' "Locally" lines) against the owner's standing rule of 2026-11-02 that bars local typechecks on this Mac, a bigger heap included; the executor met it as a heap exhaustion in `tsc -p tsconfig.node.json`. A second correction the same day, from the rule as first recorded: no typecheck of any kind and no multi-file eslint or vitest at any load. Both places now allow a focused run alone, eslint on one file or vitest on one test file, with the typecheck, the whole lint and the unit suite in class 1a, and class 1a green on a head before any run that holds the CI Mac. (b) M1's proof is spent at M1's boundary, before M2 builds on it: class 1a green on M1's head, then `--gates all`, the measured groups M1 ported and `e2e:cross-build --peer 63443a3bd`, each cleared by the architect, since a fault found only after M2 could not be told apart from the deletion. On the branch's head after M2: `--gates all`, `--gates packaged` and `e2e:cross-build` again; the measured groups a second time only if M2 changed one of their specs or the code they measure in a way the executor cannot rule out, since M3 measures the landed build anyway. This settles Decision Log 4's conditional.

## Outcomes & Retrospective

Pending — written at finish.
