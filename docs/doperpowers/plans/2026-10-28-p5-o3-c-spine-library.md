# P5 O3-C: the spine as a library with two roots (2026-10-28)

> **Parent:** `docs/doperpowers/plans/2026-10-28-p5-o3-spine.md` (O3's composite spec), child **O3-C**, §"O3-C: The spine as a library with two roots — plan". Parent pin: blob `b827bb96f` at master `5698b6ef0` (O3 Decision Logs 1 to 11). O3-C's section there is this document's design, approved with the composite: its purpose, acceptance 1 to 7, edges and contracts **O3X2**, **O3X3** and **O3X4**.
>
> **What binds.** From O3's design: §5 (what moves at O3-D, at O3-E, and what stays in the app) [binding]; §7's interface, the one view every staying consumer reads the spine through [binding], its shape advisory; §1 to §4 as O3-A built them (O3X1 to O3X3: the file owners, `spine.lock`, the settings split, the browser's own database); §9's "O3-A, O3-B and O3-C bump nothing"; §6 and §11 advisory. O3 Decision Log 2 (the grounding map of staying readers) is pre-landed input, re-read against master below (Interfaces §C); Decision Log 11 is O3-A's landing and its flow-back to O3-C. From P5 (`docs/doperpowers/plans/2026-10-27-p5-org.md`, blob `7dfa2cb51`): §2 (two composition roots until M2 closes), OX4 (the client port), OX5 (interest), OX7 (the local latency budget), OX9 (grades, unchanged here). Charter D-1.
>
> **Built on.** O3-A, landed (PR #311, master `e1c8d35a3`): `settings.json` the client file at version 21, `machine-settings.json` at 1, `spine.lock` over O2's `takeLock`, migration 14, `browser/browser.sqlite`, and the refused run (O3 Decision Log 11, residue 1 to 4). O1's `MachineBinding` and client port, O2's `mawsd` (untouched here), O6's local machine binding and connection manager.
>
> **In flight beside it.** O3-B (branch `p5-o3-b`: the e2e default flips to the daemon shape; touches `src/main/hosts/mode.ts`, `src/main/lifecycle/quit-guard.ts`, `e2e/support/*`, `tsconfig.e2e.json`). O9's local half (branch `p5-o9`, M2 to M8: `src/main/lane-a/`, a block in `src/main/index.ts`, `MACHINE_BOUND` gaining `lane-a`). Constraints says how each meets O3-C.
>
> **What this file holds.** The execution only: constraints, orientation, where every file goes, the milestones, the commands, the interfaces, and the record. Each decision O3-C's section leaves open is made where it binds and listed in the Decision Log (D1 to D25) with the alternative it beat, for the architect to fold into O3's Decision Log under O3-C. One writer: the controller of this document's execution (doperpowers:subagent-driven-execution's), never the parent documents.

## Purpose

O3 moves MAWS's machine services (the session index and read model, attention, the owner channel, the session service, settings' machine half, and later git, scm and files) out of Electron main into `mawsd`, so they keep running with the app quit and serve every client of the machine. O3-D is that move. It is reviewable only if, when it starts, the code that moves is already a library that any process can compose, and the code that stays already reads it through one door that O3-D can re-hang on a socket.

Nothing a person sees changes in O3-C. What changes is the code's shape, so the next landing changes a process and not a design:

- **The spine is a library.** Everything §5 moves at O3-D (and git, scm and files, which move at O3-E) lives under `src/services/`, imports nothing from Electron or from `src/main/`, and is composed by two functions, one per set, that take every dependency they need. Main's startup calls them ("the embedded root"); at O3-D `mawsd` calls the same functions ("mawsd's root").
- **The app reads the spine through one view.** The notifier, the quit guard, the chat panels, the browser, connectors, the export authors, the org rows, Settings' reveal, and (until O3-E) files, `git.lsFiles` and scm read records, digests, attention, intents and the rest only through `SpineView`. Main's startup holds nothing of the spine but that view, the machine half of the settings it composes the renderer's settings from (O3X3), and the roots' stop functions.
- **The sweep follows interest.** The inactive sweep keeps what the machine's interest set holds (OX5), not what `layout.json` says, so at O3-D a session a remote viewer watches is never archived.
- **O3-D starts from a number.** The spine composed alone under the runtime `mawsd` uses, idle over a profile the size of the owner's, has a measured footprint, loaded and released.

**How to see it working.** `pnpm exec vitest run src/services/spine-root.test.ts` composes the spine under plain Node against a fake engine host, plays a replay into the index and attention, and reads `session.list` and `attention.list` back. `npx eslint .` and the bundle guard (`pnpm build:main-preload && pnpm exec vitest run src/engine-host/bundle-guard.test.ts`) show the library reaches no Electron. The app, built from the branch, behaves as on master across every hosted Mac e2e group. Concrete Steps has each command.

## Progress

- [ ] M1 — The services bus: the library stops importing main's IPC
- [ ] M2 — Main's view of the spine, and the sweep on interest
- [ ] M3 — The library moves to `src/services/`, behind its boundary
- [ ] M4 — Two roots and the services entry
- [ ] M5 — The spine's idle reading (`e2e:daemon-idle-spine`)
- [ ] M6 — Landing: the acceptance run, O9's half, the bench and the review

## Acceptance

O3-C's acceptance, as its section states it, each with the check that proves it. Concrete Steps has the commands.

1. **The spine composes under plain Node.** `src/services/spine-root.test.ts`, in vitest's `node` project, opens a scratch profile's spine data (`spine.lock` taken, the settings split run), starts `startSpine` against the fake engine host and the fake bus of Interfaces §G, launches a replay session through `session.replay.start`, and sees its events folded: `session.list` answers the replay's record, `session.digests` its digest with the replayed turn's last assistant line, and `attention.list` the pending permission raised while it played. `startCheckouts` composes over the spine's view in the same process and `git.status` answers for a scratch repository. After both roots' `stop()`, the fake engine host holds none of the listeners the spine registered.
2. **No library file reaches `src/main/ipc/` or Electron, directly or through its imports.** Lint: `src/services/**` imports neither `electron` nor anything under `src/main/`, `src/mawsd/`, `src/renderer/` or `src/preload/` (rule A, Interfaces §E), and `test/services/boundary.test.ts` shows the rule fires. Bundle: the services entry, built as `out/main/services.js`, and every chunk it requires load only Node's builtins, `zod` and the MCP SDK, never `electron`, with no dynamic `import()` (`src/engine-host/bundle-guard.test.ts`). `MACHINE_BOUND_ALLOWED` is `['src/main/connectors/oauth-root.ts']`.
3. **Every staying consumer reads the spine only through §7's view.** Lint rule B: no file under `src/main/` but its root, `src/main/index.ts`, imports from `src/services/`, and the root imports only the services entry. By construction: `openSpineData` returns the refusal and the machine half's service (O3X3's, from which the client half composes the renderer's settings), the roots return the view, the stop functions and the checkouts' `readResolved`, and nothing else, so main's root holds no index, read model, intent store or service.
4. **The sweep reads the interest set, not `layout.json`.** `InactiveArchive` takes the machine's interest union as a port (`interest()`) and no layout; its unit test keeps a session in the set and archives the same session once it leaves the set. On the embedded shape the set is the one main's interest report sends; `e2e:c12` (its sweep scenes) passes.
5. **The idle reading.** `e2e:daemon-idle-spine`, on `MEASURED_E2E` only, composes the spine alone under the Electron binary as Node over the profile-sized fixture of D19, idle, and reports its physical footprint loaded and after its data is released. Three valid runs on the mini; their numbers in this Decision Log as O3-D's starting point.
6. **Behaviour is unchanged.** Class 1a and `unit:darwin`; every `HOSTED_MAC_E2E` group on the hosted lane (on the daemon shape if O3-B has landed by then, which the record says); `e2e:default` on the mini; `e2e:local-latency-daemon` once, within OX7's budget of P5 Decision Log 33's baseline. `src/shared/ipc/wire-manifest.json` and `WIRE_MINOR` are unchanged.
7. **Every staying reader is covered,** the intents and files' admission read included: each row of the reader map (Interfaces §C) reads through the view, and its tests drive it through the fake view (`test/support/fake-spine-view.ts`), so O3-D can back the view remotely without a new reader appearing.

## Execution

### Constraints (bind every milestone)

- **Binding inheritance.** §5's sets are the library's two roots: what O3-D moves is `startSpine`'s, what O3-E moves is `startCheckouts`'s, what stays in the app is neither (the disposition table below). §7's interface is `SpineView` (Interfaces §B): staying code reads the spine through it and nothing else. O3X2: `openSpineData` takes `spine.lock` before any spine file is opened and every refusal of O3-A's refused run holds exactly as built (O3 Decision Log 11, residue 1 to 4). O3X3: the renderer's settings API is unchanged; the spine reads only the machine half (D12).
- **No wire, settings or index change.** No command or event is added, retagged or reshaped; `wireFingerprint()` must not move and `WIRE_MINOR` stays. No settings version, no machine-settings version, no index migration. If a milestone finds it needs one, it stops and asks the architect.
- **Nothing moves into `mawsd`.** `src/mawsd/**`, `src/endpoint/**`, `src/pty-host/**` and the engine host's behaviour are untouched. The services entry is built and checked, never loaded by `mawsd` (that is O3-D's).
- **Behaviour is the code's as it is.** Every move is a relocation: a module keeps its logic, its comments and its tests; a signature changes only where a dependency becomes injected. Start order, shutdown order and every refusal stay as they are, except where a decision here says otherwise (D10, D11, D17).
- **Coexisting with O9's local half.** Whichever of O3-C and O9's local half lands second keeps both (D20). Merge `origin/master` into the branch at each milestone's start (never rebase). If `src/main/lane-a/` is on master:
  - before M1 ends, its type import of `MainHandler` becomes the bus's `ServiceHandler`;
  - from M2, nothing in it is a view reader (it reads the index inside the spine), so it needs no view member;
  - in M3 it moves to `src/services/lane-a/` with the rest, and `MACHINE_BOUND` loses `lane-a`;
  - in M4 `createLaneADriver`, `registerLaneA` and the index wiring O9 put in `src/main/index.ts` (the records observed at start, `onChange` to `observe`/`forget`, the transcript path) move into `startSpine`, before the spine's shutdown step that closes the index; its commands register through the bus;
  - its renderer, schema, grades, link-surface and e2e files are untouched, and `e2e:lane-a` joins M6's run.
  If O9 lands after O3-C, O9's merge of master does the same (the architect relays D20 to O9).
