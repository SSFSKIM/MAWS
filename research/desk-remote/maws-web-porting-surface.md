# MAWS web porting surface: what must cross the network, and in what shape

This is research input for MAWS #52 (the desk) and the charter's P5 web-hosted MAWS. It reads the MAWS repository at `origin/master` **e42e6bbd8**. Every `path:line` cite refers to that commit, and paths are relative to the repository root.

- **How the counts were made.** They come from bundling `src/shared/ipc/schema.ts` and `names.ts` and enumerating the live registries, not from reading source by eye.
- **How the classification was made.** Four parallel readers walked each namespace's handlers and renderer callers. Their cites were spot-checked.
- **"(inferred)".** A claim marked this way was not verified in source.
- **Paths outside the MAWS repository.** These are marked `[doperpowers]` and are relative to `~/.claude/plugins/marketplaces/doperpowers` at 359c71a.

## 0. The answer in one page

- **Transport.** Today the X2 registry crosses Electron IPC between one renderer and one main process. Main then reaches two hosts: the engine host, a detached supervisor on a Unix socket, and the pty host, a utility process.
- **Where the commands and state live.** 365 commands and 77 events are registered.
  - **Main owns 186 of the commands.** Most of them are *machine-bound* services that just happen to live in Electron main: the SQLite session index and read model, the session service (launch, fork, acquire), git, scm, files, attention, the owner channel, the library index, the connector broker, the export and capture renderers, and the in-app browser.
  - **The engine host owns 169** and the pty host owns 10.
  - **The supervisor is not enough.** A machine that runs only the E10 supervisor can keep sessions alive. It cannot serve a client the MAWS product, because the product's read side and most of its write side are in main (§3).
- **What must cross, by shape** (§2 has the per-command detail):
  - **Keystroke-class streams.** Four carry nearly all the latency budget:
    - **pty.** `pty.data` (binary chunks stamped with their offset) comes down. `pty.write`, `pty.ack` and `pty.resize` go up.
    - **Transcript.** `session.eventBatch` comes down, at 16 ms or 500 events per batch, carrying assistant deltas.
    - **Yjs documents.** y-protocols frames per artifact channel. These are outside the X2 registry.
    - **Engine mod surface.** `session.ui.input` and `session.ui.scroll` go up on each change.
  - **A few typeahead reads**, also keystroke-class: `git.lsFiles`, `library.list`, `browser.history.suggest` and `browser.tabs.find`.
  - **Click-class request/response.** Everything else a person does: send, steer, answer, interrupt, the scm actions, the artifact commands, and so on.
  - **Background state pushes.** Their size varies widely (status, queue, digest, attention, git, settings, tabs). Several of them are *whole-state replacements*, not deltas (`attention.changed`, `browser.tabs.changed`, `session.queue`, `session.catalogChanged`).
  - **Large reads.** Some are unbounded or capped only at 8 to 64 MiB: `session.events`, `files.read`, `fs.readSpill`, `artifacts.versionState`, `pty.attach`, and screenshots carried as base64 inside events.
- **The structural gap is the event model, more than the protocol.** Every event is broadcast to every app window (`src/main/ipc/events.ts:14`). No command subscribes and nothing filters by session. The supervisor serves exactly one client (`src/shared/host/socket-server.ts:181-187`). A web hub needs four things the code has nowhere:
  - per-client subscriptions;
  - per-client delivery cursors;
  - per-client pty credit;
  - an authorization model beyond a same-user token.
- **The renderer seam is small.** One product file reads `window.maws` (`src/renderer/src/ipc/client.ts:55`). It goes through a three-method interface (`src/shared/ipc/schema.ts:245-249`), and no renderer file imports Electron or Node. The *semantic* seam is larger:
  - the single-machine identity model;
  - the out-of-band document ports;
  - the `maws-artifact:` scheme;
  - dropped-file paths;
  - the WebContentsView browser.

## 1. Registry inventory

**Owners and their counts.**

- *Owner* is the registry entry's `owner` field. Main routes on it (`src/main/ipc/router.ts:103-114`).
- *Main-only* commands are callable by main but refused to the renderer (`src/shared/ipc/names.ts:114-115`, router `:97-99`).
- *Host-emitted* events are `HOST_EVENTS` (`src/shared/ipc/schema.ts:207-231`), which the engine host's runtime enforces (`src/shared/host/runtime.ts:114`). Two more events, `pty.data` and `pty.exit`, are emitted by the pty host (`src/pty-host/table.ts:119,196`). The remaining 45 are emitted by main, several of them as relays or derivations of host events.

| Namespace | Cmds | Owner split | Main-only | Events (host-emitted) | Where the handlers live |
|---|---:|---|---:|---|---|
| session | 106 | engine-host 66, main 40 | 0 | 14 (8) | `src/engine-host/ipc.ts:347-777`; main: `src/main/index/register.ts`, `src/main/sessions/{service-register,index,observed}.ts`, `src/main/index.ts:312,338` |
| engine | 11 | engine-host 10, main 1 | 3 | 2 (1) | `src/engine-host/ipc.ts:306-336`; `engine.hostState` `src/main/hosts/index.ts:35` |
| fs | 11 | engine-host 11 | 0 | 9 (9) | `src/engine-host/fs/register.ts:19-29` |
| git | 13 | main 13 | 0 | 1 (0) | `src/main/git/{register,worktrees-register}.ts`, `src/main/index.ts:358` |
| pty | 12 | pty-host 10, main 2 | 0 | 3 (pty-host 2) | `src/pty-host/index.ts:13-22`; main `src/main/hosts/index.ts:36`, `src/main/pty-links.ts:8` |
| layout | 13 | main 13 | 0 | 4 (0) | `src/main/layout/store.ts`, `src/main/menu.ts`, `src/main/index.ts` |
| attention | 4 | main 4 | 0 | 3 (0) | `src/main/attention/{service,index,notifier,navigation}.ts` |
| settings | 10 | main 10 | 0 | 2 (0) | `src/main/settings/index.ts`, `src/main/index.ts:321,485-513` |
| files | 7 | main 7 | 0 | 1 (0) | `src/main/files/register.ts:48-59` |
| plugins | 10 | engine-host 10 | 0 | 2 (2) | `src/engine-host/ipc.ts:754-784` |
| marketplaces | 4 | engine-host 4 | 0 | 0 | `src/engine-host/ipc.ts:765,772-774` |
| voice | 5 | main 5 | 0 | 1 (0) | `src/main/voice/register.ts:18-22` |
| maws | 7 | engine-host 7 | 2 | 4 (4) | `src/engine-host/ipc.ts:790-807` |
| scm | 12 | main 12 | 0 | 1 (0) | `src/main/scm/register.ts:13-24` |
| side | 5 | main 3, engine-host 2 | 0 | 0 | `src/main/sessions/service-register.ts:45-47`; `src/engine-host/ipc.ts:816-817` |
| host | 7 | engine-host 4, main 3 | 3 | 2 (1) | `src/engine-host/supervision.ts:64-73`; `src/main/hosts/status.ts:75-85` |
| browser | 37 | main 37 | 0 | 17 (0) | `src/main/browser/{register,index}.ts`, `import/`, `extensions/`, `bookmarks/`, `comment/` |
| mods | 2 | main 2 | 0 | 0 | `src/main/owner/register.ts:111-114` |
| ownerChannel | 4 | main 4 | 0 | 1 (0) | `src/main/owner/register.ts:105-108` |
| artifacts | 39 | engine-host 31, main 8 | 8 | 3 (1) | `src/engine-host/documents/register.ts`; main `src/main/artifacts/index.ts`, `src/main/dashboard/`, `src/main/connectors/index.ts:180-182` |
| spaces | 4 | engine-host 4 | 0 | 1 (1) | `src/engine-host/documents/register.ts:279-300` |
| library | 13 | main 9, engine-host 4 | 3 | 1 (0) | `src/main/library/{register,files}.ts`; `src/engine-host/library/register.ts:39-41` |
| designSystems | 2 | engine-host 2 | 1 | 0 | `src/engine-host/design-systems/reads.ts:27,31` |
| presentations | 1 | main 1 | 0 | 0 | `src/main/presentations/present.ts:131` |
| connectors | 26 | engine-host 14, main 12 | 14 | 5 (3) | `src/main/connectors/index.ts:163-189`; `src/engine-host/connectors/register.ts:89-103` |
| **Total** | **365** | **main 186, engine-host 169, pty-host 10** | **34** | **77 (engine 30, pty 2)** | |

**Notes on the totals.**

- **Bridged commands.** 331 commands reach the renderer (365 − 34).
- **The wire fingerprint** covers only the 169 engine-host commands and the 30 `HOST_EVENTS` (`src/shared/ipc/wire-fingerprint.ts:19-27`). Main-owned commands never cross the supervisor socket.
- **`session.answer`** is engine-host-owned but is intercepted by main. Main answers `not_pending` unless its own attention model holds that request as pending (`src/main/sessions/index.ts:147`).
- **Channels outside the registry.** The Yjs document channels are outside X2. They use the `maws:doc-port` MessagePort (`src/shared/ipc/doc-port.ts`), and on the socket they use protocol-2 doc frames (`src/shared/host/socket-protocol.ts:116-133,257-259`). The `maws-artifact:` protocol scheme is also outside X2 (`src/main/artifacts/protocol.ts:18-20,59`).

**Locality tally** (from the §2 tables, counting merged rows by name; approximate):

| Locality | Commands | Events |
|---|---:|---:|
| Machine-bound | about 305 | about 60 |
| Client-bound | about 38 | about 12 |
| Either (could be served by the hub or by the client) | about 22 | about 5 |

- **Machine-bound but needs Electron today.** Of the machine-bound items, these depend on Chromium on the machine: the export, capture and print renderers, the browser tab engine, the `maws-artifact:` scheme, and the OAuth token store (Keychain through `safeStorage`).
- **The "either" group.** Most of it is main's index and read model: `session.list`, `get`, `update`, `drafts.*`, `digests`, `intent.*`, `appEvents`, plus `layout.get`, `set` and `list`.

## 2. Classification by namespace

**Legend.**

