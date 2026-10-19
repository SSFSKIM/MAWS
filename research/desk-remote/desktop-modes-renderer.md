# Claude Desktop Code tab, renderer side: how local, cloud and Remote Control sessions differ

Companion to `claude-ai-rc-client-protocol.md` (same directory), which covers cloud vs RC at the protocol level. This note covers the web UI that Desktop ships (`app-2.42304.0`): how it decides a session's kind, what each kind gets, why, and how each kind feels to use.

## Build and method

- **Build:** `~/claude-desktop-re/readable/app-2.42304.0/`. All analysis is static.
- **How the work was split:** I mapped the kind predicates, the env-type tables and the adapter capability objects myself. Four parallel readers covered side panes, the composer, session controls and transcript actions, and lifecycle plus feel of use. I re-read their load-bearing claims in source; the list is in §7. Anything not read in source is marked *(inferred)*.
- **"Desktop" vs "browser":** in this note, "Desktop" means the web bundle running inside the Electron shell. Several gates behave differently in a browser at claude.ai/code; those cases are called out.

**Citation prefixes.** The first block is the same as in the previous report. Expand them to `readable/app-2.42304.0/…`.

| Prefix | File | What it is |
|---|---|---|
| `W/` | `web/app/v1/` | web app chunks |
| `M/` | `main-process/` | Desktop main process |
| `S104` | `W/shared-104-Cqo2-vQh.js` | sessions API |
| `EPI` | `W/c5da7eb42-B8cTG8SI.js` | code-session adapter ("epitaxy"), shared by cloud and bridge |
| `SDK` | `W/c30db9bec-DjF3pT_h.js` | Agent SDK browser build |
| `STORE` | `W/c06cf64bb-BE5q2vSr.js` | transcript store |
| `SEND` | `W/c6b8adeaf-C5Aww7gq.js` | send mutation |
| `CC43` | `W/cc43287c9-DAfOi8yP.js` | composer and start flow |
| `MU` | `M/index.chunk-muI2IV6k.js` | main-process core |
| **New in this note** | | |
| `C227` | `W/c227f4d5e-Ba-r--Rl.js` | composer `+` menu, permission-mode menu, RC toggle |
| `CTX` | `W/c5cd1b4dc-jDcYG_fG.js` | gate context, env-kind function, RC-offline detector |
| `LOC` | `W/cef1e6037-8DivyY4m.js` | local session adapter (IPC) |
| `RES` | `W/c11959232-Dx4NfIyJ.js` | session-ref resolver, side-pane enablement |
| `HDR` | `W/c73f45bc3-CFrHin0p.js` | session header, View menu |
| `PICK` | `W/c9543da06-DX8mZLsD.js` | model, effort and fast-mode pickers |
| `CMDS` | `W/cc183b3ab-BlACljsv.js` | slash-command registry and its gates |
| `RW` | `W/cc8941b7b-CZT9QwXr.js` | rewind |
| `TX` | `W/c96d752d0-BOCqU7c2.js` | transcript renderer |
| `S8`, `S11`, `S14`, `S18`, `S19`, `S52`, `S78` | `W/shared-8-B5lJ8U5C.js`, `W/shared-11-BuQ3CK5I.js`, `W/shared-14-u0TSV9dR.js`, `W/shared-18-D4XxL6Tg.js`, `W/shared-19-CkPOiIKm.js`, `W/shared-52-DGviI8xb.js`, `W/shared-78-D6VXYXaQ.js` | env-type tables, session list, error copy, PR panel, row menu, backend capabilities, Desktop app features |

Other chunks are cited by their hash prefix, for example `W/cd54a5401`; the full name is in the directory listing.

---

## 0. Load-bearing findings

1. **Kind is decided in three layers, and they don't fully agree.**
   - The **session ref type** (`local` / `cli` / `bridge` / `remote`) comes from the id prefix and session meta (RES:5107-5160).
   - The **env kind** (`local` / `ssh` / `wsl` / `bridge` / `pool` / `byoc` / `anthropic_cloud` / `project`) is derived from the ref type plus meta (CTX:3888-3906).
   - EPI keeps a **per-session transport class**: `bridge` (set `Z`), `cloud` (set `qC`) or `other` (EPI:9391-9458).
   - Self-hosted runner pool sessions fall in EPI's `other` bucket. They miss every feature gated on the cloud set (cancel-queued, browser tools, MCP-app widgets, the SSE stream), even though the permission-mode table treats them like cloud.
2. **Most of the gap is client policy, not protocol.** RC sessions run a full CLI on a real machine, and most RC gaps sit behind explicit client kind checks that the worker would accept.
   - Examples: fast mode is hidden (PICK:2036), queued-message cancel is cloud-only (EPI:9591), there is no files tree (EPI:9202), no terminal (EPI:9420), no native notification (`W/c101fef3f`:4657), no plugins or Chrome (C227:11066, S8:22789), and the advisor value is never read (EPI:14200).
3. **Cloud lacks what RC has in a few places, and the reasons differ.**
   - Fork has no cloud path (EPI:14456 `if (!Z.has(e)) return unsupported`), which is close to structural: forking needs a host that can spawn sessions.
   - Cloud's permission menu is flag-shaped: `["acceptEdits"]` only, unless `ccr_plan_mode_enabled` (then `default`/`plan`, plus auto). Bridge gets `default`/`acceptEdits`/`plan`, plus auto (S8:22451-22457, 22903-22940).
4. **What only local sessions get falls into two groups.**
   - **Structural** — it needs the Mac's process, files or PTY: `!` bash (`LocalSessions.runBashCommand`), add-folder pickers, file editing and saving, the local MCP server dialog, Launch dev-server preview, the rewind extras (undo/redo marks, file restore), bypass permissions, ultrareview, and IPC-only queue controls (reorder, steer-now).
   - **Fillable** — the protocol already has a control_request that the cloud/RC adapter never sends: `rewind_files` (SDK:60624), `add_directory`, `mcp_toggle` / `mcp_reconnect`.
