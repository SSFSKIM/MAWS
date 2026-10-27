# The headless cut: sizing a MAWS machine daemon at current master

**Scope.** A read-only survey of MAWS at `origin/master` **c3507722d** (2026-10-26), checkout `/private/tmp/maws-arch`. It updates `/Users/new/claude-code-bundle/2.1.300/notes/maws-web-porting-surface.md` ("the note", which read e42e6bbd8) for one question: what it costs to move every machine-bound service out of Electron main into a headless per-machine daemon, compared with a Desktop-SSH-style helper.

**Conventions.**
- Every `path:line` is at c3507722d, relative to the repository root.
- Line counts are non-test TypeScript (`*.test.ts` and `test/` excluded).
- "(inferred)" marks a claim not verified in source.
- The detailed tables behind §4 and §6 are in `headless-cut-survey-appendix.md`. The scripts are in `scripts/`.

## 0. The answer in one page

- **The surface grew but kept its shape.** Main grew about 5,200 lines (from 42,170 to 47,414), almost all of it new machine-bound services built on injected dependencies: Discover's catalog, Send to, connector sign-in, the inactive-session sweep and session full-text search. The registry went from 365 to 397 commands, and main owns 204 of them (it owned 186). None of the note's §3 items left main.
- **Most of the cut is relocation.** About 27,000 lines of main are already plain Node: the index and read model, the session service, attention, the owner channel, git, scm, files, the library, connectors, delivery, the catalog and settings. Their Electron contact is narrow:
  - `shell.trashItem`, `safeStorage`, dialogs, reveal and open-external, and `Notification`;
  - per-window state keyed by `WebContents`, in 34 files.

  About 15,000 lines are tied to Chromium (the browser alone is 11,788). About 2,800 lines are process ownership.
- **Three findings make it harder than the note implies.**
  1. **Moving main freezes the wire.** The wire fingerprint leaves main out deliberately, "or every settings bump would strand kept sessions" (`src/shared/ipc/wire-fingerprint.ts:5-6`). Settings went from v14 to v18 in five days. A compatibility window therefore becomes step zero.
  2. **The spine is read synchronously.** Settings, index, read model, attention, owner channel and the session service are read in memory by scm, files, `git.lsFiles`, the sweep, the quit guard, the notifier, the layout and the browser. So the spine moves as one step.
  3. **Agent tools are bound to the app.** `artifact_screenshot`, `artifact_export` and browser control need Chromium or the app. The browser socket is frozen into the engine's environment at launch. And the harnesses test the utility-process host, not the detached one.
- **Route.** Do not fold main's services into the supervisor's event loop. Run them in a plain-Node **services host** that is the supervisor's one client, as main is today, and make it the multi-client front.
  - This leaves E10's single-client machinery correct: the connect burst, the undelivered tail and `ready`.
  - Main's derivations then run live while no app is open, which removes the `tail_gap` loss that E10 accepted.
  - The cut lands in eight steps, and the app works after each one (§3).
- **The alternative is not cheaper.** The SSH-helper design costs about the same new and changed code: about 10k to 16k lines, against 11k to 20k for the daemon. It still needs a helper that runs most of MAWS's machine code. And it leaves the org shape's defining cases unsolved: a second client, the laptop asleep, and a Linux VM with no app.

## 1. Delta since e42e6bbd8

**How the counts were made.** The registries were counted the way the note counted them: by bundling `src/shared/ipc/schema.ts` and `names.ts` at both commits with esbuild and enumerating the live registries (`scripts/count.mjs`). At e42e6bbd8 the script reproduces the note's numbers exactly.

| | e42e6bbd8 | c3507722d |
|---|---:|---:|
| Commands | 365 | **397** |
| owner `main` / `engine-host` / `pty-host` | 186 / 169 / 10 | **204 / 183 / 10** |
| Main-only commands | 34 | 40 |
| Events | 77 | **81** |
| emitted by engine host / pty host / main | 30 / 2 / 45 | 30 / 2 / **49** |

**New commands.**

- **In main (+18):**
  - `catalog.*` (7) and `delivery.*` (5), both new namespaces;
  - `connectors.{signIn,signInCancel}`;
  - `session.{search,archiveOlder}`;
  - `attention.viewing` and `layout.nativeEdit`.
- **In the engine host (+14):**
  - `session.{mcpAuthenticate,mcpOAuthCallback}`;
  - `fs.sessionText`;
  - `plugins.{marketplaceManifest,directoryProvenance}`;
  - `artifacts.{datasetFiles,rereadDatasetFile}`;
  - `connectors.{add,remove,directLocate,directSend,observe}`;
  - `customization.{inventory,serverEndpoints}`.
- **New events, all main-emitted:** `catalog.changed`, `connectors.signInChanged`, `delivery.receipt` and `layout.edit`.

**Main services that are new or grown:**

