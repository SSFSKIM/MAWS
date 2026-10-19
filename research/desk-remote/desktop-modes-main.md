# Claude Desktop Code tab: what hosting a session in the main process buys, versus cloud and Remote Control sessions

Scope: the Desktop **main-process** side of the question "how do local, cloud and Remote Control (RC) sessions differ in Desktop's Code tab, and is each difference structural or a fillable gap?". Renderer gating and the CLI side are covered elsewhere. This builds on `notes/claude-ai-rc-client-protocol.md` (called "the previous report"): its §4.2 lists the control subtypes cloud and RC sessions get, and its §7 covers Desktop as an RC host.

## Build and method

- Build `app-2.42304.0` (Electron 44.7.2), readable tree at `~/claude-desktop-re/readable/app-2.42304.0/`.
- Static analysis only. I read areas 1, 4 and 5 myself. Two parallel readers covered area 2 (side features) and area 3 (SSH/WSL). I re-read their load-bearing claims in source: the `claude-ssh --serve/--bridge` commands, `createSpawnFunction`, the WSL adoption refusal, `isRepoHeldBySessions`, `gh auth token`, the FramebufferPreview stub and the powerSaveBlocker. Anything not read in source is marked *(inferred)*.
- **Status labels used throughout:**
  - **structural**: follows from where the process runs, who owns it, or the transport.
  - **fillable**: nothing in the architecture prevents it; it has not been built.

**Citation prefixes.** The prefixes of the previous report still apply (`W/`, `M/`, `MU`, `CF`, `EPI`, `S104`, …). New ones, each expanding to `readable/app-2.42304.0/main-process/…`:

| Prefix | File | What it is |
|---|---|---|
| `DL` | `index.chunk-DLn6Mdsc.js` | `createLocalSessionsApi`, the renderer-facing adapter for the `LocalSessions` IPC (function `zt` at DL:2201) |
| `SDKM` | `index.chunk-DNyequwM.js` | Agent SDK bundled in main (the `Query` class, its control methods) |
| `DK` | `index.chunk-DK8QSLgC.js` | remote host controller (`RemoteServerController`, `RemoteRPCClient`, `RemoteProcess`) |
| `D3` | `index.chunk-D3PzLoAh.js` | SSH/WSL connections, `claude-ssh` helper deployment, CLI install on the host |
| `D7` | `index.chunk-D7Sj9EoB.js` | ShellPtyManager |
| `B5` | `index.chunk-B5tintml.js` | MCP coordinator, proxy servers, in-process Desktop tool servers |
| `CSP` | `index.chunk-C-SPwKbM.js` | external CLI session discovery (list, tail, resume) |
| `DQ` | `index.chunk-DQCSsqI6.js` | gates for external CLI sessions |
| `CEE` | `index.chunk-CEEhCPmx.js` | TeleportToCloud |
| `IPC` | `ipc-services.md` | IPC service and method listing |

The `LocalSessions` service is declared at MU:115550 and wired at MU:370177-370189. It is lazy-loaded from DL. Every method then goes through `Bt()`, which rejects ids of hidden prewarms and parked sessions (DL:5208-5227).

---

## 0. Findings that change the picture

1. **A local session is a CLI child process plus an in-process SDK `Query`. Desktop owns both, and owns the transcript file on disk.**
   - Desktop calls `query({prompt: inputStream, options})` from its bundled SDK (CF:95436-95447; SDK load MU:181437-181444).
   - The options carry an in-process `canUseTool`, `onUserDialog` with declared `supportedDialogKinds`, Desktop hooks, `enableFileCheckpointing: true`, `includePartialMessages`, and the user/project/local setting sources (CF:84697-84790).
   - Desktop always runs its **own** CLI binary, never the user's: build pin **2.1.299** with SDK wrapper 0.3.299 (MU:97809-97893). It is downloaded to `userData/claude-code/<version>/<sha12>/` and auto-updated independently of the app, from a signed `…/claude-code-releases/stable` pointer (MU:238256-238395).
   - Everything below follows from this ownership.
2. **The main process drives local sessions with about 15 control subtypes that cloud and RC sessions never receive** (§1.4): `set_cwd`, `rewind_files`, `set_max_thinking_tokens`, `mcp_set_servers` with `mcp_message` (in-process SDK MCP servers), `mcp_toggle`, `mcp_reconnect`, `mcp_authenticate`, `mcp_clear_auth`, `mcp_oauth_callback_url`, `reload_plugins`, `reload_skills`, `list_permission_rules`, `get_sandbox_dialog`, `generate_session_title`, `ultrareview_launch`, `remote_control`.
3. **Several "session operations" are process restarts or resumes, not control requests.** These are:
   - conversation rewind: stop, then respawn with `resume + resumeSessionAt + forkSession`;
   - clear: stop, drop the CLI session id, start fresh;
   - resume before clear;
   - fork: copy the transcript JSONL, then resume the copy;
   - model change by restart;
   - CLI version upgrade;
   - side chats: a second, read-only forked process.

   Cloud and RC sessions cannot use these paths, because the client owns neither the process nor the transcript file. That is why the web gets `rewind_conversation`/`fork_conversation`/`side_question` instead, and only partly. **Structural**, except where a CCR subtype already exists.
4. **SSH and WSL sessions keep the local architecture.**
   - The SDK `Query` still runs in Desktop's main process. Only the spawn is replaced (`spawnClaudeCodeProcess = controller.createSpawnFunction(…)`, CF:81191).
   - A Desktop-deployed helper daemon on the host, **`claude-ssh`** (pinned, from `downloads.claude.ai/claude-ssh-releases`, MU:97896-97929), owns the CLI processes. They survive disconnects and Desktop quits, and Desktop re-adopts them.
   - The renderer treats such a session as local, so nearly the whole local feature set carries over (§3).
   - This is the real "drive another machine with local-session features" path. Its trade-offs are the reverse of RC's.