- **Shape:** RR request/response · SUB a subscription that must be opened (for events: a hub must add the subscription, because today every event is broadcast) · STREAM high-frequency push · PUSH low-frequency push.
- **Lat (latency):** K keystroke or frame · C click · B background.
- **Size:** S under 1 KB · M 1 to 64 KB · L over 64 KB, or unbounded.
- **Loc (locality):** MB machine-bound · CB client-bound (→ shows its browser equivalent, or "drop") · E either.
- **Main state:** what main holds that the answer depends on.
- **Sec (security):** R read · W write · X exec, spawn or terminal input, prompts to an agent, or network calls with credentials. X(r) means it spawns a process to read only.

### session (106 commands, 14 events)

**Summary.**

- The engine host serves the per-session control surface. Main serves the index, the read model and the session service.
- **Main-process residue:**
  - the SQLite index (`<userData>/index.sqlite`): records, projects, drafts and the revision;
  - the intent store and the in-flight acquisition registry (start, fork and acquire orchestrate host launches and git worktrees);
  - take-over (SIGTERM, or `claude stop`);
  - delete (`shell.trashItem`) and its deletion manifests;
  - the trust check;
  - prompt history;
  - `recentTurns`.
- **Per-window state.** The visible-session set is keyed by `sender` (`session.setVisible`) and drives unread and lastSeen.
- **`session.eventBatch`.** Formed in `src/engine-host/session-stream.ts:28-34`:

  | Property | Value |
  |---|---|
  | Contents | `{appSessionId, events[]}` |
  | Batch limits | at most 500 events, flushed every 16 ms |
  | Event fields | each event has a unique `id` and its journal `seq`; the batch has no sequence of its own |
  | Connect-burst batches | capped at 16 MiB |
  | Ring | 5,000 events while live |

- **Main-only consumption.** `session.brokerItems` and `session.forgotten` are consumed only by main, but are still broadcast to every window.
- **Unused commands.** No renderer caller was found for `setCwd`, `setThinking`, `getBinaryVersion`, `projects.update` or `ui.promptEdit`.

**Engine-host commands** (cites are `src/engine-host/ipc.ts` unless a path is given)

| Name | Shape | Lat | Size | Loc | Main state | Sec | Cite | Note |
|---|---|---|---|---|---|---|---|---|
| session.launch | RR | C | S | MB | - | X | :347 | spawns the engine; mostly called by main |
| session.status | RR | C | S | MB | - | R | :348 | checked before a send |
| session.events | RR | B | L | MB | - | R | :349 | paged by `afterSeq`; the whole ring on mount |
| session.stop | RR | C | S | MB | - | W | :363 | `archive` also erases the journal |
| session.pendingRequest | RR | B | S-M | MB | - | R | :389 | main-internal |
| session.catalog | RR | B | M | MB | - | R | :390 | |
| session.send | RR | C | S-M | MB | - | X | :393 | prompt to the agent, or queued |
| session.steer, session.queue.promote | RR | C | S-M | MB | - | X | :397, :445 | |
| session.queue.{hold,edit,remove} | RR | C | S | MB | - | W | :446, :433, :440 | |
| session.queue.list | RR | B | S-M | MB | - | R | :398 | |
| session.queue.setPaused | RR | C | S | MB | - | W | :456 | |
| session.interrupt | RR | C | S | MB | - | W | :457 | |
| session.answer | RR | C | S | MB | attention (main gate) | X | `src/main/sessions/index.ts:147` → :458 | permission and question answers |
| session.bash | RR | C | S | MB | - | X | :459 | the `!` shell command |
| session.memoryAppend | RR | C | S-M | MB | - | W | :460 | writes CLAUDE.md |
| session.setPermissionMode | RR | C | S | MB | - | W | :467 | can escalate permissions |
| session.{setModel,setEffort,setThinking} | RR | C | S | MB | - | W | :484, :498, :506 | |
| session.applyFlagSettings | RR | C | S | MB | - | W (treat as X) | :513 | arbitrary settings record; hooks could run commands (inferred) |
| session.stopTask | RR | C | S | MB | - | W | :526 | |
| session.{rewind,rewindFiles} | RR | C | S | MB | - | W | :527, :530 | `files: true` restores the working tree |
| session.setCwd | RR | C | S | MB | - | W | :531 | no caller |
| session.renameSession | RR | B | S | MB | - | W | :539 | main-internal |
| session.{generateTitle,sideQuestion} | RR receipt → PUSH `session.operation` | C | S | MB | - | X | :543, :560 | model calls |
| session.{reloadPlugins,reloadSkills,mcpReconnect,mcpToggle} | RR receipt → PUSH | C | S | MB | - | W | :547, :775, :551, :555 | |
| session.{getUsage,getSessionCost,getBinaryVersion} | RR | B | S | MB | - | R | :566, :585, :586 | getUsage is polled every 60 s |
| session.{getStatus,listPermissionRules,getHooksListing,mcpStatus} | RR | B | S-M | MB | - | R | :576, :569, :570, :577 | Session info polls every 30 s |
| session.{getSettings,getMemoryDialog,getSkillsDialog,getSandboxDialog,listModels} | RR | B | S-M | MB | - | R | :568, :571-573, :579 | |
| session.getContextUsage | RR | C | S-M | MB | - | R | :567 | |
| session.{getWorkspaceDiff,exportConversation} | RR | C | L | MB | - | R | :574, :575 | |
| session.forget | RR | B | S | MB | - | W | :626 | main-internal |
| session.replay.{launch,control} | RR | B/C | S | MB | - | W | `src/engine-host/fs/register.ts:34-35` | dev diagnostics |
| session.steer.cancel | RR | C | S | MB | - | W | :449 | main-internal |
| session.promptHistory | RR | B | M-L | MB | - | R | :450 | main-internal |
| session.ui.render | RR | C | S in, M out | MB | - | R | :670 | runs the plugins' render hooks |
| session.ui.{input,scroll} | RR | **K** | S | MB | - | W | :685, :708 | sent on every change or scroll |
| session.ui.{focus,press,select} | RR | C | S | MB | - | W | :701, :677, :693 | press runs mod handlers |
| session.ui.panes | RR | B | S-M | MB | - | R | :715 | |
| session.ui.{paneShow,paneFocus,close} | RR | C | S | MB | - | W | :716, :722, :728 | |
| session.ui.promptEdit | RR | K | S-M | MB | - | W | :735 | no caller |
| session.ui.answer | RR | C | S | MB | - | W | :741 | |

**Main commands**

| Name | Shape | Lat | Size | Loc | Main state | Sec | Cite | Note |
|---|---|---|---|---|---|---|---|---|
| session.list | RR | B | L | E | index | R | `src/main/index/register.ts:12` | every record; hub-cacheable |
| session.get | RR | B | S | E | index | R | `src/main/index/register.ts:14` | |
| session.update | RR | C | S | E | index | W | `src/main/index/register.ts:15` | pin, archive, unread, lastSeen, title |
| session.projects.list | RR | B | S-M | E | index | R | `src/main/index/register.ts:17` | |
| session.projects.{add,addFolder} | RR | C | S | MB | index | W | `src/main/index/register.ts:18-19` | realpath on machine paths |
| session.projects.{update,remove} | RR | C | S | E | index | W | `src/main/index/register.ts:20-21` | |
| session.drafts.{get,set} | RR | B | S-M | E | index | R/W | `src/main/index/register.ts:22-23` | set is debounced while typing |
| session.replay.{start,fixtures} | RR | C/B | S | MB | index, runs | W/R | `src/main/index/replay.ts:104-105` | |
| session.digests | RR | B | M | E | read model | R | `src/main/sessions/index.ts:109` | |
| session.setVisible | RR | C | S | E | per-WebContents visible set | W | `src/main/sessions/index.ts:115` | a hub must aggregate visibility across clients |
| session.launchMode | RR | B | S | E | launch mode | R | `src/main/sessions/index.ts:110` | |
| session.appEvents | RR | B | M | E | read model | R | `src/main/sessions/index.ts:111` | app-synthesised events, merged on mount |
| session.history.{list,append} | RR | B/C | M-L | MB | prompt history | R/W | `src/main/index.ts:338-339` | |
| session.trust.check | RR | C | S | MB | - | R | `src/main/sessions/service-register.ts:20` | |
| session.create | RR | C | S-M | MB | intents | W | `src/main/sessions/service-register.ts:21` | |
| session.intent.{get,list} | RR | B | S-M | E | intents | R | `src/main/sessions/service-register.ts:22-23` | |
| session.intent.{patch,release,discard,resolveWorktree} | RR | C | S-M | MB | intents | W | `src/main/sessions/service-register.ts:24-27` | |
| session.{start,fork,acquire} | RR (long) | C | S | MB | intents, in-flight registry, index | X | `src/main/sessions/service-register.ts:28, :32, :31` | phases stream as `session.setup` |
| session.archive | RR | C | S | MB | index | W | `src/main/sessions/service-register.ts:35` | |
| session.takeOverPane | RR | C | S | MB | - | R | `src/main/sessions/service-register.ts:36` | |
| session.takeOver | RR | C | S | MB | in-flight registry | X | `src/main/sessions/service-register.ts:37` | signals the foreign holder |
| session.delete | RR | C | S | MB | index, manifests | W | `src/main/sessions/service-register.ts:38` | `shell.trashItem` |
| session.rename | RR | C | S | MB | index | W | `src/main/sessions/service-register.ts:39` | |
| session.revealPath | RR | C | S | CB → drop | - | R | `src/main/sessions/service-register.ts:40` | Finder |
| session.deletions.{list,keep,preview} | RR | B/C | S | MB | manifests | R/W | `src/main/sessions/service-register.ts:41-43` | |
| session.observedFacts | RR | B | S-M | MB | - | R | `src/main/sessions/observed.ts:20` | relays main-only `engine.observedFacts` |
| session.recentTurns | RR | C | M | MB | index | R | `src/main/index.ts:312` | |

**Events**

