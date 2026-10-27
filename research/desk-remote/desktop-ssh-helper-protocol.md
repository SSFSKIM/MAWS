# Claude Desktop SSH mode: the `claude-ssh` helper protocol and its durability semantics

**Purpose.** This is a reference design for the MAWS #52 rebuild of the desk's remote protocol. Desktop's SSH mode solves the desk's problem over an unreliable link: one client drives Claude Code processes on another machine, survives link loss and app quits, and rejoins them. This note maps how it does that, then sets the mechanisms against the desk's four diagnosed failures (§8).

## Build and method

- **Desktop build:** `app-2.42304.0`, readable tree at `~/claude-desktop-re/readable/app-2.42304.0/`.
- **Helper:** `claude-ssh` pinned at `683cc6a9cd1d99430efd762587e02dd076fd5ada`. The linux-amd64 build was downloaded from the pinned URL into `~/claude-ssh-helper-inspect/dl/` and inspected statically. It was never executed. Its sha256 and size match the pin.
  - Go 1.25.14, module `github.com/anthropics/claude-ssh`. The pclntab is intact: 8236 function names.
  - Extracted strings, symbols and disassembly are in `~/claude-ssh-helper-inspect/{strings,syms,dis}.txt`.
- **Static analysis only.** I read the RPC client, the process object and the controller myself. Two parallel readers covered session-manager durability and deployment/binary. I re-read their load-bearing claims in source: prompt redelivery, the checkpoint top-up rule, socket and token paths, the single-exec reattach gate, and the helper's buffer and idle strings.
- *(inferred)* marks anything not read in source.
- **Corrections to `desktop-modes-main.md` §3:**
  - The daemon start is at D3:19253-19296, not D3:199-342. D3:199-342 is the local download cache.
  - "Hosts with sessions active in the last 24 h are pre-connected" conflates two mechanisms, separated in §5.4.
  - The CLI pin in that note (2.1.299) still holds.

**Citation prefixes** (all under `readable/app-2.42304.0/main-process/` unless marked):

| Prefix | File | What |
|---|---|---|
| `DK` | `index.chunk-DK8QSLgC.js` | `RemoteRPCClient` (class `Ze`, DK:1140), `RemoteProcess` (`_t`, DK:2028), `RemoteServerController` (`ar`, DK:4968), controller pool (DK:12190-12486) |
| `D3` | `index.chunk-D3PzLoAh.js` | helper deployment, daemon start, bridge handshake, SSH engines, SFTP mirror append |
| `CF` | `index.chunk-CFJssAFf.js` | LocalSessionManager (park, adopt, cold holds, transcript mirror) |
| `DB` | `index.chunk-DBPLojse.js` | the pure adoption-eligibility decision |
| `B5` | `index.chunk-B5tintml.js` | `sshReattach` record validation |
| `SDK` | `index.chunk-DNyequwM.js` | Agent SDK `Query` bundled in main |
| `MU` | `index.chunk-muI2IV6k.js` | core: pins, feature list |
| `BX` | `index.chunk-BxxgGLcw.js` | ssh2 engine wrapper |
| `RP` | `index.chunk-Daayvnw4.js` | reachability pre-probe plan |
| `BIN` | `~/claude-ssh-helper-inspect/strings.txt` | helper binary strings (quoted) |
| `CLI` | `~/claude-code-bundle/2.1.300/cli.pretty.js` | Claude Code CLI 2.1.300 |
| `DOCS` | https://code.claude.com/docs/en/desktop | SSH sections, fetched 2026-10-19 |

---

## 0. The design in one screen

1. **The host daemon owns the processes.** The client never owns them. A per-install daemon (`~/.claude/remote/srv/<ver>/server --serve`) is the parent of every CLI. The SSH connection is only a pipe into it: a `--bridge` exec bridges stdio to a 0600 Unix socket. Losing the pipe changes nothing on the host.
2. **Every output frame has a per-process sequence number.** The daemon keeps the last 16 MiB of frames per process (BIN `frameSink`, cap `0x1000000`). `process.reattach{id, fromSeq}` replays from any seq still in the ring and reports its window `firstSeq..lastSeq`. A gap is detected exactly, never guessed.
3. **Every input byte has an offset.** `process.stdin{id, data, offset}` is idempotent: the daemon reports `stdinApplied` and answers `duplicate:true` for bytes already applied (DK:3578-3589). The client re-sends everything it has not seen acknowledged. Freshness windows play no part in safety.
4. **The client persists a line-aligned output checkpoint** `{seq, skipBytes}` before every input write (DK:3536-3576, CF:25288-25303). After an app quit, a new client adopts the survivor and replays exactly from there.
5. **Pending prompts are state held by the CLI, not events.** On re-initialize, the CLI re-sends every pending permission and dialog request (CLI:77939, 77991). The SDK de-duplicates them by `request_id` (SDK:67037-67042).
6. **Liveness is checked at the application layer and is traffic-aware.**
   - The client sends `server.ping` every 7 s, but only when no stream line arrived in the last 7 s. The ping timeout is 2 s, adapting up to min(10 s, 3×SRTT). Two misses force a close (DK:1145-1158, 1649-1738).
   - Any arriving byte counts as life. A write error closes at once.
   - A process frozen longer than the daemon's 300 s idle close is replaced without asking.
7. **Reconnect is a single exec in the healthy case** (D3:18843-18851, 19360-19365). It is driven by:
   - exponential backoff, 1 s doubling to a 60 s cap, with ±30 % jitter;
   - a 5-min slow tick after 30 failures, with a TCP pre-probe every ~30 s that ends the wait early;
   - immediate wake on a person's action, network-interface change, OS resume, unlock or session switch.
8. **A separate transcript mirror** (host JSONL appended over SFTP into `~/.claude/projects/ssh-<id>/`) is what the pane is rebuilt from. The live stream is for new output only. A gap is filled from the mirror (CF:61121-61185, 81062-81134).

---

## 1. Transport and auth

### 1.1 Host layout and permissions

- **Paths** (`Qf()`, D3:15636-15645):
  - binary: `$HOME/.claude/remote/srv/<helperVersion>/server`
  - run dir: `$HOME/.claude/remote/run/<clientId>/`
  - socket: `<runDir>/rpc.sock`
  - persisted token: `<runDir>/daemon.token` (D3:15646-15648)
- **`clientId` = `sha256(hostname + "\0" + userData)[:8]`**, persisted after first use (D3:15610-15630). Each Desktop install therefore has its own run dir and its own daemon on a shared host. There is no shared multi-client daemon.
- **Permissions.**
  - Desktop runs `mkdir -p runDir && chmod 700 ~/.claude/remote runDir` (D3:17598).
  - The daemon chmods the socket to 0600 right after `net.Listen` (`daemon.runChild`, disassembly 0x6545fe).
  - DOCS: "it has mode 600 and its folder has mode 700."
- **Daemon run-dir files** (D3:500-636; BIN):
  - `daemon.lock`: flock plus a JSON owner record with `instanceId` (32 hex);
  - `children/<pid>.json`: `{pid, instance, program|argv0, at}`;
  - `remote-server.log`.
- **Peer check (Linux only).** It is enabled with `CLAUDE_SSH_PEER_CHECK=1` on `--serve` (D3:379-461, 19264-19272). The daemon checks the caller's namespaces with SO_PEERCRED (BIN `peer_linux.go`). A refused caller gets an unsolicited `{"id":null,"error":{"code":-32006,"data":{"reason":"other_namespace|unreadable|lookup_failed"}}}` (D3:398-424). *(inferred)* This keeps sandboxed children that share `$HOME` off the socket.