- **Coexisting with O3-B.** Its edits to `quit-guard.ts` and `tsconfig.e2e.json` meet M2's and M3's; a merge keeps both. Acceptance 6 runs on whatever shape master's e2e default is at M6.
- **The machine.** On this MacBook: one focused vitest file at a time, `npx eslint` on touched files and `pnpm typecheck`, after `pnpm install --frozen-lockfile --offline --ignore-scripts` when the worktree's install is stale. Never launch MAWS against the owner's profile, its `dist/` or its user data; never run an engine or connector e2e scene here; never run `node --test .github/scripts/*.test.mjs` here (the static gate does). Everything else runs through `scripts/ci-gate.sh` (gate plan below).
- **Gates.** Class 1a: `--gates static,unit,probes --class1a pool --peer none`. `unit:darwin` (the macOS-guarded unit files, `scripts/darwin-unit-files.sh`; M2 to M4 move or edit several): `--gates unit:darwin --runner macos --peer none`. Hosted Mac groups: `--runner macos --lane hosted --peer none`. Measured groups (`e2e:daemon-idle-spine`, `e2e:local-latency-daemon`) run on the mini with `--runner macos --peer none`, and `e2e:default` on the mini beside a hosted run. Never `--gates all`. A group `ci-gate` warns is reached through a spec's imports joins that milestone's run.

  | Milestone | Class 1a | `unit:darwin` | Hosted lane | Mini |
  |---|---|---|---|---|
  | M1 | yes | — | `e2e:c7`, `e2e:side`, `e2e:to-human`, `e2e:library`, `e2e:scm`, `e2e:code` | — |
  | M2 | yes | yes | `e2e:browser`, `e2e:browser-cua`, `e2e:browser-chrome`, `e2e:connectors`, `e2e:connectors-direct`, `e2e:c12`, `e2e:panel`, `e2e:library`, `e2e:code`, `e2e:to-human`, `e2e:settings`, `e2e:supervisor` | — |
  | M3 | yes | yes | `e2e:library`, `e2e:machines`, `e2e:settings`, `e2e:supervisor-daemon`, `e2e:browser-chrome`, `e2e:code`, `e2e:scm` | — |
  | M4 | yes | yes | every `HOSTED_MAC_E2E` group | `e2e:default` |
  | M5 | yes (static runs the gate-script tests) | — | — | `e2e:daemon-idle-spine`, three runs |
  | M6 | yes | yes | every `HOSTED_MAC_E2E` group | `e2e:default`, `e2e:local-latency-daemon` once; `e2e:lane-a` on the lane O9 admitted it to, if O9's half is on master |

  `--lane hosted` sends every eligible group it is given to the hosted Macs; only `default`, measured, live, `MAC_SECRET_E2E` and `POOL_E2E` groups stay where they would be. So a hosted run names hosted groups only (plus `e2e:default`), and any other group runs in a call of its own.

- **Hands off.** The charter, P5's and O3's documents, O9's document, the ledgers and `docs/tech-debt-tracker.md`: debt and residue go to this document's record and the PR body. Never stage `spikes/gws-onboarding/`, `.playwright-cli/`, `plugin/` or `node_modules`. The `.github` hunk (M5) is CI-opt's to review at the PR; the architect relays it.
- **Commits and branch.** Branch `p5-o3-c` from master. End every commit message with the `Sminos-Session:` line the executor's own session is given, as a second `-m` paragraph, and add no other trailer. Move files with `git mv` so `git log --follow` keeps their history.
- **Review.** Each milestone gets doperpowers:subagent-driven-execution's task review at its frontier. The branch gets doperpowers:review-code at the **High** rung (`doperpowers:reviewer-high`) at M6, before the PR goes to the architect, who lands it.

### Orientation

Terms used throughout:

- **The spine:** §5's set that O3-D moves into `mawsd`: settings' machine half; the index with the read model, its session source and replay; attention's core; the owner channel and mods; the session service with intents, worktrees, prompt history, side threads, yield, observed facts and the sweep; the design-system defaults relay; O9's lane A driver; the library's derived index.
- **The checkouts:** what O3-E moves: git's read service and watcher, scm, files, `git.lsFiles`. Until O3-E they run beside the app and read the spine through the view, like staying code.
- **The library:** `src/services/`, the spine, the checkouts and what only they share (git's runner, the release fences).
- **A root:** a function that composes one set from injected dependencies and returns its handles: `startSpine` (with `openSpineData` before it) and `startCheckouts`. **The embedded root** is `src/main/index.ts`, which calls them in main. **mawsd's root** is O3-D's.
- **The bus** (`ServicesBus`, Interfaces §A): how the library registers its commands, installs its intercepts, emits its events and taps them. Main binds it to its router and `emit`; at O3-D `mawsd` binds it to its services front.
- **The view** (`SpineView`, Interfaces §B): the one interface through which staying code and the checkouts read the spine.
- **Staying code, the client:** everything under `src/main/` that is not the library.
- **A reverse read:** the spine reading the client's state (`layout.json` for the sweep, the browser's cua socket per launch, the OS trash, the client port). In the library each is a port the root takes (Interfaces §D).

How the parts fit today, on master. `src/main/index.ts` (about 1,050 lines) is the only composition: `startSpineData` (O3-A) takes `spine.lock`, splits the settings and starts both halves; `startMain` then builds the index, the session source, attention, replay, the read model (`startSessions`), the intent store, the session service and its siblings, git, files and scm, and hands the index, the read model, the intent store and the session service to the client code that reads them (the notifier, the quit guard, the browser, connectors, the chat panels). The library's modules already import no Electron directly (lint's `MACHINE_BOUND`, O1), but nine of them import values from `src/main/ipc/` (`registerMainHandler`, `interceptCommand`, `emit`, `onEmitted`, `CommandFailure`), whose router imports Electron, and about twenty import types from there or from `src/main/hosts/`. The engine host is reached through `HostSupervisor` (`@shared/host/host-supervisor`), the same interface `mawsd`'s relay uses.

### Where every file goes

Applied in M3; M1 and M2 work at today's paths. A file's test moves with it. A client file left in a directory whose machine part moved stays at its path (D16). The `lane-a` row applies once O9's half is on master.