5. **External (terminal) CLI sessions can only be watched read-only, or adopted once they have exited.**
   - `resumeCliSession` refuses while the CLI's PID registry entry is live (CSP:464-560).
   - `enableCliRemoteControl` throws unconditionally: the adapter gate is hard-wired to `false` (DQ:46-48 via DL:109-115), and the implementation behind it also throws (CSP:569-571).
6. **Feel of use for local sessions is governed by process lifecycle.** The CLI-process cap is `max(6, RAM/3 GiB)`. LRU idle eviction runs under memory pressure. Hidden SDK "spare" processes are prewarmed with a 10-minute TTL and a 30 s claim timeout. Transcripts are read from local JSONL in a utility process and delivered to the renderer over a dedicated MessagePort (§5). Cloud sessions have none of this; their latency is network plus server.

**Contradictions with, and corrections to, the previous report:**
- `enableCliRemoteControl`: the previous report cites only `M/index.chunk-C-SPwKbM.js:569-571`. The call actually dies one layer earlier, in the adapter gate `DQ:46-48`, so the CSP stub is never reached. Same outcome.
- "Rewind there is a resume at a point, not a control request" (previous report §4.2, last paragraph) is right for **conversation** rewind. **File** rewind (`rewindFiles`) is the `rewind_files` control request (CF:91543, SDKM:67771).
- The previous report says `add_directory` appears only in Cowork-remote. That is consistent: local `addDirectories` does not use `add_directory` either. It records a session permission update and pushes it with `apply_flag_settings` (CF:100425-100493).
- The previous report's list of subtypes main sends (`set_max_thinking_tokens`, `mcp_*`, `mcp_set_servers`, `remote_control`) is incomplete; see §1.4.
- Previous report finding 5 says `/btw` side questions exist only for RC. Local sessions have them too, implemented as a separate forked CLI process rather than `side_question` (CF:70255-70320).
- New for Lane B (`rc-serve`) in the previous report's §7: sessions this Desktop hosts *for* a remote client (`remoteControlSpawn`) refuse clear and conversation rewind (`refuseHistoryRewriteIfBound`, CF:50268-50277) and file rewind (CF:91521). So an RC-served local session loses history-rewrite operations even in Desktop itself.

---

## 1. How a local session runs

### 1.1 Who spawns what

- **Spawn.** The renderer calls `LocalSessions.start(info)` (DL:2752). The manager (`lZ`, CF:73605, 33k lines) builds SDK options (CF:84697-84790) and spawns through `spawnSessionQuery`, which calls the SDK `query()` with an async-iterable `inputStream` (CF:95436-95447). That is streaming-input mode: user turns are pushed into the iterable, not re-spawned.
- **SDK.** The bundled Agent SDK is lazy-loaded (`[agentSdk] sdk loaded in …ms`, MU:181409-181444).
- **Binary resolution** (`CC`, CF:27696):
  1. a **pinned** version for this session, if still installed (`getInstalledHostBinaryPath`, MU:237392);
  2. the manager's current target (`resolveHostBinary`, MU:237414-237477). In order:
     - `local_override`: never set in production. `CLAUDE_CODE_LOCAL_BINARY` is read and discarded (MU:236436), and `initLocalBinary` has no caller.
     - `preseed_in_place`: MSIX only; `qr()` is `false` on macOS (MU:17951).
     - `required_version` under `userData/claude-code` (MU:235831).
     - `fallback_version`: any installed version.
  - **Waits.** If an install is in flight and the model needs a newer CLI (`model_floor`) or a `warm_respawn` is pending, the spawn waits up to 90 s (`pC`, CF:27635) for the download.
- **Version.**
  - The build pin is `2.1.299` (manifest commit `c416f56e…`, per-platform zstd binaries including musl). The base URL is `https://downloads.claude.ai/claude-code-releases` (MU:97809-97885).
  - The CLI auto-updater (`[CCD-autoupdate]`) works as follows (MU:238256-238395):
    1. reads `${baseUrl}/stable`;
    2. verifies `manifest.zst.json` against `claude-code-release-signing-key`;
    3. checks wrapper compatibility against the embedded SDK wrapper;
    4. honours a high-water mark and a flag-driven `spreadHours` rollout;
    5. calls `installUpdatedHostTarget` (MU:237137).
  - **Effect:** a Desktop install can run a newer CLI than its build pin, without an app update.
- **Launchers.** A managed-settings launcher can wrap the binary ("Starting it through the host CLI launcher", CF:95972-95992). In that mode Desktop withholds its OAuth push (CF:85612-85621).
- **Root.** When running as root, Desktop downgrades `bypassPermissions` to `acceptEdits` (CF:85635-85641).

### 1.2 What the main process owns per session

- **Session ids.** The Desktop id is `local_<cliSessionId>` (prefix `Fd = "local_"`, MU:61190). The CLI transcript JSONL lives under the user's Claude config `projects/` directory, and Desktop reads it directly (§5).
- **Permission and dialog relay** run in-process:
  - `canUseTool`: `permissionBroker.createCanUseTool`.
  - `onUserDialog`, with `supportedDialogKinds` derived from feature flags: `userDialogBroker`, CF:71501, used at CF:84730.

  The previous report found that the web declares **no** dialog kinds to cloud or RC workers. Locally they are declared.
- **Hooks.** Desktop hooks are installed as SDK hook callbacks (`createBaseHooks`, CF:84756-84768).
- **Spawn-time options** cloud and RC cannot set per session: `effort`, adaptive `thinking`, `managedSettings`, per-session `settings` (fast mode, worktree, denied MCP servers), `additionalDirectories`, `disallowedTools` for scheduled or unattended runs, `extraArgs`, `toolConfig` (AskUserQuestion HTML preview), `promptSuggestions`, and `env` (CF:84697-84800).