| Service | Lines | Locality | Notes |
|---|---:|---|---|
| `src/main/catalog/` (new) | 2,120 | Split: the network half is the person's ("the catalog is the person's", `src/main/catalog/index.ts:3`); the engine-reads half is per machine and per cwd | It joins network sources with `plugins.list`, `marketplaces.list` and `customization.inventory` through the host (`engine-reads.ts:1-14`), `fs.watch`es the engine's plugin state (`state-watch.ts:88-89`), and imports engine-host code directly (`index.ts:13`). It has no direct Electron import. |
| `src/main/delivery/` (new) | 856 | Person-bound credentials, located on one machine | Notion goes through route D; Drive through the owner's `gws` CLI under the login shell (`src/main/index.ts:655-667`; `delivery/gws.ts:25`). Needs the Chromium export. |
| `src/main/connectors/sign-in*.ts`, `owner-delivery.ts` (new) | 582 | Machine, with consent on the machine | The engine's MCP sign-in through a MAWS listener on 127.0.0.1, or the engine's own `localhost:<port>` (`sign-in.ts:1-36`). This is a second loopback consent path. |
| `src/main/sessions/inactive-archive.ts`, `restored-cost.ts` (new) | 186 | Machine, but it reads client state | The sweep spares sessions open in a tab by reading `layout.json` (`src/main/index.ts:449-462`; `layout/open-session-tabs.ts:1-11`). |
| `src/main/index/session-search.ts` and the `session_text*` FTS tables (new) | 94 + migration | Machine | Filled by pulling each transcript's text from the host (`src/main/index/source.ts:382`). |
| `src/main/artifacts/inspection.ts` (new) | 72 | Chromium | Document and slide PNGs for `artifact_screenshot` (`src/engine-host/tool-server/artifact-inspection.ts:10-31`). |
| `src/main/attention/actions.ts` (new), `notifier.ts` (rewritten) | 37 | Client | Notification actions that dispatch to the host (`src/main/index.ts:770`). |

**Shape changes to the note's §3.**

- **The process boundary did not move.** `src/main/hosts/` is unchanged at 1,654 lines.
- **One new single-client assumption.** The runtime gained a startup admission gate, and with it a request is dropped if `port !== source` when it resumes. The comment states the premise: "renderer windows multiplex through main" (`src/shared/host/runtime.ts:227-229`).
- **Item 7 has a second consent path** (sign-in) and now also serves owner delivery (`src/main/index.ts:663`).
- **Item 1 pulls in bulk.** It now pulls full transcript text from the host.
- **Item 2 depends on client layout.**
- **Item 12 now shapes every launch.** It owns `engine.mcpServers` (v16) and `engine.launchProfile` (v17), which every launch reads (`src/main/sessions/launch-mapping.ts:81-84`), so the daemon that launches must own them.

## 2. Sizing per item