5. **Feel of use differs most in send and stream.**
   - **Local.** Transcripts come over a MessagePort/IPC lane from main (LOC:668-760), and live events arrive on one multiplexed `LocalSessions.onOnEvent` (LOC:1208-1225). The state reads `connected` immediately with no backoff; with no attachments, the send goes to IPC before any echo is drawn (`dispatchFirst`, SEND:1972-1975). There is no durable outbox; main holds failed sends.
   - **Cloud and RC.** History is paged over HTTP, live events come over SSE (cloud) or the v1 WebSocket (RC), and sends use an optimistic echo with a sessionStorage outbox.
   - RC also has a client-side offline detector and a "Continue in cloud" escape hatch.
6. **Some previous-report claims need correcting** (§6):
   - `/btw` side chat is cloud **and** RC, not RC-only.
   - RC does send `mark_read`.
   - Fork is local and RC.
   - Fast mode on RC is hidden, not merely stripped.
   - Cloud needs CLI ≥ 2.1.274 for fast mode.
   - `/memory`, `!` and `/cd` gates are kind checks with different SSH/WSL treatment than reported.

---

## 1. How the client decides a session's kind

### 1.1 Session ref type (`{id, type}`)

`um()` resolves the ref type (RES:5107-5160):

| Condition | `type` |
|---|---|
| id starts with `local_cli_` (`Ao`, S11:821-823) | `cli`: a Claude Code CLI session on this Mac that Desktop mirrors from `listCliSessions` |
| other `local_*` id, or no id | `local`: a Desktop-hosted session over `LocalSessions` IPC; includes SSH and WSL |
| meta is a `shared_session` wrapper (`MT`, S104:14533) | `remote` |
| `TT(meta)` (S104:14493): `environment_kind === "bridge"`, or, when the kind is absent, empty `environment_id` with no pool, a title, and status not `pending` | `bridge` |
| `environment_id` is in the active bridge-environment set | `bridge` |
| otherwise | `remote` (unresolved until the list or meta settles) |

The full ref union is `["local","remote","bridge","cli"]` (`W/c10f0af0c-E4ruBQ4W.js`:40897).

**`cli` refs are read-only.**
- Every mutating adapter method throws "Terminal sessions are read-only in the desktop app." (EPI:4348, 4530-4551).
- The transcript is read through `readCliTranscript`/`openCliTail` and refreshed on `cli_transcript_appended` or `cli_transcript_resync` events (EPI:4370-4500).

### 1.2 Env kind

`Gs(ref, meta, fallback)` (CTX:3888-3906; imported as `dv` in C227) maps the ref type to an env kind:

| Ref type | Env kind |
|---|---|
| `local` or `cli` | `meta.remote.kind ?? "local"`, which gives `ssh` or `wsl` for remote-host local sessions |
| `bridge` | `bridge` |
| `remote` | `pool` if `meta.selfHostedPoolId`; `byoc` if `environmentKind === "byoc"`; else `anthropic_cloud` |

**The start composer uses a different classifier.** For environments, before a session exists, `KL` (S8:22880-22897) applies these rules in order:
- worker type `pool` → `pool`;
- environment id `"__local__"` → `local`;
- an SSH or WSL environment id → `ssh` / `wsl`;
- a bridge environment → `bridge`;
- `kind === "byoc"` → `byoc`;
- otherwise `anthropic_cloud`.

The env kind feeds a family of pure capability tables (S8:22760-22940):

| Fn (export) | true for | Used for |
|---|---|---|
| `FL` (`Bt`) | local, ssh, wsl | local-machine draft features (CC43:50250) |
| `IL` (`zt`) | local and ssh only if IPC `setMcpServers` exists; wsl only with a flag and that IPC; every remote kind | connector toggles in the `+` menu (C227:11001) |
| `LL` (`Vt`) | local, ssh; `anthropic_cloud` only with `marble_sparrow` | plugins (C227:11239; CTX:3932) |
| `RL` (`It`) | bridge, anthropic_cloud, byoc, pool | "is remote" for attachment UI (CC43:50621) |
| `zL` (`Ht`), `VL`/`BL` (`Pt`) | local, ssh, wsl | local-only draft affordances (CC43:17996; PICK:4750) |
| `WL` (`Ft`) | byoc, pool | self-hosted env specifics (CC43:11703) |
| `GL` (`Ut`) | local, ssh, wsl, bridge | "has a real machine" (repo grouping key C227:20054; `Pu` C227:19992) |
| `HL` (`Lt`), `UL` (`Rt`) | always `false` | stubbed capabilities *(inferred: features compiled off)* |
| `qL` (`Wt`) | — | the permission-mode list per kind (§2.4) |

`project` (a project composer) is a seventh env kind that the tables treat as remote.

### 1.3 EPI's per-session transport class

The cloud and bridge sessions share one adapter. On each meta update, `$C` (EPI:9428-9458) classifies the session:

| Meta | Class |
|---|---|
| shared session | `mS.add` (viewer-only), class `other` |
| `TT(meta)` | `HC` → set `Z` (bridge) |
| `environment_kind` `anthropic_cloud` or `byoc` | `QC` → set `qC` (cloud) |
| else, which includes pool *(inferred: pool meta carries `self_hosted_runner_pool_id` and a non-cloud kind)* | class `other` |

Most per-feature gates are built from these sets:

| Helper | Definition | Gates |
|---|---|---|
| `ew`/`iw` (EPI:9461, 9476) | class `cloud` and not bridge | SSE selector `ow` (9499), browser tools, MCP-app widgets (`tw`, plus `__gb__2613657492`) |
| `vC` (EPI:9202) | `__gb__3098969594` and not shared and (not bridge, or cloud) | `list_directory` (files tree) |
| `uw` (EPI:9519) | (not bridge, or cloud) and `__gb__302592060` | kill switch for cloud reads: `read_file`, `file_suggestions`, task output |
| `Qw` (EPI:9591) | in `qC` and CLI ≥ `Xw` = 2.1.76 | `cancel_async_message` |
| `qw` (EPI:9576-9586) | bridge → `Kw` = 2.1.255, else `Gw` = 2.1.137 | `background_tasks` |
| `pw` (EPI:9529) | bridge and not `cw()` | bridge-specific connect handling (13592) |
| `nT` (EPI:9609-9618) | CLI < `tT` = 2.1.198, or below a feature's `minCliVersion` | worker-diff and other version floors |

### 1.4 Adapter capability objects

Each adapter declares a `capabilities` object, and the UI reads it for the queue bar, unarchive, worktree, tail and context features:

| Flag | local `Z` (LOC:1581-1594) | cloud + bridge (EPI:12694-12706) | cli mirror `Dg` (EPI:4400) |
|---|---|---|---|
| `cancelQueued` | IPC `cancelQueuedMessage` present | `true`, but the method returns false unless `Qw` | false |
| `cancelQueuedNeedsConfirm` | false | **true** | false |
| `reorderQueued` | IPC `reorderQueuedMessage` present | **false** | false |
| `sendSteeredNow` | IPC `sendSteeredNow` present | **false** | false |
| `unarchive` | IPC `unarchive` present | true | false |
| `discardKeptWorktree` | IPC present | false | false |
| `fetchTail` | false | true | false |
| `fileSuggestions` | false (uses IPC `Resources.fetchMentionOptions`) | true | false |
| `readMedia` | false (uses IPC) | true | false |
| `backgroundTasks` | IPC present | true (version-gated by `qw`) | false |
| `contextUsageSummary` | IPC `getContextUsageSummary` present | false | false |

So the local capabilities are **feature detection on the IPC surface**: an older Desktop main process simply lacks the method. The remote flags are hard-coded and refined per session by the §1.3 helpers.

### 1.5 Other kind predicates the UI checks

- **`cj({isLocal,isBridge})`** (C227:10700-10722) drives "Only available in local sessions" (`SRfvtxpa+5`).
  - It returns null when not in Desktop (`xe()` is shared-25 `ml`, a desktop user-agent test, shared-25:2922), or when the session is local or bridge.
  - So in **Desktop** a cloud session sees the item disabled with that tooltip. In the **browser** the same item is simply omitted. For **bridge** sessions the item is omitted outright (the callers `continue` or skip).
  - The callers disagree on WSL:
    - `pj` (connectors, Chrome, plugins) passes `isLocal: f === "local" || f === "ssh"` (C227:10913-10916), so WSL sessions get the "local only" tooltip there.
    - The add-folder caller passes `isLocal: n.type === "local"` (C227:11510-11512), so WSL is local and `cli` mirrors get the tooltip.
    - *(Inferred: an inconsistency, not a deliberate WSL policy.)*
- **`nc(ref)`** (CTX:4039-4053) collapses the kinds: `local` → `"local"`, `remote` and `bridge` → `"remote"`, `cli` → null. The side chat and slash-command gates read it.
- **`isLocalSession = id.startsWith("local_")`** (CTX:4224) is the slash-command registry's notion of local. SSH, WSL and `cli` all count as local there.
- **The backend capability object** `fN({backend, onThisDevice, served})` (S52:19893-20010) is not per-session. It differs only in Desktop's self-hosted-execution mode (`backend` other than `ccr`):
  - `transport.websocket: false`;
  - `permission_modes.available` from the host;
  - `session_files.files_api: false`;
  - `vcs.github_sync: false`;
  - `sessions.lists_repositories: true`.

  Its `permission_modes.available` overrides the cloud permission list (§2.4).

---

## 2. Feature matrix

Legend:
- ✓ available; **hidden** = not rendered; **disabled** = rendered greyed out, with the copy given.
- "local" includes SSH and WSL unless noted.
- Gate classes:
  - (a) explicit client kind check;
  - (b) worker capability or CLI version;
  - (c) server or flag gate;
  - (d) no transport (the feature calls a Desktop IPC method that has no control_request or HTTP equivalent).

### 2.1 Side panes

The pane set is diff, file, artifact, terminal, plan, tasks, subagent, session (side chat), runs, pr, cr, framebuffer, preview and simulator (`W/c03935b01`:2701-2714). The main pane enablement is `Bf` (RES:3076-3112); the View menu applies the same gates (HDR:5611-5950).