### 1.3 Operations implemented by restart, resume or fork

| Operation | Mechanism | Cite |
|---|---|---|
| `rewind` (conversation) | Validates the target is on the active chain in the on-disk transcript. Then `stopSession(…,"rewind")`, sets `pendingRewindTo = assistantUuid`, clears the message buffer and returns `prefill`. The next start sets `resume = cliSessionId`, `resumeSessionAt = pendingRewindTo` and `forkSession = true` | CF:56222-56415, CF:85071-85076 |
| `undoRewind` / `switchRewindMark` | Takes the start mutex, re-reads the transcript, restores the leaf (`leafBefore`), crash records and file-restore marks; no process call | CF:56417-56520 |
| `rewindFiles` | **Control request** `rewind_files` (`query.rewindFiles(uuid,{dryRun})`), timeout `nR`. Refused mid-turn ("Session is busy"), for RC-served sessions (`remoteControlSpawn`), and when the link is down. Warms the process first if it is not running | CF:91516-91582, SDKM:67771 |
| `clearSession` | Refuses when bound to a remote client. Stops the process, stashes `preClearCliSessionId` and prompt state, drops `cliSessionId` (`clearStaleResumeHandle`), sets `isFirstTurn=true`. The next send spawns a **fresh** CLI session under the same Desktop id. Re-enables RC after the clear if the user had it on | CF:50268-50380 |
| `resumePreClearSession` | Stops the process, then swaps `cliSessionId` back to `preClearCliSessionId` (checks that the local transcript is non-empty); the next start resumes it | CF:91699-91760 |
| `forkSession` | Local: copies the transcript up to the cut (`copyTranscriptUntilSettled`), registers a new `local_<uuid>` session that resumes the copy, and clears inherited RC bridge pointers and worktree bindings from the copy. SSH: `forkSessionRemote` copies on the host. WSL: behind a flag. Remote into a local folder: refused | CF:31859-32170, 31895-31960 |
| `applyModelByRestart` | Local only ("Only a local session's Claude Code is restarted here"). Commits the model, **drops `cliBinaryPin`**, tears down (`model_restart`) and `warmSession`s again. Returns `Busy` / `Restarted` / `AppliesOnNextStart`. The normal `setModel` path is the `set_model` control request (CF:55074-55160) | CF:100530-100594 |
| `getClaudeCodeRestartVersions` | Returns `{fresh, target, downloading}` from `getHostSpawnSummary`, so the UI can offer "restart to update Claude Code". Empty for remote targets and local overrides. Emits `claude_code_restart_versions_changed` on host-state change | CF:25599-25637 |
| `changeCwd` | **Control request** `set_cwd` (`query.setCwd`). An unstarted session is retargeted without a process. A CLI that is too old gets "requires a newer Claude Code version". If the CLI did not relocate the transcript, Desktop migrates it itself. Unsupported for SSH (other report) | CF:65180-65330 |
| `addDirectories` | No restart: pushes a session permission update `addDirectories` and sends it live with `apply_flag_settings`. Remote paths are checked against `allowedWorkspaceFolders` | CF:100425-100493 |
| Side chats / `/btw` | Spawns a second SDK query with `resume: parent, forkSession: true`, `persistSession: false`, read-only tools and a deny-all `canUseTool` ("Side chats only read inside the session's working folder.") | CF:70255-70320 |
| Out-of-date CLI refused by the API | Ends the process and unpins it, so the next message resumes on the newer binary | CF:25560-25595 |

**Why this is structural.** A cloud or RC client has no process to restart and no transcript file to copy. The equivalent capability must be a worker-side control request: `rewind_conversation`, `fork_conversation` (RC only), `side_question`. So the cloud/RC gaps here are **fillable only on the CLI/CCR side** (for example `fork_conversation` for cloud, or `rewind_files` over CCR). They cannot be filled from Desktop.

### 1.4 Control subtypes the main process sends

The SDK `Query` methods (SDKM:66748-68583) that the manager actually invokes, counted by call sites in CF:

- **Shared with cloud/RC:** `interrupt`, `set_permission_mode`, `set_model`, `apply_flag_settings`, `get_settings`, `get_task_output`, `stop_task`, `background_tasks`, `cancel_async_message`, `get_context_usage`, `submit_feedback`, `mcp_status`, `mcp_read_resource`, `read_file`.
- **Local only (never sent to cloud or RC by the web):**
  - `set_cwd` (CF:65233);
  - `rewind_files` (CF:91543);
  - `set_max_thinking_tokens` (thinking override, CF:54915);
  - `mcp_set_servers` (CF:79686), carrying in-process SDK MCP servers whose JSON-RPC rides `mcp_message` (SDKM:68354-68400, 68549-68583);
  - `mcp_toggle` (CF:36887), `mcp_reconnect` (CF:36501), `mcp_authenticate` (CF:36308), `mcp_clear_auth` (CF:36076), `mcp_oauth_callback_url` (CF:36372);
  - `reload_plugins` (CF:42855) and `reload_skills` (CF:100904);
  - `list_permission_rules` (SSH host rule lock, CF:57624);
  - `get_sandbox_dialog` (host sandbox check, CF:57978);
  - `generate_session_title` (CF:56826);
  - `ultrareview_launch` (CF:100296);
  - `remote_control` (CF:46087, previous report §7).
- **Methods the SDK has that the manager never calls:** `side_question` (side chats use a fork instead), `rename_session`, `claim_session`, `seed_read_state`, `get_plan`, `update_settings`, `reload_output_styles`, `set_prompt_suggestions_paused`, `set_chrome_browser_hints`, and the `get_*_dialog`/`export_conversation` family. Grepping all main-process chunks finds no caller.

