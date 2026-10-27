# Appendix to the headless-cut survey: the detailed cite tables

This appendix holds the detailed tables behind §4 and §6 of `headless-cut-survey.md`. All cites are at MAWS c3507722d (`/private/tmp/maws-arch`). Two parallel readers produced them, and the parent session spot-checked them: about 20 cites were re-read and all held. "(inferred)" marks a claim not verified in source.

## A. Single-client and single-machine detail (§4)

### A.1 Main's supervisor client (`src/main/hosts/`)

| Where | Now | Multi-daemon need |
|---|---|---|
| `supervisor.ts:23-27, 128-152` | One `Host` per owner, each with one port. The pty host is utility-only (`:26`). | One host per (machine, owner) |
| `supervisor.ts:114-120, 566-580, 366-373, 215` | Requests are held while a host is starting or restarting, and fail only at `crashed`. Ids come from `++nextRequestId`. | Held queues per daemon link |
| `supervisor.ts:39-45, 109-110, 260-290`; `sessions/index.ts:54`; `sessions/resync.ts:1-6, 38-60` | The resync runs before `ready`. `FoldFilter` is keyed by `appSessionId`. | Resync and fold per daemon |
| `connectors/index.ts:229`, `artifacts/index.ts:95`, `owner/register.ts:97`, `library/sync.ts:80`, `index/source.ts:155`, `sessions/service-register.ts:64` | `onStreaming` reconcilers, one run per engine-host connection | A machine parameter |
| `detached-transport.ts:314-320, 338-366`; `supervisor.ts:86-91, 516` | Main replaces another build's supervisor when idle, asks an incompatible one to exit when idle, kills an unresponsive lock holder, and stops everything at quit. | A client must never stop or kill a shared daemon |
| `ipc/router.ts:27-29, 109-110` | Dispatch is `(owner, name, input)` | `(machine, owner, name, input)` |

### A.2 Per-client state keyed by `WebContents` or sender

| State | Cite | After the split |
|---|---|---|
| Session visibility, which feeds unread | `sessions/index.ts:114-142` → `sessions/read-model.ts:168-179` → `index/source.ts:207` | Daemon: the union across clients |
| Attention viewing and focus | `attention/index.ts:18-40, 45` | Client. Notification dedupe across devices is a new problem (inferred). |
| git watch reference counts | `git/register.ts:11-27` | Daemon, per client |
| files watches and epochs | `files/register.ts:30-57` | Daemon, per client |
| Dataset holds | `dashboard/holds.ts:38-112`; host `documents/register.ts:265-274` | Daemon, per client |
| Connector leases, window-shown veto, owner viewers | `connectors/index.ts:7-8, 111-160, 165-180`; `connectors/owner.ts:183` | Leases to the daemon; the veto stays on the client |
| Document relay channels | `hosts/doc-relay.ts:29-31`; `artifacts/open.ts:42, 62` | Daemon, per connection |
| Browser placement and cover | `browser/view.ts:125-147`; `browser/register.ts:104-123` | Client |
| Voice capture | `voice/service.ts:43, 60-132` | Client |
| Unsaved files and Save all | `lifecycle/quit-guard.ts:457-500` | Client. Its writes go to the daemon's `files.write`. |
| Capture chords, presenter, comment mode, extension popups | `settings/capture-chords.ts:7-9`; `presentations/present.ts:131`; `browser/comment/mode.ts:141`; `browser/extensions/popup.ts:207` | Client |
| Dialogs parented to the sender's window | `index.ts:380-388, 553-558`; `library/files.ts:228`; `dashboard/download.ts:80`; `browser/import/register.ts:51` | Client |
| Edit menu delivered to the focused page | `ipc/events.ts:20-33`; `menu.ts:209` | Client |

(Paths in A.1 and A.2 are under `src/main/` unless they start with `src/`.)

### A.3 Ids and where they are minted