| From (today) | To | Set |
|---|---|---|
| `src/main/index/**` | `src/services/index/**` | spine |
| `src/main/sessions/**` but `interest.ts`, `panel-lifetime.ts`, `select-source.ts` | `src/services/sessions/**` | spine |
| `src/main/side/**`, `src/main/history/**`, `src/main/owner/**` | `src/services/{side,history,owner}/**` | spine |
| `src/main/attention/{service,store,file-attention-store}.ts` | `src/services/attention/` | spine |
| `src/main/settings/{machine,split,spine-lock,engine-configure,host-configure,session-settings,user-engine-defaults}.ts` | `src/services/settings/` | spine |
| `src/main/library/{store,sync,source,register,index}.ts` | `src/services/library/` (`index.ts` without the files part since M1, D22) | spine |
| `src/main/git/{worktrees,worktrees-register}.ts` | `src/services/git/` | spine |
| `src/main/artifacts/defaults.ts` | `src/services/artifacts/defaults.ts` | spine |
| `src/main/machine/identity.ts` | `src/services/machine/identity.ts` (D15) | library, called first by each root as today |
| `src/main/lane-a/**` (O9) | `src/services/lane-a/**` | spine |
| `src/main/git/{service,watcher,porcelain,ls-files,register,mutate}.ts` | `src/services/git/` | checkouts |
| `src/main/scm/**` | `src/services/scm/**` | checkouts |
| `src/main/files/{service,watch,allowlist,mime,register}.ts` | `src/services/files/` | checkouts |
| `src/main/library/admission.ts` | `src/services/files/admission.ts` | checkouts |
| `src/main/release-fences.ts` | `src/services/release-fences.ts` | checkouts |
| `src/main/git/runner.ts` | `src/services/git/runner.ts` | both |
| `src/main/files/atomic-write.ts`, `src/main/files/read-tail.ts` | `src/shared/fs/` | neutral (D3) |
| `src/main/settings/store.ts` | `src/shared/settings/file-store.ts` | neutral (O3-A's flow-back) |
| `SETTINGS_FILES`, `settingsPaths` (in `settings/split.ts`) | `src/shared/settings/paths.ts` | neutral (main reads the client file's shape before `openSpineData`) |
| the `MachineSettingsService` interface (in `settings/machine.ts`) | `src/shared/spine/machine-settings.ts` | neutral (the client half composes with it, D6) |
| `src/main/sessions/select-source.ts` | `src/shared/sessions/select-source.ts` | neutral |
| `src/main/settings/session-directories.ts` | `src/shared/sessions/directories.ts`, over `{ records(): SessionRecord[] }` | neutral |
| `claudeConfigDir` (in `history/prompt-history.ts`) | `src/shared/engine/config-dir.ts` | neutral |
| `uuid5`, `repoProjectId`, `machineProjectId` (in `index/org-project.ts`) | `src/shared/machine/project-ids.ts` | neutral (the org rows read `repoProjectId`) |
| `src/main/attention/{index,notifier,navigation,actions}.ts`, `src/main/settings/{capture-chords,reveal}.ts`, `src/main/sessions/{interest,panel-lifetime}.ts`, `src/main/files/{pick,save-text,profile-lock}.ts`, `src/main/library/files.ts`, `src/main/machine/local.ts` | stay | client |

`ServicesBus`, `SpineView` and `MachineSettingsService` are types in `src/shared/spine/` (D6): the library implements each in process, O3-D's main implements the view and the machine half again over the services front, and both roots bind the bus.

### Plan of Work

The order is M1 to M6, each on the one branch. M1 and M2 work in place, so their diffs are logic and stay small; M3 is the mechanical move with nothing else in it; M4 extracts the roots in their final place; M5 needs M4's services entry; M6 lands.

### M1 — The services bus: the library stops importing main

**At its end.** No file the disposition table puts in the library imports anything from `src/main/ipc/` or `src/main/hosts/`, and none composes a client module. Each module that registers a command, installs an intercept, emits an event or taps one takes the bus (Interfaces §A) in its dependencies, and the library's handlers fail with `HostCommandError`. Main's root builds one bus from its router and `emit` and passes it wherever the singletons were imported. The two compositions that straddle the line today are cut in place: main's root composes the library's files (`registerLibraryFiles`, O4's) beside `startLibrary` rather than through it, and composes the design-system defaults relay (`startArtifactDefaults`, gated on the spine running as today) beside `startArtifacts` rather than through it. The app behaves as before.

**Touches.** `src/shared/spine/bus.ts` (new). The value importers: `src/main/index/{register,replay}.ts`, `src/main/sessions/{index,observed,service-register}.ts`, `src/main/git/{register,worktrees-register}.ts`, `src/main/scm/register.ts`, `src/main/files/register.ts`. The type importers: `src/main/index/source.ts`, `src/main/sessions/{context,holders,pane-holder,recovery,resync,setup-steps,stub-source,yield}.ts`, `src/main/owner/{launch,register,service}.ts`, `src/main/library/{index,register,source}.ts`, `src/main/attention/service.ts`, `src/main/machine/identity.ts` (its `MachineHandler` becomes `ServiceHandler`; its `register` stays bound to `registerMachineHandler`, since `machine.identity` is `machine`-owned). The straddling compositions: `src/main/library/index.ts` (loses `files`), `src/main/artifacts/index.ts` (loses `relayDefaults` and its import of `./defaults`). `src/main/index.ts` (the bus, built once beside `installRouter`; the two compositions). Their tests, which today mock `../ipc/router` or `../ipc/events`, take `test/support/fake-bus.ts` (new, Interfaces §G) instead.

**Decisions.**
- The bus is injected through each module's dependencies, the way `startLibrary`, `startOwnerChannel` and `startIndexAttention` already take `register` and `emit` (D4).
- `HostDispatch` and `HostSupervisor` are imported from `@shared/host/host-supervisor`, where they are defined; `src/main/hosts/supervisor.ts` only re-exports them.
- A handler that must fail with a specific `IpcError` throws `HostCommandError` (`@shared/host/runtime`), which main's router already answers intact for any owner and every host runtime answers the same way (D5). Client code keeps `CommandFailure`.
- `emittedAttentionSource` and `emittedAppEventsSource` (`sessions/index.ts`) take the bus's `onEmitted` as their tap, as they already take a tap parameter.
- Main's binding is `{ register: registerMainHandler, intercept: interceptCommand, emit, onEmitted }` from `src/main/ipc/`, so every tap main's client code holds (the menu's, the stand-in's) still hears the library's events.
- The library's files and the defaults relay are split here rather than in M4 because M3's lint rules refuse both edges (`library/index.ts` importing the client's `library/files.ts`; the client's `artifacts/index.ts` importing the spine's `artifacts/defaults.ts`), and a move cannot make either legal (D22, D23). `registerLibraryFiles` keeps main's `registerMainHandler` and its `readFile` reach; `startArtifactDefaults` keeps reading the merged settings until M4 (D12).

**Does not touch.** File locations. The client modules' own imports of main's IPC. Any command's owner or schema.

**Proves.** The grep in Concrete Steps finds no library-classified file importing `src/main/ipc/` or `src/main/hosts/`, and neither `src/main/library/index.ts` nor `src/main/artifacts/index.ts` imports across the line. Tests pin: the fake bus answers through the registry's codec as the router does (an input that fails its schema is `invalid_input`; an interceptor runs before the handler; a tap hears a payload only after it validated); every re-pointed suite passes against it.

### M2 — Main's view of the spine, and the sweep on interest

**At its end.** `SpineView` exists (Interfaces §B) with its in-process backing, `createSpineView` (`src/main/sessions/spine-view.ts` until M3), built by main's root once the spine's parts exist. Every reader of the reader map (Interfaces §C) takes the view, or the part of it it reads, instead of the index, the read model, the intent store, the session service or the library store. Main's interest report and the sweep read one interest set, the report's, and the sweep no longer reads `layout.json`. The app behaves as before.

**Touches.** `src/shared/spine/view.ts` (new), `src/main/sessions/spine-view.ts` and its test (new), `test/support/fake-spine-view.ts` (new). The readers and their tests: `src/main/attention/{index,notifier,actions}.ts`, `src/main/lifecycle/quit-guard.ts`, `src/main/sessions/panel-lifetime.ts`, `src/main/sessions/interest.ts`, `src/main/browser/index.ts`, `src/main/browser/agent/index.ts`, `src/main/connectors/{index,engine-route,direct-route}.ts`, `src/main/settings/reveal.ts` with `session-directories.ts`, `src/main/files/allowlist.ts`, `src/main/library/admission.ts`, `src/main/scm/service.ts`, `src/main/sessions/inactive-archive.ts`, `src/main/layout/store.ts` and `open-session-tabs.ts`, and in `src/main/index.ts` the export authors, the org rows' local projects, `git.lsFiles`'s roots and invalidation, and every reader's construction.

**Decisions.**
- What the view carries and what backs it in process: D7, D8, D9 and Interfaces §B. The view adds the visible set to §7's list, because the interest report reads it (D7).
- In launch mode `scenario` the view answers the scenario's sessions and reports itself unavailable, so nothing reconciles the browser's rows against a scenario (D10).
- The notifier names a project only when the view's project is not hidden, as it does today (the read model holds visible projects only); it takes an attention change's `silent` set in place of `restoredIds`.
- The browser reconciles its data (`BrowserData.reattach`) with the view's snapshot (every record's id, or null while `unavailable()`) at its start and at each `availability` event; in process the view's availability never changes after start, so the start is the only reconciliation, as today. Its restored tabs are kept whole while the view is unavailable, as they are while the index is.
- The sweep's `open` becomes `interest(): ReadonlySet<AppSessionId>` (D11). Main computes one memoized set, `interestSet(layout.get('main.tabs'), view.visibleSessions(), local)`, recomputed when `main.tabs` is written or a visibility changes, and gives the same function to `startInterest` and the sweep. `openSessionTabs` goes; `sessionsInTabs` stays for the set.
- `git.lsFiles`'s roots: the unarchived records' directories and the intents' directories from the view, the projects' directories from `view.projectRows()` (every row, as today); it invalidates on the view's `record`, `projects` and `intent` events in place of the four `onEmitted` taps.
- `dropPanelKeysOfRemovedSessions` in `layout/store.ts`, which only its tests call (production uses `registerChatPanels`), is deleted with its tests (D17).
- Each reader declares the narrowest `Pick<SpineView, …>` it reads, so its tests build only that.

**Does not touch.** What any reader does with what it reads. The spine's own internal reads (the session service reading the index, lane A reading the index). File locations.

**Proves.** Acceptance 4 and 7, and acceptance 3's in-place half. Tests pin: each view member answers its backing's value and each view event fires with its backing's (Interfaces §B's table), including an attention change whose `silent` holds exactly the restored ids among its items, `known` true for an intent with no record, `project` answering a hidden project marked hidden, and `unavailable()` naming the refusal in a refused run and the scenario in launch mode `scenario`; over a real index, a discovered project whose only session's transcript was removed (`markTranscriptRemoved`) is absent from `projects()` and present in `projectRows()` and `project(id)`, and route D's fallback to the artifact's project directory (`src/main/connectors/direct-route.test.ts`'s case for a creator gone) resolves through that view; every reader of §C passes its suite against the fake view; the sweep keeps a session while `interest()` holds it and archives it once the set no longer does, with no layout in its dependencies; the browser reconciles at start and again when the fake view fires `availability` with null.

### M3 — The library moves to `src/services/`, behind its boundary

**At its end.** The disposition table is applied: the library under `src/services/` with its tests, the neutral helpers under `src/shared/`, the client files where they were. Lint rule A holds over `src/services/**` and rule B over `src/main/**` (Interfaces §E), with `src/main/index.ts` exempt from B until M4 narrows it. `MACHINE_BOUND` covers `src/main/{library,connectors,delivery,catalog,usage,gateway}/**` and `MACHINE_BOUND_ALLOWED` is `['src/main/connectors/oauth-root.ts']`. `test/services/boundary.test.ts` shows both rules fire. The app behaves as before.

**Touches.** The moves (`git mv`), and every import of a moved path: `src/**`, `test/**`, `e2e/**`. `eslint.config.js`. `tsconfig.node.json` (`src/services/**/*`). `tsconfig.e2e.json` (its listed `src/main/git/runner.ts`, `src/main/index/{migrations,browser-staging,db}.ts` re-pointed). `vitest.config.ts` (the `node` project's include gains `src/services/**/*.test.ts`; `TIMING_NODE_TESTS`'s `src/main/git/watcher.test.ts`, `src/main/index/source.test.ts`, `src/main/sessions/pause-take-over.pty.test.ts` re-pointed; `test/services/boundary.test.ts` joins that list, since it loads the whole ESLint config as `test/artifacts/portability.test.ts` does).

**Decisions.**
- The library is flat, `src/services/<the same directory names>/`, so imports between moved modules keep their relative paths, and the two sets are told apart by their roots, not their directories (D2).
- Helpers both sides use go to `src/shared/` under the names the table gives (D3); a test that exercises both halves stays where it is (`src/main/profile-upgrade.test.ts`, `src/main/lifecycle.test.ts`), since rule B does not cover tests.
- `no-restricted-imports`'s options are replaced by each later block that sets them, so every block covering `src/main/**` carries rule B's pattern beside the patterns it already has, and the `src/services/**` block restates the Yjs and endpoint patterns (the config's own comments say so for the existing blocks).
- One commit moves and re-points everything (green); the next adds the rules and the boundary test.

**Does not touch.** Any logic. `src/main/index.ts`'s composition (M4). `src/mawsd/**`.

**Proves.** Acceptance 2's lint half. `test/services/boundary.test.ts` lints synthetic sources through the repository's config and expects: a file under `src/services/` importing `electron`, `../../main/ipc/events` or `../../main/windows` errors; a file under `src/main/browser/` importing `../../services/index/index` errors and importing `@shared/spine/view` passes; `src/main/index.ts` importing `../services/entry` passes. Typecheck, lint, the unit suite and `unit:darwin` pass, and the move deletes or skips no test (the count of test files equals M2's head's plus the boundary test).

### M4 — Two roots and the services entry

**At its end.** `src/services/spine-root.ts` (`openSpineData`, `startSpine`) and `src/services/checkouts-root.ts` (`startCheckouts`) compose their sets from the dependencies of Interfaces §D, and `src/services/entry.ts` exports them. Main's root calls `openSpineData` where `startSpineData` ran, `startSpine` and `startCheckouts` where their parts were built, and from then on holds only `SpineRoot.view`, the checkouts' `readResolved` and the two stop functions. The entry is a third input of main's build, `out/main/services.js`, held by the bundle guard to mawsd's rule. Acceptance 1's test passes under plain Node. Rule B narrows `src/main/index.ts` to the entry. The app behaves as before.

**Touches.** `src/services/{spine-root,checkouts-root,entry}.ts` (new), `src/main/index.ts` (the spine's and the checkouts' composition leave it, the library's derived index and the defaults relay that M1 put there included; `registerLibraryFiles` stays), the machine-half readers (`src/services/settings/{engine-configure,host-configure,session-settings}.ts`, `src/services/owner/register.ts`, `src/services/artifacts/defaults.ts`, the sweep's schedule; D12), `electron.vite.config.ts`, `src/engine-host/bundle-guard.test.ts`, `src/main/lifecycle.test.ts`, `src/services/spine-root.test.ts` and `test/support/fake-spine-host.ts` (new), `eslint.config.js`. O9's composition when on master.

**Decisions.**
- What each root composes is §5's set exactly; the commands each registers through the bus are pinned by a test in `spine-root.test.ts`, and the lists go into the record for O3-D's retag (D25).
- The spine reads the machine half of the settings only (D12); main composes the client half from `SpineData.machineSettings` as O3-A's `startSettings` does.
- O3-A's refused run is the root's: with `data.refused` set, `startSpine` starts none of attention's core, replays, the prompt history's commands, the worktree and session services, the owner channel, the sweep, yield, side threads, the engine and host configure relays, the design-system defaults relay or the retired-custody removal; it keeps the read model, the inert index source and the library; the view's `unavailable()` names the refusal, its `acquire` rejects with "MAWS cannot reach its sessions this run: <reason>", and `settings.engineApplied` rejects with the refusal, all as today.
- The ports map onto dependencies the services already take: the session service's `browserBackend`, `trash` (wrapped by `trashFor`) and `port`, the sweep's `interest` (M2), so `service.ts`, `context.ts` and `inactive-archive.ts` keep their signatures.
- Order inside main's root, each kept from today: the machine identity first; `openSpineData` after the launch's shape settles and before either settings file is written; `startSpine` before `new BrowserData(…)`, which must read the index at version 14 after migration 14 ran; `startCheckouts` after `startSpine` (it takes the view); the library's files (`registerLibraryFiles`) after `startCheckouts` (`readResolved`); the cua socket port a closure over the browser's `cua`, set once the browser starts, as today.
- Shutdown: each root's `stop` is one step, added where its first part's step is today (`'spine'` at the place of `'git, replays and attention'`, `'checkouts'` right after it); inside, `startSpine`'s stop runs its parts in today's relative order, the index closing after the read model has stopped the source that reads it and the library stopping in the same pass (D21).
- `settings.userEngineDefaults`, `settings.engineApplied`, `session.recentTurns` and the prompt history's two commands are registered by `startSpine`: each answers the machine's engine or the machine's files (D24).
- `src/main/lifecycle.test.ts`, which loads the real main root over about fifty module mocks, mocks the services entry's roots with a stub view instead of mocking each moved module.
- The bundle check is a third main input and a new `describe` in the bundle guard (D13).

**Does not touch.** `src/mawsd/**`. The renderer. Any client module's behaviour. The engine host.

**Proves.** Acceptance 1, the bundle half of 2, and 3. Tests pin: `spine-root.test.ts` as acceptance 1 states it; a refused run (a live holder of `spine.lock` on the scratch profile) composes with the view unavailable and registers none of the refused commands; the exact sets of command names, intercepts and emitted-event taps each root installs; the bundle guard's services `describe` (no dynamic `import()`; requires only Node's builtins, `zod` and the MCP SDK; never `electron`); `src/main/lifecycle.test.ts` passes.

### M5 — The spine's idle reading (`e2e:daemon-idle-spine`)

**At its end.** A new measured group, on `MEASURED_E2E` only, runs the services entry's `idleReading` (Interfaces §F) under the Electron binary as Node, over the profile-sized fixture of D19, and reports the spine's physical footprint idle while loaded and after its data is released. Three valid runs on the mini are recorded in this document's Decision Log, with the fixture's counts, the per-run numbers and the run URLs.

**Touches.** `src/services/idle-reading.ts` and a unit test that composes it over a small fixture and releases on its trigger; `src/services/entry.ts` (exports `idleReading`); `test/support/spine-fixture.ts` and its test (new); `e2e/daemon-idle.spec.ts` (a fourth case, `daemon idle spine alone`); `test/support/daemon-idle.ts` (`spineLine`); `package.json` (the new script, and `|spine alone` added to `e2e:daemon-idle`'s and `e2e:daemon-idle-baseline`'s `--grep-invert`, or both would run the new case); `.github/workflows/gate.yml` (`MEASURED_E2E` gains `daemon-idle-spine`, with a comment line like its neighbours'); `tsconfig.e2e.json` (the fixture's imports); `.github/scripts/e2e-default-specs.test.mjs` only if the static gate says its pin moved.

**Decisions.**
- The case, the windows and the release: D18. The fixture: D19.
- The script: `"e2e:daemon-idle-spine": "scripts/e2e-build.sh plain && MAWS_DAEMON_IDLE_PERF=1 playwright test e2e/daemon-idle.spec.ts -g \"spine alone\""`. Its prefix gives it gate-offload Decision Log 133's procedure by itself (the first settle, the prebuild into the cache, the second settle, then the command). It is never on `HOSTED_MAC_E2E`, `CLASS1_E2E`, `MAC_VM_E2E` or `MAC_SHARED_E2E`.
- The case measures one process, the services process (argv0 `maws-spine`), with the readers, sampling and validity rule of the existing cases (`test/support/daemon-idle.ts`): load under 5 throughout, the process alive, the two footprint readers agreeing. It asserts no bound; it writes `test-results/daemon-idle-spine.json` and prints one line naming the loaded and released medians, the fixture's counts, whether a full collection ran, and the load.
- An invalid run is rerun. After two invalid runs in a row the executor asks the architect for a quiet window on the mini (gate-offload Decision Log 133's source (b)). Runs go in the lane's idle half (12 to 24Z) when the schedule allows.

**Does not touch.** `e2e:daemon-idle`'s, `-baseline`'s, `-floor`'s and `-mawsd`'s cases or bounds. `mawsd`.

**Proves.** Acceptance 5. Tests pin: `idleReading` composes over a fixture, logs `spine idle: composed`, and on its trigger stops the root and logs `spine idle: released` once `released` resolves, its keep-alive timer running until `dispose`; the fixture generator writes the counts it is asked for, deterministically (two runs give the same records).

### M6 — Landing: the acceptance run, O9's half, the bench and the review

**At its end.** The branch, merged with `origin/master`, passes acceptance 1 to 7 as written, with O9's half folded in if it landed first (Constraints), the bench run once, the whole-branch review at High clean, and a PR open to master with this document's record current.

**Touches.** Whatever the merge and the review require; this document's Progress, record and Outcomes.

**Decisions.**
- If O9's half is on master and was not folded at an earlier boundary, it is folded now by the Constraints' rule, and `e2e:lane-a` joins the run.
- The record says which shape the hosted groups ran on (O3-B on master or not) and lists every run URL.
- The idle numbers and D25's command lists go into the PR body as well, for the architect's fold into O3's Decision Log.

**Does not touch.** Anything outside the merge, the review's fixes and the record.

**Proves.** Acceptance 6, and 1 to 5 and 7 re-run on the merged tree: the full gate line of Concrete Steps green, `e2e:local-latency-daemon` green within OX7's budget, the reviewer's findings resolved or logged.

### Concrete Steps

From the worktree root (`<wt>`), unless a line says otherwise.

Setup and iteration:

    pnpm install --frozen-lockfile --offline --ignore-scripts   # only when node_modules is stale
    pnpm exec vitest run src/services/spine-root.test.ts         # one file at a time
    npx eslint <touched files>
    pnpm typecheck

M1's check (expect no output):

    grep -rnE "from '(\.\./)+(ipc|hosts)/" src/main/index src/main/sessions src/main/side src/main/history src/main/owner \
      src/main/attention/service.ts src/main/attention/store.ts src/main/attention/file-attention-store.ts \
      src/main/library/store.ts src/main/library/sync.ts src/main/library/source.ts src/main/library/register.ts \
      src/main/library/index.ts src/main/git src/main/scm src/main/files/service.ts src/main/files/watch.ts \
      src/main/files/allowlist.ts src/main/files/register.ts src/main/settings/machine.ts src/main/settings/split.ts \
      src/main/settings/spine-lock.ts src/main/settings/engine-configure.ts src/main/settings/host-configure.ts \
      src/main/machine/identity.ts \
      --include='*.ts' | grep -v '\.test\.ts:' | grep -v '^src/main/sessions/\(interest\|panel-lifetime\)\.ts'
    # add src/main/lane-a to the paths when O9's half is on master

The bundle guard, locally (a build of main and the preloads only):

    pnpm build:main-preload && pnpm exec vitest run src/engine-host/bundle-guard.test.ts
    # expect: "the built services entry and its chunks" passing beside mawsd's describes

Gates, from any directory:

    scripts/ci-gate.sh <wt> --gates static,unit,probes --class1a pool --peer none
    scripts/ci-gate.sh <wt> --gates unit:darwin --runner macos --peer none
    scripts/ci-gate.sh <wt> --gates e2e:<group>,e2e:<group>,… --runner macos --lane hosted --peer none
    scripts/ci-gate.sh <wt> --gates e2e:daemon-idle-spine --runner macos --peer none       # M5, three times
    scripts/ci-gate.sh <wt> --gates e2e:local-latency-daemon --runner macos --peer none    # M6, once

Each prints a line per gate (`PASS`, `FAIL … log=<path>`, `SKIP`, `WAIT`), then `GREEN <run-url>` (exit 0) or `RED <failed>/<total> <run-url>` (exit 1). A measured run's line is in the job log and its annotation: `[daemon-idle] spine loaded footprint … KiB (median of 21) · released … KiB (median of 11) · …`.

M4's and M6's hosted list is `HOSTED_MAC_E2E` as `.github/workflows/gate.yml` holds it at the run (at authoring: `document-app browser-chrome available artifacts settings connectors connectors-direct delivery to-human widgets side supervisor c12 browser-import document code scm agents library deliverables presentations dashboard design design-systems tools panel browser-cua terminal c7 browser transcript supervisor-daemon daemon-unit machines`), each as `e2e:<name>`. M6 runs, on the merged tree:

    scripts/ci-gate.sh <wt> --gates static,unit,probes,unit:darwin,e2e:default,<every hosted group> \
      --class1a pool --runner macos --lane hosted --peer none
    scripts/ci-gate.sh <wt> --gates e2e:local-latency-daemon --runner macos --peer none

(`--lane hosted` leaves `e2e:default` on the mini.)

### Interfaces and Dependencies

#### A. The bus (`src/shared/spine/bus.ts`)

    import type { HandlerContext } from '@shared/ipc/client';
    import type { CommandInput, CommandName, CommandOutput, EventName, EventPayload } from '@shared/ipc/schema';

    // A command handler as the library writes it: the asker's ClientRef in `context`, no machine (a library handler
    // always answers its own machine's).
    export type ServiceHandler<N extends CommandName> = (input: CommandInput<N>, context: HandlerContext) => CommandOutput<N> | Promise<CommandOutput<N>>;

    export interface ServicesBus {
      // A command the library answers; throws for a name registered twice. Main binds it to registerMainHandler while the
      // spine's commands are `main`-owned; O3-D binds a retagged command to its `machine` handler.
      register<N extends CommandName>(name: N, handler: ServiceHandler<N>): void;
      // Answers a command another owner would answer, before that owner (session.answer's pending check, the scenario
      // stub, O9's reroute); the function returned removes it.
      intercept<N extends CommandName>(name: N, handler: ServiceHandler<N>): () => void;
      // To every client, validated: false, and nothing sent, for a payload its schema refuses. Every tap hears what was sent.
      emit<N extends EventName>(name: N, payload: EventPayload<N>): boolean;
      // An in-process tap on what `emit` sent, from any emitter on this bus.
      onEmitted<N extends EventName>(name: N, listener: (payload: EventPayload<N>) => void): () => void;
    }

A handler fails with a specific `IpcError` by throwing `HostCommandError` (`@shared/host/runtime`).

#### B. The view (`src/shared/spine/view.ts`)

    export interface SpineView {
      unavailable(): string | null;                           // null while the spine can be read; else why not
      record(appSessionId: AppSessionId): SessionRecord | null;
      records(): readonly SessionRecord[];                    // every record, archived included; a record's lineage is its `lineage`
      projects(): readonly ProjectRecord[];                   // as session.projects.list answers: visible, and removed ones marked hidden
      projectRows(): readonly ProjectRecord[];                // every project row the index holds, hidden or with no present session
      project(projectId: ProjectId): ProjectRecord | null;    // among projectRows()
      digest(appSessionId: AppSessionId): SessionDigest | null;
      digests(): readonly SessionDigest[];
      attention(appSessionId: AppSessionId): readonly AttentionItem[];
      allAttention(): ReadonlyMap<AppSessionId, readonly AttentionItem[]>;
      engineStatuses(): readonly EngineSessionStatus[];
      midTurnCount(): number;
      intent(appSessionId: AppSessionId): SetupIntent | null;
      intents(): readonly SetupIntent[];
      known(appSessionId: AppSessionId): boolean;             // a record or an intent
      visibleSessions(): readonly AppSessionId[];             // the sessions some client shows (session.setVisible's union)
      on<E extends keyof SpineViewEvents>(event: E, listener: SpineViewEvents[E]): () => void;
      acquire(appSessionId: AppSessionId, reason: AcquireReason): Promise<AcquireOutcome>;
      fileLinkedPaths(appSessionId: AppSessionId): Promise<string[]>; // files' admission; [] while unavailable
    }

    export interface SpineViewEvents {
      availability: (unavailable: string | null) => void;
      record: (appSessionId: AppSessionId, record: SessionRecord | null) => void; // null: removed
      projects: () => void;                                   // either project set may have changed; read them again
      digest: (digest: SessionDigest) => void;
      attention: (appSessionId: AppSessionId, items: readonly AttentionItem[], silent: ReadonlySet<AttentionId>) => void;
      engine: (appSessionId: AppSessionId, status: EngineSessionStatus | null) => void;
      intent: (appSessionId: AppSessionId, intent: SetupIntent | null) => void;
      visible: (appSessionId: AppSessionId, visible: boolean) => void;
    }

The synchronous reads answer from memory in every backing; only `acquire` and `fileLinkedPaths` may cross a process at O3-D. `silent` is the ids among `items` the notifier must not announce: persisted items the attention service accepted at its start, and owner-channel items it was told are silent (O3 §7's "restored marks in band").

The in-process backing, `createSpineView` (`src/services/sessions/spine-view.ts` from M3), built by `startSpine` and returned as `SpineRoot.view`:

| Member | Backed by |
|---|---|
| `record`, `records`, `digest(s)`, `attention`, `allAttention`, `engineStatuses`, `midTurnCount`, `visibleSessions`; events `record`, `digest`, `engine`, `visible` | the read model (`SessionReadModel`) |
| `attention` event | the read model's, with `silent` = the item ids in the attention service's `restoredIds` at that moment (empty in a refused run) |
| `projects` | `index.projects.listWithRemoved()` at start, then each `session.projects.changed` the bus emits (empty while unavailable) |
| `projectRows`, `project` | `index.projects.list({ includeHidden: true })`, read at start and again at each `index.projects.onChange` (empty while unavailable) |
| event `projects` | either of the two above changing |
| `intent`, `intents`; event `intent` | the intent store, and each `session.intent.changed` the bus emits |
| `known` | a record or an intent |
| `acquire` | the session service's `acquire`; rejects in a refused run as today |
| `fileLinkedPaths` | `index.library.fileLinkedPaths`; `[]` while unavailable |
| `unavailable`; event `availability` | the index's `unavailable` reason; `'launch mode scenario: the sessions shown are a scenario’s'` in launch mode `scenario` (D10); never changes after start in process |

#### C. The reader map (acceptance 7)

O3 Decision Log 2's map, re-read on master `5698b6ef0`. Each row's module reads the spine only through the members named, and its tests drive it with `test/support/fake-spine-view.ts`. Paths are after M3.

| # | Reader | Module | Reads today | Reads through the view |
|---|---|---|---|---|
| R1 | the notifier | `src/main/attention/notifier.ts` | the read model's `allAttention`, `digests`, `attention`, `record`, `project`, its `attention`, `digest` and `record` events; the attention service's `restoredIds` | `allAttention`, `digests`, `attention`, `record`, `project` (hidden read as none), events `attention` (with `silent`), `digest`, `record` |
| R2 | notification actions | `src/main/attention/actions.ts`, built in main's root | the session service's `acquire`; the read model's `attention` | `acquire`, `attention` |
| R3 | the quit guard | `src/main/lifecycle/quit-guard.ts` | `midTurnCount`, `engineStatuses`, the `engine` event | the same |
| R4 | the chat panels (`layout.set` of a panel key, the panel keys' removal) | `src/main/sessions/panel-lifetime.ts` | the read model's `record` and the intent store's `get`; the `record` event; the `session.intent.changed` tap | `known`, events `record`, `intent` |
| R5 | the interest report | `src/main/sessions/interest.ts`, wired in main's root | the read model's `visibleSessions` and `visible` event (missing from Decision Log 2's map) | `visibleSessions`, event `visible` |
| R6 | the browser (restored tabs, each `session.status`, removals, the data's reconciliation) | `src/main/browser/index.ts` | `index.sessions.get`, `onChange`, `appIds`; `index.unavailable` | `record`, `records`, `unavailable`, events `record`, `availability` |
| R7 | the browser's agent reach (side threads reach their parent's tabs) | `src/main/browser/agent/index.ts`, `browser/cua/connection.ts`'s `reaches` | `index.sessions.get(…).lineage` | `record` |
| R8 | connectors, routes E and D | `src/main/connectors/{index,engine-route,direct-route}.ts` | `index.sessions.get`; `index.projects.list({ includeHidden: true })` | `record`, `project` (any row, D8) |
| R9 | the export authors' `sessionTitle` | main's root | `index.sessions.get(…).title` | `record` |
| R10 | the org rows' local projects (O8 M2; missing from the map) | main's root, for `src/main/org/rows.ts` | `index.projects.listWithRemoved()`; the `session.projects.changed` tap | `projects`, event `projects` |
| R11 | `settings.reveal`'s session roots | `src/main/settings/reveal.ts` | `knownSessionDirectories(read model, index)` | `records`, through `src/shared/sessions/directories.ts` |
| R12 | files' allowlist (checkouts) | `src/services/files/allowlist.ts` | the read model's `record`; the intent store's `get` | `record`, `intent` |
| R13 | `git.lsFiles`'s roots (checkouts) | `startCheckouts` (`FileLister`) | records from the read model and the index; `index.projects.list({ includeHidden: true })`; `intents.list()`; four `onEmitted` taps for invalidation | `records`, `projectRows`, `intents`, events `record`, `projects`, `intent` |
| R14 | files' admission (checkouts) | `src/services/files/admission.ts` | `index.library.fileLinkedPaths` | `fileLinkedPaths` |
| R15 | scm's checkout of a session (checkouts) | `src/services/scm/service.ts` | the read model's `record` | `record` |

Not view readers: O6's stand-in (`src/main/machines/serve-standin.ts`) relays whatever main emits, through main's taps, and is deleted at O3-D; the widgets' fixture backend reads the launch mode, a pure function now in `src/shared/sessions/select-source.ts`; `dropPanelKeysOfRemovedSessions` is deleted (D17). Reverse reads become ports (§D): the sweep's layout (now `interest`), the session service's cua socket, trash and client port.

#### D. The roots (`src/services/spine-root.ts`, `src/services/checkouts-root.ts`)

    export interface SpineData {
      readonly lock: SpineLock;                         // src/services/settings/spine-lock.ts
      readonly refused: string | null;                  // why this run may not write the spine's files; null: it holds spine.lock
      readonly machineSettings: MachineSettingsService; // src/services/settings/machine.ts
      readonly paths: { client: string; machine: string };
    }
    // O3-A's data start, unchanged: spine.lock (released at process exit), then while held the split once, then the
    // machine half. Main calls it after the launch's shape settles; it composes the client half from `paths.client`.
    export function openSpineData(profile: string, options: { build: string }): Promise<SpineData>;

    export type SpineHosts = Pick<HostSupervisor, 'dispatch' | 'onEvent' | 'onState' | 'onStreaming' | 'streaming' | 'snapshot' | 'setResync'>;

    export interface SpineDeps {
      profile: string;                                    // <userData>, the daemon's profile (O3 §1)
      machine: MachineRef;                                // this machine
      data: SpineData;
      hosts: SpineHosts;                                  // the engine host
      bus: ServicesBus;
      clientPort: ClientPort;                             // OX4
      interest(): ReadonlySet<AppSessionId>;              // the machine's interest union (OX5), read by the sweep at each check
      browserSocket(appSessionId: AppSessionId): string | null; // the cua socket a launch is told (E13); O5's
      trash(path: string): Promise<void>;                 // the OS trash; the root applies the e2e seam (trashFor) itself
      engineEnv: Promise<NodeJS.ProcessEnv>;              // the login-shell capture (captureShellEnvironment)
      env: NodeJS.ProcessEnv;
      packaged: boolean;
      appPath: string;                                    // the app's code (Electron's app.getAppPath()): replay fixtures' checkout
      devRoot: string;                                    // the development app root: a scenario's relative path
      home: string;
    }
    export interface SpineRoot {
      readonly view: SpineView;
      stop(): void;
    }
    export function startSpine(deps: SpineDeps): SpineRoot;

    export interface CheckoutsDeps {
      view: SpineView;
      bus: ServicesBus;
      clientPort: ClientPort;
      engineEnv: Promise<NodeJS.ProcessEnv>;
      env: NodeJS.ProcessEnv;
    }
    export interface CheckoutsRoot {
      readonly files: Pick<FilesService, 'readResolved'>; // library.read's reach (O4's library files), in process until O3-E
      stop(): void;
    }
    export function startCheckouts(deps: CheckoutsDeps): CheckoutsRoot;

Main's bindings on the embedded shape: `hosts` its `createHosts(…)`; `bus` §A's binding; `clientPort` `electronClientPort(…)`; `interest` the memoized set of M2; `browserSocket` `(id) => cuaSockets?.socketPathFor(id) ?? null`; `trash` `(path) => shell.trashItem(path)`; `engineEnv` its one `captureShellEnvironment()`, shared with the client; `appPath` `app.getAppPath()`; `devRoot` `process.cwd()`; `home` `app.getPath('home')`.

#### E. The services entry, the bundle check and the lint rules

- `src/services/entry.ts` exports `openSpineData`, `startSpine`, `startCheckouts`, `startMachineIdentity` and their types from M4, and `idleReading` from M5, and nothing else. `electron.vite.config.ts`'s main input becomes `{ index, mawsd, services: resolve(__dirname, 'src/services/entry.ts') }`, emitting `out/main/services.js`.
- `src/engine-host/bundle-guard.test.ts` gains `describe('the built services entry and its chunks')` over `graphOf(out/main/services.js)`, skipped when no build is present like its neighbours: no dynamic `import()` in any file of the graph; every external one of Node's builtins, `zod` or the MCP SDK (the `allowed` predicate, no extras); none `electron`.
- Rule A, the block for `src/services/**/*.{ts,tsx}`: `no-restricted-imports` with `electron` and `**/open-external` (O1's message), the Yjs and endpoint patterns, and the regex `^(\.\./)+(main|mawsd|renderer|preload)(/|$)` with a message naming the bus and the view; `no-restricted-syntax` with the dynamic forms, as `src/mawsd/**`'s block has.
- Rule B, every block covering `src/main/**/*.{ts,tsx}` but tests (`ignores` the `*.test.{ts,tsx}` files): the regex `^(\.\./)+services(/|$)` with a message naming `@shared/spine/view`. `src/main/index.ts`'s block refuses `^\.\./services/(?!entry$)` instead (M3: no services pattern for it; M4 adds this one).

#### F. The idle reading (`src/services/idle-reading.ts`) and the fixture

    // e2e:daemon-idle-spine's subject (O3 §11's diagnostic reading): the spine composed alone over `profile` with stand-in
    // ports (an engine host that never streams and answers every dispatch host_unavailable; a bus with no client; a
    // client port that answers noClient; an empty interest set; no browser socket; process.env as the shell capture).
    // Logs `spine idle: composed` once `startSpine` has returned, and when released (SIGUSR2 by default; a test passes
    // its own trigger) stops the root, drops every reference to it, runs globalThis.gc twice when the runtime exposes
    // it, and logs `spine idle: released` with `gc: true|false`. A timer keeps the process alive until `dispose`.
    export function idleReading(options: {
      profile: string;
      build: string;
      log(line: string): void;
      onRelease?(release: () => void): void; // default: process.once('SIGUSR2', release)
    }): Promise<{ released: Promise<void>; dispose(): void }>; // resolves once composed

The spec's case: a scratch root, the fixture written into `<root>/ud` by `test/support/spine-fixture.ts`, then the Electron binary as Node (`ELECTRON_RUN_AS_NODE=1`, `--disable-sigusr1 --expose-gc`, argv0 `maws-spine`, an environment of its own with `HOME` the scratch root and `MAWS_USER_DATA` the profile) running a three-line wrapper written into the scratch root that requires `out/main/services.js` and calls `idleReading`. It waits for `composed`, settles 120 s, measures a 600 s window (21 samples), sends SIGUSR2, waits for `released`, settles 120 s, measures a 300 s window (11 samples), then kills the scratch's processes as the other cases do.

#### G. Test support

- `test/support/fake-bus.ts`: a `ServicesBus` over `REGISTRY`'s codec: `invoke(name, input, client?)` validates the input, runs an interceptor before the handler, validates the output, and answers a `CommandResult` as the router would (a `HostCommandError` intact, any other throw `internal`); `emit` validates and records; taps hear what was sent.
- `test/support/fake-spine-host.ts`: a `SpineHosts` whose engine host is ready and streaming on `ready()`. It answers every command the spine sends at a connect with the smallest valid answer (an empty scan, no holders, empty library reads, configure commands accepted), plays `session.replay.launch` through the engine host's own `ReplayHost` (`src/engine-host/fs/replay/host.ts`) with the engine's normalizer (`engineNormalizer`, `src/engine-host/fs/replay/normalizer.ts`) over `spikes/protocol-probe/fixtures/permission-roundtrip.jsonl` at the fastest speed (the in-process host `src/main/index/replay.test.ts` builds is the pattern: a dispatch that validates input and output through the registry), and when the journal's `can_use_tool` row plays emits the `session.brokerItems` frame the broker would raise for it (built with `test/support/builders.ts`), so attention folds a pending permission. Anything else answers `host_unavailable`. It may extend `test/support/session-host.ts`'s `FakeEngineHost`.
- `test/support/fake-spine-view.ts`: a settable `SpineView` (records, projects, digests, attention, intents, visibility, statuses) with helpers that fire each event, used by every reader's tests.
- `test/support/spine-fixture.ts`: D19's profile, written through the index's own API (`Index`, `sessions.upsertFromSummary` over `test/support/index-fixture.ts`'s `summary`, the index's attention store, library store and drafts) and the prompt history's file, from a seeded generator.

## Owner questions

None. O3-C changes nothing a person sees; its forks are technical and decided below.

## Surprises & Discoveries

Read at authoring, on master `5698b6ef0`, against O3's grounding at `p5-o2`.

- Observation: the spine's imports of main's IPC are fewer and simpler than "29 files" suggests: nine library files import values (`registerMainHandler`, `interceptCommand`, `emit`, `onEmitted`, `CommandFailure`), the rest types (`HostDispatch`, `typeof registerMainHandler`, `HostSupervisor` through `src/main/hosts/supervisor.ts`), and `CommandFailure`'s job is already done by `@shared/host/runtime`'s `HostCommandError`, which main's router answers intact for any owner.
  Evidence: a value-import graph over `src/main/{index,sessions,side,history,attention,owner,settings,library}` reaches `electron` from 9 of 98 files, every path through `src/main/ipc/router.ts` but `attention/index.ts` (the client half); `router.ts`'s catch answers `HostCommandError` through `thrownError`.
- Observation: Decision Log 2's reader map misses three staying reads: the interest report's read of the read model's visible set (`sessions.model.visibleSessions()`, its `visible` event), O8 M2's org rows (`index.projects.listWithRemoved()` and the `session.projects.changed` tap), and scm's `records` from the read model; and `layout/store.ts` still exports `dropPanelKeysOfRemovedSessions`, which only its tests call.
  Evidence: `src/main/index.ts`'s `startInterest` and `createRemoteRows` calls; `grep -rn dropPanelKeysOfRemovedSessions src` lists `store.ts` and `store.test.ts` (and a mock in `lifecycle.test.ts`) only.
- Observation: in launch mode `scenario`, readers of `index.sessions` (the browser, connectors, the export authors) and readers of the read model (the notifier, the quit guard, the chat panels) see different sessions today: the stub fills the read model, the index stays the profile's.
  Evidence: `src/main/sessions/index.ts` registers the index source unstarted in `scenario`; `startBrowser` reads `index.sessions` directly.
- Observation: three project sets are read today: the read model holds visible projects with content (`index.projects.list()`); `session.projects.list` and the org rows answer those plus hidden ones with content (`listWithRemoved()`); connectors and `git.lsFiles` read every row (`list({ includeHidden: true })`), and route D's directory fallback needs a row with no present session. `session.projects.changed` carries the second set only.
  Evidence: `src/main/index/source.ts`'s start; `projects.ts`'s `HAS_PROJECT_CONTENT`; `src/main/connectors/eligibility.ts`'s `artifactDirectories`; `direct-route.test.ts`'s creator-gone case.
- Observation: the worktree service, which §5 moves at O3-D with the session service, registers `git.worktree.*`, while O3's "Contract additions" retag `git.*` at O3-E; and the spine registers two `settings.*` commands (`settings.engineApplied`, `settings.userEngineDefaults`) that the O3-D retag list does not name. `[parent-impact]`, for O3-D's retag.
  Evidence: `src/main/git/worktrees-register.ts` registers `git.worktree.{add,branch,deleteBranch,list,remove,status}`; `src/main/index.ts` registers the two `settings.*` handlers beside the spine's relays.
- Observation: `src/engine-host/bundle-guard.test.ts` forbids dynamic `import()` in `mawsd`'s graph, because a running daemon must not load code from a binary replaced under it (E10), while O3 §11 asks for the spine's modules to be "imported only when first needed, never at start". A lazy `require` of `out/main/services.js` meets the same hazard. `[parent-impact]`, for O3-D's cold core.
  Evidence: the guard's "have no dynamic import()" over `graphOf(out/main/mawsd.js)`; O3 §11, "A cold core".
- Observation: the notifier's silence for restored attention travels outside the event: the attention service fills `restoredIds` before it emits `attention.changed`, whose payload carries no mark. In process the view can compute `silent`; on the daemon shape the mirror cannot, unless the services front sends the mark. `[parent-impact]`, for O3-D's wire (an additive field or a machine-only event).
  Evidence: `src/main/attention/service.ts` (`restoredIds`, "marked before their change is emitted"); `attention.changed`'s schema.
- Observation: every settings field the spine reads is a machine field of O3 §3's table (`gateway`, `engine`, `permissions.autoFallback`, `mods.toHuman.enabled`, `supervisor.idleExitMinutes`, the design-system defaults, `sessions.archiveInactiveDays`), so the spine can read `MachineSettingsService` alone.
  Evidence: `src/main/settings/session-settings.ts`, `owner/register.ts`, `engine-configure.ts`, `host-configure.ts`, `artifacts/defaults.ts`, and the sweep's schedule in `src/main/index.ts`.
- Observation: a measured group that builds `out/` gets 60 minutes (`gate-plan.mjs`): two settle guards of up to 15 minutes each and the prebuild leave about 28 minutes for the spec.
  Evidence: `gate-plan.mjs`, `const minutes = measured.has(group) ? (prebuild ? 60 : 45) : …`.
- Observation: O9's driver, today on `p5-o9`, imports only a type from main's IPC (`MainHandler`), reads the index through main's root, and is already Electron-free under `MACHINE_BOUND`.
  Evidence: `git show p5-o9:src/main/lane-a/driver.ts` imports; `git diff master...p5-o9 -- src/main/index.ts`.

## Decision Log

- **D1. 2026-10-28, O3-C's planner: the verification.** This document gets doperpowers:adversarial-reviewer rounds on its execution section for buildability (complete, aligned with O3's design, buildable by an engineer with nothing but this document and the code), repeated until a round yields nothing worth changing; the rounds are recorded below. Execution: one `doperpowers:plan-executor` running doperpowers:subagent-driven-execution, a task review at each milestone's frontier, and doperpowers:review-code at the **High** rung (`doperpowers:reviewer-high`) over the branch at M6, as O3-C's section names.
- **D2. The library is `src/services/`, flat, with `src/main/`'s directory names; the two sets are its two roots.** Imports between moved modules keep their relative paths, so the move is a rename. Rejected: `src/services/{spine,checkouts}/` (every import between the sets changes, and git's runner is both's); keeping the files in place behind a glob list (the boundary is then a list to keep current, and `MACHINE_BOUND_ALLOWED` could not shrink to client files).
- **D3. Helpers both sides use go to `src/shared/`** (atomic write, the tail reader, the settings file rules, the launch mode, session directories, the engine config dir, sminos's id functions). This settles O3-A's flow-back: the client half reaches the file rules in neutral ground. Rejected: lint exceptions letting client code import those library modules (the list grows with each helper and blurs what O3-D must serve).
- **D4. The bus is injected through each module's dependencies,** overturning §6's suggestion of O6's module-level binding. Most of these modules already take `register` and `emit`, and a root is the one place that knows its bus. Rejected: a module-level `bindServicesBus` (a hidden dependency, a failure mode for a registration made before binding, and every test must bind first).
- **D5. Library handlers fail with `HostCommandError`.** Main's router and every host runtime already answer it intact. Rejected: moving `CommandFailure` to `src/shared/` (a second class with the same meaning that `mawsd`'s runtime would have to learn).
- **D6. `ServicesBus`, `SpineView` and the `MachineSettingsService` interface are types in `src/shared/spine/`.** The library implements the view and the machine half in process; at O3-D main implements both again over the services front (O3X3's "the machine half's service", O3X4's mirror), and both roots bind the bus. Rejected: defining them in `src/services/` (client code would import the library, which rule B forbids).
- **D7. The view's members are Interfaces §B, which adds the visible set to §7's list.** The interest report reads it (R5); in process the read model holds it. A record's lineage is read from the record; no separate member. Rejected: moving page visibility to the client half with a spine port (it changes `session.setVisible`'s owner, which O3-D's retag of `session.*` assumes). `[parent-impact]`: §7's list gains the visible set, and O3-D's mirror backs it.
- **D8. The view keeps both project sets the code reads today:** `projects()`, what `session.projects.list` answers (the org rows' listing), and `projectRows()` with `project(id)`, every row the index holds (connectors' lookup, `git.lsFiles`'s roots). Route D needs no live session: an artifact whose creator is gone falls back to its project's directory (`src/main/connectors/eligibility.ts`, `artifactDirectories`), and a discovered project whose sessions' transcripts retention removed is a row `listWithRemoved()` omits. Rejected (review round 1): narrowing connectors and `git.lsFiles` to the listing, which drops that fallback directory. `[parent-impact]`: O3-D's mirror must hold every project row, which `session.projects.changed` does not carry.
- **D9. In process, the view is backed by what the renderer is told:** the read model, the emitted projects list, the intent store with `session.intent.changed`, the attention service's restored ids, the session service's `acquire`, the library's linked paths (Interfaces §B). Rejected: backing records by the index directly (it differs from the read model only in launch mode `scenario`, and O3-D's mirror can reproduce only what the services front publishes).
- **D10. In launch mode `scenario` the view answers the scenario's sessions and reports itself unavailable.** Every reader then sees the sessions the renderer shows, and the browser reconciles nothing against a scenario. Rejected: available in `scenario` (a `dev:stub` run on a real profile would delete that profile's agent activity rows at the browser's start).
- **D11. The sweep reads the interest union through a port, `interest()`, read at each check.** On the embedded shape main binds it to the set its own interest report sends (the tabs of `main.tabs` and the sessions on screen, as `openSessionTabs` computed); at O3-D it is `mawsd`'s union. Rejected: the spine keeping its own union fed by host.interest-like reports on the embedded shape (a second report path that O3-D replaces anyway).
- **D12. The spine reads the machine half of the settings only** (`MachineSettingsService`), subscribing to its changes rather than to `settings.changed`. Rejected: handing the spine the merged `Settings` (`mawsd` has no client half to merge at O3-D).
- **D13. The bundle check is a third input of main's build** (`src/services/entry.ts` to `out/main/services.js`), held by `bundle-guard.test.ts` to `mawsd`'s rule. It is also what O3-D's `mawsd` will load. Rejected: building the entry inside a test (a second bundler configuration to keep equal to main's), and inspecting main's `index.js` graph (which requires Electron by right).
- **D14. The boundary is enforced by lint and the bundle check; the reader coverage by construction and the fake view.** Rule A and the bundle guard cover every edge out of the library, rule B every edge into it, and main's root receives only the view. Rejected: a custom import-graph test (a third mechanism over edges the first two already cover).
- **D15. `machine/identity.ts` moves into the library,** exported by the entry and called first by each root as today, so O3-D's `mawsd` can serve `machine.identity` without importing `src/main/`. Rejected: leaving it for O3-D (its import of the index's org-project code would cross rule B now).
- **D16. A client file in a directory whose machine part moved stays at its path.** History and import paths stay put for the client. Rejected: relocating them into new client directories (churn with no reader).
- **D17. `dropPanelKeysOfRemovedSessions` is deleted, not ported.** Production removes panel keys through `registerChatPanels`; the function has no caller. Rejected: porting a dead reader onto the view.
- **D18. The idle reading is a fourth case of `e2e/daemon-idle.spec.ts`, chosen by title, over the entry's `idleReading`.** The loaded window is `IDLE_RUN`'s (120 s settle, 600 s); the released one is a 120 s settle and a 300 s window after the root's `stop` and a full collection when the runtime exposes one. Rejected: a command-line mode in the entry (a product surface for a diagnostic); a spec file of its own (it would duplicate the readers and the validity rule); a second 600 s window (the case would pass the measured job's 60 minutes with both settle guards at their bound).
- **D19. The profile-sized fixture:** 5,000 sessions (the owner's store held 5,108 transcript summaries, `src/main/index/source.ts`'s header) over 50 project folders (no repositories, so no git runs at start but the org refresh's one per project), 300 attention items of which 40 pending, 1,000 library rows, 50 drafts and 2,000 prompt-history lines, from a seeded generator, written through the index's own API. The counts are recorded with each reading. Rejected: a copy of a real profile (the owner's data on the mini) and raw SQL inserts (rows the code would never write).
- **D20. O9's local half: whichever lands second keeps both,** by the Constraints' rule: lane A is spine, moves to `src/services/lane-a/`, composes in `startSpine`, registers through the bus. Rejected: holding O3-C until O9 lands (O9's remote half follows its local half, and neither needs the other's code).
- **D21. Each root's stop is one shutdown step** at its first part's place today, running its parts in today's relative order. Steps run synchronously in one pass after the hosts' drain, so only the order inside a root matters. Rejected: registering every part's step from inside the root (main's step list would depend on the library's internals).
- **D22. The library's derived index is the spine's; its files are the client's.** From M1 `startLibrary` composes the store, the sync and `library.list`, `.get`, `.spaces` and `library.changed` only, and main composes `registerLibraryFiles` (O4's); from M4 `startSpine` composes the former and main reaches the files service through `CheckoutsRoot.files`. Split in M1 because M3's rules refuse the edge between them. Rejected: keeping `startLibrary` whole (O4's file code would sit in the spine's root); splitting in M4 (M3 could not pass its own boundary).
- **D23. The design-system defaults relay is the spine's.** From M1 main composes `startArtifactDefaults` beside `startArtifacts`, which loses `relayDefaults`; from M4 `startSpine` composes it over the machine half. Rejected: relaying from the client half (it would read machine fields from the merged settings after O3-D); moving it in M4 only (M3's rule B refuses the client's `artifacts/index.ts` importing it).
- **D24. `settings.userEngineDefaults`, `settings.engineApplied`, `session.recentTurns` and `session.history.*` are registered by `startSpine`.** They answer the machine's engine configuration and the machine's files. Rejected: keeping them in main's root (they read the index and the engine's configuration on the machine, which a remote client asks the machine for).
- **R1. 2026-10-28, review round 1** (doperpowers:adversarial-reviewer on `84cdd43a9`; 1 P1, 2 P2, each checked against the code and adopted). (1) M3's rules would refuse three edges M3 could not cut by moving: `library/index.ts` composing the client's `library/files.ts`, the client's `artifacts/index.ts` composing the spine's defaults relay, and `machine/identity.ts`'s `MachineHandler` type; M1 now cuts all three in place (D22, D23). (2) Narrowing connectors to `session.projects.list`'s projects broke route D's fallback directory for an artifact whose project has no present session: the view keeps every project row beside the listing (D8). (3) M4's entry exported `idleReading` before M5 creates it: the entry's exports are per milestone (§E).
- **D25. The commands, intercepts and taps each root installs are pinned by a test,** and M6 records the lists for O3-D's retag. Rejected: leaving O3-D to derive them from the code (the retag list O3 wrote already misses `git.worktree.*` and two `settings.*` commands).

## Outcomes & Retrospective

Pending — written at finish.