### 1.2 Starting the daemon

- **One exec** (D3:19253-19296): `server --stop --socket S && server --serve --socket S --token-file <runDir>/token.<16hex>`.
  - `--stop` sends `server.shutdown` over the socket and prints one of `stopped|none|terminated|killed|survivor` (D3:352-378).
  - Desktop first reads `daemon.lock` to log which instance held the run dir (D3:16655-16670).
- **`--serve` self-daemonizes** (BIN call graph: `daemon.Serve` → `spawnChild` → `exec.Command.Start` → `Release` → `waitForHandoff`, 12 s budget). The child then:
  1. claims the run dir;
  2. reaps the predecessor's children ("its Claude Code children, if any, are ended next, before this daemon serves");
  3. listens and chmods the socket;
  4. persists the token;
  5. starts host cleaning;
  6. serves.
- **A helper restart ends the old daemon's children.** BIN: "[daemon] received %v; shutting down (children will be killed)" and "ending orphaned process group %d recorded by daemon instance %q". `children/<pid>.json` is a kill-list for crash recovery and a liveness hint for Desktop. It is not a handover. This is why Desktop works hard to defer helper replacement (§7).

### 1.3 The token

- **Created by the controller.** It reuses a per-host persisted token, else `randomUUID()` (DK:7568-7576).
- **Delivery to the daemon.** Desktop uploads it over SFTP to `<runDir>/token.<16hex>` with mode 0600 (`Jp`, D3:16569-16592). The daemon reads and unlinks it. BIN help: "Read auth token from this file at startup, then unlink it. Used by the daemonized child so the token never appears in /proc/<pid>/environ."
- **Persistence.** The daemon persists the token to `daemon.token`. Desktop reads it back (≤4 KiB) on a first connect under a new address (5 s budget), or once after a `-32001` on reattach (D3:16593-16628, 19027-19075, 19760-19785). `reattachAuth` ∈ `own_token|persisted_token|host_token` (D3:19185).
- **Every request carries the token in the envelope, not in params:** `{"jsonrpc":"2.0","id":N,"method":M,"params":P,"auth":TOKEN}` (DK:1398-1409). A wrong token gets `-32001` "Unauthorized: invalid or missing auth token" (D3:19525).

### 1.4 The `--bridge` channel

- **Command** (`ap()`, D3:15688-15702): `[env HOME=…] '<srv>/server' --bridge --socket '<runDir>/rpc.sock'`. BIN: "Connect stdio to the running server". Windows wraps it in `powershell -EncodedCommand`.
- **Opened as an SSH exec channel**, `conn.exec(cmd, cb, "helper-bridge")` (D3:16731-16749):
  - **ssh2 engine:** a session channel with an `exec` request (BX:12108).
  - **System OpenSSH:** a mux client on Desktop's ControlMaster, `ssh -S <ctl> -o ControlMaster=no -o BatchMode=yes …` (D3:11736-11770), or a separate `ssh` per channel in "discrete" mode (D3:12076-12083).
- **The channel's stdio is the RPC stream** (`connectWithStream`, DK:1232-1246, called at DK:8262-8265).
- **No daemon behind the socket.** The bridge prints `dial server: … no such file or directory` or `… connection refused`. Desktop classifies it as `no_socket|refused|other` and falls back to the `--stop && --serve` exec (D3:19563-19628).

### 1.5 Framing

- **Newline-delimited JSON** (readline over the channel, DK:1440-1478). Lines starting `{"type":"stream"` are stream frames. They go to a buffer drained 64 per `setImmediate` tick, so a replay burst cannot starve the event loop (`FRAMES_PER_TICK`, DK:1141-1143, 1586-1606). Every other line is parsed as JSON-RPC.
- **Line-end trailer for stream-hole detection** (feature `server.line_end`):
  - Each line ends in `,"end":{"at":N,"len":M}}` (BIN format string; parsed by `B()`, D3:335-351; `next = at + len + trailerLen + 1`).
  - The client checks that each line starts where the previous one ended (`checkedLine`, DK:1480-1517).
  - A line out of place (`skip`) or not as sent (`torn`) closes the connection to reconnect and have the data re-sent ("The remote daemon's output arrived damaged … closing now to reconnect and have it sent again", DK:1518-1531). The reattach replay then restores it.
  - The check is armed only on system OpenSSH, where shell noise can mix into the stdio. After 3 holes in 330 s, checking is suspended (DK:9202-9242).
  - The starting offset comes from the handshake reply's `nextLineAt` (D3:19755, DK:8264). *(inferred)* `at` is a per-connection byte offset.
- **Shell noise in front of the first reply.** The handshake scans up to 16 `{"jsonrpc":` offsets per line (D3:19682-19850). A refusal hidden behind noise is still extracted (`noteRefusalBehindNoise`, DK:1532-1539).

### 1.6 Versioning and capability negotiation

- **`server.capabilities` is the handshake.** In the reattach path it is written into the bridge's stdin before the probe output finishes, as `{"id":"reattach-N","method":"server.capabilities","auth":…}` (`tg`, D3:19674-19681, `Lh` D3:19522). Its reply comes back as `daemonCapabilities {kind:"reported", raw, nextLineAt}`, and the controller uses it without asking again (`capabilitiesFromReattach`, DK:9110-9122, DK:8311-8312). Otherwise it is called with a 5 s timeout (DK:9123-9137).
- **Reply shape:** `{version, methods[], features[], instanceId (32 hex, if feature server.instance_id), startedAt, peerCheck, peerCheckBy}` (DK:9063-9102).
- **Failure handling.**
  - `-32601` means a confirmed legacy daemon. Desktop assumes `methods:["process.reattach"]` and no features (DK:9103-9109).
  - Any other failure is "indeterminate": it is retried later (`retryIndeterminateCapabilityHandshake`, DK:9188-9201), and capability-gated choices report `unknown` rather than `unsupported`.
- **Feature flags Desktop gates on** (DK:9138-9258, 10716, 11531, 11771, 11808; full list at MU:222656-222670):
  - process: `process.stdin.offset`, `process.kill.farewell`;
  - server: `server.line_end`, `server.peer_check`, `server.instance_id`;
  - files: `files.extract_tar.execBit`;
  - git: `git.status.baseRepo`, `git.worktree.external_root`, `git.worktree_create.timeoutMs`, `git.worktree_create.existingBranch`, `git.worktree_remove.unpushedGuard`;
  - launcher: `launcher.managed`.
- **Method presence also gates behaviour:** `process.reattach`, `process.killAndWait`, `plugins.prune`, `git.list_branches`.
- **Adoption requires all three** of `process.reattach`, `process.killAndWait` and `process.stdin.offset` (`supportsProcessAdoption`, DK:9252-9259).
- **The daemon instance (`instanceId`, `startedAt`) is tracked per connection.** When a process is missing, Desktop uses it to say *why* (DK:1989-2007):
  - `not_found_same_daemon`: the process exited;
  - `daemon_superseded`: a newer daemon replaced the one it was spawned under, most likely stopping it with its processes;
  - `foreign_daemon`: another daemon answered, and the process may still run under its own.
- **`server.ping`** returns `{pong}` (DK:11427-11450). It is the heartbeat and the probe.

---

## 2. Method surface (as Desktop calls it)