| # | Item | Files (lines) | Electron dependencies | What each needs instead |
|---|---|---|---|---|
| 1 | Index and read model | `src/main/index/` (3,247) plus the read side of `sessions/` (`read-model`, `digest`, `availability`, `index`, `resync`, `launch-watch`, `stub-*`, `observed`, `select-source`: 1,522). **About 4,770.** | `app.getPath('userData')` (`src/main/index.ts:251`). The visible set is keyed by `WebContents` (`src/main/sessions/index.ts:114-142`). The browser's `browser_history`, `browser_bookmarks` and `browser_activity` tables share `index.sqlite` (`src/main/index/migrations.ts`). | The daemon's data dir. Visibility becomes the union across clients. The browser tables split out with the tab engine (a migration). |
| 2 | Session service | The rest of `sessions/` (4,400), `side/` (276), `history/` (135). **About 4,810.** | `shell.trashItem` and `showItemInFolder` (`src/main/index.ts:438-439`). The cua socket path from main's browser at launch (`:444`; `launch-mapping.ts:84`). | Trash per OS: on macOS a Finder or NSFileManager helper in the LaunchAgent's GUI session (inferred); on Linux the freedesktop Trash. Reveal moves to the client. The cua socket becomes daemon-owned (§5). |
| 3 | Attention | Core: `service`, `store`, `file-attention-store`, `actions` (494), plus `src/main/index/attention*.ts`. Client half: `notifier`, `index`, `navigation` (243). | `Notification` and `app` (`src/main/attention/notifier.ts:3`). Focus and viewing per window (`attention/index.ts:17-41`). | The core moves. The notifier stays in every client, but it reads the read model in memory (`notifier.ts:33-36`), so it needs a client-side mirror fed by `attention.changed` and `session.digest`. |
| 4 | Owner channel and mods | `src/main/owner/` (2,093) | None | Moves as it is, with settings, the hosts and attention (`src/main/index.ts:416-420`). |
| 5 | git, scm, files | `git/` (1,803), `scm/` (1,488), `files/` (1,154). **About 4,445.** | Watch counts by sender. Pick and save dialogs (`src/main/index.ts:380-388, 554-562`). `openPath` and reveal (`:396-397`). | Watch counts per client; dialogs, open and reveal go to the client. The recursive `fs.watch` of each repo root (`src/main/git/watcher.ts:314-341`) will meet inotify limits on Linux (inferred). |
| 6 | Library | `src/main/library/` (1,025) | Dialogs, `openPath` and reveal, all injected (`src/main/index.ts:700-735`). It shares the artifact root path with the host (`:710`). | Dialogs go to the client. On the same machine the shared path holds; a remote client needs bytes. |
| 7 | Connectors, delivery, catalog | `connectors/` (4,929), `delivery/` (856), `catalog/` (2,120). **About 7,905.** | `safeStorage` and `app.whenReady` (`src/main/connectors/oauth-root.ts:16, 70-75`). The lease's visibility veto reads the owner's `BrowserWindow` (`src/main/index.ts:641`; `connectors/index.ts:9-14, 141`). Two loopback consent flows (`oauth-callback.ts:2-5`; `sign-in.ts:7-13`). | A Keychain API outside Chromium (`security` or a native helper on macOS; libsecret or a sealed file on Linux), plus a migration of the existing OSCrypt ciphertext (§7.13). Visibility becomes a client-reported fact. Consent opens on the client, with the callback relayed to the machine. |
| 8 | Offscreen render and export | `artifacts/capture.ts` (220); `export.ts`, `export-document.ts`, `inspection.ts`, `defaults.ts`, `page-connectors.ts` (944); `presentations/export.ts` and `present-embeds.ts` (500); `dashboard/` (387); `design/export.ts` (114); `design-systems/` (191). **About 2,360.** | `BrowserWindow`, `capturePage` and `printToPDF` (`capture.ts:72, 100`; `export.ts:500-580`; `inspection.ts:52`; `dashboard/pictures.ts:81`), on the `maws-capture` partition (`artifacts/index.ts:51-64`). | Chromium on the machine (§5) |
| 9 | `maws-artifact:` scheme | `protocol.ts`, `scheme-handler.ts`, `policies.ts`, `bridge-script.ts` (796); `open.ts` and `index.ts` (199) | `protocol.registerSchemesAsPrivileged` and `session.protocol.handle` (`src/main/artifacts/protocol.ts:19, 59`). Frame policies on `session.defaultSession` (`artifacts/index.ts:51-52`). | An HTTP endpoint on the daemon. A local client keeps `protocol.handle` as a proxy to it. |
| 10 | pty host | `src/pty-host/` (530), plus the fork in `src/main/hosts/supervisor.ts:220-254` | `utilityProcess.fork` (`supervisor.ts:225`), `process.parentPort` (`src/shared/host/runtime.ts:254-256`), the node-pty native addon | A `child_process.fork` from the daemon, served on a socket the way detached mode does. `pty.data` needs a binary frame type: today the socket base64-encodes bytes inside JSON (`src/shared/host/json-bytes.ts`). |
| 11 | Browser | `src/main/browser/` (11,788): core 3,710, cua 1,984, import 2,398, extensions 876, agent 729, comment 703, bookmarks 416 | `WebContentsView`, partitions, `Menu`, `dialog`, `clipboard`, the debugger. The Keychain for Chrome import (`browser/import/keychain.ts`). The peer-auth addon ships for darwin-arm64 only (`browser/cua/peer.ts:31-32`). | Inherently Electron (§5) |
| 12 | Settings, usage, gateway | `settings/` (506), `usage/` (737), `gateway/` (91). **About 1,330.** | `nativeTheme` (`src/main/settings/index.ts:5, 23`). One `settings.json` mixes client and machine fields. ClaudeUsage's open runs `/usr/bin/open -b` (`gateway/claude-usage-app.ts:78`). | Split the file: the theme and notifications are the client's; engine, supervisor, sessions and the launch profile are the machine's (or the org's). The ClaudeUsage hand-off is macOS GUI only. |
| 13 | Supervisor lifecycle and quit | `hosts/` (1,654), `lifecycle/` (625) | The spawn sets `ELECTRON_RUN_AS_NODE` (`src/main/hosts/detached-transport.ts:646-647`). The quit guard's dialog. `openPath` for the log (`hosts/index.ts:48`). | A LaunchAgent or a systemd user unit; the app connects to it or kicks it. The quit guard shrinks to unsaved files. |
| - | Client shell, which stays | `layout/` (205), `voice/` (770), top-level `src/main/*.ts` (1,496), `ipc/` (189) | All of the above | Stays |

**Totals.**

| Category | Items | Lines |
|---|---|---:|
| Plain Node, which moves | 1-7 and 12 | about 26,900 |
| Chromium-bound | 8, 9 and 11 | about 15,000 |
| Process ownership | 10 and 13 | about 2,800 |
| Client shell | the last row, plus the client halves of 3, 5 and 6 | about 2,700 |

**Why the code mostly moves verbatim.**

- **Every service is wired through injected dependencies** in one composition root (`src/main/index.ts:226-760`): `register`, `emit`, `call` or `dispatch`, and `onEvent`.
- **The host coupling is already async and message-shaped:** 50 dispatch sites, 47 `onEvent` sites, 131 `emit` sites and 189 handler registrations.
- **What changes instead of moving:**
  - `MainContext.sender: WebContents`, with 226 uses in 34 files (`src/main/ipc/router.ts:23-25, 104`);
  - `emit` to every window (`src/main/ipc/events.ts:14`), which becomes fan-out with per-client subscriptions;
  - the `onEmitted` taps that couple services through main's own events (`src/main/index.ts:378, 499, 512, 628`; `menu.ts:190`; `sessions/panel-lifetime.ts:26`; `sessions/index.ts:79-95`).

**By command.** Of the 204 main commands:

| Disposition | Count | Which |
|---|---:|---|
| Move with their service | about 130 | |
| Chromium-bound | 38 | `browser.*` and `artifacts.export` |
| Stay with the client | about 36 | `layout.*`; `voice.*`; `attention.{viewing,pendingNavigate}`; `host.{status,restart,openLog}`; `engine.hostState`; `pty.{hostState,openLink}`; the reveal and open-external commands; `presentations.present`; `artifacts.downloadAsset`; `library.saveAs` |

Every main command was traced to exactly one registering file (`scripts/main-handlers.json`).

## 3. Dependency order

**Constraints.**

- **(a) The spine is read synchronously.** These callers read the read model, the index or settings in memory:
  - scm (`records: (id) => sessions.model.record(id)`, `src/main/index.ts:472`);
  - the files allowlist (`:394`);
  - the `git.lsFiles` roots (`:363-377`);
  - the sweep (`:449-460`);
  - the notifier (`:770`);
  - the quit guard (`:772`);
  - the chat panels (`:309`);
  - the browser and the library (`:573, 585, 700`);
  - `settings.state()`, at 13 call sites.
- **(b) Moved code crosses an exact-match version check.** Anything moved into a process that outlives the app sits behind that check (`wire-fingerprint.ts:1-6`).
- **(c) The client tails must keep working at every step.** These are the dialogs, reveal, notifications and visibility facts.

**Sequence.** "Services host" is a plain-Node process that runs main's moved services. It is the supervisor's single client over the existing detached transport, and it fronts the clients.

1. **S0: seams inside main, with no process move.**
   - `MainContext` carries a `ClientRef {id, onGone}` instead of a `WebContents` (34 files, mechanical).
   - Electron-only effects move behind one injected `Desktop` port: trash, reveal, openPath, openExternal, dialogs, notifications, `nativeTheme` and `safeStorage`.
   - A registry owner value (for example `machine`) lets the router forward a namespace to another process transparently.
   - A wire compatibility window replaces the exact fingerprint. This is the prerequisite for everything below.
2. **S1: daemon lifecycle.**
   - A LaunchAgent or systemd user unit owns the supervisor. The app connects or kicks it instead of spawning it (`detached-transport.ts:408, 646`).
   - On macOS the unit can keep running the app bundle's binary as Node; nothing needs rebuilding, because the engine host has no native addon. Linux needs a bundled Node and its prebuilds.
   - The idle exit and idle-row release are re-keyed from "no client" to "no interest".
   - The harnesses default to utility mode (`src/main/hosts/mode.ts:11`), so at least the supervisor suites move to the daemon shape here.
3. **S2: the pty host under the daemon.**
   - The daemon forks the pty host (the supervisor until S3, then the services host). A binary `pty.data` frame sits beside protocol 2's doc frames (`src/shared/host/socket-protocol.ts`), and credit is acked across the socket.
   - Independent of S3 to S6; it ends "terminals die with the app" (`docs/doperpowers/plans/2026-10-06-e10-supervisor.md:187`).
4. **S3: the services host and the spine, in one step (about 14,000 lines).**
   - **What moves:** the machine half of settings (main keeps a mirror for the menu, the theme and the browser), the index and read model, the attention core, the owner channel and mods, and the session service with its intents, worktrees and history. Side threads, yield, the sweep, observed facts and replay move with them.
   - **What main keeps:** the client tails and the forwarding of the moved namespaces. The notifier switches to events. The quit guard keeps only unsaved files. The chat panels ask for `known(id)`.
   - **The split:** the browser's tables leave `index.sqlite`.
   - **What this buys:** derivations now run while no app is open.
5. **S4: git, scm and files.** They read the read model's records and the intents synchronously (`src/main/index.ts:363-377, 394, 471-480`), so they follow S3. Their watch counts become per client.
6. **S5: library, connectors, delivery and catalog.**
   - The library and delivery call the exporter registry, which is still Chromium in main at this point. So this step adds a render bridge from the services host to main, the same shape as today's host bridge for `maws.artifact.export`.
   - It also brings the Keychain replacement and migration, and consent relayed through a client.
7. **S6: the Chromium residue onto the machine** (§5).
   - a render service under the daemon;
   - the artifact scheme served over HTTP;
   - a per-session cua socket owned by the daemon and relayed to whichever tab engine is attached.
8. **S7: the network.**
   - Remote clients over TLS or through the hub (the desk hub lives in this repository, `apps/desk-hub/`).
   - Authentication and capability classes, enforced on the machine.
   - Per-client subscriptions in the services host.
   - The renderer's machine dimension (§4).

**Why S3 is one step.** Splitting it turns the session service's `index.sessions.*` and `worktrees.*` calls into interim remote calls that the next step undoes, and its parts share the `onEmitted` taps and the read model's `on('record')` (`src/main/sessions/panel-lifetime.ts:25`). Settings alone could go first, with a full mirror in main.

**Why a services host, not a merge into the supervisor.** The index is synchronous `node:sqlite` `DatabaseSync` (`src/main/index/db.ts:6`). In the supervisor it, the FTS fill and the library index would share one loop with event batching, the `maws` tool server and Yjs commits; the engine host already instruments its request time (`src/engine-host/documents/host-work.ts`, P4-R6). With an always-connected single client, E10's premise stays true and the burst becomes a crash-recovery path. A merge stays possible later.