| Name | Shape | Lat | Size | Loc | Main state | Cite | Note |
|---|---|---|---|---|---|---|---|
| session.eventBatch | **STREAM** | **K** | L | MB | feeds index, read model, attention | `src/engine-host/session-stream.ts:235` | also synthesised by main (`setup-steps.ts:141`, `yield.ts:77`, `side-threads.ts:133`) |
| session.status | PUSH | C | S | MB | - | `src/engine-host/session-stream.ts:134` | |
| session.queue | PUSH (whole state) | C | S-M | MB | - | `src/engine-host/session-stream.ts:153` | |
| session.brokerItems | PUSH | C | M | MB | main attention | `src/engine-host/session-stream.ts:172` | main-consumed |
| session.operation | PUSH | C | S-M | MB | - | `src/engine-host/ipc.ts:208` | |
| session.forgotten | PUSH | B | S | MB | - | `src/engine-host/ipc.ts:375` | main-consumed |
| session.{changed,removed} | PUSH | B | S-M | E | index revision | `src/main/index/source.ts:370-371` | |
| session.projects.changed | PUSH | B | S-M | E | index | `src/main/index/source.ts:379` | |
| session.replay.progress | STREAM (ticks) | B | S | MB | - | `src/engine-host/fs/replay/host.ts:85` | |
| session.digest | PUSH (medium rate) | C | S | E | read model | `src/main/sessions/index.ts:142` | |
| session.catalogChanged | PUSH (whole) | B | M | MB | - | `src/engine-host/session-stream.ts:160` | |
| session.setup | PUSH | C | S | MB | in-flight registry | `src/main/sessions/setup-steps.ts:96` | |
| session.intent.changed | PUSH | C | S-M | E | intents | `src/main/sessions/service.ts:332` | |

### engine, fs, host, plugins, marketplaces

**Summary.**

- **What main pushes into the host.** Main pushes settings into the host through `engine.configure`, `engine.policy.set` and `host.configure` (`src/main/index.ts:462-480`). A machine with no main needs a local owner of those settings.
- **The fs namespace is mostly main-consumed.**
  - Main drives scan, bind and unbind from its index (`src/main/index/source.ts:293-294,400`).
  - Main consumes `fs.sessionChanged`, `fs.sessionRemoved`, `fs.holderChanged` and `fs.foreignWrite` (`src/main/index/source.ts:106-111`, `src/main/sessions/yield.ts:72`).
  - Every fs command that takes an `appSessionId` needs a binding that main made.
- **Plugin operations.** Every plugin read is one `claude plugin … --json` CLI run.

| Name | Shape | Lat | Size | Loc | Main state | Sec | Cite | Note |
|---|---|---|---|---|---|---|---|---|
| engine.ping | RR | B | S | MB | - | R | `src/engine-host/index.ts:75` | |
| engine.hostState (cmd, evt) | RR / PUSH | B | S | MB | supervisor HostState | R | `src/main/hosts/index.ts:35,37` | answered by main |
| engine.binaryInfo | RR | B | S | MB | pushed binary path | R | `src/engine-host/ipc.ts:306` | Settings polls every 10 s |
| engine.relayHealth | RR | C/B | S | MB | - | R | :307 | loopback gateway GET |
| engine.sessions | RR | B | M | MB | - | R | :308 | read at connect and on every reconnect |
| engine.shutdown | RR | B | S | MB | - | X | :316 | bridged, but only main calls it |
| engine.models | RR | B | M | MB | - | R | :597 | |
| engine.configure / engine.policy.set (main-only) | RR | B | S | MB | settings | W | :336, :320 | policy can stop sessions |
| engine.budget (cmd, evt) | RR / PUSH | B | S-M | MB | - | R | :321-322 | in the connect burst |
| engine.observedFacts (main-only) | RR | B | M | MB | - | R | :654 | |
| fs.state | RR | B | S-M | MB | - | R | `src/engine-host/fs/register.ts:19` | |
| fs.scan | RR | B | M-L in | MB | index known list | R | :20 | main → host |
| fs.{bind,unbind} | RR | B | S-M | MB | index bindings | W | :21-22 | main → host |
| fs.holders | RR | C | S-M | MB | bindings | R | :23 | |
| fs.unfollow | SUB close | B | S | MB | bindings | W | :24 | |
| fs.subagents | RR | B | M | MB | bindings | R | :25 | |
| fs.agentEvents | SUB open + RR | C | L | MB | bindings | R | :26 | backfill now, then follow on `session.eventBatch` |
| fs.workflows / fs.tasks | RR | B | S-M | MB | bindings | R | :27-28 | |
| fs.readSpill | RR | C | L | MB | - | R | :29 | up to 8 MiB pages |
| fs.sessionChanged | PUSH, bursty | B | S-M | MB | main index | R | `src/engine-host/fs/service.ts:705` | 50 ms debounce; main-consumed |
| fs.{sessionRemoved,holderChanged} | PUSH | B | S-M | MB | main index | R | :701, :154 | main-consumed |
| fs.scanProgress | PUSH | B | S | MB | - | R | :638 | |
| fs.followState | PUSH | B | S | MB | - | R | `src/engine-host/fs/follow.ts:115` | |
| fs.subagentsChanged | PUSH | B | M | MB | - | R | `src/engine-host/fs/service.ts:449` | full list |
| fs.{workflowChanged,tasksChanged} | PUSH | B | S | MB | - | R | :511, :543 | invalidations |
| fs.foreignWrite | PUSH | B | S | MB | main yield | R | :740 | main-consumed; triggers a main action |
| host.supervisorStatus (cmd, evt) | RR / PUSH | B | S | MB | main caches | R | `src/engine-host/supervision.ts:64`; `src/engine-host/index.ts:140` | |
| host.{configure,exitWhenIdle} (main-only) | RR | B | S | MB | settings | W | `src/engine-host/supervision.ts:65,69` | exitWhenIdle has no main caller |
| host.stopAll (main-only) | RR | B | S | MB | - | X | :73 | |
| host.status (cmd, evt) | RR / PUSH | B | S | MB | transport + supervisor status | R | `src/main/hosts/status.ts:75`; `src/main/hosts/index.ts:46` | |
| host.restart | RR | C | S | MB | supervisor | X | `src/main/hosts/status.ts:76` | |
| host.openLog | RR | C | S | CB → stream the log | log path | R | `src/main/hosts/status.ts:80` | `shell.openPath` |
| plugins.env | RR | B | S | MB | - | R | `src/engine-host/ipc.ts:754` | |
| plugins.{list,available} | RR | B | M | MB | - | R | :763-764 | spawns the CLI |
| plugins.{install,update} | RR receipt → PUSH | C | S | MB | - | X | :766-767 | installs code |
| plugins.{uninstall,enable,disable,cancel} | RR | C | S | MB | - | W | :768-771 | |
| plugins.manifest | RR | B | M-L | MB | - | R | :784 | |
| plugins.operation | PUSH, bursty | C | S | MB | - | R | :219 | one event per CLI output line; replayed in the burst |
| plugins.changed | PUSH | B | S | MB | - | R | :220 | invalidation |
| marketplaces.list | RR | B | S-M | MB | - | R | :765 | |
| marketplaces.{add,update,remove} | RR receipt → PUSH | C | S | MB | - | X/W | :772-774 | |

### pty (12 commands, 3 events)

**The data path**, as built:

- **Output from node-pty.** node-pty runs raw (`encoding: null`). Output is coalesced:
  - after 5 ms of quiet it flushes on the next `setImmediate`;
  - 64 KiB pending flushes at once (`src/pty-host/table.ts:38-39,143-191`).
- **`pty.data` payload.** `{ptyId, offset, data: Uint8Array}`, where `offset` is the stream offset of the chunk's first byte (`src/shared/ipc/schema/pty.ts:99`).
- **Backpressure (credit).** Credit is counted against acknowledged bytes (`src/pty-host/flow.ts:7-8,34,42`):

  | Condition | Effect |
  |---|---|
  | `total − acked` reaches 256 KiB or more | the pty pauses |
  | an ack brings it to 64 KiB or less | the pty resumes |

- **Renderer acks.**
  - The renderer acks only after xterm's parse callback.
  - A visible terminal acks past 32 KiB unacked, or 16 ms after the last parse.
  - A hidden terminal acks at most 256 KiB per 250 ms (`src/renderer/src/terminal/registry.ts:605-655`; `src/renderer/src/terminal/constants.ts:10-13`).
- **Ring and checkpoint.**
  - The ring holds 512 KiB, which is 2 × HIGH (`src/pty-host/table.ts:32-33`).
  - The renderer posts xterm serialize-addon checkpoints after 500 ms of quiet (`src/renderer/src/terminal/registry.ts:664-702`).
  - `pty.attach` returns `{info, checkpoint, replay, replayFrom, nextOffset}` (`src/pty-host/table.ts:243-255`). The reattach is exact when `replayFrom === checkpoint.offset`.
- **Hops to the renderer.**
  1. The pty host posts on a MessagePortMain.
  2. Main's `receive` → `emit` → `webContents.send` sends it to **every** window (`src/main/hosts/supervisor.ts:460-474`; `src/main/ipc/events.ts:14`).
  3. The renderer validates it again.

  That is three zod parses and two structured-clone hops per chunk.
- **Input.** Input is `pty.write {data: string}`, one invoke per keystroke (`src/renderer/src/terminal/registry.ts:402-405`).
- **One `acked` cursor per pty.** It is shared by every viewer (inferred: windows that have not bound the pty do not ack).
- **Lifetime.** The pty host is a utility process of the app, so terminals die with the app (E10 §4, `docs/doperpowers/plans/2026-10-06-e10-supervisor.md:187`).