All are JSON-RPC 2.0 requests. The default per-call timeout is 30 s (`requestTimeout`, DK:1198); `timeout:null` means wait forever. Desktop never calls `process.resize`, `files.realpath`, `files.validate` or `server.shutdown`; they exist in BIN (`server.shutdown` is used by `--stop`).

| Method | Params (as sent) | Result (as read) | Cite |
|---|---|---|---|
| `server.capabilities` | none | `{version, methods, features, instanceId?, startedAt?, peerCheck?, peerCheckBy?}` | DK:9123-9137 |
| `server.ping` | none | `{pong}` | DK:1337, 11427 |
| `process.spawn` | `{id: uuid chosen by Desktop, command, args, cwd, env, launcher?: argv[], disableShellAgentSocket?}` | `{success, outsideJob?}`. Refusal reasons classified as `cwd_unusable`, `host_exhausted`, `host_out_of_files`, … and retried on a schedule when allowed | DK:3362-3444, 2181-2230 |
| `process.stdin` | `{id, data: base64, offset?}` (offset only with `process.stdin.offset`). Chunks ≤256 KiB | `{duplicate?: true}`. Errors: `-32002` daemon queue full, `-32003` offset ahead of applied bytes; both re-queue and retry every 200 ms, up to 150 attempts or 16 MiB buffered, then abandon | DK:3561-3679, 1105-1112 |
| `process.reattach` | `{id, fromSeq}` | `{found, running, firstSeq?, lastSeq, stdinApplied?}`, then replayed stream frames `seq > fromSeq` on the same connection. `fromSeq = 2^53-1` is a liveness probe with no replay | DK:2539-2550, 3059-3076, 11460-11483 |
| `process.kill` | `{id, signal, …farewell}` (farewell fields such as `graceMs`, Windows only) | `{farewellEnd?}` | DK:2330-2373 |
| `process.killAndWait` | `{id, signal?, timeoutMs (5000 normal, 3000 orphan reap), …farewell}` | `{found, died, escalated, alreadyExited, farewellEnd?}` | DK:11484-11522, 2884-2902 |
| `files.read` | `{path, maxBytes: 1 MiB}` | content; "file exceeds maxBytes" error | DK:11523-11529 |
| `files.stat` / `files.list` | `{path}` | stat / `{entries}` | DK:11542-11562, 11740-11745 |
| `files.extract_tar` | `{archivePath, destDir}` | (plugin sync) | DK:11705-11711 |
| `git.info` | `{path, shadowDirOff?}` | `{…, settingsControl}` | DK:11747-11756 |
| `git.status` | `{path, baseRepo?, shadowDirOff?}` | status | DK:11757-11768 |
| `git.list_branches` | `{path}` | `{branches}` | DK:11769-11786 |
| `git.worktree_create` | `{baseRepo, branchName, worktreePath, sourceBranch, existingBranch, worktreeRoot, timeoutMs: 290 s}` (RPC timeout 300 s) | worktree | DK:11787-11805 |
| `git.worktree_remove` | `{baseRepo, worktreePath, branchName?, worktreeRoot}` | result | DK:11806-11827 |
| `launcher.resolve` | `{cliPath}` | `{status: none|usable|…, argv?}` | DK:10727-10790 |
| `plugins.prune` | `{keep, minAgeDays}` | result | DK:11530-11541 |

**Pushed by the helper (no request id).**

- **Stream frames** `{"type":"stream", processId, seq, stream: "stdout"|"stderr"|"exit", data?: base64, exitCode?, signal?, killedBy?}`. They are dispatched as `stream:<processId>` events (DK:1579-1582, 3680-3848).
- **Unsolicited errors with `id:null`.** Only peer refusals (`-32006`) are interpreted (DK:1540-1554).
- There are no other notifications. Process lifecycle travels as frames (`exit`) or reattach answers.

**Other error codes:** `-32004` launcher unusable, `-32005` launcher failed (DK:2008-2018), `-32001` unauthorized, `-32601` unknown method.

**SFTP runs beside the RPC on the same SSH connection.** It carries transcript mirroring (§6), file reads over 1 MiB, realpath and lstat, uploads and the token file (DK:11575-11700, D3:14764-14900).

---

## 3. Durability

There are two recovery paths, and they must be kept apart.

- **A. Live rebind.** The link drops while Desktop runs. The same `RemoteProcess` object and the same SDK `Query` survive. The renderer, the SDK's pending `canUseTool` promises and the permission broker are untouched; they are cleared only in `teardownQuery` (CF:83007-83008).
- **B. Adoption.** The app quit, or the local process object ended. A new `Query` and a new `RemoteProcess` attach to the surviving CLI using a persisted checkpoint.

### 3.1 Output: sequence numbers, checkpoint, replay

- **The daemon side** (BIN):
  - `process.frameSink` holds `[]bufferedFrame` with seq numbers, capped at 16 MiB per process ("keeps each session's most recent Claude Code output in a 16 MiB buffer and drops older output", DOCS).
  - On attach it replays ("[frameSink] replay write failed, detaching").
  - There is one writer per process: a new attach supersedes the old connection's writer (`ConnWriter.Supersede`).
- **The client's position.** `_lastSeq` is the highest frame consumed. Frames with `seq ≤ _lastSeq` are dropped silently (DK:3694-3708). This is the de-duplication for path A.
- **The checkpoint is line-aligned:** `{seq: _alignedSeq, skipBytes: _deliveredSinceAligned}` (DK:2272-2286, 3789-3816). It means "everything through frame `seq`, plus the first `skipBytes` bytes of frame `seq+1`, has reached the parser as whole lines". The SDK parses stdout as JSONL, so the checkpoint never points mid-line.
  - It is `null` (not recordable) while a reattach is pending, while skip bytes are being consumed, or while resyncing.
- **Where it is persisted:** `sshReattach.checkpoint` in the session record, flushed to disk (`bb()`, CF:25288-25303). It is written at two points:
  1. **Before every `process.stdin` RPC, as a barrier.** `sendStdin` awaits `checkpointBarrierBeforeStdin()` (DK:3536-3576). Output the client consumed before it sent any input is therefore durable before that input leaves. After an adoption, the client never replays output older than an answer it already sent, so it never re-shows a prompt it already answered.
  2. **At each turn `result`, but only when no permission or dialog is pending** (CF:64391-64397, `Nb` CF:25365-25376). The checkpoint therefore stays before an unanswered `control_request`, and an adoption replays that request (§3.6).
- **Record shape** (validated by `cD`, B5:22274-22340; created by `tb()`, CF:24978-25027): `v:1, processId, hostKey, checkpoint{seq,skipBytes}, midTurn, remoteControl, cliReappliesHooks, policySig, policyInputsSig, hookSig, recordedAt, person, state∈{adoptable,reap_only,blocked}`, plus optional fields.
- **Replay with `process.reattach{id, fromSeq}`.**
  - Frames that arrive before the answer go to `_rebindFrameBuffer` (cap 64 MiB, else abandon; DK:3680-3693).
  - When the answer's `lastSeq > fromSeq`, the client waits for the buffered replay to reach `lastSeq` (`settleReplayHold`, DK:2786-2797).
  - Frames `≤ lastSeq` that arrived ahead of the replay are dropped, because "the replay re-sends them" (DK:3235-3252).
  - In path B the first `skipBytes` of replayed stdout are discarded (DK:3713-3732).
  - The outcome is classified (DK:3149-3212):
    - **`exact`:** the ring still holds `fromSeq+1`.
    - **`gap`:** `firstSeq > fromSeq+1`. The client adopts anyway, jumps to `firstSeq-1`, drops bytes up to the next `\n` (`_resyncStdoutToNewline`) and emits `reattach-gap`.
    - **`skipped`:** the checkpoint is past `lastSeq`, the daemon reports no window, or the record is malformed. The client adopts from `lastSeq` with no replay and resyncs.
  - Path A has the same gap logic (DK:2602-2651).
  - With no gap consumer the process is `unadoptable("gap_unsurvivable")` and left running (DK:3186-3192).