**Judgement.** The local-only list is mostly **fillable** for cloud and RC: the CLI already implements every one of these subtypes, and only CCR forwarding plus a web client are missing. The exceptions are `mcp_set_servers`/`mcp_message`, which is **structural**: those servers are in-process objects in Desktop's main, and a remote worker cannot call back into them without a new relay.

---

## 2. Main-process features next to a session

**Keying rule.** Almost every feature is keyed one of three ways:
- **by local sessionId**: looked up in `lZ.sessions`, so a cloud or bridge id misses ("Session not found", null or a no-op);
- **by a local cwd or path**: session-agnostic, but it must be on this disk and pass `requireTrustedCwd` (`M/index.chunk-CxZMGoHL.js:745`);
- **by repo slug**: the PR panel only.

`findLocalSessionIdForBridgeId` (DL:3276) maps an RC bridge id back to a local session. That is how a *Desktop-hosted* session viewed as an RC row can reach every feature below. An RC session hosted elsewhere cannot.

| Feature | Main mechanism | Keyed by | Cloud / RC reach | Verdict |
|---|---|---|---|---|
| **PTY shell** (`startShellPty` …) | ShellPtyManager (D7:2306). Owner = the session in the pty key, or `"landing"`, else "Session not found" (D7:2320-2325). cwd = worktree or cwd. Env adds a `BROWSER` shim so URLs land in Desktop (CF:75507). Runs in the `pty-host` utility process (D7:640). A finished command refreshes the diff (CF:75582-75591). Branches for WSL and SSH | local sessionId | Not through this IPC. The web has a CCR terminal WebSocket (`/v1/code/sessions/{id}/terminal`, flag `ccr_v2_terminal_ws_web`; W/c03935b01-CyJKQj4N.js:181-240); which session types use it was not traced. RC: none seen | structural for the IPC; cloud already substituted; RC fillable (the host CLI would have to serve a terminal) |
| **`runBashCommand`** (`!` mode) | Runs **in Desktop**, not the CLI: a hidden per-session bash PTY (`shellPty.runCommand`, D7:4614; `startBashPty` D7:4181). The renderer wraps the output and sends it as a normal user message (W/cc43287c9:51678-51760). Renderer gate is `local && kind !== "wsl"` | local sessionId | none | structural for the Desktop PTY; fillable for cloud via the CCR terminal |
| **Git / diff** | `gitStatus` (CxZMGoHL) for info, diff, file content, commits and commit diff; stash/WIP-commit/discard/branch-conflict ops (DL:3311-3339, 4314-4334). Runs in the "Claude Desktop Git" utility process (MU:157768-157772, 120 s RPC timeout). `uv` watcher emits `git_state_changed` (CF:23396, 75610). `getUncommittedChanges*` branches on SSH (CF:47331) | cwd, plus trust | CCR substitutes: `get_workspace_diff`, `get_branch_status`, `push_branch` (cloud) | structural (data lives with the repo); per-file content, commit list and stash/discard over CCR are fillable as new subtypes |
| **`gh` / PR panel** | `GitHubPrManager` (CF:18729). Gets a token once via `gh auth token --hostname` (M/index.chunk-DYcTWSEO.js:1086), then calls REST/GraphQL directly. `mergePr` = REST merge with GraphQL merge-queue fallback (CF:23257-23310). `installGh` = `brew install gh` (CF:20866). Reads with an explicit `repo` skip cwd trust. Writes require `isRepoHeldBySessions`, i.e. a local checkout or a **local** session bound to the repo (CF:19471-19510: "Could not verify this repository against your sessions…"). GHES actions refused (DL:2206-2219) | repo slug (reads); repo plus local session (writes) | **Reads already serve cloud/RC** (renderer allows `remote`/`bridge` when `sourceAttested`; W/shared-18-D4XxL6Tg.js:5934-5941). Cloud writes go over a server path (mark ready, auto-merge; not merge). RC writes through LocalSessions should fail the ownership check unless a matching local checkout exists *(inferred)* | **fillable**: the data is a repo slug plus the user's token; only the local-ownership check blocks it |
| **PR auto-fix** | `AutoFixEngine` (M/index.chunk-D11XiLmx.js, started MU:398876) sweeps **local** sessions with bound PRs and reads CI, review and merge state with the gh token. It wakes the session with `sessionManager.sendMessage(id, "<ci-monitor-event>…", {initiator:"ci-monitor"})` (D11XiLmx:899-906, 1495) | local sessionId | none | **fillable**: the polling is session-agnostic; the wake could be a CCR user message *(inferred)* |
| **`getCrRefSummary` / `getCrCliStatus`** | Stubbed: the backing chunk is empty, returns null/"unsupported" (DL:4288-4307) | — | — | n/a in this build |
| **File access** | `ZB` SessionFileAccess (CF:51138) and `eV` placement (CF:53477). `readFileAtCwd`/`listDirectoryAtCwd` keyed by cwd. `readSessionFile*`, hash-checked `writeSessionFile` (CF:53340), `createSessionFile`, `listSessionDirectory` and media stream URLs keyed by session, with SSH branches. `watchSessionDirectories` is a per-window watcher emitting `sessionDirectoryChanged` (DL:2328-2340) | session or cwd | CCR has `read_file` (both), `list_directory` (cloud). **No** write, create, watch or media stream | reads structural (substituted); **write/create/watch fillable** as CCR subtypes |
| **`@` mentions** | `Resources.fetchMentionOptions` using the "Claude Desktop File Index" utility process (MU:219321-219331, 229967), keyed by a global *focused cwd* (MU:229618-229676) | focused local, SSH or WSL cwd | cloud/RC use the `file_suggestions` control request (1.5 s cap) | structural; the local index has no 1.5 s cap and works over the whole tree *(inferred)* |
| **Editors / reveal** | `wm.openInEditor` (CF:15991): `file/` URI locally, `vscode-remote/ssh-remote+host`, `vscode-remote/wsl+distro` (CF:16135-16157). `revealRemotePath` is WSL-only (DL:236-268). Show-in-folder and open-in-default-app go through local file access | path | none | structural for cloud; for an RC host reachable over SSH, the ssh-remote URI branch could be reused (niche) |
| **Framebuffer preview** | **Stubbed**: `listSources → []`, `attach` throws "not available in this window" (MU:371205-371216); this is the only implementation site | — | — | n/a |
| **Computer-use live preview / TCC** | `ComputerUseLivePreview` (MU:316911) streams *this* Mac's screen for a computer-use session. Capture comes from Cowork or a "remote CU session" of the device bridge (MU:316952-316956, 314842-314960). `ComputerUseTcc` covers Accessibility, Screen Recording and Mic (MU:316898). Files-and-folders TCC: on a `bun_cwd_eperm` spawn failure, the cwd is classified (Desktop, Documents, Downloads, iCloud, CloudStorage) into `session.tccFolderKind` (CF:104804-104812, 105153), and `openMacFilesAndFoldersSettings` deep-links System Settings (DL:4247) | local sessionId | none for Code-tab cloud/RC; the device bridge (Cowork/Dispatch) already lets remote sessions use this Mac's computer use *(inferred: not the Code tab)* | structural (TCC and screen belong to the process host) |
| **Local MCP and claude.ai connectors** | `applyMcpServerUpdates` (CF:101281-101400) builds three kinds of server: internal Desktop servers, Desktop-config stdio servers (can run on an SSH host), and claude.ai connectors via `ProxyMcpServerManager`. The connector kind is an **in-process MCP server** whose tool calls `POST {claude.ai}/api/organizations/{org}/mcp/servers/{uuid}/tools/call` (B5:17368, 17528-17545). All are handed to the CLI as SDK servers via `mcp_set_servers`/`mcp_message`. Toggle, auth and reconnect use the SDK subtypes in §1.4. `mcpCallTool`/`mcpReadResource` are Desktop-side calls for MCP-app widgets (CF:101212-101280) | local sessionId | none through this IPC; cloud connectors are attached server-side *(inferred)* | laptop stdio MCP: structural. **Connector toggle/auth/reconnect for cloud/RC: fillable** (existing CLI subtypes, forwarding missing) |
| **Worktrees** | `HK.ensureSessionWorktree` (CF:67780). Lazy worktrees (CF:4333, local-only). Folder worktrees `IK` (CF:66557, also remote). `WorktreePool` recycles parked worktrees per repo (M/index.chunk-Cw2oNaf4.js:216, 869). Kept-dirty worktrees with `discardKeptWorktree` and a reaper (CF:67571, 65945). Base-branch sync `XL` (CF:46939), also exposed as a model tool | local sessionId | cloud has its own container checkout; RC uses the host CLI's own worktree handling | structural |
| **Keep-awake** | One `powerSaveBlocker("prevent-app-suspension")` with claims: `code_turn` while a local turn runs, `code_session:<id>` for manual keep-awake, managed `keepAwakeEnabled` (MU:226089-226128, 226336, 226575). Activity counts turns, agent runs, RC-enabled and keep-awake (CF:54855-54870) | local sessionId | n/a | structural (it keeps the machine that runs the CLI awake) |
| **Notifications** | Local: main generates them from manager events (`queryCompleted` → `showIdleNotification({product:"ccd"})`, with ci-monitor and summary suppression; MU:383651-383700); closed when the permission resolves (DL:3745). Cloud: the **renderer** calls `DesktopNotifications.showNotification(…, "remote_requires_action")` (W/ce8ecfba4-N3pSpsqV.js:4383) | session events | cloud via renderer; RC excluded (previous report, not re-verified) | split is structural; **RC exclusion fillable** (same renderer path) |
| **Scheduled tasks** | `CCDScheduledTasks` service and `getSessionsForScheduledTask` (DL:3290): Desktop-run schedules that spawn local sessions, with `AskUserQuestion` disallowed (CF:84806) | task id | none | structural (needs a host); cloud has its own triggers |
| **`launchUltrareview`** | The `ultrareview_launch` subtype to the local query (CF:100281-100296) | local sessionId | none | fillable (forwarding) |
| **Dev-server preview (`Launch`)** | cwd-keyed `startFromConfig`. Also has `teardownRemoteSessionPreview`/`setRemoteSessionViewed` keyed by `session_<id>`, used by device-bridge preview tools (MU:327164-327173, 267270-267285) | cwd | not for Code-tab cloud *(inferred)* | fillable along the existing remote-preview line |
| **`createLogsHandoffBundle`** | Zips Desktop logs for a handoff; the sessionId is only a label (MU:302235) | — | any | session-agnostic |