| Pane | local | cloud | bridge | Gate on the missing side |
|---|---|---|---|---|
| Terminal | Desktop PTY. App feature `chillingSlothFeat`; SSH needs `chillingSlothSshShell`, WSL needs `wslTerminal` (S78:18485-18677; EPI:19438-19443) | WS `/v1/code/sessions/{id}/terminal` (`/v2/ccr-sessions/…` without `ccr_v2_terminal_ws_web`). Needs `ccr_cardboard_truck`, owner only, not withheld (EPI:19426-19445; `W/c03935b01`:180-186) | **hidden**: `zN` has only `landing`/`local`/`remote` arms (EPI:19420-19446) | bridge: (a)+(d). No server terminal endpoint for bridge and no PTY control_request. Fillable only with new worker support |
| Preview | Launch dev-server preview: local, kind known, not SSH; WSL needs `wslPreview` (RES:3101; S78:18686) | A **Desktop-hosted browser pane** (`Launch.startRemoteBrowserPreview`, EPI:2151-2207) driven by browser tools injected only for `iw` sessions (EPI:9476, 13257). Flags `sink_planter_vase` or `__gb__2035791980` plus org policy (S78:18823-18866). Not a preview of the container's dev server | **hidden** unless a `previewServerId` is already bound (RES:3101-3106) | bridge: (a) `iw`. The browser runs in Desktop, so this is fillable |
| Files tree | IPC `listSessionDirectory` / `listSSHDirectory` / `listRemoteDirectory` (`W/cfac349aa`:70-110) | `list_directory`, gated by `__gb__3098969594` and **Desktop app feature `selfHostedSessions`** (`UN()` = `pe() && !flag`, EPI:19463-19476; app feature set at S78:9361). So in a browser cloud gets no tree | **search only**: the pane exists (not `ccr_epitaxy_disable_bridge_host_reads`, connected; EPI:19467), but `vC` excludes bridge, so no tree. "Search files…" uses `file_suggestions` (`W/cccc2cf0a`:5136-5139, 5654-5660) | bridge tree: (a) `vC`. The worker serves `list_directory`; fillable |
| File viewer | IPC `readSessionFile` | `read_file`, contained to session roots | `read_file`, **no containment** (EPI:12575). Failure copy: "This file lives on the machine running this Remote Control session, and it couldn’t be loaded from here…" (`W/cd2efac6e`:6056) | — |
| Edit / save | IPC `writeSessionFile` (`W/cd2efac6e`:4281) | **disabled**: "This file can’t be saved. Its path is outside the working directory, or this is a remote session." | **disabled**, same copy | (a) `type === "local"` plus (d): no write-file control_request. Fillable only with new worker support |
| Diff / changes | IPC `getGitDiff` / `getSSHGitDiff` / `getRemoteGitDiff` (EPI:796-880) | GitHub compare from server `branch_statuses` (`W/cb61be3a2`:551-584). Worker `get_workspace_diff` only in pane / cloud-row modes (C227:1242-1265) | GitHub compare plus worker diff per repo row (S104:24914) | (c) `ccr_epitaxy_disable_bridge_workspace_diff`, which despite its name covers **all** remote sessions (EPI:14592). (c) `__gb__2023598694` turns off the cloud worker diff under github_sync. (b) CLI ≥ 2.1.198 (`tT`), and ≥ 2.1.280 for cloud under github_sync (S104:24941) |
| Commit / push band | none (commit/stash IPC exists only for branch switching) | Only `type === "remote"` **and** org env-provider capability `vcs.push` (`W/c96d752d0`:40424-40431; S52:20460). Effectively self-hosted. Copy: "Your organization’s infrastructure doesn’t support pushing from here yet. Ask Claude to push instead." | **hidden** (`type !== "remote"`) | bridge: (a). `push_branch` is a plain control_request; fillable |
| PR pane | `epitaxy_pr_panel` plus IPC `getPrOverview`; status through IPC `getPrStateForBranch` (`gh`) (`W/c28ee0d82`:5-7; EPI:17797) | Opens only if the repo row is `sourceAttested` (S18:5934); status from server `branch_statuses` (EPI:17784) | same as cloud | (c) and attestation; no kind gap between cloud and bridge |
| Tasks | Driven by transcript data. Stop, output and background over IPC | `stop_task`; output through `read_file{taskOutput}` or `get_task_output`; `background_tasks` needs CLI ≥ 2.1.137 | `stop_task` and `read_file{taskOutput}` work; **`get_task_output` returns null** (EPI:14847-14859); `background_tasks` needs CLI ≥ **2.1.255** | (a) for `get_task_output` (partial gap; "Output unavailable", `W/cccc2cf0a`:14792). (b) `Kw`/`Gw` |
| MCP servers dialog | `e?.type === "local"` (CC43:40692); IPC `mcpReconnect`, `mcpEnableServer`, `mcpAuthenticate` | **absent**; `/mcp` routes to Settings › Connectors (CC43:51232-51254) | **absent**, same routing | (a)+(d). The SDK has `mcp_toggle`/`mcp_reconnect`; the remote adapter never sends them. Fillable |
| MCP-app widgets | local SDK path | `mcp_status` + `mcp_read_resource` when `tw` (cloud plus `__gb__2613657492`; EPI:9460-9465, 12349) | **excluded** (`ew`) | (a) |
| Plan / subagent panes | content-driven; no kind gate (`W/c1ebb1aa4`:779) | same; ultraplan is display data only (`is_ultraplan_mode`, EPI:10597) | same | — |
| Context meter | IPC `getContextUsage`, plus the cheaper summary call | `get_context_usage`, no kind gate (EPI:14169) | same as cloud | — |
| Runs | local `scheduledTaskId` (HDR:5480-5518) | trigger-spawned sessions | **hidden** | structural: bridge sessions have no routines or triggers |

### 2.2 Composer

| Feature | local | cloud | bridge | Gate |
|---|---|---|---|---|
| `+` › Slash commands | ✓ | ✓ (wakes the session) | ✓ | — (C227:11360-11366) |
| `+` › Attach | "Add files or photos"; SSH files need `ssh_file_attachments` plus host `sshAttachmentTransport.status === "supported"` | "Add files or photos" if `ccr_file_attachments`, else "Add image" (png/jpeg/gif/webp) | same as cloud, with **no CLI-version check** for files | (c) (C227:11606-11622; CC43:50050-50070, 54510) |
| `+` › Add folder | IPC `FileSystem.browseFolder` → `LocalSessions.addDirectories`; SSH uses a remote picker via `listSSHDirectory` (CC43:51347-51440) | **disabled** in Desktop: "Only available in local sessions"; hidden in the browser | **hidden** | (a) `cj` plus (d). `add_directory` is never sent to remote kinds; `/add-dir` typed as text reaches the CLI. Fillable for bridge |
| Folder drag-drop | ✓ | ignored | ignored | (a) `folders` set only for local without `remote` (CC43:54641, 54656-54721) |
| Connectors | toggles via IPC `setMcpServers` (`Sm`) | toggles via HTTP edit of the session's `session_context.mcp_config` (`dj`, C227:10735+) | same as cloud *(inferred: whether a bridge CLI honours `mcp_config` edits is unverified)* | — |
| Claude in Chrome | toggle | **disabled**: "Only available in local sessions", or `runsOnOrgInfra` copy | **hidden**: `if (f === "bridge") continue` (C227:11066) | cloud: structural (no local browser). Bridge: (a); the remote machine's Chrome could serve it, so fillable |
| Plugins | local skills submenu | `marble_sparrow`: plugin toggles via `/api/claude_code/organizations/{org}/plugins`. byoc/pool, or no flag: **disabled** "Only available in local sessions" | **hidden**; typing `/plugin` gives "Plugins aren’t available in this environment." (CC43:44450) | (a) `LL` (S8:22789) plus (c). Bridge: fillable (the CLI has plugins) |
| Images | up to 20 ("Attach up to 20 images in a single message for local sessions", `W/cb63ed069`:5963); SSH 20 if gated, else 5 | 16 via the upload lane (`ccr_image_attachments`), else 5 inline | same, but the lane needs CLI ≥ 2.1.226 | (c)+(b) (`W/c98ab6e79`:9-40; EPI:15392-15460) |
| Other files | by path | 5 per message, uploaded (`W/c54bf5722`:149, 711) | same | (c) |
| `@` mentions | IPC `Resources.fetchMentionOptions` (C227:6436-6505) | `file_suggestions` (1.5 s); off when `__gb__302592060` | `file_suggestions` (kill switch does not apply) | (c) on cloud only |
| Session / window `@` mentions | ✓ | — | — | structural (CC43:43391-43396) |
| Slash-command list | IPC `getSupportedCommands`; SSH drafts use `getSSHDraftCommandNames` | `system/init` plus `commands_changed` | same as cloud | — (`CMDS`:880-905; EPI:10245-10267) |
| Host-only slash commands | `subtask`, `mcp`, `output-style`, `add-dir`, `cd`, `memory`, `auto-mode-setup` gated `hostInterceptSurface && isLocalSession` (`CMDS`:256-560) | pass through or refused | same | (a) |
| `!` bash | `N(e,n) = e?.type === "local" && n !== "wsl" && !!runBashCommand` (`W/c4491d238`:114-116); SSH ✓, **WSL ✗** | refused: "Shell commands are only available in local sessions." | same | (a)+(d) IPC `runBashCommand` (CC43:52833-52846). Before a session exists: "Start a local session first to run shell commands." Fillable only with a new control_request |
| `/memory` | ✓ when `__gb__3914392501`; the dialog needs `type === "local"` (CC43:40695) | "Memory files aren’t available for SSH or cloud sessions." | same copy | (a)+(d). Without the flag the command passes through to the CLI. A read-only view is fillable via `get_context_usage` memory paths |
| `/cd` | IPC; worktree sessions refuse | "Changing the directory isn’t available for this session." | same | (a)+(d) (CC43:52697-52715) |
| Queued: edit / remove | IPC `cancelQueuedMessage` | `cancel_async_message` (with a confirmation), CLI ≥ 2.1.76 | **no**: `Qw` needs the cloud set | (a)+(b) (EPI:9589-9597, 14951-14963). Bridge fillable: the RC CLI implements `cancel_async_message` (previous report §11.8) |
| Queued: reorder | IPC `reorderQueuedMessage` | **no** | **no** | (d): no control_request; the remote adapter hard-codes false |
| Queued: Send now | IPC `sendSteeredNow` | head-only stop-and-send (`interrupt`), gated by `__gb__93598664` and a live stream | same | (d) for steer-alone (`W/cf74bc599`:7890-7920, 8136; CC43:50518-50533) |
| "Queue for later" (⌘↵) | only if `reorderQueuedMessage` exists | always | always | IPC presence (CC43:49196-49198) |
| Steer while working (Enter → `priority:"next"`) | IPC steer events | ✓ | ✓, plus mid-turn **asides**: a `next` message auto-asked as `side_question` when `steeringGates.asides` (SEND:544-575) | asides: (a)+(c), bridge only |
| Fork-submit (⌘⌥↵) | "Send in a forked session" (IPC `forkSession`; WSL needs `wslForkSupported`) | **not offered** | "Fork with this prompt" (prefill only) | (a) `O$` (S19:26798-26805) |
| Remote Control toggle | session details, local only (IPC `toggleRemoteControl`, else sends `/remote-control`). Refusal: "Send a message to start this session, then turn on Remote Control." (C227:5048-5150) | n/a | n/a | structural |
| Dictation, drafts, prompt suggestions | no kind branch | same (suggestions only if the worker emits `prompt_suggestion`) | same | — |