- **Replay concurrency.** At most 2 processes replay at once. The others wait up to 30 s for a slot; each slot is held at most 60 s, or until the replay drains below 256 KiB of unread stdout (polled every 50 ms, 20 s cap) (DK:1052-1095, 2050-2063, 2988-3053).

### 3.2 Input: offsets, buffering, de-duplication

- **Every chunk written to the process's stdin gets `offset = bytes assigned so far`** (DK:3452-3476).
- **When chunks are buffered.** They are buffered, kept sorted by offset, whenever:
  - the spawn is not confirmed;
  - the process is detached;
  - the daemon pushed back;
  - a chunked send is in flight;
  - the RPC client reports not connected (DK:3477-3483, 3566-3569).
- **A transport-class failure re-queues the chunk** ("Re-queued … will replay on next rebind", DK:3593-3599). A chunk counts as delivered only when the RPC answers.
- **After rebind or adoption the buffer is flushed in order** (DK:2683-2698, 3254-3273).
- **The daemon de-duplicates by offset.**
  - The reattach answer's `stdinApplied` tells the client whether the head chunk landed ("head chunk WAS accepted before the drop; daemon will dedup the replay", DK:2584-2589).
  - `process.stdin` answers `duplicate:true` for bytes already applied (DK:3585-3589).
  - `-32003` means a gap ahead of applied bytes; the client re-queues for an in-order replay (DK:3601-3604).
  - In path B, `seedStdinOffsets(stdinApplied)` rebases the new object's offsets onto the daemon's count (DK:3275-3285).
- **The stdin buffer is in memory only.** Input that would die with a `Query` is tracked at the session level (`heldAcrossLoss`, `inputPending`, §3.7).

### 3.3 Parking at disconnect and at quit

- **Detach on link loss (path A)** (`handleTransportDetached`, DK:2798-2813).
  - With `keepLiveRemote()` (the default; only a killswitch turns it off, DK:5152-5162), the process stays detached with no deadline.
  - It emits `rebind-wanted` after 60 s, doubling up to 30 min (DK:2814-2843). If the link is up but the process is still detached, the controller rebinds it ("still detached on a live connection; rebinding", DK:9634-9649). If the link is down, the nudge restarts the reconnect loop (`ensureReconnectDriven`, DK:11027-11041).
  - With the killswitch on, the process is abandoned after `REATTACH_GRACE_MS` = 15 min.
- **Disown (path B)** (`parkSshLiveProcess`, CF:58540-58560).
  - It calls `RemoteProcess.disown()`, which is purely local (DK:2397-2422). **Nothing is sent to the helper.** The daemon keeps the child.
  - It then stamps `midTurn`, `recordedAt` and `inputPending` on the record and persists it.
  - Retiring a process instead marks `reap_only` and sends SIGTERM (CF:82983-82998).
- **When the local `Query` dies.** If the `Query` errors within 60 s of a transport drop, it is "treating as dormant, not crash" (CF:58682-58686, CF:104606-104610). The session tears down with `keepUndeliveredInput`, parks, flushes the mirror, and recovers with a new `Query` that adopts (CF:104631-104690).
- **App quit** (CF:75270-75392).
  - SSH sessions are not stopped. `markSshSessionAtExit` records `leftBy: quit|relaunch` (CF:25228-25255, 82796-82803).
  - Held input is written to the waiting-input manifest, and the stores are flushed.
  - `kill()` during app exit is ignored ("the process is left running remotely", DK:2306-2311).
  - An adopted process is kill-guarded: `kill()` turns into disown until the owner calls `permitKill()` (DK:2312-2318, 2394-2396).
- **The host side keeps it** (BIN): the daemon serves until 30 days pass with no client request and nobody connected ("this daemon has been abandoned; shutting down and killing %d child process(es)"). DOCS confirms the 30-day limit.
  - The `--bridge` connection itself is closed by the daemon after 300 s idle in both directions ("closing connection idle %s in both directions"). Desktop's heartbeat keeps a live link from going idle.
  - Link-bound processes such as terminals end 7 s after their last connection is gone ("no connection attached for %s; ending it"). The CLI is not link-bound.

### 3.4 Adoption eligibility (path B)

The pure decision `v()` (DB:139-289) checks the following, in order:

1. `flag_off`, `fork`, `backend` (non-SSH; WSL never adopts), `platform`, `no_handle`
2. `handle_mismatch`: the record's `processId` ≠ the session's `sshRemoteProcessId`
3. `reap_only`
4. `person_changed`: the signed-in person differs from the record's `person`
5. `admin_policy_changed`: `policyInputsSig` differs
6. `remote_managed_launcher_changed`
7. `blocked`
8. `host_mismatch`: `hostKey`
9. `daemon_capability`: `!supportsProcessAdoption`
10. `cwd_missing`
11. `remote_control_bound`, `remote_control`, `remote_control_off`, `remote_control_no_coverage`
12. `mcp_on_host_changed`
13. `hook_layout`: a hooks signature changed and the CLI does not re-apply hooks
14. `spawn_policy`: `policySig` matches neither now, nor as computed by an earlier build, nor as for a bare CLI
15. Otherwise eligible, with target `{processId, seq, skipBytes}`.

**Additional checks around the decision.**

- **Person:** a person unknown or changed during the start throws `person_changed` (CF:25310-25326).
- **MCP on host:** if `mcpOnHost` differs and a 5 s probe finds the process gone, the decision flips (CF:57544-57573).
- **Launcher refusal:** it is thrown only when not eligible, so a survivor is still adopted (CF:80608-80613).
- **Blocked:** a record blocked by an older app version is reset to adoptable after an app update (CF:80539-80546).

**When not eligible** (CF:80649-80741, reason groups at DB:103-126):

- **"Restartable" reasons** (handle, capability, RC, MCP, hook layout, spawn policy, blocked, cwd): Desktop probes the process. If it is alive, the log says "cannot be re-adopted (<r>); restarting Claude Code on the host" and the record becomes `reap_only`.
- **The other reasons** resume on a fresh process.
- **Either way, the old pid is reaped** with `killProcessAndWait`.

**Adopt-only (background) never spawns fresh** (DK:3114-3127). A process found gone after being mid-turn gets `knownGone` (CF:81815-81848).

**Time windows** (D3:462-506; CF:25063-25072, 25349-25364):

- **7 days** (`fe` = 604800000): a record with Remote Control on is adoptable this long.
- **3 days** (`pe` = 259200000): a mid-turn record is adoptable this long.
- **24 hours:** a host with a session active in the last 24 h is treated as possibly running live work (`_e`/`ve`, D3:493-509, registered as `hostMayHaveLiveRemoteProcessNow`, CF:75146, 78725-78733). This makes a silent reattach "retry" instead of restarting the daemon (`silentReattachPolicy`, DK:9321-9377).

### 3.5 Re-adoption at launch

`preconnectRecentSSHConfigs` (CF:59234-59420) drives `readoptRunningSessionsOnHost` (CF:59176-59230).