| Name | Shape | Lat | Size | Loc | Main state | Sec | Cite | Note |
|---|---|---|---|---|---|---|---|---|
| pty.hostState (cmd, evt) | RR / PUSH | B | S | MB | supervisor HostState | R | `src/main/hosts/index.ts:36,38` | |
| pty.ping | RR | B | S | MB | - | R | `src/pty-host/index.ts:13` | |
| pty.spawn | RR | C | S | MB | - | X | :14 | login shell |
| pty.write | RR, fire-and-forget | **K** | S | MB | - | X | :15 | string |
| pty.resize | RR, fire-and-forget | K | S | MB | - | W | :16 | 50 ms debounce |
| pty.kill | RR | C | S | MB | - | X | :17 | |
| pty.ack | RR, fire-and-forget | **K** | S | MB | - | W | :18 | credit |
| pty.checkpoint | RR, fire-and-forget | B | L | MB | - | W | :19 | up to 10,000 lines of scrollback |
| pty.attach | RR | C/B | L | MB | - | R | :20 | up to 512 KiB binary replay |
| pty.list | RR | B | S-M | MB | - | R | :21 | |
| pty.foreground | RR | C | S | MB | - | R | :22 | |
| pty.openLink | RR | C | S | CB → `window.open` | - | X | `src/main/pty-links.ts:8` | |
| pty.data | **STREAM** | **K** | S typ., up to 64 KiB | MB | - | R | `src/pty-host/table.ts:119` | binary + offset; broadcast |
| pty.exit | PUSH | C | S | MB | spawned-pty set | R | `src/pty-host/table.ts:196`; synthetic at `src/main/hosts/supervisor.ts:444` | |

### maws, side, mods, ownerChannel, spaces, designSystems, presentations

**Summary.**

- **`maws.*` is the agent's tool server.** It asks a window or main to do something, and gets the answer back as a command.
- **Main answers capture, export and dataset refresh, and this is main residue:**
  - capture renders in an offscreen `BrowserWindow` (`src/main/artifacts/capture.ts`);
  - export renders the same way (`src/main/artifacts/export.ts:471`);
  - dataset refresh goes through main's connector broker.
- **When no client is connected,** these bridges fail fast with `appNotOpen` (E10 §3, `docs/doperpowers/plans/2026-10-06-e10-supervisor.md:159,173`).
- **Main-owned namespaces.** `side.thread.open`, `side.sendToMain`, the owner channel and the mods overrides all live in main over its index.

| Name | Shape | Lat | Size | Loc | Main state | Sec | Cite | Note |
|---|---|---|---|---|---|---|---|---|
| maws.asks.list | RR | B | S-M | MB | - | R | `src/engine-host/ipc.ts:790` | |
| maws.ask.answer | RR | C | S-M | MB | - | X | :791 | the answer goes to the agent |
| maws.pane.answer | RR | C | S | MB | - | W | :801 | the first window to answer wins |
| maws.artifact.captured | RR (main → host) | B | L | MB | - | W | :802 | PNG as base64 |
| maws.download.recorded | RR (main → host) | B | S | MB | - | W | :807 | |
| maws.artifact.{exported,datasetRefreshed} (main-only) | RR | B | S | MB | - | W | :803, :805 | |
| maws.pane.show | PUSH | C | S | CB (the web client answers natively) | - | R | :287 | every window answers |
| maws.artifact.capture | PUSH | B | S | CB (Chromium render; main-consumed) | - | R | :288 | 42 s bound |
| maws.artifact.export | PUSH | B | S | CB + MB (print; machine path) | - | R | :289 | main-consumed |
| maws.artifact.datasetRefresh | PUSH | B | S | MB | connector grants | X | `src/engine-host/connectors/dataset-requests.ts:206` | main-consumed |
| side.thread.open | RR | C | S-M | MB | index, intents | X | `src/main/sessions/service-register.ts:45` | forks the session and sends |
| side.sendToMain | RR | C | S-M | MB | index | X | :46 | |
| side.screenshot.preview | RR | C | L | MB | session roots | R | :47 | data URL up to 5 MiB |
| side.question.{list,clear} | RR | B/C | M/S | MB | - | R/W | `src/engine-host/ipc.ts:816-817` | |
| mods.list | RR | B | S | MB | index | R | `src/main/owner/register.ts:111` | |
| mods.setSessionOverride | RR | C | S | MB | index | W | :112 | |
| ownerChannel.state | RR | B | S-M | MB | marks in index | R | :105 | |
| ownerChannel.{answered,cancel,markRead} | RR | C | S | MB | marks | W | :106-108 | |
| ownerChannel.changed | PUSH | B | S-M | MB | marks | R | `src/main/owner/service.ts:711` | |
| spaces.list | RR | B | S-M | MB (could be E) | - | R | `src/engine-host/documents/register.ts:279` | |
| spaces.{create,update,delete} | RR | C | S | MB | - | W | :283-293 | `linkedDir` is a machine path |
| spaces.changed | PUSH | B | S | MB | main library | R | :300 | main-consumed |
| designSystems.house | RR | B | S | MB | - | R | `src/engine-host/design-systems/reads.ts:27` | |
| designSystems.governing (main-only) | RR | B | S | MB | - | R | :31 | |
| presentations.present | RR | C | S | CB → `window.open` + Fullscreen | windows, displays | R | `src/main/presentations/present.ts:131` | |

### artifacts, library, connectors

**Summary.**

- **Artifact storage** is the engine host's: `<userData>/artifacts/store.sqlite`.
- **Main-process residue in this area:**
  - the `maws-artifact:` scheme, which resolves to an absolute path through `artifacts.content` and opens the file itself, so main must share the host's filesystem (`src/main/artifacts/protocol.ts:26-33`);
  - the export service (offscreen Chromium);
  - dataset holds bound to a webContents;
  - the library index, held in main's SQLite with FTS5 and rebuilt from main-only host reads;
  - the whole connector broker: leases, the watch scheduler, routes, OAuth token custody through `safeStorage`, and a loopback OAuth callback.
- **OAuth consent on a remote client.** Consent opens the system browser **on the machine** and redirects to `127.0.0.1` (`src/main/connectors/oauth-root.ts:67`, `oauth-callback.ts:22,39`). A remote client needs a redesigned consent flow.

| Name | Shape | Lat | Size | Loc | Main state | Sec | Cite | Note |
|---|---|---|---|---|---|---|---|---|
| artifacts.list | RR | C | M | MB | - | R | `src/engine-host/documents/register.ts:116` | row count unbounded |
| artifacts.get | RR | C | S | MB | - | R (W) | :120 | `prepare` migrates the doc |
| artifacts.search | RR | C | M | MB | - | R | :146 | |
| artifacts.create | RR | C | S-L | MB | - | W | :127 | bytes up to 16 MiB, or a machine `path` |
| artifacts.{update,delete,duplicate} | RR | C | S | MB | - | W | :133, :138, :141 | |
| artifacts.versions | RR | C | M | MB | - | R | :150 | |
| artifacts.{saveVersion,nameVersion,restore,pruneVersions,acceptSuggestion,rejectSuggestion,copyAsset} | RR | C | S | MB | - | W | :157-208 | |
| artifacts.markViewed | RR | B | S | MB | - | W | :172 | |
| artifacts.versionState | RR | C | L | MB | - | R | :176 | whole V2 state |
| artifacts.attributions | RR | C | M-L | MB | - | R | :180 | |
| artifacts.uploadAsset | RR | C | L | E → MB | - | W | :207 | up to 16 MiB |
| artifacts.readDataset | RR | C | M | MB | - | R | :210 | up to 1 MiB per page |
| artifacts.status | RR | B | S | MB | - | R | :271 | at each doc connect |
| artifacts.{testLoopDelay,testWrite} | RR | B | S | MB | - | R/W | :214, :275 | e2e only |
| artifacts.setDefaults (main-only) | RR | B | S | MB | settings | W | :218 | |
| artifacts.content (main-only) | RR | B | S | MB | - | R | :227 | answers an absolute path |
| artifacts.{state,captureDatasetState,assets,holdAssets,releaseAssets,datasetRefreshRequest} (main-only) | RR | B | S-L | MB | export service | R/W | :241-269 | |
| artifacts.open | SUB | C | S | MB (channel) + CB (port delivery) | doc channel table, relay | W | `src/main/artifacts/index.ts:57`; `open.ts:51` | opens a Yjs channel |
| artifacts.export | RR | C (seconds) | S answer, L file | MB, needs Chromium | export service | W | `src/main/artifacts/index.ts:78` | the answer is a machine path |
| artifacts.downloadAsset | RR | C | S | CB → HTTP download | - | W | `src/main/dashboard/download.ts:80` | |
| artifacts.connectorGrants | RR | C | S | MB | broker | R | `src/main/connectors/index.ts:180` | |
| artifacts.{grantConnectorTool,revokeConnectorTool} | RR | C | S | MB | broker | W | `src/main/connectors/index.ts:181-182` | |
| artifacts.{holdDatasets,releaseDatasets} | RR | B | S | MB (tied to the client) | window hold table | W | `src/main/dashboard/holds.ts:111-112` | |
| artifacts.changed | PUSH | B | S | MB | - | R | `src/engine-host/documents/register.ts:299` | 250 ms coalesce per artifact |
| artifacts.resync | PUSH | B | S | MB | - | - | `src/main/artifacts/index.ts:93` | sent at each host stream start |
| artifacts.console | PUSH | B | S | CB → bridge-script postMessage | rate limiter | - | `src/main/artifacts/policies.ts:287` | |
| library.list | RR | **K**/C | M-L | MB | library index | R | `src/main/library/register.ts:13` | mention picker per keystroke |
| library.{get,spaces} | RR | C | S | MB | index | R | :14-15 | |
| library.exportFormats | RR | C | S | E | exporter registry | R | `src/main/library/files.ts:142` | |
| library.content | RR | C | S | MB | - | R | :143 | answers a machine path |
| library.read | RR | C | L | MB | - | R | :144 | up to 8 MiB chunks |
| library.openExternally | RR | C | S | CB → download | - | X | :145 | |
| library.reveal | RR | C | S | CB → drop | - | R | :146 | |
| library.saveAs | RR | C | S/L | CB → download | - | W | :147 | native dialog |
| library.{snapshot,entry,text} (main-only) | RR | B | S-L | MB | feeds the index | R | `src/engine-host/library/register.ts:39-41` | |
| library.testImport | RR | B | S | MB | - | W | `src/engine-host/library/index.ts:49` | e2e only |
| library.changed | PUSH | B | S | MB | index | - | `src/main/library/index.ts:44` | |
| connectors.open | SUB (lease) | C | S | MB, the lease bound to a window | leases by sender | R | `src/main/connectors/index.ts:163` | vetoes a hidden native window |
| connectors.declare | RR | C | S | MB | broker | R | :164 | |
| connectors.call | RR | C/B | L | MB | broker, routes | X | :165 | up to 16 MiB, no time bound |
| connectors.watch | SUB | B | S | MB | scheduler | X | :166 | interval of at least 30 s |
| connectors.{unwatch,close,visibility} | RR | C/B | S | MB | broker | R | :175, :178, :177 | |
| connectors.refresh | RR | C | S | MB | broker | X | :176 | |
| connectors.servers | RR | C | M | MB | owner | R | :186 | |
| connectors.{connect,reconnect} | RR → `serversChanged` | C | S | MB + CB (consent) | OAuth store | X | :187-188 | system browser on the machine |
| connectors.disconnect | RR | C | S | MB | OAuth store | X | :189 | |
| connectors.{grants,check,resolve,directResolve} (main-only) | RR | B | S | MB | - | R | `src/engine-host/connectors/register.ts:89-98` | |
| connectors.{grant,revoke,cancel,directCancel,directClose} (main-only) | RR | B | S | MB | - | W | :90-103 | |
| connectors.{start,directStart,directDiscover} (main-only) | RR | B | S | MB | - | X | :94, :99-100 | a token travels main → host |
| connectors.{take,directTake} (main-only) | RR | B | L | MB | - | R | :95, :101 | |
| connectors.watchUpdate | PUSH (owner window only) | B | L | MB | broker | - | `src/main/connectors/index.ts:159` | |
| connectors.{operation,directOperation} | PUSH | B | S | MB | - | - | `src/engine-host/connectors/register.ts:65,72` | main-consumed |
| connectors.grantChanged | PUSH | B | S | MB | broker | - | :106 | |
| connectors.serversChanged | PUSH (targeted) | B | S | MB | owner | - | `src/main/connectors/owner.ts:199` | |