---

## 3. SSH and WSL sessions: local features on another machine

### 3.1 Architecture

- **Query stays local.** The SDK `Query` stays in Desktop's main process; only `spawnClaudeCodeProcess` is replaced (CF:81191, DK:12038). A query error after a transport drop is logged as "treating as dormant, not crash" (CF:58682-58690). Every control subtype in §1.4 therefore still applies.
- **Helper daemon `claude-ssh`.** About 2.9 MB per platform, pinned to build `683cc6a9…`, base URL `https://downloads.claude.ai/claude-ssh-releases` (MU:97896-97929). Desktop downloads it locally, verifies sha256, uploads it over SFTP to `~/.claude/remote/`, and skips the upload when it is current (D3:199-342, 17573-17640).
- **Daemon start.** `claude-ssh --stop --socket S` then `--serve --socket S [--token-file …]` (D3:19255-19264). The run dir holds `daemon.lock` and one `children/<pid>.json` per CLI (D3:500-591).
- **Per-connection exec channel.** `claude-ssh --bridge --socket S` ("[BinaryDeployment] Bridge channel opened", D3:16733-16748) proxies JSON-RPC to the daemon. Desktop's `RemoteRPCClient` (DK:1140) calls `process.spawn`/`stdin`/`reattach`/`kill`, `files.*`, `git.*`, `launcher.resolve`, `plugins.prune` and `server.capabilities`/`ping` (DK:3405-3407).
- **The daemon owns the CLI children.** `parkSshLiveProcess` disowns the live process (CF:58532-58556). On the next spawn, `process.reattach` adopts the survivor and replays from a stdout checkpoint ("Reattaching session … to surviving remote process … (checkpoint seq=…)", CF:80630-80633).
  - Adoptable for up to 7 days with RC on, or 3 days if mid-turn. The adoption must match person, policy signature, host key and launcher (D3:542-560; M/index.chunk-DBPLojse.js:130-200).
  - Sessions still running at quit are re-adopted at launch (`readoptRunningSessionsOnHost`, CF:59176-59230).
  - Hosts with sessions active in the last 24 h are pre-connected (D3:563-576).