- **Hosts dialled:** the **3 most recently used hosts** (by any session's last activity, with no age cutoff), plus every host with re-adoption candidates or waiting input.
- **Timing:** it waits 5 s (`sx`) for managed settings. If they are not loaded, re-adoption and the extra hosts are skipped for that launch.
- **Candidates** (CF:59153-59175): not archived, no `Query`, no cold hold, record younger than 7 days. They are sorted mid-turn first, then by recency.
- **Limits:** 2 dial workers and at most 8 adoptions per launch.
- **Per session:** an allowlist check, then `warmSession(id, {adoptOnly:true})`, with a 60 s cap (D3:464).
- **Outcomes:** `adopted`, `gone` or `declined`. An unadoptable result in the background becomes `state:"blocked"`, "left running for the session's next open" (CF:81993-82014).

### 3.6 A permission prompt or dialog that was pending across the disconnect

**The CLI re-sends it.** The checkpoint replay is a second, de-duplicated route.

- **Path A (live rebind).** Nothing is lost.
  - The SDK `Query` still holds the pending `control_request`, and the renderer still shows it.
  - An answer given while the link is down is written to the `RemoteProcess` stdin, buffered by offset, and flushed after rebind (DK:3452-3476, 2683-2698).
  - If the drop interrupted the write, the daemon's offset de-duplication makes the resend exactly-once (DK:3585-3589).
  - DOCS: "Claude waits on the remote machine. The wait has no time limit of its own."
- **Path B (new `Query`).**
  - Teardown has cleared the broker's pending prompts (CF:83007-83008). Two mechanisms bring the request back.
    1. **Re-initialize redelivery.** The new `Query`'s `initialize` (or `reinitialize()` after a gap, CF:81073-81075; SDK:68116-68121) gets a `control_response` carrying `pending_permission_requests` and `pending_user_dialog_requests`.
       - The CLI builds them from its own pending state: `w.getPendingPermissionRequests()`, `w.getPendingUserDialogRequests()`, telemetry `tengu_reinit_pending_redelivery` (CLI:77939, 77991).
       - The SDK processes them only on an `initialize` response ("Ignoring prompt-redelivery fields on non-initialize response", SDK:68074-68085) and re-dispatches each as a `can_use_tool` / `request_user_dialog` request (SDK:67992-68004).
    2. **Stdout replay.** The checkpoint is not topped up while a prompt is pending (CF:64391-64397), so the original `control_request` frame is replayed too.
  - **De-duplication:** the SDK skips a second delivery with the same `request_id` ("Duplicate delivery of in-flight request … skipping", SDK:67037-67042).
- **When the request is truly lost.** It is lost only when Desktop starts a *new* process instead of adopting. DOCS: "If Desktop starts a new process instead, you lose the request."
- *(inferred)* An answer buffered in a `RemoteProcess` that died before delivery is not persisted. The CLI is still waiting, so redelivery shows the request again and the person answers twice; this is safe.

### 3.7 Held "cold sends"

- **What a cold send is.** A message sent to an SSH session with **no live `Query`** while the host is unreachable (`holdColdSend`, CF:33876-34023). It is held only when:
  - the failure is a classified reachability failure, not a terminal one;
  - the controller is not connected;
  - there is no pending rewind;
  - attachments fit the cap.
- **What holding does:**
  - It claims a `person_hold` reconnect claim, which keeps the reconnect loop alive and dialling (`claimReconnect`, DK:9390-9429).
  - It builds the SDK user message with a uuid. If that uuid was already used, a fresh one is minted "so the CLI doesn't drop the prompt as a duplicate" (CF:33852-33873).
  - It appends the message to `heldAcrossLoss`, shows it in the pane, and persists it to `waiting-input/<id>.json` plus blobs (250 ms debounce; immediate at quit; CF:72474-72530, 79974-80010).
- **Delivery.** On reconnect, `deliverColdHolds(controller)` (CF:33412-33540) delivers held sessions serially, each through `warmSession` (adopting where eligible) with a 120 s cap. On spawn, `releaseHeldMessages`, then `admitKeptInput`, then uploads feed them into the new `Query` (CF:80164-80210).
- **Messages to a live `Query` while the link is down** are held and released on the `reattached` event ("host link is down; holding the message for the live session and nudging reconnect", CF:89735-89746, 81202-81214).
- **Duplicates.**
  - **Within one process:** stdin offsets (§3.2).
  - **Across processes:** a message whose write to a lost process is uncertain is tagged `unverified:<pid>:<cliSessionId>`. It is settled by syncing the mirror and looking for a `type:"user"` row with that uuid (CF:32589-32613, 77624-77690). The verdict is one of:
    - `present`: the CLI took it; drop it;
    - `absent`: keep it for the next process;
    - `undecidable`: ask the person to resend (CF:58237-58300).

### 3.8 "Some output may be missing"

- **Detection** is exact: `firstSeq > checkpoint+1` in a reattach answer, which means the 16 MiB ring rolled over. It emits `gap-detected` (telemetry `desktop_ssh_reattach_gap`) and `reattach-gap` (CF:81048-81061).
- **Handler** (CF:81062-81134):
  1. `query.reinitialize()`, which also redelivers prompts;
  2. drop the message buffer except pending, held and unacknowledged rows;
  3. `resyncSshTranscriptAndReseed(…, "reattach-gap")`, which shows "Loading recent output from <host>…" and has a 120 s deadline (CF:62523-62558).
- **The visible notice.** If the mirror cannot fill the gap, a system row is pushed: "Some output produced while you were disconnected may be missing here." (`ZT`, CF:30532, pushed at CF:81107-81130).
- **The sibling notice:** "Newer output is available — reopen this session to load it." It appears when a reseed shares no row with the pane (CF:30533, 62758-62773).
- **An `exact` replay of more than 0 frames** also reseeds from the mirror, as `"reattach-replay"` (CF:81780-81782).

---

## 4. Liveness and reconnect

### 4.1 Detecting a dead link

**The heartbeat** (`RemoteRPCClient`, DK:1140-1755):

- Every `HEARTBEAT_INTERVAL_MS` = 7 s, the client skips the ping if a stream line arrived in the last 7 s. Traffic proves the link (DK:1668-1671).
- Otherwise it sends `server.ping` with timeout `livenessTimeoutMs(2000)` = `min(10000, max(2000, 3 × SRTT))`. SRTT is an EWMA with gain 0.25 (DK:1314-1323, 1364-1372).
- `HEARTBEAT_MAX_MISSES` = 2. Two consecutive misses force a close: the socket is destroyed, every pending request is rejected with "Connection closed", and `close` is emitted (DK:1719-1733, 1746-1754).
- **Worst case from the last byte to the close is about 18 s** *(inferred from the constants: up to 7 s to the first tick, a 2 s miss, 7 s, a 2 s miss)*.

**Guards against false deaths:**

- **Late pong.** A pong after its timeout resets the misses ("late pong … link is alive", DK:1373-1386, 1557-1566).
- **Queued pong (OpenSSH).** If bytes arrived during the ping's window, the miss is not counted ("the link is busy, not dead", DK:1263-1271, 1708-1718). This is bounded by the request timeout.

**Fast paths to a close:**

- **A write error** on any request closes at once (`forceCloseFromHeartbeat` in the write callback, DK:1426-1435).
- **Sleep.** If the tick gap is over 2× the interval (the machine slept), the next miss closes at once (DK:1652-1664).
- **Frozen process (OpenSSH).** If the process was frozen ≥ 360 s (`LINK_PRESUMED_DEAD_AFTER_FROZEN_MS`), which is longer than the daemon's 300 s idle close, the link is closed without a ping unless traffic arrived since ("longer than the remote daemon keeps a silent connection", DK:1672-1696, 5134-5136).
- **A stream hole** (§1.5) closes the link.

**Below the RPC:**

- ssh2: `keepaliveInterval` 15 s × 3 (BX:22488-22491).
- OpenSSH: `ServerAliveInterval=15 ServerAliveCountMax=3`, so about 45 s, on master and channels (D3:12072-12178). DOCS: "approve within 45 seconds".
- An SSH-level close also triggers `handleUnexpectedClose("ssh2_close")` (DK:8240-8245).

### 4.2 Probing on resume, unlock and network change

- **Triggers** (`Dr()`, DK:12387-12405):
  - `powerMonitor` `resume|unlock|session`, where `resume` means the path may have changed;
  - app `focus`, which notes presence;
  - a 3 s poll of `os.networkInterfaces()` (`Er`, DK:12312-12386). It ignores `awdl|llw|anpi`, and a change must hold for 2 polls (`xr = 2`) before it counts. On a change it logs "network-interface change detected; probing SSH controllers".
- **`jr()`** (DK:12449-12480), for every pooled controller:
  1. clear the last failure and any background backoff;
  2. `wake("signal")`;
  3. if disconnected, `ensureReconnectDriven`;
  4. if connected, `probeLiveness`, and on anything but `kept`, `recoverConnection`.
- **`probeLiveness`** (DK:11303-11426):
  - stream traffic in the last 10 s → kept, with no ping;
  - frozen ≥ 360 s → `dead_frozen`, replace;
  - otherwise a ping with a 1.5 s timeout (5 s if busy) → kept or dead.

### 4.3 The reconnect loop and backoff

`attemptAutoReconnect` (DK:9846-10450); constants at DK:5012-5150.

- **With something to preserve** (live processes, reconnect claims, owed kills):
  - delay = `min(2^failStreak × 1 s, 60 s)`;
  - after 30 consecutive failures (`RECONNECT_DECAY_AFTER_FAILURES`), or while a failure needs the person's attention, `RECONNECT_SLOW_TICK_MS` = **5 min** ("Desktop slows to about one attempt every five minutes", DOCS);
  - jitter: multiply by 0.7–1.3 (DK:9930-9972).
- **During the 5-min slow tick a reachability pre-probe** runs every ~30 s (`PREPROBE_INTERVAL_MS`). It is a TCP connect to the resolved sshd host:port, or a Coder workspace probe; there is none through ProxyJump (RP:59-92; DK:10908-10942; schedule `G`, DK:440-460). When the host answers, it dials within 0–10 s instead of waiting out the tick (DK:10915-10925).
- **With nothing to preserve:** idle schedule `[1 s, 2 s, 5 s]`, then stop.
- **Legacy timing** (killswitch): 2^n s capped at 30 s, for at most 10 min.
- **Flap control** (DK:8951-9061):
  - more than 5 unexpected closes in 5 min: an extra delay of 5 s × 2^(n−6), capped at 60 s;
  - 10 or more: "parked", a 5-min delay, and attention reported. If nothing needs preserving, auto-reconnect gives up and emits `disconnected`.
  - The episode ends after the connection holds for 5 min.
- **Wake priority** (`wake()`, DK:10951-11025): `demand` 3 > `input|focus|presence|agent` 2 > `signal_restart` 1 > `signal|view|follow_up|interrupted` 0.
  - A person's `send_message`, `interrupt`, `dialog_answer` or `manual` retry (`kn`, DK:4853) is a **demand**: it resets `failStreak` and dials now (`recoverConnection`, DK:11042-11067).
  - Repeated OS signals ramp-restart the backoff at most every 10 min to 2 h, after a fresh streak of 3 (DK:10985-11003).
- **Demand staleness:** a demand older than 5 min (`DEMAND_STALE_MS`) dials unattended (DK:10169-10177).
- **"Still reconnecting" warning** after 10 min (`RECONNECT_PROLONGED_MS`), noting that processes "remain detached and will reattach when the connection returns" (DK:9908-9922).
- **Sign-in prompts:** password, OTP and jump-host prompts hold the loop for a person. After 3 unanswered second-factor dials it waits for the person (`SECOND_FACTOR_MAX_UNANSWERED_DIALS`; DOCS jump-host notes).

### 4.4 What a reconnect costs

- **Healthy reconnect** (`leanReconnect` and `singleExecReattach`, both on by default, D3:18810-18851, 19360-19365):
  - **one exec**, which runs:
    1. the folded probe (env, uname, id, run-dir chmod, `server --version`, CLI check);
    2. `exec server --bridge`;
  - plus the SFTP subsystem opened in parallel.
  - `server.capabilities` is pipelined into the bridge's stdin before the probe output finishes.
  - Requirements: the OpenSSH engine, a token, a known CLI path, and no discrete channel mode.
- **Then, per live process**, one `process.reattach` (`rebindLiveProcesses`, DK:9273-9294, called at DK:8413-8417), answered with its replay on the same stream.
- **If the server was restarted rather than reused**, every tracked process is abandoned with a classified cause (DK:8418-8440).
- **Without single-exec:** a probe exec, optionally a dial check, then a bridge exec (15 s startup timeout, 30 s if live work is expected).
- **A fresh start adds** deploy, install, and `--stop && --serve` (§7).
- **Silent reattach.** A reattach that gets no answer while work may be live is judged by `judgeSilentReattach` (DK:9344-9377):
  - across a sleep: `retry`;
  - with a person waiting: `give_up`, which restarts the server;
  - otherwise `retry` until the budget is spent.

### 4.5 SSH engine choice (only where it changes the above)

- **System OpenSSH** (the default where available) uses a ControlMaster with `ControlPersist=no`, so nothing survives a Desktop quit; durability is the daemon's job.
  - Single-exec reattach, stream-hole checking, queued-pong-as-life and frozen-link replacement apply only here (DK:5185-5196, 8250-8257, 9212-9222).
  - If the control socket vanishes while the master lives, the transport is closed so the controller reconnects (D3:11139-11146).
- **ssh2 (built-in)** gets the plain heartbeat and the multi-exec reconnect.
- `ConnectTimeout` = the ssh-config value or 30 s (D3:13360). The master ready-wait is `max(ConnectTimeout, 30 s) + 5 s`, or + 30 s if a person may be prompted (D3:10983-10986).

### 4.6 The controller pool

- One `RemoteServerController` per host key (`_r`, DK:12257-12267, map `$` at DK:12190).
- Evicted on config deletion (DK:12406-12420). Retired locally with the daemon left running when the key changes (DK:12421-12435).
- All are detached on app exit (DK:12481-12486).

---

## 5. Timing constants

| Constant | Value | Where |
|---|---|---|
| RPC default timeout | 30 s | DK:1198 |
| Heartbeat interval / timeout / misses | 7 s / 2 s / 2 | DK:1145-1152 |
| Liveness timeout cap; RTT headroom; SRTT gain | 10 s; 3×; 0.25 | DK:1154-1161 |
| Frozen-gap memory | 15 s | DK:1163 |
| Capability handshake | 5 s | DK:9126 |
| Probe: recent traffic / ping / busy ping / seed ping | 10 s / 1.5 s / 5 s / 10 s | DK:5129-5145 |
| Link presumed dead after freeze | 360 s | DK:5135 |
| Reconnect backoff | 2^n s, cap 60 s, jitter ±30 % | DK:5046, 9943, 9972 |
| Decay after failures → slow tick | 30 → 300 s | DK:5049-5053 |
| Idle (nothing to preserve) schedule | 1, 2, 5 s | DK:5043 |
| Legacy cap / max duration | 30 s / 10 min | DK:5094-5098 |
| Pre-probe interval / hurry jitter | 30 s / 0–10 s | DK:5055-5058 |
| Reachability probe schedule | first 5 s, then 15 s ×8, then 60 s; tcp ≤ 240 probes | DK:440-460 |
| Flap window / backoff threshold / park threshold / base / cap | 300 s / 5 / 10 / 5 s / 60 s | DK:5113-5127 |
| Stream holes tolerated | 3 per 330 s | DK:9202-9207 |
| Demand stale | 300 s | DK:5037 |
| Prolonged reconnect warning | 600 s | DK:5076 |
| Signal ramp restart | 10 min → 2 h | DK:5066-5070 |
| Network-interface poll | 3 s, 2-poll debounce | DK:12404, 12271 |
| Detached rebind nudge | 60 s doubling to 30 min | DK:2045-2048 |
| Reattach grace (keep-live killswitch only) | 15 min | DK:2042 |
| Replay slots | 2 concurrent; wait 30 s; hold 60 s; drained at 256 KiB, 50 ms poll, 20 s max | DK:1088-1095, 2050-2063 |
| Rebind frame buffer | 64 MiB | DK:2066 |
| Stdin chunk / buffer / retries | 256 KiB / 16 MiB / 150 × 200 ms | DK:2030-2036, 3629-3636 |
| Stdout line max | 16 MiB | DK:2039 |
| Orphan killAndWait / RPC | 3 s / 15 s | DK:2069-2072 |
| killAndWait / ping (controller) | 5 s / 5 s | DK:5845, 5854 |
| Worktree RPC / daemon margin | 300 s / 10 s | DK:5857-5860 |
| SFTP read idle / transfer ceilings | 30 s / 300 s watched, 120 s unwatched | DK:11567-11573 |
| ssh keepalive (both engines) | 15 s × 3 | BX:22488; D3:12072-12178 |
| Bridge handshake | 15 s startup (30 s with live work, 5 s single-exec), 3 s reply, 15 s token re-read | D3:19525-19527, 19696-19705, 19770 |
| Adoption windows | RC 7 d; mid-turn 3 d; host-activity 24 h | D3:462-506 |
| Launch re-adoption | 5 s settle; 3 hosts; 2 workers; 8 adoptions; 60 s each | CF:59234-59420, D3:464 |
| Dormant-after-drop window | 60 s | CF:104606-104610 |
| Cold delivery per session / waiting-input debounce | 120 s / 250 ms | CF:33412-33540, 72474 |
| Gap backfill deadline | 120 s | CF:62523-62558 |
| Daemon: helper ring / stdin queue | 16 MiB / 16 MiB | BIN `frameSink.emit`, "stdin backpressure: queue full" |
| Daemon: connection idle close | 300 s, both directions | BIN `closeWhenIdle` |
| Daemon: abandonment | 30 d with no request and nobody connected | BIN; DOCS |
| Daemon: link-bound process unattended | 7 s | BIN `endWhenUnattended` |
| Daemon: exited-process prune | 900 s | BIN *(field use)* |

---

## 6. Transcript mirror

- **Location:** `~/.claude/projects/ssh-<cliSessionId>/<cliSessionId>.jsonl` (CF:30151, 61086-61091).
- **Transport: SFTP over the same SSH connection, not daemon RPC.** `doPersistSSHTranscript` (CF:61121-61185) calls `controller.appendRemoteFileRange(path, offset, localPath)` (DK:11575-11594). That calls `Hd()` (D3:14764-14900), which:
  - opens the local file for append and checks that its size equals the tracked offset (else `MirrorOffsetMismatchError`, and the offset is re-derived);
  - reads the remote file from the offset in 254 KiB SFTP reads, with a 30 s idle timeout and a 512 MiB per-call ceiling;
  - appends **only complete lines** (a line over 64 MiB stops the mirror there).
  - The fallback is a shell tail (300 s idle).
  - Subagent transcripts are synced too.
  - In-flight syncs are coalesced.
- **When it syncs. There is no periodic timer; it is event-driven:**
  - each turn `result` (CF:64109, 64318);
  - query close or error;
  - pending-save flush (including at quit);
  - archive and fork;
  - session start or preload;
  - unverified-input verdicts (§3.7);
  - every reseed.
- **What the UI reads.**
  - **Live stream:** new output, through the SDK `Query` into `messageBuffer` and `message` events. It is trimmed to the last 500 rows past 600 (CF:50680-50688).
  - **Mirror** (`fetchRemoteTranscript`, then `loadTranscriptFromDisk`, CF:60940-60975):
    - session open;
    - every reseed, with priorities `warm`, `reconnect`, `cold-fetch`, `reattach-replay` and `reattach-gap` (CF:62716-62789).
    - A reseed aligns to the renderer's anchor uuid and declines if it shares no row.
  - The mirror is the source of truth for history and for filling gaps. The stream is never relied on for history.

---

## 7. Versioning, install and update

- **Pins.**
  - Helper: version `683cc6a9…`, base `https://downloads.claude.ai/claude-ssh-releases`, a per-platform sha256 and size of `claude-ssh.zst` (MU:97896-97929). URL `${base}/${ver}/${plat}/claude-ssh.zst` (D3:138-140).
  - CLI: 2.1.299 from `claude-code-releases` (MU:97809-97818).
- **Local cache:** `userData/claude-ssh-remote/<ver>/claude-ssh-<plat>` plus a `.verified-<plat>` marker. It is seeded from the app bundle, else downloaded resumably with sha256 verification, 3 attempts, 1 s then 2 s backoff (D3:161-334).
- **Upload only when the host's version differs.** `server --version` must match `/claude-ssh\s+(\S+)/` and equal the pin (D3:17567-17621).
  - The upload goes over SFTP to `server.<clientId>.<8hex>.part`, is resumable, and has a 120 s stall watchdog. Then `chmod +x; mv -f`, an atomic rename, so a running old daemon keeps its inode (D3:17686-17830).
  - One `srv/<ver>/` per version; the current one plus 9 are kept (D3:17798-17833).
- **An older helper already running with live work is not replaced.**
  - Desktop reattaches to it ("Reattached to an older remote server … its replacement is deferred to a later connect", DK:8364-8380).
  - When a new binary is deployed, it first reads the old daemon's `children/*.json` and `~/.claude/sessions/<pid>.json` (status busy or waiting) to look for live work (`Ae`, D3:570-636; 5 s budget). If it finds any, replacement is "put off for 7 days or more, and only a turn in progress under it still puts it off" (D3:16649-16651).
  - DOCS: "Desktop replaces the helper on the remote machine at a later connection, which can end a task that still runs."
- **Replacement ends that daemon's CLIs** (§1.2). There is no hand-over of children between daemon instances.
- **`restartRemoteHelper`** (CF:81380-81402, DK:10832-10868) exists only for a helper too old for a managed launcher. It abandons this run's processes, killing all but adopted (kill-guarded) ones, and reconnects with `forceDaemonReplace`.
- **CLI install.** `server --install --cli-dir ~/.claude/remote/ccd-cli --cli-version <ver>-<sha12> --cli-keep 3` (D3:18234-18700).
  - The host fetches the CLI itself (`--cli-url`, `--cli-checksum`). The fallback is a Desktop download plus SFTP upload and `--cli-zst`.
  - The helper prunes to 3 versions. Each CLI is a separate file, so a running CLI is never overwritten.
- **Idle restart of a session's CLI.** `restartRemoteSession` refuses mid-turn, when RC-bound, with held input, or when busy (CF:81475-81630). `reinstallRemoteClaudeCode` runs only after a failed managed-launcher probe (CF:81362-81379).
- **App updates wait on SSH work.** DOCS: an update restart "waits while Claude is working on an SSH task", except after 72 h on macOS with a Claude account. The rejoin after it is the normal adoption path (§3.5). *(inferred: not traced in source.)*

---

## 8. Against the desk's diagnosed failures (MAWS #52, comment 2026-10-19T20:15:33Z)

### 8.1 The hub forgets a project is open while the machine's stream stays up

**SSH mode's answer: subscription state belongs to the connection generation, and the client re-asserts it idempotently.** No intermediary holds it.

- **One owner of the subscription.**
  - There is no hub. A process's "subscription" is the `stream:<processId>` listener on the current `RemoteRPCClient` (DK:2173-2177), plus the daemon's writer for that process, which a new attach supersedes (BIN `ConnWriter.Supersede`).
  - Neither side can drop it while the other believes it is live, because both sides tie it to the connection.
  - When the connection closes, every process goes `detached` together (DK:2798-2813).
  - After every successful connect, every live process is re-attached with `process.reattach{id, fromSeq}` (DK:9273-9294).
- **The re-assertion is idempotent:** reattaching an already-attached process just supersedes the writer and replays from `fromSeq`. Duplicates are dropped by `seq` (DK:3694-3697).
- **There is a self-heal for the "link up, process not bound" state the desk hits:** the `rebind-wanted` nudge (60 s, doubling) rebinds any process still detached on a live connection (DK:2814-2843, 9634-9649).
- **What the desk should take:**
  - make "project open" a property of the stream generation, re-sent by the machine on every new generation and idempotent at the hub;
  - never delete it on a send failure without closing that generation;
  - add a periodic "am I bound?" reconcile.
- **Not covered:** SSH mode has no multi-client hub, so it says nothing about fan-out membership itself.

### 8.2 A resent answer arrives 60 s late and is refused as stale

**SSH mode has no freshness window on input. Exactly-once comes from position, and resends are safe at any age.**

- **Input is a byte stream with offsets.** A resend carries its original offset. The daemon applies it if new, answers `duplicate:true` if already applied, and refuses `-32003` if ahead, after which the client re-queues in order (DK:3561-3644; `stdinApplied` in the reattach answer, DK:2584-2589).
- **A write counts as delivered only when its RPC is answered.** On a transport error or close it goes back in the queue (DK:3593-3599). All pending RPCs are rejected with "Connection closed" when the link dies (DK:1607-1620), so the client always knows which writes are unacknowledged.
- **The answer to a prompt is de-duplicated by the prompt's `request_id`** (SDK:67037-67042), and the CLI settles each request once. A late duplicate is a no-op, never a refusal.
- **An answer is a demand.** `dialog_answer` and `send_message` wake the reconnect loop at once and reset the backoff (`kn`, DK:4853; DK:11042-11067), so it does not sit behind a backoff timer.
- **What the desk should take:**
  - Replace "refuse after 60 s" with idempotency keyed on the request being answered (`request_id` or digest), plus a per-stream sequence or offset for ordering.
  - Keep a time bound only as a security property: the replay of a captured message. If one is needed, re-seal on resend, as the issue already proposes.
  - Answer delivery should be acknowledged end to end. Until the ack, it is pending and re-sent on every new generation.

### 8.3 Resume takes about 30 s, most of it opening the subscription

**SSH mode's answer: opening the subscription is one request with no readiness polling; history comes from a local mirror; the replay rides the same stream.**

- **One request.** `process.reattach{id, fromSeq}` either answers `{found, running, firstSeq, lastSeq}` and starts replaying on the same connection, or says `found:false`. There is no "not ready, retry" state.
  - Frames that arrive before the answer are buffered, not refused (`_rebindFrameBuffer`, DK:3680-3693).
  - The call is made with `timeout:null` while keep-live is on, so it never fails and backs off merely because it was slow (DK:2539-2550, 3059-3068).
- **The pane does not wait for the subscription.** Session open loads the mirrored JSONL from local disk (CF:60940-60975). The live replay only adds rows after the checkpoint. A reseed from the mirror runs only after a replay or a gap.
- **A reconnect is one SSH exec**, with `server.capabilities` pipelined (§4.4).
- **Replay is bounded and fair:** 2 slots, drained at 256 KiB (DK:1088-1095, 3037-3053), and delivered 64 frames per tick (DK:1586-1606).
- **No growing backoff while a person waits.** A person's action is a demand that dials now (DK:10951-11025).
- **What the desk should take:**
  - open the subscription as "reattach from my last seq", served immediately from the machine's ring, with no snapshot readiness gate;
  - render history from a locally cached transcript at once;
  - never back off a subscription open while a resume is in flight;
  - timestamp open → first frame for the benchmark.
- **Inherent, as in SSH mode:** the CLI's own start (about 2.5 s on the desk) when a *new* process is needed.

### 8.4 A dead socket that still reports open goes undetected

**SSH mode's answer: an application-level, traffic-aware heartbeat, plus treating any write error or a missed ack as death.**

- **Heartbeat:** `server.ping` every 7 s whenever no stream line arrived in the last 7 s, with a 2 s timeout adapting to 3×SRTT (capped at 10 s); 2 misses force a close (DK:1145-1158, 1649-1738). The worst case is about 18 s *(inferred)*.
- **Guards against killing a busy link:** a late pong resets the misses; inbound bytes during a ping count as life (DK:1263-1271, 1373-1386).
- **A write error on any request destroys the socket at once** (DK:1426-1435).
- **Sleep and resume are handled explicitly:**
  - a tick gap over 2× the interval arms an immediate close on the next miss;
  - a freeze longer than the server's idle timeout replaces the link without asking (DK:1652-1696);
  - OS resume, unlock and network-interface changes trigger a 1.5 s probe ping, skipped if traffic arrived in the last 10 s (DK:12387-12480, 11303-11426).
- **The SSH layer adds** a 15 s × 3 keepalive under the RPC (BX:22488; D3:12072-12178). The daemon closes connections idle in both directions after 300 s (BIN), so a half-dead connection cannot pin server state forever.
- **What the desk should take:**
  - an app-level ping on the browser↔hub and machine↔hub sockets at a few seconds' interval, skipped while frames are flowing;
  - close on 2 misses, and close on any send error;
  - on `visibilitychange`, `online` and focus, probe at once with a short timeout;
  - have the hub close sockets silent beyond a bound, so both ends converge.

---

## 9. Not verified / open

- **The `at` field of the line-end trailer.** It is assumed to be a per-connection byte offset; it was checked only against the client's arithmetic.
- **The pairing of some daemon timer fields to their log strings** (600 s orphan re-check; 3600 s / 7 d and 60 s / 600 s TTL clamps) was inferred from field use in the disassembly.
- **The adoption path's first `initialize`.** That the new `Query`'s first `initialize` (not only `reinitialize()`) gets the redelivery fields is inferred from the CLI building them in its initialize handler (CLI:77991). The SDK-side path for the first `initialize` was not traced.
- **Renderer de-duplication** of rows re-seen after a reseed (uuid keyed) was not read.
- **The app-update restart's wait** on SSH work is from DOCS, not traced in source.