**The Yjs document channels**, outside X2:

- **Opening a channel.** One `MessageChannelMain` is created per `artifacts.open` (`src/main/artifacts/open.ts:58-67`), with the actor always the human.
- **Utility mode.** The ports are entangled renderer ↔ host directly.
- **Detached mode, the default.**
  - Main keeps the host's end and relays it over the supervisor socket (`src/main/hosts/doc-relay.ts:55-72`).
  - Each frame is `0x00 | u32 len | u32 channel | payload`, with a 64 MiB cap (`src/shared/host/socket-protocol.ts:116-133`).
  - A channel is reset rather than queued past 8 MiB (`src/shared/host/doc-channels.ts:21`).
- **Frame protocol.** Frames are y-protocols sync and awareness, plus MAWS `ack` (type 100) and `restored` (type 101) (`src/artifacts/provider/frames.ts`).
- **Authority.** The engine host's DocumentService holds the authoritative Y.Doc. Commits are grouped once per event-loop turn, and an outbox waits for the commit. A keystroke relay therefore includes one SQLite commit.
- **Connections and awareness.** A doc has no connection cap. Awareness is relayed and throttled to 50 ms on the renderer side.
- **Reconnect.** Unacked updates are carried and re-sent through step 2 (`src/artifacts/provider/port.ts:6-12,142-168`).
- **Browser transport.** The provider has no Electron or DOM dependency and names "P4 a WebSocket adapter" as a target (`src/artifacts/provider/port.ts:1-4`).

### browser, layout, attention, settings, voice, files, git, scm

**Summary.**

- **All of these are main's.**
- **Client-bound groups:**
  - layout's native-shell commands (menu, dialogs, quit guard, window capture);
  - voice (Swift helper, microphone): client-local in a browser, it needs no network;
  - the attention notifier, dock and navigation relay: Web Notifications or Push, `setAppBadge`;
  - browser tab *display*.
- **Machine-bound groups:** git, scm, files and attention items are all machine-bound residue in main.
- **How browser tabs work today.**
  - Tabs are `WebContentsView`s that main lays over a rect the renderer reports per frame (`browser.view.place`; `src/main/browser/view.ts`; `src/renderer/src/tools/browser/Pane.tsx:95-100`).
  - Agents drive the tabs through a per-session Unix-socket cua server in main (`src/main/browser/cua/index.ts:158-168`).
- **What a remote client can have of the browser.** A web page cannot host another site's page. A remote client can have:
  - the tab metadata;
  - the data commands;
  - snapshots;
  - eventually a CDP screencast. A screencast is a new keystroke-class binary stream.
- **Settings and layout mix per-client and per-machine state.**
  - Settings mix the two in one file: appearance and notifications are the client's, while engine, supervisor and browser settings are the machine's.
  - Layout is one shared `layout.json` with no change event. Its keys name one machine's sessions.

| Name | Shape | Lat | Size | Loc | Main state | Sec | Cite | Note |
|---|---|---|---|---|---|---|---|---|
| git.status | RR | B | M | MB | - | X(r) | `src/main/git/register.ts:22` | no renderer caller |
| git.branches | RR | C | S | MB | - | X(r) | :23 | |
| git.diff | RR | B | L | MB | - | X(r) | :24 | re-run after each `git.changed` |
| git.log | RR | C | M | MB | - | X(r) | :25 | |
| git.{watch,unwatch} | SUB | B | M/S | MB | watch counts per root and per window | X(r) | :26-27 | |
| git.lsFiles | RR | **K** | M | MB | roots cache | X(r) | `src/main/index.ts:358` | `@` menu, 80 ms debounce |
| git.worktree.list | RR | B | M | MB | - | X(r) | `src/main/git/worktrees-register.ts:11` | |
| git.worktree.{status,branch} | RR | C | S | MB | - | X(r) | :12-13 | |
| git.worktree.{add,remove,deleteBranch} | RR | C | S | MB | - | X | :14-16 | destructive, guarded |
| git.changed | STREAM | B | M | MB | watcher | R | `src/main/git/watcher.ts:175` | 250 ms debounce; full status |
| scm.status | RR | B | S | MB | gh cache | X(r) | `src/main/scm/register.ts:13` | |
| scm.{stage,unstage,discard,commit} | RR | C | M | MB | per-checkout chain, trust | X | :14-17 | |
| scm.{push.plan,pr.plan} | RR | C | S | MB | plan tokens | X(r) | :18, :20 | |
| scm.{push,pr.create} | RR | C | S | MB | run | X | :19, :21 | user credentials |
| scm.remote.cancel | RR | C | S | MB | run | W | :22 | |
| scm.remote.last | RR | B | L | MB | last run | R | :23 | up to 1 MiB |
| scm.pr.state | RR | B | S-M | MB | 60 s cache | X(r) | :24 | polled every 120 s |
| scm.remote.output | STREAM | C | S | MB | - | R | `src/main/scm/remote-runner.ts:204` | one event per output chunk, seq'd |
| files.list | RR | C | M | MB | allowlist | R | `src/main/files/register.ts:48` | |
| files.read | RR | C | L | MB | - | R | :49 | 1 to 8 MiB, base64 for binary |
| files.write | RR | C | L | MB | - | W | :50 | hash-checked |
| files.{watch,unwatch} | SUB | B | S | MB | watch counts per window | R | :51, :57 | |
| files.openExternal | RR | C | S | CB → download or preview | - | X | :58 | `shell.openPath` |
| files.reveal | RR | C | S | CB → drop | - | R | :59 | |
| files.changed | STREAM | B | S | MB | - | R | `src/main/files/watch.ts:173` | |
| settings.get / settings.set | RR | B/C | M | split E + MB | settings.json | R/W | `src/main/settings/index.ts:51-52` | set pushes engine config |
| settings.usage | RR | B | M | MB | pins | R | `src/main/index.ts:321` | ClaudeUsage files |
| settings.claudeUsage.status | RR | B | S | MB | 60 s cache | X(r) | :497 | |
| settings.claudeUsage.open | RR | C | S | MB (GUI on the machine) | - | X | :498 | |
| settings.reveal | RR | C | S | CB → drop | - | R | :513 | |
| settings.engineApplied | RR | C | S | MB | last push | R | :485 | |
| settings.userEngineDefaults | RR | B | S | MB | - | R | :511 | |
| settings.usageControls | RR | C | S-M | MB | - | R | :509 | loopback API |
| settings.usageAction | RR | C | S | MB | - | X | :510 | |
| settings.changed | PUSH | B | M | split | settings.json | R | `src/main/settings/index.ts:31` | |
| settings.usageChanged | STREAM | B | M | MB | usage reader | R | `src/main/usage/claude-usage-reader.ts:125` | up to about 2 Hz |
| attention.list | RR | B | M | MB | items | R | `src/main/attention/service.ts:271` | |
| attention.request | RR | C | M | MB | broker items | R | :283 | |
| attention.acknowledge | RR | C | S | MB | items | W | :274 | |
| attention.pendingNavigate | RR | B | S | CB → client-local | relay queue | R | `src/main/attention/index.ts:18` | |
| attention.changed | PUSH (whole list) | C | M | MB | items | R | `src/main/attention/service.ts:164` | |
| attention.notified | PUSH | B | S | CB → Web Notification | seen set | R | `src/main/attention/notifier.ts:57` | |
| attention.navigate | PUSH | C | S | CB → notification onclick | relay | R | `src/main/attention/navigation.ts:21` | |
| layout.{get,list,set} | RR | B | S-M | E | layout.json (shared) | R/W | `src/main/layout/store.ts:137-147` | |
| layout.openExternal | RR | C | S | CB → `window.open` | - | X | `src/main/open-external.ts:33` | |
| layout.setEnabledActions | RR | B | S | CB → drop | menu state | W | `src/main/menu.ts:165` | |
| layout.pickFiles | RR | C | L | CB → file input (directory: MB browser) | - | R | `src/main/index.ts:359` | |
| layout.saveTextFile | RR | C | L | CB → Blob download | - | W | :519 | |
| layout.captureChords | RR | C | S | CB → drop | per window | W | :516 | |
| layout.captureRegion | RR | C | L | CB | - | R | :518 | window pixels |
| layout.{quitWait,quitWaitAnswer,unsavedFiles,saveAllDone} | RR | B/C | S | CB → `beforeunload` or drop | quit guard | R/W | :668-720 | |
| layout.{action,selectAll,quitWait,saveAll} (events) | PUSH | C/B | S | CB → in-page | - | R | `src/main/menu.ts:42,57`; `src/main/index.ts:690,715` | |
| voice.status | RR | B | S | CB → client-local | - | X(r) | `src/main/voice/register.ts:18` | |
| voice.{start,stop,cancel} | RR | K | S | CB → client-local | one capture | X/W | :19-21 | |
| voice.openPrivacySettings | RR | C | S | CB → drop | - | X | :22 | |
| voice.event | STREAM | K | S | CB → client-local | capture | R | `src/main/voice/service.ts:149` | |
| browser.tabs.list | RR | B | M | MB | TabStore | R | `src/main/browser/register.ts:81` | |
| browser.tabs.{open,navigate} | RR | C | S | MB | TabStore | X | :82, :85 | |
| browser.tabs.{close,select,zoom,dismiss} | RR | C | S | MB | TabStore | W | :83-88 | |
| browser.tabs.find | RR | K | S | MB | - | R | :87 | |
| browser.tabs.{devtools,revealDownload} | RR | C | S | CB → drop | - | W/R | :89-90 | |
| browser.view.place | RR | **K** (per frame) | S | CB | placement per window | W | :104 | WebContentsView over a rect |
| browser.view.cover | RR | C | S | CB | cover | W | :105 | |
| browser.view.capture | RR | C | L | CB | placement | R | :110 | |
| browser.control.handBack | RR | C | S | MB | lease | W | :118 | |
| browser.history.suggest | RR | K | S | MB | history index | R | :93 | |
| browser.profiles.list | RR | B | S | MB | partitions | R | :99 | |
| browser.comment.set | RR | C | S | MB + CB | comment mode | W | `src/main/browser/comment/index.ts:61` | |
| browser.import.{profiles,inspect,start,discard,cancel,list,remove,setExtension} | RR | C/B | S-M | MB | import run | R/W/X | `src/main/browser/import/register.ts:46-73` | reads Chrome and Keychain |
| browser.import.chooseUserData | RR | C | S | CB → MB picker | - | R | :51 | |
| browser.agent.activities.list | RR | B | M | MB | activity ring | R | `src/main/browser/index.ts:197` | |
| browser.bookmarks.{tree,sync,favicons} | RR | B/C | S-M | MB | bookmark index | R/W | `src/main/browser/bookmarks/register.ts:19,27`; `register.ts:128` | |
| browser.bookmarks.open | RR | C | S | MB | TabStore | X | `src/main/browser/register.ts:120` | |
| browser.bookmarks.menu | RR | C | S | CB → in-page menu | - | W | :122 | |
| browser.extensions.actions | RR | B | S | MB | extensions | R | `src/main/browser/extensions/register.ts:66` | |
| browser.extensions.action.click | RR | C | S | CB | popup | W | :68 | |
| browser.extensions.action.options | RR | C | S | MB | TabStore | W | :76 | no caller |
| browser.extensions.{action.menu,puzzle} | RR | C | S | CB → in-page menu | - | W | :83, :91 | |
| browser.tabs.changed | STREAM (whole list) | C | M | MB | TabStore | R | `src/main/browser/tabs.ts:621` | favicons as data URLs |
| browser.view.covered | PUSH | C | L | CB | cover | R | `src/main/browser/view.ts:255` | JPEG up to 400 KB |
| browser.control.changed | PUSH | C | S | MB | control | R | `src/main/browser/tabs.ts:397` | |
| browser.chrome.command | PUSH | C | S | CB → in-page | - | R | `src/main/browser/keys.ts:93` | |
| browser.download.refused | PUSH | B | S | MB | - | R | `src/main/browser/downloads.ts:81` | no listener |
| browser.notice | PUSH | B | S | MB | - | R | `src/main/browser/tabs.ts:511` and others | |
| browser.comment.{changed,picked} | PUSH | C | S | MB | comment mode | R | `src/main/browser/comment/mode.ts:131`; `send.ts:35` | `picked` goes to the owner window |
| browser.import.{progress,finished,changed} | STREAM / PUSH | B | S-M | MB | import run | R | `src/main/browser/import/service.ts:603,368,359` | |
| browser.agent.acting | PUSH | C | S | MB | cua lease | R | `src/main/browser/cua/connection.ts:416` | |
| browser.agent.activity | STREAM | B | S | MB | ring | R | `src/main/browser/cua/activity.ts:259` | up to 20/s per tab |
| browser.bookmarks.changed | PUSH | B | S | MB | index | R | `src/main/browser/import/service.ts:429` | |
| browser.extensions.{actions.changed,popup,reveal} | PUSH | B/C | S | MB / CB | extensions | R | `src/main/browser/extensions/actions.ts:195`; `index.ts:71`; `register.ts:58` | |