- **CLI on the host.**
  - The same pin as local, 2.1.299 (MU:97809).
  - Installed by `claude-ssh --install --cli-dir ~/.claude/remote/ccd-cli --cli-version <ver>-<hash12> --cli-keep 3`; the host fetches it itself (D3:18233-18263).
  - Fallback: Desktop downloads it and uploads with resumable SFTP (D3:18294-18320, 18597-18690).
  - Platform comes from probing `uname -sm` / `id -u` (D3:84, 113-125, 17014), including Windows hosts with PowerShell.
  - The host PATH `claude` is not used *(inferred: no path found)*.
  - A host-managed launcher is honoured via `launcher.resolve` (CF:26183-26340).
- **SSH engines.**
  - **Built-in ssh2.** `ssh -G` config evaluation, ProxyCommand spawned by Desktop (M/index.chunk-BxxgGLcw.js:21914, 22136).
  - **System OpenSSH.** A ControlMaster master plus multiplexed channels and an askpass relay (D3:695-14253, 12073-12107). Chosen by flag `3946462706`, managed `sshTransport`, or `CLAUDE_DESKTOP_SSH_TRANSPORT` (M/index.chunk-CjeJL9CL.js:270-327).
  - Passwords, passphrases and host-key prompts are queued and surfaced to the renderer (`onSSHPasswordRequired`, `respondToSSHPassword`, `declareSSHPromptKinds`; DL:2263-2275, 4602-4623). Host-key prompts are never shown from a background connect (M/index.chunk-BPH2yjvG.js:96-105).
- **WSL.**
  - The same controller with target `{kind:"wsl", distro}` (DK:12240-12256). The SSH connection is replaced by `wsl.exe -d <distro> --exec sh -c …` plus SFTP emulation (D3:15200-15255).
  - Same daemon and CLI deployment.
  - **No adoption** across a Desktop restart: the eligibility check returns `reason:"backend"` for non-SSH targets (M/index.chunk-DBPLojse.js:143-147, verified).
  - Fork, terminal and open-in-default-app are behind flags (CF:31942-31944, MU:226055, CF:53632).
- **Controller pool.** One controller per host key, pooled. It re-probes on network change and on resume or unlock (DK:12257-12439).

### 3.2 Feature retention

| Local feature | SSH | WSL | Path |
|---|---|---|---|
| Full control-subtype set, permission and dialog relay | yes | yes | local `Query` |
| Survive disconnect and app quit | yes (re-adopt) | transport gaps only | `process.reattach` |
| Git / diff | yes | yes | git on the host via the controller. `getSSHGit*` (pre-session picker, no trust check) and `getRemoteGit*` (trust-gated, root-confined) (DL:2386-2400, 4767-4912) |
| Files | yes | yes | `files.*`/SFTP (CF:53477) |
| Terminal | yes | flag | local PTY running `ssh -t … 'cd <cwd> && exec $SHELL -l'`, or master channels; job state read from `/proc/<pid>/stat` on the host; resize via `stty` (D7:1153-1167; CF:58634-58680) |
| Worktrees | on host | on host *(inferred)* | `git.worktree_create`, `IK` (CF:66557) |
| Desktop stdio MCP | runs on host | in distro *(inferred)* | `planHostRunServers` / `SshMcpServerManager` (B5:18453-18497); non-forwardable env withheld |
| Desktop extensions (DXT) | no | no | "those run on this computer only" (M/index.chunk-CcaAhFZy.js:880-888) |
| claude.ai connectors | yes | yes | re-sent (`reconcileRemoteMcpServers`, CF:35467), with per-host "always allow" grants bound to the observed host key (`sshHostToolGrants`, CF:26814-27003) |
| In-process Desktop tools (computer use, PR, view) | yes | yes | SDK servers on the local `Query` (B5:2332-2340); computer use drives **this Mac** *(inferred)* |
| `ccd_directory`, Claude Browser, simulators | no | Browser behind flag | B5:4384, 15868-15872; M/index.chunk-xqxtf5CS.js:4236 |
| Fork | yes (host-side copy) | flag | CF:31043-31120, 31939-31944 |
| Change cwd | no | — | CF:65084 |
| Transcripts | local mirror | local mirror | host JSONL byte-synced to `projects/ssh-<id>/…` (CF:61086-61200, 62439) |
| Open in editor | VS Code ssh-remote | VS Code wsl+ | CF:16135-16147 |
| RC toggle on the session | yes | not checked | CF:45695, 46323 |
| Cold send while host unreachable | held and delivered on reconnect | same | `$k.holdColdSend`, `Rk.deliverColdHolds` (CF:33395-33960) |
| `restartRemoteSession` / `reinstallRemoteClaudeCode` / `restartRemoteHelper` | idle restart (refused mid-turn, RC-bound or with held input) / re-install after a failed launcher check / "Update now" for a helper too old for the managed launcher | same | CF:81362-81560 |