| Id | Minted | Machine-local binding |
|---|---|---|
| `AppSessionId` | `randomUUID()`: `src/main/sessions/service.ts:390`, `src/main/index/sessions.ts:280, 355`, `src/main/sessions/record-actions.ts:179`, `src/main/sessions/setup.ts:66`, `src/main/index/replay.ts:43` | That machine's `index.sqlite`, and the journal at `<userData>/engine-host/journal/<id>` (`src/engine-host/launcher.ts:168-171`). Two daemons indexing the same transcript would mint two ids (inferred). |
| `ProjectId` | `randomUUID()` (`src/main/index/projects.ts:336`) | Identity is the realpath `directory` (`:327, 355-359, 389-391`) |
| `PtyId` | `randomUUID()` (`src/pty-host/table.ts:141`) | One acked offset and flow state per pty (`src/pty-host/flow.ts:11-20`) |
| `EventId` | `${appSessionId}:${launchId}:${seq}:${i}` (`src/main/sessions/resync.ts:24-34`) | Unique within a session (`src/shared/graph/ids.ts:19`) |
| `AttentionId` | `${appSessionId}:${requestId}` (`src/engine-host/broker.ts:109`; `tool-server/asks.ts:95`; `src/main/owner/projection.ts:18`; `src/main/attention/service.ts:179`) | n/a |
| Host keys | `HostOwner` (`router.ts:27`); `HostKey = 'engine' \| 'pty'` (`src/renderer/src/stores/hosts.ts:16-22`) | n/a |

### A.4 Renderer scan

**Rerunning it.**

1. `scripts/introspect.ts` imports `src/shared/ipc/schema.ts` and records each command's input keys at any depth through `z.toJSONSchema`. Bundle it with esbuild from the main MAWS checkout's `node_modules`, using `--tsconfig=/private/tmp/maws-arch/tsconfig.node.json --external:electron`, then run it to produce `registry.json`.
2. `python3 -I scripts/scan2.py /private/tmp/maws-arch registry.json [--list]` does the scan.

**What it counts.**

- **Classifying keys:**
  - session: `appSessionId`, `sessionId(s)`, `engineSessionIds`, `launchId`;
  - project: `projectId`, `project`;
  - pty: `ptyId`;
  - path: `path(s)`, `cwd`, `directory`, `directories`, `additionalDirectories`, `repoRoot`, `root`, `projectPath`, `linkedDir`, `binaryPath`, `files`, `filename`, `location`.
- **Excluded:** `browser.*` and `settings.set`. Result: 213 of the 397 commands qualify.
- **Sites:** a quoted command literal that is an argument of `invoke`, `useEngineRead`, `useCommand`, `useOperation`, `usePluginsRead`, `run` or `invokeRead`, in non-test `src/renderer/src` files. `test-support/`, `harness/` and `ipc/query.ts` are excluded. Type positions (57), query keys (17), subscriptions (13) and bare literals (9) are not counted.

**Breakdowns.**

- **By dimension:** session 203, path 108, pty 13, project 6.
- **By owner:** engine host 147, main 131, pty host 15.
- **By namespace:** session 155, git 27, pty 15, files 13, scm 13, layout 11, fs 10.
- **Top files:**
  - 12 each: `tools/agents/client.ts`, `terminal/registry.ts`;
  - 7: `sessions/CleanupDialog.tsx`;
  - 6 each: `composer/Composer.tsx`, `composer/queue/QueueList.tsx`, `transcript/source/ipc.ts`, `sessions/setup-actions.ts`, `sessions/record-ops.ts`, `gateway/switch-route.ts`.

## B. The SSH-helper design: locality sites (§6)

Paths are under `src/engine-host/` unless they start with `src/`.

### B.1 Engine-host core