## 4. Single-client and single-machine assumptions

**The premise.** One client is a stated premise of E10: "There is at most one client at a time (one app per data directory, the single-instance lock)" (`docs/doperpowers/plans/2026-10-06-e10-supervisor.md:29`).

**What the §3 route changes.** On that route the supervisor rows below can stay as they are. The multi-client work moves into the services host's fan-out, which is new code either way, since main's `emit` has no cursors. A merge into the supervisor would need every row changed.

### 4.1 The supervisor

| Assumption | Where | Multi-client need |
|---|---|---|
| A second valid hello replaces the first (`refuse replaced`); main treats `replaced` as terminal | `src/shared/host/socket-server.ts:74, 177-187`; `src/main/hosts/supervisor.ts:421`; `detached-transport.ts:111-114, 512-514` | A client set |
| One `port` and one `ready` in the runtime; a request is dropped when its port is no longer *the* port | `src/shared/host/runtime.ts:60-79, 189-194, 226-229` | Per-client handles |
| `emit` is true only if the one client took the event, and cursors advance on that; with no client, events are dropped and counted | `runtime.ts:23-24, 113-137`; `src/engine-host/session-stream.ts:234-239` | Broadcast separate from emit-to-one |
| One delivered cursor per stream; a trim past it logs `tail_gap` | `session-stream.ts:68-73, 97-99, 142-148, 213-220` | A cursor per (stream, client) |
| The connect burst republishes every row through the shared `emit`; one status signature | `runtime.ts:167-186`; `src/engine-host/ipc.ts:855-876`; `session-stream.ts:199-230`; `src/engine-host/supervision.ts:88, 179-185` | A burst to the joiner only |
| One journal paging cursor per stream | `session-stream.ts:75-87, 253-258` | A cursor cache (performance only) |
| Idle exit with no client and no live row | `supervision.ts:5-8, 98-101, 137, 166` | None under launchd or systemd (inferred) |
| Idle-row release while "no app connected" | `supervision.ts:11-12, 129-133`; `src/engine-host/process-table.ts:225-269` | Re-key on interest (§7.9) |
| Any client may `exit`, `host.configure` (last writer wins) or `host.stopAll`; a welcome resets the login-shell capture ("the owner is back") | `socket-server.ts:52, 224-227`; `src/engine-host/detached.ts:156-161`; `supervision.ts:65-87` | Daemon-admin operations behind authority |
| `onClientGone` ends route E's calls, direct ops and `ConnectionHolds`; dataset refreshes settle `noClient` | `runtime.ts:81-95`; `src/engine-host/connectors/register.ts:124-130`; `documents/register.ts:265-267`; `connectors/dataset-requests.ts:94` | Per-client holds |
| Host bridges take "the" client's first answer | `src/engine-host/tool-server/bridge.ts:1-46`; `session-maws.ts:85-87` | A chosen client, or the render service |
| An exact protocol and wire match | `socket-server.ts:159-176`; `wire-fingerprint.ts:1-28` | A compatibility range |

**Already safe across clients.**

- **Answers.** Pending answers are first-wins with `not_pending` for the rest (`src/engine-host/broker.ts:127-131`).
- **Document channels.** They are already kept per connection on the host (`socket-server.ts:13-16, 192-199`).

### 4.2 Main's supervisor client and per-client state

**Main's client** keeps one host per owner (the pty host utility-only); its held requests, its resync's `FoldFilter` (by `appSessionId`) and six `onStreaming` reconcilers carry no machine; dispatch is `(owner, name, input)` (`src/main/ipc/router.ts:27-29, 109-110`); and it replaces, kills or stops the supervisor (`detached-transport.ts:314-366`; `supervisor.ts:86-91, 516`), which no client may do to a shared daemon.

**State keyed by sender** becomes daemon state per client for visibility, git and files watch counts, dataset holds, connector leases and doc relay channels. It stays in the client for attention focus, browser placement, voice, unsaved files, chords, the presenter, comment mode, dialogs and the Edit menu's `emitTo`. Cites for both are in appendix A.1 and A.2.

### 4.3 Single-machine assumptions

- **No id names its machine.** Every id is a branded string (`src/shared/graph/ids.ts:6-19`).
  - `AppSessionId`, `ProjectId` and `PtyId` are UUIDs: globally unique, but resolvable only on the machine that minted them. Appendix A.3 lists where each is minted.
  - `ProjectId`'s identity is its realpath (`src/main/index/projects.ts:327, 355-359`).
  - `EventId` and `AttentionId` embed `appSessionId`.
  - `SessionRecord` holds absolute paths and a holder pid (`src/shared/graph/session.ts:23-50`).
- **The renderer has one transport** (`src/renderer/src/ipc/client.ts:55`).
- **Its stores are singletons:**
  - keyed by id: `useSessions`, `useAttention`, `useLayout`, a single-host `useHosts` (`stores/hosts.ts:17-22`);
  - keyed by path: `useGit`, `useFiles`, `useViewer`;
  - the terminal registry, keyed by `ptyId`.