## 3. Main-process residue: what a machine without an app window cannot serve

**What does survive without the app.** The E10 supervisor (the engine host, detached) keeps engine processes, the journal, the ring, the queue, grants, the artifact store, the fs service and plugin operations running while the app is away. The authoritative list is `docs/doperpowers/plans/2026-10-06-e10-supervisor.md:167-188`.

**Why that is not enough.** A client that reached only the supervisor would lose everything below. Each item is machine-bound, lives in Electron main today, and is listed with what it would take to move.

1. **The session index and read model.**
   - **What lives in main:**
     - `<userData>/index.sqlite`: records, projects, drafts, bindings, attention, the owner-channel marks and the mod overrides;
     - main's digests, with X16 `availability` derived in main;
     - `session.appEvents`.
   - **Why the whole product depends on it.**
     - The sidebar, Overview and attention all read it.
     - The fs service serves only the ids that main binds (`fs.bind` from `src/main/index/source.ts:293-294`).
     - Digests are folded from host events through E10's resync (`src/main/sessions/index.ts`; resync at `src/main/hosts/supervisor.ts:272`).
   - **To move it:** pure Node (`node:sqlite`).
2. **The session service.**
   - **What it covers:** create, start, fork and acquire (X16), intents, recovery, take-over, delete (`shell.trashItem`), trust checks, side threads and `sendToMain` (`src/main/sessions/service.ts`, `service-register.ts:20-47`).
   - **Why it matters:** an engine starts only through main's acquisition registry.
   - **To move it:** pure Node, except the trash call.