| Site | Assumes locality how |
|---|---|
| `transport.ts:168, 196, 37` | `spawn(…, {detached: true})`; group kill `process.kill(-pid)`; a write counts as delivered "when the bytes reached the OS pipe" |
| `launch.ts:112-149, 137, 22/142, 254` | Env built from the client's login-shell capture. `SMNS_MEMBER` is the spawner's pid, which must be the engine's direct parent. `ANTHROPIC_BASE_URL=http://127.0.0.1:8641` (the ClaudeUsage relay). The `--settings` JSON. |
| `launcher.ts:94-97, 108` | Binary probe, relay check, `captureEnv`, `captureLocalKey(cwd)`; `spawnerPid: process.pid` |
| `binary-info.ts:60-110` | realpath, stat, X_OK and `--version` of the binary |
| `session-start-hooks.ts:53, 63-80, 140` | User, project, local and managed settings; MDM plists through `/usr/bin/plutil`; plugin `hooks.json`; the git root |
| `local-store.ts:17-23, 140-159`; `models-cache.ts:61-66` | Settings files and the git root, for the model-catalogue key |
| `memory-append.ts:14-40` | `#` writes CLAUDE.md under `O_NOFOLLOW` |
| `process-table.ts:45, 81, 126` | `ps -axo pid=,ppid=,rss=` every 10 s; the budget from `totalmem()` |
| `live-ledger.ts:80-110`; `supervisor-files.ts:239, 250` | Orphan sweep by pid; `kill(pid, 0)`; `ps -o lstart` |
| `plugins/runner.ts:326, 153`; `plugins/manifest.ts`; `ipc.ts:773-816` | `claude plugin … --json` and `claude mcp add/remove`, then reads of `~/.claude/plugins` |
| `customization/inventory.ts:237-247` | Skill listing under `~/.claude/skills` and `<cwd>/.claude/skills` |

**What is unaffected.** Hooks travel as `initialize.hooks` and `hook_callback` (`host-hooks.ts:1-4`), and the remote's own hooks run on the remote (`launch.ts:60`). `!` (`bash-mode.ts:1-7`), rewind and `get_workspace_diff` (`ipc.ts:577`) also work over the control protocol.

### B.2 Tools, documents, library, connectors

- **Tool context.** The tool context carries only `cwd` (`tool-server/server.ts:25`). Calls arrive as `mcp_message` (`session.ts:934`).
- **Tools that touch remote paths:** `send_file` (stat and sha256 of the whole file), `show_pane` (stat), `artifact_create` (html up to 16 MiB; a `file` artifact is kept in place), `artifact_read` (up to 1 MiB of an in-place file), `artifact_upload_asset` (realpath, lstat, `O_NOFOLLOW_ANY`, dev/ino, up to 16 MiB), `artifact_export` (writes `to` under the cwd), `artifact_dataset` (up to 16 MiB).
- **Documents.** `ContentRef.path` is absolute and has no machine (`documents/bytes.ts:16, 102-104`). The commit transaction runs `existsSync`, `statSync` and `describe` synchronously (`documents/store.ts:733-737`).
- **Library.** `library/mirror.ts:275-777` makes about 34 synchronous fs calls. `cloneFile` shells out to `/bin/cp -c` and `/usr/bin/stat` (`mirror.ts:745-757`).
- **Connectors.** `captureLocalKey` walks the cwd's ancestors under a 1.5 s budget (`connectors/local-key.ts:24, 46-80`). `source-entry.ts` reads the config and walks PATH. `direct-stdio.ts:93-233` spawns stdio MCP servers.
- **Dashboards.** The renderer polls file datasets every 5 s (`src/renderer/src/tools/dashboard/FileSources.tsx:10`).

### B.3 fs service (`fs/`, 4,981 lines in all, about 2.6k touched)

- `watcher.ts:108, 137, 33`: recursive watches on `projects/`, `jobs/` and `tasks/`; a flat watch on `sessions/`; a 50 ms debounce.
- `follow.ts:35-76`: reads with an inode check.
- `discovery.ts:67-86`: summaries from 64 KiB of head plus 64 KiB of tail.
- `holders.ts:50`: `sessions/<pid>.json`, `kill(0)` and `ps lstart`, polled every 2 s.
- `artifacts.ts:16-53`: the `readSpill` containment check.
- `search-text.ts`: streams whole transcripts.
- `paths.ts:19`: `homedir()` and `getuid()`.

`FsService` has no Electron dependency and is wired in one place (`fs/register.ts:15-38`).

### B.4 Sessions, index, git, scm, files, pty