- **`connectShell` forgets every status on one host departure** (`src/renderer/src/ipc/events.ts:141-149`).
- **Persisted state names one machine's ids.** In `layout.json`: `main.tabs` by `ProjectId`, `panel.<appSessionId>`, `sessions.attachTabs`, and file tabs `file:<path>` with no session (`src/shared/ipc/schema/layout.ts:21, 42-68, 139-159, 328-354`). Drafts are keyed by session id and carry attachment paths (`src/main/index/drafts.ts:1-30`).
- **Paths are local.** This covers `pathForFile` (`src/preload/bridge.ts:33-40`), `layout.pickFiles` (9 renderer sites), the realpath taken when a project is added, `cwd` on launch and on `pty.spawn`, and reveal and open.

### 4.4 Renderer call sites that need a machine dimension

**Method.**

- **Which commands count.** Registry introspection marked a command machine-scoped when its input carries a session, project or pty id, or a machine path. 213 of 397 commands qualify; `browser.*` and `settings.set` were excluded.
- **Which sites count.** The scan then counted the literal call sites of those commands inside the IPC wrappers (`invoke`, `useCommand`, `useEngineRead`, `useOperation`, and similar) in production renderer files.
- **Where it lives.** `scripts/introspect.ts` and `scripts/scan2.py`; the rerun recipe is in appendix A.4.

| Scope | Sites | Files | Commands |
|---|---:|---:|---:|
| All command call sites | 512 | 202 | n/a |
| **Machine-scoped** | **293** | **135** | **167** |
| Strict (`invoke` and `useCommand` only) | 249 | 114 | 151 |

- **Routable from an id: 218 sites.** These carry a session, project or pty id, so a client-side id-to-machine map could route them without editing the call site (inferred).
- **Need an explicit machine: 75 sites in 42 files.** These are path-only, led by `layout.pickFiles` (9), `session.projects.add` (5), `git.worktree.list` (5), `engine.models` (5) and `plugins.list` (5).
- **Events.** 67 `on()` subscriptions in 37 files listen to machine-keyed events (14 of them on `session.eventBatch`).
- **Keyed collections.** 57 files declare `Map` or `Set` collections keyed by `AppSessionId` or `ProjectId`.
- **The union** is 177 of the 848 production renderer files.
- **This is an undercount.** It misses the path-keyed stores and dynamically named commands.

## 5. The Chromium-bound residue

The host-to-main tool bridges are `HostBridge` instances that settle `noClient` when no app is connected (`src/engine-host/tool-server/bridge.ts:1-7, 22`). Production has three: capture, export and pane (`src/engine-host/session-maws.ts:86-87`; `tool-server/panes.ts:32`). Two event paths need main as well: dataset refresh and the browser.

| Residue | Agent tool that depends on it | Plausible home |
|---|---|---|
| Offscreen capture (`src/main/artifacts/capture.ts:72-100`) | **`artifact_screenshot`** on html artifacts (`maws.artifact.capture`). With no app it fails `appNotOpen` (`src/engine-host/tool-server/artifacts.ts:67`). | A **render service owned by the daemon**: the app binary in a windowless mode on Macs (a LaunchAgent runs in the GUI session Electron needs; inferred), headless Chromium or Playwright on Linux. The attached client is the wrong home: its fonts and its copy of the artifact are not the machine's. |
| Export and inspection (`export.ts:500-580`; `inspection.ts:52`; `presentations/export.ts`; `dashboard/pictures.ts:81`; `design/export.ts`) | **`artifact_export`** (`src/engine-host/tool-server/artifact-export.ts:58`), and **`artifact_screenshot` on documents and slides** through the export bridge (`artifact-inspection.ts:23-31`). Indirectly, Send to and the library's Export. | The same render service. A renderer that does not share the machine's filesystem must answer with bytes, because the export writes to a path the host names (`artifact-inspection.ts:21-24`; `src/main/artifacts/export.ts:7-9`). |
| `maws-artifact:` scheme | Indirect: the capture and export windows load artifacts through it (`export.ts:473-476`). | An HTTP endpoint on the daemon, for the render service and for remote clients (through the hub). Ranges, the CSP `sandbox` and a separate origin carry over from `scheme-handler.ts` and `policies.ts`. |
| In-app browser and its cua server (`src/main/browser/cua/index.ts:1-20`) | **Browser control** through `cua_repl`, by way of `CUA_BROWSER_BACKENDS`, which is fixed in the engine's env at launch (`src/main/sessions/launch-mapping.ts:53-55, 84`). Also `maws.download.recorded` (`src/main/browser/index.ts:183`). | (a) **Recommended: the daemon owns a stable per-session socket.** It checks the peer against the engine pid it already holds, and relays to whichever tab engine is attached: the app on that machine, or a headless Chromium backend on a VM. (b) Tabs in a windowless Electron on the machine, with a CDP screencast. That adds a new keystroke-class stream, and is the costliest option. (c) Forwarding to a remote client's browser breaks the peer-auth model (`browser/cua/peer.ts`, darwin-arm64 only). |
| Pane display | **`show_pane`** (`tool-server/panes.ts:51`, answered at `src/main/browser/inspect.ts:48`). | Whichever client is attached; the first answer wins. Client-bound by nature. |
| Dataset refresh | **`artifact_dataset` refresh**, through main's broker (`src/main/connectors/index.ts:215`). It settles `noClient` (`dataset-requests.ts:94`). | Not Chromium. It works headless once the broker moves (S5). |
| Voice; notifications, dock and navigation; the presenter; Mark-up capture | None. The to-human lane reaches the phone through the desk hub (`docs/charter.md:1120`). | The client. Each client posts its own banners, and "seen" becomes per client. |