### 2.3 Session controls

| Control | local | cloud | bridge | Gate |
|---|---|---|---|---|
| Model | IPC `setModel`; can restart the CLI onto a newer version (`applyModelByRestart`) | `set_model`; anthropic_cloud has no CLI-version gating; byoc/pool are gated | `set_model`; rows needing a newer CLI are disabled: "Update Claude Code on the machine running this session to use this model." | (b) CLI version from connection → attach → transcript → `container_cc_version` → environment (PICK:1174-1196), compared with `min_claude_code_version` and flag `cowork_slate_finch_min_versions` (S182:20225-20304) |
| Effort | IPC | `apply_flag_settings{effortLevel}` | same | — (PICK:1488-1590) |
| Ultracode | if the IPC exists | ✓ | ✓ for a running session; hidden in a new bridge draft (`o !== "bridge"`, PICK:1495) | (a) draft only |
| Fast mode | IPC `setFastMode` | `apply_flag_settings{fastMode}`; **disabled if CLI < 2.1.274** (`zs`) unless already on or cooling down; org gate `claude_code_fast_mode` | **hidden**: `T = e.type === "remote" && w !== "bridge" && …` (PICK:2033-2042); EPI also strips the key (EPI:14325) | bridge: (a). The CLI accepts the setting, so fillable. Cloud: (b) |
| Permission modes | `default`, `acceptEdits`, `plan`, +auto, **+bypass** (bypass needs org setting `Sy().available` and no root) | flag `ccr_plan_mode_enabled`: `default`, `plan`, +auto; flag off: **`acceptEdits` only**; server `permission_modes.available` overrides both | `default`, `acceptEdits`, `plan`, +auto | (a) `qL` (S8:22903-22940; call site C227:19983-20015) plus (c). Auto default: `ccd_auto_default_mode` (local), `ccr_auto_default_mode` (cloud) |
| Shift+Tab cycle | none for any kind; the mode menu is ⌘⇧M / ⌘⌥M (`W/c518a31cc`:736-746) | — | — | — |
| Thinking | No toggle in the Code tab for any kind; effort replaces it. On-demand thinking summaries: local only (IPC `setThinkingSummariesWanted`, flag `ccd_thinking_summary_on_demand`, TX:94421-94428) | — | — | (d) |
| `/advisor` | IPC `getAdvisorSetting` | `get_settings` | dialog opens, but the **current value is never read** (EPI:14200 `if (Z.has(e)) return null`) | (a); fillable *(inferred: if the RC CLI answers `get_settings`)* |
| Ultrareview | IPC `launchUltrareview` | "/ultrareview is only available in a local Claude Code session." | same | (a)+(d) (CC43:49835-49845) |
| Stop | IPC `interrupt` | `interrupt` control_request | same | — |

### 2.4 Transcript actions and side chats