3. **Attention derivation.** It derives items from host events and broker items, persists them, and gates `session.answer` (`src/main/attention/service.ts`; `src/main/sessions/index.ts:147`). It also derives the owner channel's items. **To move it:** pure Node. The notifier half is client-bound.
4. **The owner channel and mods.** Covered by `src/main/owner/`. **To move it:** pure Node.
5. **git, scm and files.** These include the watchers, the push and PR runners with the captured login-shell credentials, and path-confined file reads and writes. **To move them:** pure Node. Only reveal and open-external use `shell`.
6. **The library index.** Main's SQLite with FTS5, rebuilt from main-only host reads (`src/main/library/index.ts:47`). **To move it:** pure Node.
7. **The connector broker and OAuth custody.** OAuth custody uses `safeStorage`, which is the Keychain (`src/main/connectors/oauth-root.ts`, `oauth-store.ts`). Dataset refresh for agents, `maws.artifact.datasetRefresh`, is part of this. **To move it:** it needs the Keychain through a different API, and a redesigned consent flow.
8. **Offscreen rendering.** It covers `maws.artifact.capture` (the agent's `artifact_screenshot`), `maws.artifact.export`, `artifacts.export` and presentation export. All of these use `BrowserWindow` (`src/main/artifacts/capture.ts`, `export.ts:471`; `src/main/presentations/export.ts`).
   - **Why it matters:** these are agent tools, so a headless machine breaks them, not only the UI.
   - **To move it:** it needs Chromium on the machine, for example headless Chrome or Playwright, or Electron run windowless.
9. **The `maws-artifact:` scheme and its CSP/sandbox policy** (`src/main/artifacts/protocol.ts`, `scheme-handler.ts`, `policies.ts`). **To move it:** it becomes an HTTP endpoint on the machine, behind the hub.
10. **The pty host.** It is an Electron `utilityProcess` forked by main, so terminals die with the app (`src/main/hosts/supervisor.ts:221-254`; E10 §4). **To move it:** it has to move under the supervisor, or a sibling daemon. node-pty is a native addon but runs under plain Node.
11. **The browser tab engine.** WebContentsView, partitions, import, extensions and the cua server. **To move it:** it is inherently Electron. Agents that drive tabs need it on the machine even when no window shows the tabs.
12. **Settings ownership and the configuration pushes.** `settings.json` lives in main, and main pushes `engine.configure`, `engine.policy.set` and `host.configure` (`src/main/index.ts:462-480`). The ClaudeUsage integration is also main's (`src/main/usage/`, `src/main/gateway/`).
13. **The supervisor's own lifecycle.**
    - Main spawns the supervisor through `ELECTRON_RUN_AS_NODE` (E10 §1) and owns its crash ladder, the version handshake and the resync.
    - The supervisor exits **10 minutes after it has had no client and no live row** (`src/engine-host/supervision.ts:21`).
    - While no client is connected, it stops idle rows (E10 §1, "Idle exit, and idle rows").
    - Events emitted with no client are dropped (`src/shared/host/runtime.ts:123-126`).
    - So today nothing starts or holds a supervisor without the app.

**The pattern.** Items 1-7 and 12 are plain Node logic that lives in main for historical reasons: main was "privileged" in charter §4.1. Items 8, 9 and 11 need Chromium. Item 10 needs a process owner.

**The cleanest cut.** A headless "machine daemon" would absorb items 1-7, 10 and 12. Items 8 and 9 would come from a windowless Electron or a headless Chromium owned by that daemon. Electron main would become a client of the daemon, like any web client.

## 4. The E10 supervisor protocol as a network endpoint

### What it is

- **Transport.** A Unix socket in `<userData>/supervisor/` (mode `0o700`; socket `0o600`; token file `0o600`, 32 random bytes as hex). E10 design: `docs/doperpowers/plans/2026-10-06-e10-supervisor.md:92-94,250-252`.
- **Framing** (`src/shared/host/socket-protocol.ts`):
  - **Lines.** Newline-delimited JSON with a 64 MiB line cap (`:19`).
  - **Bytes inside a line.** A `Uint8Array` is carried as `{"$bytes": base64}` (`src/shared/host/json-bytes.ts`).
  - **Binary doc frames (protocol 2).** After the welcome, binary doc frames are interleaved with the lines: `0x00 | u32 BE length | u32 BE channel | payload` (`:116-133`). A reader tells them apart by the first byte.
  - **Doc frame cap.** 64 MiB per frame (`:126`).
- **Handshake.**
  - The client sends `hello {protocol, token, buildId, wire, appPid}`.
  - The server checks these in order: the token (timing-safe), the protocol number, the wire fingerprint, then replacement. It answers `welcome {protocol, buildId, wire, pid, startedAt, liveSessions, rows}` or `refuse {reason: token|protocol|wire|replaced}` (`src/shared/host/socket-server.ts:143-211`).
  - The hello has a 2 s deadline (`:36`).
  - `exit {when: now|idle}` is honoured on any connection whose token checked out, including a refused one (`:116-133,224-228`).
  - The first three fields of `hello`, the shape of `refuse`, and `exit` are promised stable across versions (`socket-protocol.ts:6-8`).
- **Envelope.** After the welcome the lines are C1's envelope: `req {id, name, input}`, `res {id, ok, value|error}`, `evt {name, payload}`, plus `ready` (`src/shared/ipc/host-protocol.ts:10-19`). A malformed line closes the connection.
- **Held requests.**
  - Main holds requests while the host is `starting` or `restarting`, each under the 10 s `REQUEST_TIMEOUT_MS` from its dispatch. It sends them at `ready`, and fails them only on `crashed` or `stop()` (`src/main/hosts/supervisor.ts:103,118,215,310-344`).
  - When a client dies, its in-flight requests still complete in the host and their answers are dropped (E10 §2, "Disconnect semantics").
- **Resync and `ready`.**
  1. After the welcome, the client pulls by command: `engine.sessions`, then `session.events {afterSeq, limit: 2000}` paged per row. Main folds its digests from these, bounded at 30 s (`RESYNC_BOUND_MS`, `supervisor.ts:109`).
  2. The client then sends `ready`.
  3. The host emits no event before `ready`.
  4. At `ready`, the host's connect burst runs synchronously, for every row: `session.status`, `session.queue`, `session.brokerItems`, `session.catalogChanged`, and then the row's **undelivered tail** as `session.eventBatch`. That tail starts from a per-stream delivered cursor and is capped at 500 events or 16 MiB per batch.
  5. The burst ends with `engine.budget`, `plugins.changed`, and the latest `plugins.operation` of every operation still running (`src/shared/host/runtime.ts:161-180`; `src/engine-host/session-stream.ts:200-235,308-315`; E10 §3).
- **Events.**
  - Events go only to the one ready client. With no client they are **dropped, not queued** (`runtime.ts:123-134`).
  - Session events carry their launch's journal `seq` and a unique `id`, and consumers deduplicate by id (X13, `docs/charter.md:604`).
  - The ring holds 5,000 events per live stream and 500 once exited (`session-stream.ts:28`). Past the ring, `session.events` rebuilds events from the journal.
- **Backpressure.** None is negotiated.
  - A peer more than 256 MiB behind on writes is closed (`socket-protocol.ts:20`; `socket-port.ts:92-98`).
  - Document channels reset past 8 MiB (`doc-channels.ts:21`).
  - The pty credit scheme does not cross this socket, because the pty host is not on it.
- **Versioning.** Two rules decide compatibility (E10 §6):
  - **Protocol and wire.** The client must match `SOCKET_PROTOCOL` (2), and must match the wire fingerprint exactly. The fingerprint is a SHA-1 over the JSON schemas of the 169 engine-host commands and the 30 host events (`wire-fingerprint.ts`).
  - **Build id.** It only decides whether to restart the supervisor when it goes idle.

### What it lacks for a WAN with many clients

| Need | What exists | Gap |
|---|---|---|
| Authentication | One same-user shared secret in a file. No TLS, because the socket is local. | No principal, no per-user identity, no expiry or rotation outside a restart, and no device enrolment. The desk's DX7, whose enrolment and service tokens already exist, is the obvious source. |
| Authorization | All or nothing after the welcome. The main-only split is enforced in main's router, not in the host (`runtime.ts:220-240` serves any registered host command). | Capability classes per principal: read, write, and exec (pty, bash, send, `applyFlagSettings`, `plugins.install`, `scm.push`). The host would also have to enforce the main-only list itself. |
| Several concurrent clients | Exactly one. A second valid hello replaces the first (`socket-server.ts:181-187`); the runtime serves one port. | A client table, per-client `ready`, and connect bursts per client. |
| Fan-out | Main fans every event out to every window. The host fans out to its one client. | Fan-out at the hub or the machine, with per-client filtering. |
| Per-client subscriptions | None. Every `session.eventBatch` of every session, every `pty.data` and every `git.changed` reaches every window. | Subscribe and unsubscribe by session, pty, doc or repo. Today's "SUB" commands (`git.watch`, `files.watch`, `fs.agentEvents`, `connectors.watch`) are reference counts per window, not delivery filters. |
| Sequence and replay after reconnect | Per-stream `seq` and event `id` for session events only. One delivered cursor per stream, for "the" client. A 5,000-event ring, plus the journal. | Per-client cursors. A machine-wide or per-subscription offset for *all* events, like the desk's project offset. Today status, queue, attention and git are recovered by re-reading state, and anything else is lost: "events with no client are dropped". |
| Delivery guarantees | "Written" is not "read": a batch written to a dying socket counts as delivered (E10 §3). | Acknowledged delivery, or resume-from-offset, which matters on lossy links. |
| Backpressure | A close at 256 MiB behind. A doc channel reset at 8 MiB. pty credit exists, but end-to-end between the pty host and the renderer only. | Per-stream flow control and priorities. Without them, one 16 MiB event batch carrying base64 screenshots blocks keystrokes on the same connection (head-of-line blocking). Also needed: pty credit per viewer, and frame-size limits matching the hub (the desk's frames are 1 MiB, `docs/doperpowers/specs/2026-10-15-desk-design.md:272-273`). |
| Liveness | The kernel reports a closed socket. | Heartbeats and leases with fencing (the desk uses a lease plus a connection generation). |
| Cancellation | None. In-flight requests complete. | A cancel message. Bounded commands already answer their own `timeout`. |
| Versioning | An exact wire match, or refusal. `strictObject` everywhere. | A compatibility window or capability negotiation. Web clients and machines on different builds must interoperate; today one changed field anywhere on the host wire refuses the connection. |
| Scope | Only the engine host's 169 commands and 30 events. | The 186 main-owned commands, the pty host and the scheme need an endpoint too (§3). |
| Lifecycle | The app spawns the supervisor, which idle-exits without a client. | A launchd-owned daemon, with a remote client counting as a client for idle exit and idle-row release. |

**What is sound and reusable.**

- the envelope and its validation at both ends;
- the hello stability promise;
- the held-request discipline;
- the `ready` barrier;
- the per-stream seq and dedup-by-id contract;
- the undelivered-tail burst, which makes main's derivations exactly-once;
- the binary doc channel framing.

## 5. Relation to the desk as built

**The two paths on one machine.**

| | Desk path (observe and control any Claude Code session) | MAWS path (own engine processes) |
|---|---|---|
| Machine endpoint | The sminos daemon's uplink: outbound only, SSE down and POST up to a Durable Object per machine and per project (`docs/doperpowers/specs/2026-10-15-desk-design.md:225-296`) | The E10 supervisor's Unix socket, local only (§4) |
| Per-session hook | The bridge mod inside the `claude` process spawns `sminos bridge --session <id>` serving `$SMINOS_HOME/bridge/<id>.sock`. Control goes through `$.prompt.submit`, `$.session.append`, `$.turn.abort`, `classic.PermissionRequest`, and a `turn.step` model rewrite (`desk-design.md:299-335,579-607`; `[doperpowers] hooks/mods/bridge.tsx:1177-1240`) | The SDK host owns the process's stdin and stdout over stream-json: control requests, `can_use_tool` via `--permission-prompt-tool stdio`, the `maws` MCP server via `sdkMcpServers`, and `ui_attach` (`src/engine-host/launch.ts:47-58`) |
| What it reads | Transcript JSONL (flushed every 100 ms), `subagents/*.meta.json`, `~/.claude/sessions/<pid>.json` presence, and the bridge stream (`desk-design.md:442-457`) | The stream-json wire, normalised to X1; plus the same transcript JSONL and the same `sessions/<pid>.json` registry, for terminal-held sessions (`src/engine-host/fs/holders.ts:1-10`) |
| What is durable | The `.smns` log plane, replicated to the hub. The hub never stores transcripts. | The journal and ring in the supervisor; main's index |
| Session kinds | Terminal, `--bg` seats, and MAWS-launched sessions | MAWS-launched only. Terminal and `--bg` sessions are "foreign" holders, read-only plus take-over. |
| Granularity | Per-session RPCs that return `done` or `failed` at once. RPCs that decide carry a digest of the request as it was drawn. | The full X2 control surface (106 session commands) |

**Where they overlap.**

- **MAWS sessions are desk members by design.** The charter makes them so (`docs/charter.md:1120`). The engine environment carries `SMNS_MEMBER` (`src/engine-host/launch.ts:121-128`), and the launch loads user plugins (`--setting-sources user,project,local`, `src/engine-host/launch.ts:58`).
- **So the bridge mod runs inside MAWS's engines.** It gates only on `SMNS_INTERNAL` (`[doperpowers] hooks/mods/bridge.tsx:1178-1181`). sminos's own test asserts that an SDK run MAWS marked as a member "joins and exports as a terminal session does" (`[doperpowers] tests/sminos/test-bridge-export.sh:407-413`).
- **Every MAWS session is therefore reachable two ways at once:** from MAWS, and from the desk through the bridge.
- **Both read the same disk truth.** That is the transcripts and the session registry. Their identity keys differ: MAWS uses `appSessionId` and `launchId`; the desk uses the engine session id and the machine name.

**Where they conflict.** These are inferred from the two designs; none of the races was exercised here.

1. **Two controllers of one process.**
   - **Send and steer.** A desk send uses `$.prompt.submit` or `$.session.append`, which bypasses MAWS's host queue. MAWS's queue, `disposition` and X22 delivery (`command.lifecycle started` for *its* uuid) never saw that prompt. It shows up only as a foreign `user.message`.
   - **Interrupt.** A desk interrupt (`$.turn.abort` plus `TaskStop`) and MAWS's `interrupt` control request can cross.
2. **Permissions.** MAWS answers `can_use_tool` over stdio. The desk answers through a `classic.PermissionRequest` hook that races the dialog. It is not verified whether, in `-p` with `--permission-prompt-tool stdio`, the hook runs before `can_use_tool` is sent, and which answer wins. If the desk wins, MAWS's broker item and attention entry may be left pending until the engine withdraws them.
3. **Model and effort.** The bridge rewrites `model` and `effort` on each request in `turn.step`. MAWS's `session.setModel` sets them through the control channel. MAWS's status and chips would show a model that is not the one being called.
4. **Lifecycle.**
   - A desk Resume RPC runs `claude --bg --resume <id>`. If MAWS holds that session, this creates a foreign holder: a W7 contest in `holders.ts`.
   - A desk Retire of a MAWS session records `retired`, but the process stays MAWS's.
   - The desk's control table has no row for "an SDK host owns this process" (`desk-design.md:609-626`).
5. **Two depth streams out of one machine.** The desk relays transcript rows plus `turn.step` chunks, which include subagent deltas that the SDK wire lacks. MAWS streams normalised X1 events. A web MAWS through the hub would ship a third.

**§9.6 in this light.** The desk rejected being a remote *mod surface* because only an SDK host holds `ui_attach` and `ui_render` (`desk-design.md:1175-1190`). For P5 that premise flips: MAWS's engine host *is* the SDK host, so `session.ui.*` can cross the network. Two of the cost objections still hold:

- one round trip per row render, and `ui.input` per keystroke;
- mod handlers running from the web, which is a trust surface.

**Recommendation.**

- **Machines.** Keep one hub and one outbound machine connection per machine, using the desk's DX2 pattern, the Durable Object per machine, and DX7 enrolment.
- **MAWS sessions.** Make the MAWS machine daemon (§3) a second *service* on that connection, with MAWS-owned sessions controlled only through it.
- **The bridge in MAWS sessions.** It should go observe-only, or delegate. When it sees an `SMNS_MEMBER` session whose SDK host is live, it should route desk control to the MAWS daemon's endpoint, or refuse it. That keeps one controller per process.
- **Terminal sessions** stay on the bridge path.

The alternative is MAWS controlling its sessions through the bridge. That would throw away the SDK control surface (rewind, fork, permission mode, the maws tools) which the desk itself lists as impossible through the mod API (`desk-design.md:641-643`).

## 6. Renderer portability

**The transport seam is small.**

- **One file reads the bridge.** The only product file that reads `window.maws` is `src/renderer/src/ipc/client.ts:55`.
  - It validates every output and event with zod on receipt (`:20-53`).
  - 176 non-test renderer files import the client.
  - None of the 838 non-test renderer files imports `electron` or a Node built-in. The two that use `node:fs` are test support.
- **The bridge interface is three methods** (`src/shared/ipc/schema.ts:245-249`): `invoke`, `on` and `pathForFile`.
- **The preload is a name-checking pipe** (`src/preload/bridge.ts:12-44`).
- **What a network client needs to provide.** It can implement `MawsBridge` over a socket and set `window.maws`. Happy-dom tests already do this with a fake. An earlier survey reached the same conclusion at an older commit (`docs/doperpowers/specs/2026-10-15-desk-renderer-survey.md:10-28,56-61`).

**What is tied to Electron beyond the bridge.**

| Coupling | Where | Web replacement |
|---|---|---|
| Document MessagePorts posted by main on `maws:doc-port`, re-posted by the preload through `window.postMessage` | `src/preload/doc-port.ts:11-19`; `src/renderer/src/artifacts/window-ports.ts` | A WebSocket adapter for `PortProvider`, which was designed for it (`src/artifacts/provider/port.ts:1-4`) |
| The `maws-artifact://<id>/<rev>/<path>` scheme for html, PDF and media frames and for editor assets; `maws-image:` chips | 8 renderer files, e.g. `tools/artifacts/viewers/frames/HtmlFrame.tsx:144`, `transcript/view/markdown/Link.tsx:28`; main `src/main/artifacts/protocol.ts` | An HTTP route per machine through the hub, with Range support, CSP `sandbox`, a separate origin, and CORS for fonts |
| Sandboxed iframes: the artifact frames, PDF, request-card preview, engine surface | 4 files | They port, given the HTTP origin. Console attribution moves into the bridge script (`artifacts.console` today reads `console-message` from webContents). |
| `pathForFile`: dropped files become machine paths | `composer/editor/controller.ts:536`, `composer/editor/paste.ts:21` | An upload to the machine. The client's file is not on the machine. |
| Native dialogs, menu, quit guard and window capture through `layout.*` | see §2 | `<input type=file>`, Blob downloads, the in-page keymap (`src/renderer/src/keymap/`), `beforeunload` |
| In-app browser: WebContentsView laid over a rect | `tools/browser/Pane.tsx:95-100` | None directly. A CDP screencast, or a metadata-only view. |
| Notifications, dock and navigation relay in main | `src/main/attention/notifier.ts` | Web Notifications or Push via a service worker; `setAppBadge` |
| Voice through the Swift helper | `src/main/voice/` | The Web Speech API, client-local |
| Page CSP set by main | `src/main/csp.ts:1` | The web server's CSP |
| `window.__maws_*` e2e hooks; `import.meta.env` | 33 and 6 files | Harmless |

**The semantic seam is larger than the transport seam.**

1. **One machine is assumed throughout.**
   - `appSessionId`, `ProjectId` and `ptyId` are unscoped.
   - The stores are singletons (`useSessions`, `useAttention`, `useLayout`).
   - `connectShell` subscribes once to app-wide events (`src/renderer/src/ipc/events.ts:52-60`).
   - Layout keys name one machine's sessions.

   A many-machine client needs a machine dimension in ids, stores and layout, or one renderer instance per machine.
2. **Subscription semantics.** `on(name)` means "all of this event, from everywhere". A web bridge must either receive everything, which is wasteful over a WAN, or map component lifecycles to server-side subscriptions. Today nothing in the renderer declares interest by session.
3. **Reconnect semantics** are spread through the stores. For example, `engine.hostState` regaining `ready` triggers a re-read of `engine.sessions`, and `artifacts.resync` triggers re-opens. A network client gets these signals right only if the hub synthesises the same transitions per client.
4. **Per-window state in main keyed by `sender`.** This covers visibility, watch counts, dataset holds, connector leases, browser placement, the voice capture and the unsaved set. Each needs a per-client key on the machine.

## 7. Decisions the #52 / P5 design has to make

1. **The machine endpoint.**
   - Option A: grow the supervisor into a headless machine daemon that absorbs main's machine-bound services (§3 items 1-7, 10, 12), with Electron main becoming a client.
   - Option B: keep Electron main running as a windowless server.

   Recommendation: A. B ties every machine to Electron and keeps the supervisor/main split as two endpoints.
2. **Chromium on the machine.** This decides whether the agent's `artifact_screenshot`, the exports, the `maws-artifact:` origin and agent-driven browser tabs work on a machine with no app. The options are a windowless Electron, a headless Chrome, or the client rendering on the machine's behalf.
3. **Hub topology.** Reuse the desk's hub (the Durable Object per machine, DX2 uplink, DX7 enrolment) or build a separate one. Choose the transport: WebSocket with binary frames, or the desk's SSE plus POST, which is weak for keystroke traffic upstream. Also decide whether the hub only relays the session plane or also caches the read model (index, digests, attention) for offline machines.
4. **Multi-client semantics.** This needs:
   - per-client subscriptions;
   - per-client delivered cursors, or a resume offset covering every event, not only session events;
   - per-viewer pty credit;
   - conflict rules for two clients answering one request. The desk's request digest is the precedent.
5. **Authorization classes.** Capability scopes per member and per machine for R, W and X, where X covers pty, bash, send and steer, `applyFlagSettings`, `setPermissionMode`, plugin installs and scm pushes. The machine must enforce them, not only the hub; the desk's "the machine's own policy is the execution boundary" applies.
6. **Wire compatibility.** Replace the exact fingerprint match with a compatibility window. Web clients will be on a different build than some machines.
7. **Stream shapes over a WAN.**
   - Keep `pty.data` binary, with offsets and credit.
   - Separate keystroke-class channels from bulk ones.
   - Stop inlining base64 screenshots in `session.eventBatch`; fetch them by reference.
   - Fit the hub's frame cap: 1 MiB at the desk against 16 MiB batches today.
   - Decide whether whole-state pushes (`attention.changed`, `browser.tabs.changed`, `session.queue`) become deltas.
8. **What a remote client drops, and what it replaces.** The in-app browser's display, the native shell, Finder reveal and open-in-OS-app, and OAuth consent each need a ruling. OAuth consent has a client-side consent step and a relayed callback.
9. **Splitting settings and layout** between the machine and the client, and a machine dimension in renderer ids and stores.
10. **One controller per MAWS session.** Decide how the bridge mod and MAWS's SDK host share a session, and whether MAWS sessions on the desk route through MAWS's endpoint (§5).
11. **Lifecycle.**
    - A launchd-owned daemon.
    - Remote clients counting for idle exit and idle-row release.
    - The pty host made independent of the app, since terminals die with the app today.
12. **`session.ui.*` over the network.** Either accept a per-row round trip and per-keystroke `ui.input`, or ship mod surfaces as data and render them client-side.