**What is lost without S6.** A Linux VM without S6 loses `artifact_screenshot`, `artifact_export`, every export, Send to's PDF and DOCX, and browser control. These are agent capabilities, not views. A Mac whose app is closed already loses them today.

## 6. The alternative: Desktop-SSH style

**The framing needs one correction.** In MAWS the "SDK Query" lives in the engine host's `Session`, inside the supervisor, not in main. The `Session` drives the CLI over stream-json and serves `maws` as `sdkMcpServers: ['maws']` (`src/shared/engine/initialize.ts:13`). So the alternative keeps both the supervisor and main on the laptop. A helper on the remote holds the engine process, files, git and the pty.

**The engine's stdio is the one cheap seam.**

- **The seam exists.** `EngineTransport` (`src/engine-host/transport.ts:32-41`) and the launcher's injected spawn already admit a non-local process; the replay transport does exactly that.
- **What it carries.** A `RemoteEngineTransport` built on Desktop-style spawn, offset-stamped stdin and seq reattach carries the control protocol. Permissions, `!`, rewind and `get_workspace_diff` then work unchanged.
- **What is new.** The client already journals every frame. The adopt path, reattaching to a running engine, is new.

**Everything else assumes locality:** about 26k lines of touched files need re-routing (sites in appendix B).

| Subsystem | Lines | What assumes local files |
|---|---:|---|
| Engine-host core | ~5.3k | Login-shell env; `SMNS_MEMBER` as the spawner's pid; the ClaudeUsage relay at `127.0.0.1:8641` (`src/engine-host/launch.ts:19-22`); settings and MDM reads; `ps` sampling; the pid orphan sweep; `claude plugin --json` runs |
| Tools, documents, library, connectors | ~6.2k | 7 of 19 `maws` tools read session paths; in-place `file` artifacts checked synchronously inside the store's commit; the library mirror's ~34 synchronous fs calls; `captureLocalKey`'s 1.5 s budget |
| fs service | ~2.6k | Watchers, the inode-checked follow, holders |
| Sessions and index | ~5.2k | Take-over by signal; a 100 ms `ps` scan; trust reads; the synchronous `locate()` inside SQLite transactions (`src/main/index/projects.ts:162-180`) |
| git, scm, files, pty | ~3.7k | All of it |
| Other main services | ~3.2k | Shell env, the catalog watch, history, the quit guard's `ps`, the cua path |

**The helper MAWS needs is far larger than Desktop's** (about 15 RPC methods; `/Users/new/claude-code-bundle/2.1.300/notes/desktop-ssh-helper-protocol.md`): recursive watch streams, ranged inode-checked reads of 8 to 16 MiB, compound safe reads and writes, a process table and signals, exec with streamed output under the remote's login shell, MAWS's pty protocol, an `lsFiles` cache, and reverse tunnels for the relay and cua. The cheapest correct helper runs MAWS's own `FsService`, git, files, pty table and plugin runner on the remote: most of a daemon, minus the engine host and the read side.

**On the WAN for every call:** every token delta (`--include-partial-messages`), every permission round trip, 5 to 8 extra round trips per path-touching tool call, about 6 round trips per 50 ms per active session for transcript follow, `git.lsFiles` per `@` keystroke, the full `git.diff` after each change, pty acks every 16 ms, and `locate()` blocking main's loop.

**What it leaves unsolved.**

1. **A second client.** Desktop's helper runs one daemon per client install. MAWS's supervisor replaces a second client. Two apps on one remote become two engine hosts, each seeing the other only as foreign holders.
2. **The laptop asleep or closed.** The engine stalls at its next permission, `maws` call or hook, and waits forever (`dialogExpiry: 'never'`, `src/engine-host/launch.ts:159`). Queued prompts do not drain. Gateway sessions lose the API itself, because the relay is on the laptop.
3. **A Linux VM with no app.** It is only a target: no unattended work, no notifications, no phone or web client.
4. **Credentials and stores.** The remote's Claude login, Keychain, gh and plugins all need rulings. The artifact store and library live on the laptop. In-place `file` refs need copy-on-deliver, and `artifact_export` answers a laptop path the remote agent cannot open.

### Sizing the two designs (non-test lines)

| | SSH helper | Daemon |
|---|---:|---:|
| Changed in place | 3.3k–4.9k | 3k–5k (seams, sender to client, forwarders, mirrors, watch counts, settings split) |
| New | 6.9k–10.9k | 8k–15k |
| Moved as is | about 6k into the helper | about 30k into the services host, the render service and the pty host |
| **New plus changed** | **about 10k–16k** | **about 11k–20k** |

**What the "new" rows are made of.**

- **SSH helper:**
  - connection layer: 2k–3k
  - helper core: 2k–3k
  - remote transport and adopt path: 1.2k–1.8k
  - renderer: 1k–1.9k
  - watch client: 0.4k–0.8k