| Action | local | cloud | bridge | Gate |
|---|---|---|---|---|
| Rewind ("Rewind to here", `/rewind`) | IPC `rewindV2` → `rewind`; `clearSession` for the first message | `rewind_conversation`; kill switch `epitaxy_disable_remote_rewind` (RW:1935-1945) | `rewind_conversation`; "Rewind is unavailable while the computer running this session is offline" (TX:28262) | (c) on cloud. Worker refusal: "This session doesn’t support rewind." (RW:1917). Local sessions started via RC hide rewind and `/clear` (CTX:4353) |
| Rewind extras (undo/redo marks, file restore, rewind to a refused prompt, resume the pre-/clear session) | ✓ | ✗ | ✗ | (d), each guarded by `e.type !== "local"` (RW:1979-2424). `rewindFiles` is fillable: the SDK has `rewind_files` (SDK:60624-60634) |
| Fork ("Fork from here", `/fork`, ⌘⌥↵, row menu) | IPC `forkSession` | **hidden** | `fork_conversation`; disabled while the host is offline. Copy: "Can’t fork this session yet. Update Claude Code on the computer running it and try again." / "Fork is unavailable while the computer running this session is offline." (`W/caec4a2d4`:424-446) | (a) `O$` (S19:26798) and EPI:14456. Cloud: no HTTP fork endpoint; the CLI refusal `requires_remote_control_server` (EPI:9974) suggests a spawn-capable host is needed. **Structural for now** |
| `/clear` | menu item calls IPC `clearSession` (CTX:4642-4665) | passed to the CLI as text *(inferred)* | same *(inferred)* | — |
| Retry on an error card | re-submit or nudge; same for all kinds (CC43:55436-55499) | | | — |
| Copy / Copy as Markdown / `/copy` | ✓ for all kinds (TX:28092-28128) | | | — |
| Edit a past message, regenerate | not in the Code tab for any kind (rewind-with-prefill substitutes) | | | — |
| Side chat (`/btw`, `/side`, ⌘;) | IPC `startSideChat`/`sendSideChatMessage`, or a child session via `startBtwChild` when `btwChildSessions` is supported (LOC:2473-2500) | **`side_question`** | `side_question` | Gate `isLocalSession || remoteSideChat`, with `nc` mapping remote and bridge alike (CTX:4039-4064, 4402; `CMDS`:286). Owned, unshared, unarchived (`BM`, EPI:18823-18834). Refusal: cloud "Side chat isn’t supported in this session’s environment yet."; bridge "This session’s Claude Code can’t answer side questions yet. Update Claude Code on the computer running it, then try again." (`W/cccc2cf0a`:17964-18040) |
| `/compact` | sent as text; all kinds | | | — |

### 2.5 List, notifications, archive / share / rename, move, start

| Feature | local | cloud | bridge | Gate |
|---|---|---|---|---|
| Rows | zustand store seeded by IPC `getSessionList` (15 s timeout) and kept live by `onOnEvent` (S8:1557-1720). CLI mirrors come from `listCliSessions(200)`, polled every 30 s (S11:816-879) | `/v1/code/sessions` plus watch | same HTTP list. Desktop **hides bridge rows that mirror its own local RC sessions** (`Ct`, S11:6900-6918; `gm`, S8:1135) and redirects them (RES:5239-5257) | — |
| Unread | client-only: a top-level `result` marks unread unless viewed (localStorage `epitaxy-unread-v1`, S11:7299-7389) | server `unread` | **never**, except by hand: `isUnread: !r && …` (S11:7004) | (a). Fillable |
| Mark read | client store only | server `mark_read` | also sends server `mark_read` (`W/cd54a5401`:1352-1395) but ignores the result | — |
| Native notifications | **main process**: turn end (waits ≤5 s for a summary), permission prompts after 300 ms, "Session started from another device" (MU:383560-383760) | page, from the watch stream: `requires_action` immediately, idle after 10 s, gate `amber_harbor_beacon` (`W/c101fef3f`:4655-4900) | **excluded**: `xs()` checks `!lt(e)` (`TT`) and `!t.has(environment_id)` (`W/c101fef3f`:4657-4669) | (a). *(Inferred: it avoids double-notifying Desktop-hosted RC sessions; RC sessions hosted elsewhere get nothing.)* Fillable: narrow the check to bridge ids mapped to a local session |
| Rename | IPC `updateSession` | `PUT` plus `rename_session` | same | — |
| Archive / delete | IPC with worktree cleanup and an uncommitted-changes dialog (LOC:2088-2115) | `POST /archive`, `DELETE` | same | — |
| Discard kept worktree | IPC | `not_kept` | `not_kept` | structural |
| Share link | **no**: the dialog renders only for remote or bridge (`W/c39a247c4`:381, 419) | ✓ | ✓ | (d)/structural: no server session id (export to a file instead: IPC `shareSession`, "Session exported to {filePath}") |
| Copy link / "Open in CLI" (`claude --teleport`) | off | off | off | (c) build constant `D$ = false` (S19:26796, 26813-26815) |
| Move to cloud | **menu compiled off**: `var pn = false` (`W/cd54a5401`:891, 948). Only the agent tool `mcp__ccd_session__move_to_cloud` drives `CloudMove` IPC (MU:306735-306754; `W/c101fef3f`:233-415) | n/a ("This session is already in the cloud.") | "Continue in cloud" via `/move-to-cloud`; flags `ccr_continue_on_cloud_offer_web` or `ccr_amber_horizon` (`W/caec4a2d4`:988-994) | local: (c) constant |
| Start: target pick | folder pick (CC43:3414-3565) | repo plus environment (CC43:3646+) | machine pick; spawn, attach or blocked (CC43:11946-11992) | — |
| Start: prewarm | `prewarmLocal`/`prewarmFolderless` while typing, keyed by cwd, model, permissions and MCP; adoptable for 8 min (CC43:15131-15420) | `POST /v1/code/mcp-config/prewarm` only in the local→cloud draft band (CC43:22269) | none | structural (there is no bridge process to warm) |

---

## 3. Gate classification: structural vs fillable

**Structural** — follows from where the process runs:
- Local-only, because they need this Mac's process, files or PTY:
  - `!` bash (IPC `runBashCommand`);
  - add-folder pickers and folder drag-drop;
  - file edit/save;
  - the Launch dev-server preview;
  - the local MCP dialog;
  - the IPC queue controls (reorder, steer-now);
  - rewind undo/redo marks;
  - ultrareview;
  - session/window mentions;
  - prewarm;
  - kept-worktree discard;
  - the main-process native notifications;
  - the Remote Control toggle.
- Bypass permissions *(policy, inferred deliberate)*.
- Cloud Chrome.
- Cloud fork *(no spawn-capable host; inferred)*.
- Local share links (no server copy).

**Fillable on RC.** A full CLI sits on the other end and the gate is an explicit client check:

| Feature | Gate | What fills it |
|---|---|---|
| Files tree | (a) `vC`, EPI:9202 | `list_directory` exists |
| Fast mode | (a) PICK:2036, EPI:14325 | — |
| Queued cancel | (a) `Qw` cloud set | `cancel_async_message` |
| `get_task_output` | (a) EPI:14859 | — |
| Advisor read | (a) EPI:14200 | — |
| Native notifications and unread | (a) | — |
| Browser pane | (a) `iw` | — |
| Plugins | (a) `LL` | — |
| Claude in Chrome | (a) | — |
| MCP-app widgets | (a) `ew` | — |
| Push band | (a) `type !== "remote"` | `push_branch` |
| Add folder | (a) | `add_directory` |
| Terminal | (a)+(d) | needs worker PTY support |
| `!` bash | (a)+(d) | needs a new control_request |

**Fillable on cloud:**
- `rewind_files`;
- MCP toggles (`mcp_toggle`/`mcp_reconnect`);
- the files tree in the browser (gated on a Desktop app feature);
- the permission list (flag).

**Version gates** (b):

| Feature | Floor | Constant |
|---|---|---|
| cancel queued | CLI 2.1.76 | `Xw` |
| background tasks | cloud 2.1.137 | `Gw` |
| background tasks | RC 2.1.255 | `Kw` |
| cumulative-delta conversion | below 2.1.157 | `eT` |
| worker diff | 2.1.198 | `tT` |
| worker diff, cloud + github_sync | 2.1.280 | `GR` |
| image lane on RC | 2.1.226 | — |
| fast mode, cloud | 2.1.274 | `zs` |
| per-model rows | `min_claude_code_version` and `cowork_slate_finch_min_versions` | — |

**Flag gates** (c), named:
- `ccr_plan_mode_enabled`, `ccd_auto_default_mode`, `ccr_auto_default_mode`
- `ccr_cardboard_truck`, `ccr_v2_terminal_ws_web`
- `ccr_image_attachments`, `ccr_file_attachments`, `ssh_file_attachments`
- `marble_sparrow`
- `epitaxy_disable_remote_rewind`
- `ccr_epitaxy_disable_bridge_workspace_diff`, `ccr_epitaxy_disable_bridge_host_reads`
- `epitaxy_pr_panel`
- `amber_harbor_beacon`
- `ccr_continue_on_cloud_offer_web`, `ccr_amber_horizon`
- `ccd_thinking_summary_on_demand`
- `claude_code_fast_mode`
- `ccd_local_transcript_paging`
- hashed: `__gb__3098969594`, `__gb__302592060`, `__gb__2613657492`, `__gb__2023598694`, `__gb__93598664`, `__gb__3914392501`, `__gb__4043774181`
- build constants: `pn = false` (local move-to-cloud), `D$ = false` (copy link / teleport)

---

## 4. Feel of use