### 3.3 Policy

- **3P `self-hosted-only`** denies `device` and `sshHost` (MU:55197-55227).
- **Managed `sshHostAllowlist`**: a malformed value allows nothing (MU:182482-182520).
- **`disableDesktopLocalSessions`** denies only `device`, so SSH stays allowed (MU:55235-55240).
- **`disableWslSessions`** (MU:48541).

### 3.4 SSH versus RC

| | SSH or WSL session | RC session viewed in Desktop |
|---|---|---|
| Who hosts the `Query` | Desktop main | the CLI on the other machine; the web adapter is a remote SDK host over CCR |
| Control surface | full local set | the reduced CCR set (previous report §4.2) |
| Durability | the `claude-ssh` daemon owns the process; Desktop re-adopts it | the CLI owns the session and reconnects to CCR itself |
| Reachability | needs SSH reachability from this Mac | works from anywhere through Anthropic |
| Who sees it | only this Desktop | phone, web and other Desktops |
| What the other machine must have | sshd | a running CLI with RC on |

For "drive another machine with local-session features", SSH is the stronger path in Desktop. RC is the path for multi-client reach. Both differences are **structural**: they follow from who hosts the `Query` and over which transport.

---

## 4. External CLI sessions

- **Discovery** (CSP:97-236):
  - The CLI writes `~/.claude/sessions/<pid>.json` registry entries (pid, `procStart`, `kind`, `bridgeSessionId`, `messagingSocketPath`).
  - Desktop computes liveness by PID plus process start time, with staleness tolerance.
  - It enumerates transcripts and lists sessions with title and branch only for trusted cwds (`listCliSessions`, CSP:384-438).
  - Gated by flag `LZ("1985233154")` (DQ:42-44; DL:98-108).
  - **Not read:** what `messagingSocketPath` is for. No main-process consumer exists.
- **`openCliTail`**: a read-only tail of the transcript. Uses `fs.watch` plus a 1.5 s size poll, signals `appended` or `resync`, and requires a trusted workspace (CSP:237-330, 572-613).
- **`readCliTranscript`**: paged read of the JSONL (CSP:439-462).
- **`resumeCliSession` / `previewCliResume`**: adoption. Refused while the CLI's writer is live (`liveOwnershipRefusal → Running`), when the folder is missing, or when the workspace is untrusted (CSP:464-560). On success, Desktop imports the transcript under `local_<cliSessionId>` and from then on hosts it as a local session (`adoptCliSession`, CF:106003-106200).
  - **Structural.** Two SDK hosts cannot drive one CLI process. Desktop has no channel into a running terminal CLI, and the registry's `messagingSocketPath` is not used.
- **`enableCliRemoteControl`**: throws in every case (DQ:46-48 via DL:109-115; CSP:569-571). This is a **fillable** gap, and the plumbing appears planned: the registry already carries `bridgeSessionId`.
- **`registerExternalSession`**: not an IPC method. It is the import path for claude.ai history and terminal-session imports (`[claude-ai-import:local-scan]`, `terminal-sessions`; MU:389880, 390813-390852, 391308, 394794). It moves a staged transcript into Desktop's staging dir under a **fresh** CLI session id and creates a session record (CF:94609-94720).
- **`teleportToCloud` / `getTeleportPlan` / `getTeleportReadiness`** (CEE:564-2140, DL:4528-4580):
  - Refused when the deployment has no claude.ai cloud sessions.
  - Two transports:
    - **`push`**: push the branch to origin.
    - **`snapshot`**: commit the working tree (optionally including untracked files) and push it to a transport ref on origin with `git push --no-follow-tags <url> +<sha>:<ref>` (CEE:1100-1170).
  - Then it summarizes the local transcript with a model call (falling back to the user messages) and stops the local session. It creates the cloud session with `POST /v1/code/sessions` (flag `133902057`) or `/v1/sessions`, with headers `ccr-byoc-2025-07-29` and git sources/outcomes (CEE:1552-1890).
  - **The conversation is carried as a summary, not a transcript**: a one-way, lossy move. Moving the full state would be fillable server-side; the summary approach is a design choice, not a constraint.

---

## 5. Feel of use: what bounds latency for local sessions

- **Prewarm.**
  - **`prewarmLocal`**: with a cwd, starts a hidden **SDK spare** process (`prewarmSpare`, CF:86849-87060). It is built from the base query config with `spare:{mode:"prewarm"}` using the SDK's `prewarm` export, and the `sdk_spare` is claimed on first send with `{prompt, options}`.
    - TTL `jX = 600000` ms (10 min); claim timeout `NX = 30000` ms (CF:73500-73502; CF:87176-87227).
    - Diagnostics record `spareWaitMs`, `spareClaimMs` and `prewarmLeadMs`.
    - Without a cwd it falls through to `prewarmFolderless` (DL:3828-3870).
  - **`prewarmFolderless`**: creates a scratch workspace and starts a hidden prewarm session (`prewarmHidden`, DL:2690-2750).
  - **`warmSession`**: starts or resumes the process for an existing session without a message (CF:92370-92470). The first send then skips spawn and MCP setup. It is skipped when:
    - the session is crash-loop parked;
    - the SSH host is backing off;
    - unattended use is not admitted;
    - a rewind is pending.

    It is also fired on relaunch auto-resume for marked sessions (CF:78885-78993).
  - **`prewarmAuth`**: warms the base query config, i.e. OAuth and token (CF:91956-91964).
  - Cloud and RC sessions have no equivalent: the worker is already running or is the server's job.