- **Take-over and holders.** `src/main/sessions/take-over.ts:70, 97-104` takes over by SIGTERM or `claude stop`. `pause-take-over.ts:36, 48` scans `ps` every 100 ms for up to 3 s. `pane-holder.ts:26-30` uses `ps`.
- **Trust.** `trust.ts:47-100` reads `~/.claude.json` and runs `git rev-parse`.
- **Store files.** `record-actions.ts:92` calls `trashItem` on store files.
- **Transcripts read directly:** `restored-cost.ts:17-47` and `recent-turns.ts:151`.
- **Projects.** `src/main/index/projects.ts:57-68` runs git with `execFileSync`. `projects.ts:162-180` runs a synchronous `locate()` inside transactions, and `migrations.ts:33-42` defines `projects.directory UNIQUE`.
- **git.** `src/main/git/runner.ts:9-12`: buffered output, a 64 MiB cap, a 10 s timeout.
- **scm.** `src/main/scm/remote-runner.ts:23-27`: 16 KiB chunks with a seq number, a 120 s timeout, credentials from the login shell (`remote-env.ts:9-14`). The gh probe is cached per process (`scm/service.ts:93`).
- **files.** `src/main/files/service.ts:110-116, 150-205`: the `O_NOFOLLOW_ANY` boundary is macOS-only; reads up to 8 MiB; writes are hash-checked.
- **pty.** `src/pty-host/flow.ts:7-8` and `table.ts:32-33`: 256/64 KiB credit and a 512 KiB ring; the foreground process found with `ps` and `pgrep`.
- **`@` typeahead.** `src/main/git/ls-files.ts:16, 63`: a 10 s cache and a realpath on every call.
- **Diffs.** After each change the renderer fetches the full `git.diff{scope:'all'}`, but its store uses only `files` (`src/renderer/src/stores/git.ts:25, 63-67`).

### B.5 Helper surface beyond Desktop's

| Need | Desktop's helper | MAWS |
|---|---|---|
| Engine process | spawn, stdin with offsets, reattach from a seq, kill | Plus group kill, and the remote pid and start time |
| Filesystem watch | none (an SFTP transcript mirror) | Recursive and flat watch streams; git working-tree and git-dir watches; `files.watch`; config-file watches |
| Reads | `files.read` up to 1 MiB, SFTP beyond | Ranged reads with an inode check, 8 to 16 MiB; whole-file sha256 on the helper |
| Compound safe operations | none | `readFileUnder` and `writeFileUnder` as single operations. On Linux this needs `openat2(RESOLVE_NO_SYMLINKS)` or a component walk (inferred: not in Node core). |
| Processes | `children/*.json` | A process table (pid, ppid, rss, pgid, tpgid, lstart), `kill(0)`, signals by pid and by group |
| Exec | worktree git methods | General exec under the remote's login-shell env, with streamed output, cancel and timeouts |
| pty | none used | MAWS's offset and credit protocol, the ring, attach, foreground, resize, the kill ladder |
| Typeahead | none | `lsFiles` with a cache invalidated by the watcher |
| Tunnels | SFTP | A reverse forward for the relay (port 8641); a reverse unix-socket forward for cua, with peer auth on the remote; upload of dropped files |

**The engine's stdio.** A `RemoteEngineTransport` implements `frames`, `stderr`, `write`, `kill`, `exited` and `pid` over `process.spawn`, `stdin`, `reattach` and `kill`.

- **Delivery truth.** A write counts as delivered when the helper acknowledges its offset.
- **The adopt path is new.** Nothing in the engine host reattaches to a running engine today. The broker already re-accepts redelivered `pending_permission_requests` (`broker.ts:202-213`).

**The SSH-helper size estimate by subsystem** (changed in place / moved to the helper / new):

| Subsystem | Changed in place | Moved | New |
|---|---|---|---|
| Engine-host core | 450–650 | ~1.6k | — |
| Remote transport and adopt path | — | — | 1.2–1.8k |
| Tools, documents, library, connectors | 820–1,000 | 0.2–0.5k | — |
| fs service | ~460 | ~0.26k | 0.4–0.8k |
| Sessions and index | 350–550 | — | 0.3–0.5k |
| git, scm, files | 380–800 | ~2.9k | — |
| pty | 170–340 | 0.5k | — |
| Other main services | 435–735 | 0.2k | 0.15–0.3k |
| Renderer | 200–400 | — | 0.8–1.5k |
| Client connection layer | — | — | 2.0–3.0k |
| Helper core | — | — | 2.0–3.0k |

The total is about 16k to 22k lines, or 33k to 46k with tests at the repository's 1.07 test lines per source line. The new-code figures are scaled from Desktop's `RemoteRPCClient`, `RemoteProcess` and controller (DK:1140-12486) (inferred). Not costed: a Node runtime on every remote (Desktop ships a static Go binary), and per-arch node-pty builds.