- **Daemon:**
  - wire compatibility: 0.5k–1k
  - lifecycle: 0.8k–1.5k
  - pty frames: 0.4k–0.8k
  - services-host root and fan-out: 1k–1.7k
  - Keychain, consent and trash: 0.9k–1.7k
  - render service, scheme and cua relay: 1.4k–2.8k
  - network channel: 2k–3k
  - renderer machine dimension: 1.5k–3k

**The ratio.** New plus changed code is roughly **1.2 to 1, daemon to SSH helper** (midpoints 15.5k and 13k). The daemon also relocates about five times as much code verbatim. That is cheap to write, but it carries test migration, because the harnesses run the utility mode (§7.3).

**The reasoning.**

- **Half the work is shared.** Both designs need the network channel, auth, reconnect and wake, and the renderer's machine dimension.
- **The machine-side code is mostly shared too.** A correct helper ends up running MAWS's fs, git, files and pty modules on the remote.
- **They pay their extra differently.** The SSH design pays in re-routing about 26k lines of local-file assumptions. The daemon pays in relocation and per-client fan-out.
- **The daemon's extra buys the org shape.** It buys exactly the four unsolved cases above, which are the org shape's requirements. Going SSH first would build the helper, the remote transport and the adopt path, only to discard them.

**Recommendation: the daemon design.**

## 7. Surprises

1. **Moving main freezes the wire.** The fingerprint excludes main so that settings bumps never strand kept sessions (`src/shared/ipc/wire-fingerprint.ts:5-6`). Settings went from v14 to v18 between 2026-10-19 and 2026-10-24 (`src/shared/ipc/schema/settings.ts:139`), and 50 commits touched IPC schemas in the window. The note lists versioning as one of twelve decisions. For the daemon it is step zero.
2. **"Pure Node" is not "message-shaped".** Items 1 to 7 are plain Node, as the note says. They are also coupled by synchronous in-memory reads and by `onEmitted` taps. That forces one large S3 instead of seven small steps.
3. **The tested host is the utility one.** The e2e and component harnesses default to utility mode (`src/main/hosts/mode.ts:11`). Only the supervisor groups run detached. Each step that moves state needs its suites on the daemon shape.
4. **The supervisor is the Electron binary in Node mode** (`detached-transport.ts:646-647`). Its bundle has no native addon. The native pieces are node-pty (in the pty host) and the cua peer-auth addon, which ships for darwin-arm64 only (`browser/cua/peer.ts:31-32`). That makes Linux mostly a packaging job. The engine host already has Linux branches (`src/engine-host/session-start-hooks.ts:41-47`; `tool-server/dataset-file.ts:56`).
5. **The browser socket is frozen at launch** (`launch-mapping.ts:84`). A session launched with no app attached never gets a browser for that launch, on a Mac with the app closed as much as on a VM. The fix is a socket owned by the daemon, not a relocated browser.
6. **A daemon service reads client state.** The inactive sweep spares sessions by reading `layout.json`'s tabs (`layout/open-session-tabs.ts:1-11`). With many clients, "open" is the union of every client's tabs, so the daemon has to be told.
7. **There is a third locality: the person.** Discover's catalog is "the person's" (`catalog/index.ts:3`). Send to uses the person's Notion connection and `gws` login. Two loopback OAuth flows assume the browser is on the machine (`connectors/oauth-callback.ts:2-5`; `sign-in.ts:7-13`). In an org shape these belong to the signed-in person, held by the client or the hub. The note's machine/client split has no place for them.
8. **Gateway routing assumes ClaudeUsage on the same machine.** The default route (D-19, `docs/charter.md:44`, `:109`) points the engine at `127.0.0.1:8641` (`src/engine-host/launch.ts:19-22`). A VM daemon needs either its own relay or its own login, which is an account-routing decision per machine.
9. **The idle-row release fights the org shape.** On a machine no app attaches to, which is the normal case for a VM, every idle session is stopped after 10 minutes by default (`supervision.ts:21`; `process-table.ts:266`). Re-keying it is a policy decision.
10. **Projects are machine paths.** A project's identity is its realpath (`projects.ts:327, 355-359`), so the same repository on a Mac and a VM is two unrelated projects. Whether an org project spans machines is a product decision that comes before the renderer's machine dimension.
11. **One host departure blanks the renderer** (`src/renderer/src/ipc/events.ts:141-149`). With several daemons, one VM's blip would blank every machine's sessions. It is small, but typical of reconnect logic spread through the stores.
12. **The process boundary is already soft, which helps.** Main imports engine-host modules (`catalog/index.ts:13`; `hosts/index.ts:8-10`), and every service takes injected `register`, `emit` and `call`. A second composition root is cheaper than the note's "absorb into the supervisor", which would also put `DatabaseSync` work on the supervisor's loop (§3).
13. **safeStorage records do not migrate on their own** (inferred). Route D's sealed records are Chromium OSCrypt ciphertext under the app's Keychain item (`src/main/connectors/oauth-store.ts:37-58`). A non-Chromium daemon has two options: read that item, which prompts because the binary is different, or ask the person to reconnect each connection.