- **Process lifecycle** (CF:14636-14660, 75159-75236):
  - **Concurrent CLI cap:** `lp = max(6, floor(totalmem / 3 GiB))`.
  - **`CliGovernor`** samples free memory. Under pressure it evicts the LRU idle session (`pauseSession(…,"governor_evict")`), excluding running, cron, loop-wakeup and connected-lanyard sessions, and RC-enabled sessions unless pressure is high.
  - **Idle timeout:** 15 min for unattended sessions; otherwise flag `4041267332` (0 = none).
  - Reopening an evicted session pays a respawn plus `--resume`. A cloud session pays nothing comparable, but pays network latency on every read.
- **Transcript loading.**
  - **Source.** Desktop reads the CLI's JSONL on local disk. There is no server history.
    - `getTranscriptTail` is capped at 500 rows (CF:62290-62410).
    - `getTranscriptPage` defaults to a 1000-row window from the file's end (`readNewestTranscriptPage`, CF:62128) and falls back to a full read.
    - A pending rewind uses its own tail (CF:62353).
  - **`requestTranscriptPort`** (gate `613003975`, CF:74039):
    1. Desktop opens a `MessageChannelMain`;
    2. hands one end to the renderer and the other to the "Claude Desktop Transcript Reads" utility process (MU:157774-157777);
    3. rows then flow worker → renderer **without passing through main**, and the reply says `via: Port|Inline` (CF:63057-63300);
    4. ports rebind if the worker exits.

    `prewarmTranscriptReads` starts the worker when the session list loads (DL:2655-2660).
  - **Contrast:** cloud and RC history comes over HTTP paging and a live stream (previous report §2.5).
- **Switch timing** (`reportSwitchTiming` …, DL:3109-3150 → CF:95213-95262, 46729-46780): telemetry only (`desktop_ccd_session_switch_timing` with first-paint, IPC, mount and tail-read breakdowns). It covers all session types: the `session_type` enum is `local|remote|bridge|cli` (MU:195617). For non-local types main has no record, so `backend_kind` is empty.

**Judgement for §5.** The local advantages (warm spares, disk-tail reads, port delivery) are **structural**: they need the process and the file. The local disadvantages (process cap, eviction, respawn on reopen, a CLI that lags the server) are also structural. Cloud first-paint latency could be improved by caching (fillable, renderer side), and that is outside this slice.

---

## 6. Not verified / open

- Which renderer surfaces use the CCR terminal WebSocket for cloud sessions (W/c03935b01). The renderer agent covers this.
- The server-side PR write path for cloud sessions (W/c219730b0:1818-1824).
- What the CLI's registry `messagingSocketPath` is used for, and whether any client uses it.
- The internals of the `claude-ssh` daemon (binary not in the bundle), and which env keys carry auth to the host CLI.
- RC exclusion from Desktop notifications (previous report, not re-verified here).
- What triggers `applyModelByRestart` in the UI (*inferred*: a model that needs a newer CLI than the one running).

---

## 7. Corrections from a later SSH lifecycle read (2026-10-19)

A reader of the stopped SSH-checklist pass re-read SSH lifecycle code. These are its corrections to §3 and §5, spot-checked at BLG:46, B5:20976, CF:33242-33246, CF:59233 and D3:18310-18345. The prefixes are as above, plus BLG = `M/index.chunk-BLGnZDpZ.js` and DBP = `M/index.chunk-DBPLojse.js`. The protocol itself is covered in [desktop-ssh-helper-protocol.md](desktop-ssh-helper-protocol.md).

1. **A transport drop does not end the Query.**
   - Keep-live is on by default; the killswitch flag is `717163759` (BLG:46).
   - The `RemoteProcess` goes "detached (until rebound)". It nudges a rebind after 60 s, doubling to 30 min (DK:2798-2840), then calls `process.reattach {id, fromSeq}` and replays stdout (DK:2514-2560).
   - "Treating as dormant" (CF:58682) applies only when the Query really ends within 60 s of a drop (CF:104624-104680).
2. **The cold-send hold is SSH-only.** `Tk` requires `backend.kind === "ssh"` (CF:33242-33246), and `holdColdStart` refuses WSL (CF:34032).
3. **The launch preconnect is not keyed on "active in the last 24 h".**
   - It dials the 3 most recently used saved SSH hosts, plus hosts with re-adopt candidates or waiting input (CF:59233-59330).
   - The 24 h / 7 d / 3 d predicate (D3:472-505) is `hostMayHaveLiveRemoteProcessNow`. It stops a silent daemon from being restarted.
4. **The process cap, LRU eviction and idle pause do not apply to SSH sessions** (B5:20973-20978, BLG:46-48, CF:75162-75183). WSL sessions do count toward the cap (B5:21022).
5. **CLI install order.** The host fetches the CLI only when Desktop has no cached archive (D3:18311-18316); otherwise Desktop uploads it over SFTP. WSL is the reverse (D3:18424-18466).
6. **Excluded for SSH sessions:**
   - prewarm: renderer `zY` requires `!e.remote` (CC43:15127-15130), and `prewarmSpare` refuses with `remote` (CF:86880-86895);
   - `applyModelByRestart`: throws for remote sessions (CF:100537-100539);
   - `getClaudeCodeRestartVersions`: returns `{}` (CF:25605-25619).

   So there is no restart-to-update offer. The host CLI changes only when Desktop's own build pin changes.
7. **`restartRemoteSession`** restarts a live process only while MCP config waits for a host restart (CF:81470-81506). Its other entry is the `ssh_reattach_blocked` card (CF:81523).
8. **Quit dialog.** It skips SSH survivors unless input is held (MU:134595-134620; CF:76480-76506). At launch Desktop re-adopts at most 8 sessions, mid-turn ones first (CF:59138-59230).