| | Local | Cloud | Bridge (RC) |
|---|---|---|---|
| Initial load | A **MessagePort lane** from main (`requestTranscriptPort` + `readTranscript`, reader `K`, LOC:668-760), falling back to IPC `getTranscript`. With `ccd_local_transcript_paging`, a paged adapter `ur` (LOC:2200-2425; EPI:21323-21327): window of 200, backfill ≤3×800, earlier pages of 200. No IndexedDB; main holds the data | `events?limit=200&sort_order=desc`, older pages of 500; IndexedDB for settled transcripts (previous report §2.5) | same HTTP, ordered by epochs, not sequence |
| Live stream | one multiplexed `LocalSessions.onOnEvent`, filtered by session id (LOC:1208-1225, 1700-1960). Events include `message`, `transcript_loaded` (full replace), `close`/`stopped` → `done{dropUnconfirmedEchoes}`, `turn_withdrawn`, `held_input_*`, `steer_*`, `initialization_status`, `ssh_*` | SSE `/events/stream` (gate `ccr_v2_subscribe_sse_web`), WS fallback after 15 s | legacy v1 WebSocket (selector `ow`, EPI:9499) |
| Connection state | `connected, optimistic:true` immediately; `wake()` is a no-op; no backoff. SSH adds `connecting`/`reconnecting` with a reason (`teleport_login`, `jump_host_*`), `ssh_host_lost`, `ssh_quiet_repair` | epitaxy loop backoff, 6 tries; "Disconnected from the remote session. Send a message or refresh to reconnect." (EPI) | same, plus the client offline detector: disconnected and no non-user frame for 70 s (CTX:738-805). Band "Reconnecting to your computer…" → "Continue in cloud…" (`W/cf74bc599`:9510-9536) |
| What the first token waits on | MCP config (≤10 s), worktree title (if a worktree), CLI version floor, IPC `start`, `initialization_status` steps. Opening an existing session calls `warmSession` to spawn the CLI ahead of the first send (CTX:1544-1565) | session POST → `env_manager_log` checklist (provision, clone, setup_script, start_cc); pools: "Waiting for a runner — {ahead} ahead of you" (TX) | `bridge-spawn` POST → `pending` until the remote bridge attaches a worker. There is no client wait endpoint, so the user waits on the remote machine polling for work |
| Dead / offline | crash taxonomy (S14:500-830): "Claude Code crashed" / "keeps crashing", "Claude Code stopped responding", "Session history unavailable", "Folder not found", "Lost connection to {host}". Recovery IPC `retryStart`, `restartRemoteSession` | `remote_stranded`: a pending turn >120 s with the worker disconnected → "Cloud session stopped responding" (CTX:850-936) | `computer_unreachable`, `remote_control_disabled`, `host_exit`… (S14:1700-1723, 3004-3011); "Can’t reach your computer" refuses sends (SEND:614-631) |
| Send and echo | IPC `sendMessage`. **`dispatchFirst`**: with no attachments, the IPC goes out before any renderer echo (SEND:1972-1975, 2338-2358) *(inferred: the echo arrives as main's `message` event)* | POST with an optimistic echo (`isOptimisticEcho`), chained per session; queued prompts held until `delivery_update` | same as cloud |
| Durable outbox | **none** (`vt` excludes local, CC43:45009). Main holds sends after an error (`holdsSendsAfterError`) and releases or withdraws them via `held_input_*` ("A message you sent is still waiting for you to sign in…") | sessionStorage `session-pending-messages` | same |
| Send failure | echo removed; bucket error `local_send_rejected` (SEND:2474-2490); `desktop_bridge_missing` if IPC is absent (LOC:1540) | `remote_send_rejected`/`auth_error` card; text restored | same |

**Net effect** *(inferred from the code paths, not measured)*:
- **Local** feels immediate: no network hop for the echo, history straight from disk via main, no reconnect states except over SSH. The cost is the CLI spawn and MCP warm-up, which prewarm and `warmSession` hide.
- **Cloud** pays container provisioning up front, then HTTP paging plus SSE.
- **RC** pays the remote bridge's work-poll latency on start and rides the less filtered v1 WebSocket. It is the only kind with a client-side heuristic for "the machine is gone".

---

## 5. SSH / WSL as far as the kind predicates go

SSH and WSL are `type:"local"` with `meta.remote.kind`, so `isLocalSession` and the adapter treat them as local. The tables split them:

| Feature | SSH | WSL |
|---|---|---|
| Plugins (`LL`) | ✓ | ✗ |
| MCP toggles (`IL`) | ✓ | flag only |
| `!` bash | ✓ | ✗ |
| Fork | ✓ | needs `wslForkSupported` |
| Terminal | `chillingSlothSshShell` | `wslTerminal` |
| Launch preview | ✗ | `wslPreview` |
| `/memory` | ✗ ("…SSH or cloud sessions.") | — |
| Bypass | ✓ | ✓ |
| `pj` "+" menu | treated as local | **gets the "Only available in local sessions" tooltip** (C227:10913) |

Depth on SSH is out of scope here.

---

## 6. Corrections to `claude-ai-rc-client-protocol.md`

| Previous report | Code says |
|---|---|
| §0.5: `/btw` side questions exist only for RC | Cloud has them too. `nc` maps `remote` and `bridge` to `"remote"`; the gate is `isLocalSession \|\| remoteSideChat` (CTX:4039-4054, 4402). Only the automatic mid-turn **asides** are RC-only (SEND:544-575) |
| §0.5: RC has no `mark_read` | RC rows do send `mark_read` (`W/cd54a5401`:1376-1395); only the server `unread` read side is ignored (S11:7004) |
| §0.5 / §4.2: `fork_conversation` RC only | Among remote kinds, yes. Local also forks over IPC `forkSession`; cloud has no fork at all |
| §4.2: `fastMode` stripped for RC | The toggle is **hidden** for RC (PICK:2036), and stripping is a second layer. Cloud needs CLI ≥ 2.1.274 (`zs`) |
| §5.6: RC offers default/acceptEdits/plan/auto | Correct for RC, but cloud differs: flag `ccr_plan_mode_enabled` → default/plan(+auto), else acceptEdits only, with server `permission_modes.available` overriding (S8:22903-22940) |
| §5.6: no Shift+Tab cycle (RC) | True for every kind, local included |
| §5.2: `!` refused for remote sessions | Also refused for **WSL**; allowed for SSH (`W/c4491d238`:114-116) |
| §5.2: `/memory` blocked for remote | Also blocked for SSH and bridge, and only when `__gb__3914392501` is on; otherwise it passes through |
| §5.2: host-intercepted list | Missing `/mcp`, which on remote kinds opens Settings › Connectors, so the CLI's `/mcp` is unreachable remotely |
| §5.4: images at most 16 | 16 is the upload-lane count; without the lane the cap is 5 inline. `ccr_file_attachments` also applies to bridge, with no version check. Cloud can also stage via IPC `stageRemoteSessionAttachmentsViaFilesApi` |
| §4.2: `list_directory` cloud only | Holds. Bridge still gets a search-only Files pane (`file_suggestions` + `read_file`), and the cloud tree additionally needs Desktop's `selfHostedSessions` app feature (EPI:19474; S78:9361), so it is off in a browser |
| §4.2: `get_task_output` cloud only | Holds, but both kinds mainly read output through `read_file{taskOutput}` (EPI:12569-12573) |
| §4.2: `get_branch_status`/`push_branch` cloud only | Narrower: only `type:"remote"` with the org capability `vcs.push`, effectively self-hosted |
| §4.2: `get_workspace_diff` both | Adds version floors 2.1.198 / 2.1.280 and the misnamed `ccr_epitaxy_disable_bridge_workspace_diff`, which covers all remote kinds |
| §4.2: `mcp_status`/`mcp_read_resource` | Feed MCP-app widgets only; there is no MCP server pane on cloud or RC |
| §4.2: Desktop-local rewind is a resume at a point | The web side calls IPC `rewindV2` → `rewind`, `clearSession` for the first message, and adds undo/redo marks and file restore. Cloud rewind has kill switch `epitaxy_disable_remote_rewind` |
| §6.3: bridge excluded from Desktop notifications | Confirmed, with two checks (`TT` and the bridge-env set); the same filter also drops trigger, `ditto:` and Slack sessions |
| §0.5: "Continue in cloud" is RC-only | True in the UI. Local has an agent-tool-only `CloudMove` path; its menu entry is compiled off (`pn = false`) |
| §3.5 (session list) | Misses Desktop's dedup that hides bridge rows mirroring its own local RC sessions |
| Previously unreported | Self-hosted pool sessions are EPI class `other`, not cloud, so every `qC`/`ew` gate excludes them |

---

## 7. Verification and inference

**Re-read in source by me:**
- `um`, `TT`, `Ao`;
- `Gs`, `$C`/`HC`/`QC`, `vC`, `uw`, `ew`, `iw`, `Qw`, `qw`, the version constants;
- the S8 env-type tables, `TL`/`EL`/`qL` and the C227 permission call site;
- `cj` and both callers;
- the three adapter capability objects;
- the backend capability object `fN`;
- `zN` (terminal) and `UN` → `selfHostedSessions`;
- fast-mode `T` (PICK:2033-2042);
- `nc`;
- EPI `fork` (14456);
- the `!` bash predicate and copy;
- the Chrome `continue` for bridge;
- `xs()` notification filter;
- `isUnread: !r`;
- `O$`/`D$`;
- `pn = false`.

**Taken from the readers and not re-read:**
- the PR, push and diff band details;
- the attachment caps;
- the local adapter's `ur` paging numbers;
- `dispatchFirst`;
- the error taxonomy copy;
- the rewind extras;
- the side-chat refusal copy;
- the model-row version source order.

**Inferred:**
- pool sessions land in class `other`;
- the reason for the notification exclusion;
- the WSL tooltip inconsistency;
- whether a bridge CLI honours `mcp_config` edits, `get_settings` or `rewind_files`;
- the net feel-of-use summary.
