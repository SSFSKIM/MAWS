# Remote-development and real-time prior art for MAWS #52 (the desk's remote protocol)

**Question.** How do the strongest remote-development and real-time systems carry a desktop-class UI to a remote backend with low latency, fast reconnect and many concurrent clients, and what went wrong for them?

**Scope.** This note covers everything except the Anthropic side (Remote Control, the claude.ai client and Claude Desktop's SSH helper), which is already mapped in [claude-ai-rc-client-protocol.md](claude-ai-rc-client-protocol.md) and its siblings. Where an Anthropic number makes a useful comparison, it is quoted from that note.

**Method and evidence labels.**
- VS Code and Zed were read from source, cloned shallow and sparse into `/private/tmp/rdpa-src/` (not built, not run):
  - `microsoft/vscode` at commit `1155fd0121681ec18b955961d1c1d9ccf9b547a7` (cited as `vscode@1155fd0:path:line`);
  - `zed-industries/zed` at commit `60e8c18598646a83b3a67a3b6a452ac552f36c24` (cited as `zed@60e8c18:path:line`).
- Everything else comes from docs, engineering posts and issue trackers fetched on 2026-10-19 (URLs inline).
- **FACT** = stated in code or a primary source. **INFER** = my reading. **NOT FOUND** = searched, not found; no number was guessed.

---

## 0. The short answer

The systems that do this well share a small set of mechanisms, and their failures cluster in a different, equally small set.

**What they converge on**
1. **A session object on the backend that outlives the socket.** VS Code keeps a disconnected window's server state for 3 h (`vscode@1155fd0:src/vs/base/parts/ipc/common/ipc.net.ts:304`), Zed's headless server waits 10 min for a client (`zed@60e8c18:crates/remote_server/src/server.rs:518`), and Zed collab holds a room seat for 30 s (`zed@60e8c18:crates/collab/src/rpc.rs:77`). The socket is disposable; the session is not.
2. **Numbered messages, cumulative acks and an unacked replay queue** for the *live* channel (VS Code `PersistentProtocol`, Zed `ChannelClient`), so a socket swap loses nothing within the grace window.
3. **State-based resync, not log replay, for anything large or long-lived.** VS Code terminals reconnect by replaying a *serialized screen* from a headless xterm, not the raw byte stream; Zed collab rejoins by sending version vectors and scan ids; Figma reloads the file then streams; Mosh synchronizes the latest screen state. Log replay is reserved for the short window between socket death and reconnect.
4. **Fast, independent liveness on both ends**: 1-5 s keepalives and 10-25 s death verdicts (VS Code 5 s / 20 s, Zed 1 s / 10 s on collab and 5 s × 5 on SSH remoting, Mosh 3 s), with a guard against blaming the network for a stalled event loop.
5. **Put latency-critical rendering next to the user and authority next to the data.** VS Code's `extensionKind` ui/workspace split, Zed's "UI, parsing and highlighting local; files, LSP, terminal remote", JetBrains' thin client with a local editor model. The UI never round-trips to draw a keystroke.
6. **A single ordering authority per document or session, with client-generated ids for optimistic echo** (Figma, Linear `lastSyncId`, Replicache mutation ids, Zero's two promises, Mosh's server-side echo ack).

**What went wrong, repeatedly**
- **Reconnect classifiers that give up.** VS Code's reconnect loop retries only on four errno codes; a managed socket that closes with a code-less "Connection closed" turns a 3 h grace into an immediate permanent failure ([vscode-remote-release#11805](https://github.com/microsoft/vscode-remote-release/issues/11805), Aug 2026). Zed gives up after 3 reconnect attempts (`remote_client.rs:170`).
- **Half-dead connections that look alive.** A tunnel that respawns, reports "online" and never reattaches to the relay stayed dark for 44 h ([vscode-remote-release#11550](https://github.com/microsoft/vscode-remote-release/issues/11550)); Zed showing "connected" after sleep + VPN drop ([zed#20375](https://github.com/zed-industries/zed/issues/20375)).
- **Sub-sessions that don't reconnect with their parent.** Zed's ACP agent threads (Claude Code among them) stay bound to a dead pipe after the remote server reconnects ([zed#60213](https://github.com/zed-industries/zed/issues/60213)); VS Code's extension host can die silently while the window looks fine (#11805).
- **Thundering herds on deploy** (Figma LiveGraph; Cloudflare restarts every Durable Object on deploy).

---

## 1. VS Code remote (Remote-SSH, VS Code Server, Remote Tunnels, vscode.dev)

### 1.1 Topology and the feature split

- **One server, several connections per window.** A remote window opens a *management* connection and an *extension host* connection, each its own socket wrapped in its own `PersistentProtocol`, each keyed by its own `reconnectionToken` (`vscode@1155fd0:src/vs/server/node/remoteExtensionHostAgentServer.ts:71-73, 415-498`). Terminals, file system and other services are named channels on the management connection.
- **Transports.** WebSocket by default; Remote-SSH can pass `skipWebSocketFrames=true` and send the same protocol raw over an SSH-forwarded socket (`remoteExtensionHostAgentServer.ts:221-229`). Remote Tunnels and vscode.dev reach the same server through the Microsoft dev-tunnels relay (§3.2).
- **Where features run: `extensionKind`.** An extension declares `ui`, `workspace` or `web`; if it doesn't, VS Code deduces it: anything with a Node `main` is `workspace` (runs next to the files); browser-only code is `web`; a declarative extension is filtered by what each contribution point supports (`vscode@1155fd0:src/vs/workbench/services/extensions/common/extensionManifestPropertiesService.ts:265-292`). The core rule, INFER: *code that needs the files runs remote; code that needs the user's machine or must feel instant runs local; everything else is declarative and can run either side.* The editor, rendering, keybindings and themes are always local.
- **Auth.** A connection token (`connectionToken`, default `0000…` when absent) plus a sign/validate challenge in control messages before any regular traffic (`vscode@1155fd0:src/vs/platform/remote/common/remoteAgentConnection.ts:254-289`); the handshake must answer within 10 s (`:266`). Unauthorized clients are refused in built servers (`remoteExtensionHostAgentServer.ts:373-376`).

### 1.2 Framing and multiplexing

- **`PersistentProtocol` frame**: 13-byte header = type (u8) | id (u32be) | ack (u32be) | length (u32be), then body (`vscode@1155fd0:src/vs/base/parts/ipc/common/ipc.net.ts:290, 374-381, 472-484`). The in-file comment still says "9 bytes", a stale doc (`:539`).
- **Types**: Regular, Control, Ack, Disconnect, ReplayRequest, Pause, Resume, KeepAlive (`ipc.net.ts:263-273`). Only Regular messages are numbered and acked; Control is for the handshake and is resent by the handshake itself on reconnect.
- **Write coalescing**: every write in one tick is concatenated and flushed on `setTimeout(0)` (`ipc.net.ts:506-527`). The Node WebSocket layer then re-splits anything over **256 KB** into separate frames, because one 100 MB write would otherwise wait for zlib to deflate all of it and arrive as one read on the far side (`vscode@1155fd0:src/vs/base/parts/ipc/node/ipc.net.ts:277, 388-404`).
- **Compression**: permessage-deflate is negotiated when offered (`node/ipc.net.ts:52-67`); the server can disable it (`--disable-websocket-compression`). Because deflate is stateful, when a socket is handed from the server process to the extension-host process, the bytes already inflated are recorded and replayed into the new zlib instance (`node/ipc.net.ts:322-340`). INFER: per-connection compression state is a hidden cost of handing sockets between processes, or of a relay terminating and re-originating streams.
- **Channel multiplexing (`ipc.ts`)**: request types Promise=100, PromiseCancel=101, EventListen=102, EventDispose=103; response types Initialize=200, PromiseSuccess=201, PromiseError=202/203, EventFire=204 (`vscode@1155fd0:src/vs/base/parts/ipc/common/ipc.ts:40-72`). Calls are `call(channel, command, arg, cancellationToken)` and subscriptions are `listen(channel, event, arg)` (`:36-37`). Requests for a channel not yet registered are queued for **1000 ms** before failing (`:339-342, 482-502`).
- **Extension host RPC** (`rpcProtocol.ts`): proxy-identifier RPC over the ext-host connection; the peer is marked unresponsive after **3 s** without a reply to an outstanding request (`vscode@1155fd0:src/vs/workbench/services/extensions/common/rpcProtocol.ts:119, 186-214`).

### 1.3 What survives a disconnect, and replay

All FACT from `vscode@1155fd0:src/vs/base/parts/ipc/common/ipc.net.ts` unless noted.

| Constant | Value | Line |
|---|---|---|
| `AcknowledgeTime` (max ack delay) | 2 s | 294 |
| `TimeoutTime` (death verdict) | 20 s | 300 |
| `ReconnectionGraceTime` | 3 h | 304 |
| `ReconnectionShortGraceTime` | 5 min | 308 |
| `KeepAliveSendTime` | 5 s | 312 |
| Client `RECONNECT_TIMEOUT` per attempt | 30 s | `remoteAgentConnection.ts:24` |
| Reconnect waits (s) | `[0, 5, 5, 10, 10, 10, 10, 10, 30]`, then 30 | `remoteAgentConnection.ts:660` |
| Replay-request throttle | once per 10 s | 1019 |

- **Replay queue**: every Regular message is pushed onto `_outgoingUnackMsg` before it is written, and dropped only when a cumulative ack ≥ its id arrives (`:1077-1085, 996-1007`). The queue is **unbounded** (a plain `Queue`), so memory, not time, is the real limit during a long outage.
- **Acks are piggybacked** on every outgoing Regular and KeepAlive frame; a bare Ack is sent only if nothing else went out within 2 s (`:1097-1121, 1226-1231`).
- **Gap detection**: a Regular message whose id is not `last+1` is dropped and a ReplayRequest is sent (throttled to 10 s); the peer answers by resending its whole unacked queue (`:1014-1027, 1045-1053`).
- **Reconnect**: the client opens a fresh socket with `?reconnectionToken=<uuid>&reconnection=true`, re-runs auth on the *same* protocol object, and `endAcceptReconnection()` first sends an Ack for everything received, then resends every unacked message (`remoteAgentConnection.ts:235-249`; `ipc.net.ts:974-993`). Messages sent while reconnecting are queued, not written (`:1081-1085`).
- **Server bookkeeping**: unknown token → reject "Unknown reconnection token (never seen | seen before)"; live duplicate → reject (`remoteExtensionHostAgentServer.ts:415-437`). After socket close the server waits the grace time before disposing (`vscode@1155fd0:src/vs/server/node/remoteExtensionManagement.ts:64-80`).
- **The short grace**: when *any new client* completes a handshake, every disconnected connection's countdown is cut to 5 min, on the theory that "the server owner has connectivity" (`remoteExtensionHostAgentServer.ts:381-391`; `remoteExtensionManagement.ts:91-99`). The maintainer explained the 3 h / 5 min rule in [vscode-remote-release#3477](https://github.com/microsoft/vscode-remote-release/issues/3477) and noted it "can be problematic if vscode server is used as a multi-user server". INFER: this is a single-user heuristic; a many-viewer system should not let one viewer's arrival shorten another's resume window.
- **Configurable**: `--reconnection-grace-time` on the server and `remote.SSH.reconnectionGraceTime` per host since VS Code 1.107 ([remote release notes v1_107](https://github.com/microsoft/vscode-docs/blob/main/remote-release-notes/v1_107.md)); the server tells the client its value (`remoteAgentEnvironmentImpl.ts:110-134`).

### 1.4 Terminals: snapshot on reattach, not log replay

- Terminal processes live in a pty host that outlives the window; after the client disconnects, they are kept for a grace period (local: **60 s**, short grace **6 s**; `vscode@1155fd0:src/vs/platform/terminal/common/terminal.ts:874-878`).
- On reattach the pty host replays a **serialized screen from a headless xterm** (`XtermSerializer`, `vscode@1155fd0:src/vs/platform/terminal/node/ptyService.ts:788-795, 849`), bounded by `terminal.integrated.persistentSessionScrollback` (default **100 lines**, `terminalPlatformConfiguration.ts:398-405`). A separate raw recorder is capped at **10 MB** (`terminalRecorder.ts:10`).
- **Flow control**: the pty pauses at **100,000** unacknowledged chars and resumes at **5,000**; the client acks every **5,000** chars (`terminal.ts:881-901`). Output is coalesced for **5 ms** before sending (`terminalDataBuffering.ts:28-38`). The comment is candid: "heavy commands will likely pause as latency grows, not flooding the connection is the important thing as it's shared with other core functionality" (`terminal.ts:886-896`).
- **Pty host heartbeat**: 5 s, 20 s while starting (`terminal.ts:466-476`).
- INFER for the desk: a Claude Code transcript is the same shape. Viewers that attach late need the *current state* (settled transcript + in-flight message), not every streamed token; and a single heavy stream must not starve control traffic on a shared connection.

### 1.5 Liveness

- Both sides send KeepAlive every 5 s. A socket is declared dead when either (a) the oldest unacked message is ≥ 20 s old and nothing has been received for ≥ 20 s, or (b) nothing has been received for ≥ 20 s at all (`ipc.net.ts:1123-1210`).
- **Load guard**: neither verdict fires if the local event loop looks stalled. `LoadEstimator` ticks every 1 s and counts how many of the last 10 ticks ran on time; < 50 % on time is "high load" (`ipc.net.ts:742-787, 1154, 1201`). This prevents a busy renderer from trashing a healthy socket. INFER: the browser's background-tab timer throttling produces exactly this false signal; any browser-side liveness check needs the same guard.

### 1.6 Known pain points

- **Retry classifier too narrow**: the loop retries only on `ETIMEDOUT/ENETUNREACH/ECONNREFUSED/ECONNRESET` with `syscall==='connect'`, `TemporarilyNotAvailable` and cancellations (`remoteAgentConnection.ts:700-733`). A Remote-SSH managed socket closing mid-connect ("Connection closed", no code) is classified permanent, so the 3 h grace is forfeited on the first attempt; VPN drops of 12-48 s triggered it, and in one case the remote extension host was dead for ~20 h with no prompt ([#11805](https://github.com/microsoft/vscode-remote-release/issues/11805), VS Code 1.133, open). INFER: *default to retry while the grace window is open; treat only explicit server verdicts as permanent.*
- **Zombie tunnel**: after a DNS failure during relay reconnect, `code tunnel` respawned, reported online, never re-established the relay socket, and kept the process alive so systemd never restarted it: 44 h offline ([#11550](https://github.com/microsoft/vscode-remote-release/issues/11550), open). INFER: liveness must be measured end to end (relay ↔ daemon), not inferred from "process is up".
- **Stale cached endpoint**: an agent-host tunnel retried a cached loopback port 10× after the upstream rebound, then gave up ([#11866](https://github.com/microsoft/vscode-remote-release/issues/11866)). Re-resolve on every attempt.
- **"Cannot reconnect, please reload the window"** is the generic terminal state when the token is unknown (server restarted or grace expired); there is no state-based fallback, only a reload ([#3477](https://github.com/microsoft/vscode-remote-release/issues/3477)).
- **Grace covers the wrong layer** for agents: the management connection's grace doesn't keep the extension host (where a Claude Code extension runs) alive ([anthropics/claude-code#97754](https://github.com/anthropics/claude-code/issues/97754)).
- **No fan-out**: VS Code remote is one client per connection; there is no shared viewer model. Multi-viewer is Live Share, a separate product (not covered here).

---

## 2. Zed: SSH remoting, the headless server, proto RPC, collab

### 2.1 Topology and the feature split

- **Split** (FACT, [docs](https://zed.dev/docs/remote-development)): the local app runs the UI, language-model calls, Tree-sitter parsing and highlighting, and keeps unsaved changes; the remote headless server holds source, language servers, tasks and terminals. Core types (Project, LspStore, GitStore, Worktree) have local and remote variants behind one interface. INFER: Zed parses locally so highlighting never waits on the network; the remote ships text and CRDT operations, not rendered views.
- **Connection**: Zed shells out to the user's `ssh` with a ControlMaster (`ControlMaster=yes`, `ControlPersist=no`, `zed@60e8c18:crates/remote/src/transport/ssh.rs:312-316`), uploads or downloads a version-matched `remote_server` binary, and runs it in **proxy mode**. The proxy starts the daemon if needed or **reattaches** to the running one. Each project gets one control master that multiplexes the Zed protocol, terminals and tasks.
- **Daemon IPC**: the daemon listens on three Unix sockets (`stdin.sock`, `stdout.sock`, `stderr.sock`) plus a pid file under the server dir (`zed@60e8c18:crates/remote_server/src/server.rs:504-506, 892-895`). The proxy just pipes SSH stdio into them. The same stdio design works over `docker exec` and WSL ([dev containers post](https://zed.dev/blog/dev-containers)).
- **Server lifetime**: the daemon exits after **10 min** with no connection (`server.rs:517-518, 551`).

### 2.2 Framing and RPC

- **SSH remoting frame**: u32 **little-endian** length + protobuf `Envelope` (`zed@60e8c18:crates/remote/src/protocol.rs:8-50`).
- **Envelope**: `id`, optional `responding_to`, optional `original_sender_id`, optional `ack_id`, and a `oneof payload` (`zed@60e8c18:crates/proto/proto/zed.proto:21-33`). Request/response is "send with id, reply with `responding_to`"; streaming responses end with `EndStream`.
- **Collab (WebSocket)**: each envelope is protobuf-encoded then **zstd level 4** compressed, one binary WebSocket message per envelope (`zed@60e8c18:crates/rpc/src/message_stream.rs:42-60`).
- **Chunking**: worktree updates are split to at most **256** entries per message (`zed@60e8c18:crates/proto/src/proto.rs:962-964`) so one big scan doesn't block the pipe.

### 2.3 What survives a disconnect, and replay

- **SSH remoting uses the same design as VS Code**: each side's `ChannelClient` keeps every sent envelope in an unbounded `VecDeque` buffer; every outgoing envelope carries `ack_id = max_received`; incoming `ack_id` pops the buffer (`zed@60e8c18:crates/remote/src/remote_client.rs:1540, 1630-1634, 1944-1953`).
- **Resync**: on reconnect the client sends `FlushBufferedMessages`; the server resends its buffer and acks; the client then resends its own (`remote_client.rs:1636-1650, 1816-1833`). A comment records a real ordering bug: "Queue the flush before waiting for the handshake, or its ack_id could cause the server to discard messages we missed while disconnected" (`:1818-1819`), and handshake acks are explicitly excluded from acking buffered messages (`:1615-1622`).
- **Timeouts** (`remote_client.rs:161-170`): heartbeat every **5 s**, each ping times out at **5 s**, **5** missed → reconnect; initial connect **60 s**; reconnect handshake **15 s**; resync **15 s**; **max 3** reconnect attempts, then `ReconnectExhausted`. Any incoming traffic resets the missed count, so a busy link needs no pings (`:811-864`).
- **Collab** (`zed@60e8c18:crates/collab/src/rpc.rs:77-80, 1344-1380`): a dropped connection keeps the user's room membership and shared projects for **30 s** (`RECONNECT_TIMEOUT`); after that the server leaves the room on their behalf. Stale state from a dead server instance is swept after **15 s** (`CLEANUP_TIMEOUT`, sized to Kubernetes' 10 s termination grace).
- **Collab rejoin is state-based**: `RejoinRoom` carries, per project, each worktree's and repository's `scan_id` (`zed@60e8c18:crates/proto/proto/call.proto:28-56`), and channel buffers rejoin with CRDT version vectors (`BufferVersion`, `buffer.proto:94-97`; `RejoinChannelBuffers`, `channel.proto:257-263`). The server answers with what changed since those versions. No message log is needed.
- **Collab client backoff**: 500 ms initial, doubling to 30 s, plus random jitter of up to 100 % of the current delay; connect timeout 20 s (`zed@60e8c18:crates/client/src/client.rs:87-89, 703-735`).

### 2.4 Liveness

- **Collab peer**: keepalive ping after **1 s** of send-idleness, any write must finish in **2 s**, and the connection dies after **10 s** without receiving anything (`zed@60e8c18:crates/rpc/src/peer.rs:94-96, 171-226`). Incoming messages go through a bounded channel of **256** (`:130-133`), so a slow consumer applies back-pressure instead of growing memory. INFER: 1 s / 10 s is tight because collab runs over the public internet to Zed's own servers, where a quick verdict and fast rejoin beat waiting.

### 2.5 Fan-out (collab)

- Collab is a central relay (Zed's servers, Kubernetes). The **host** owns the project; guests' read requests are forwarded to the host (`forward_read_only_project_request`, `rpc.rs:359-368`) and host notifications are broadcast to all guests (`broadcast_project_message_from_host`, `rpc.rs:431-448`). Buffers are CRDTs, so guest edits apply locally at once and converge.
- INFER: this is the closest public analogue to "many viewers of one agent session": the host machine is authoritative, the relay routes and broadcasts, and viewers rejoin with what they already have.

### 2.6 Known pain points

- **Reconnect gives up**: 3 attempts then manual reconnect; issues report idle drops that need a restart ([#38522](https://github.com/zed-industries/zed/issues/38522)), no auto-reconnect after suspend ([#59344](https://github.com/zed-industries/zed/issues/59344)), and "remote server is missing" after reconnect ([#49363](https://github.com/zed-industries/zed/issues/49363)).
- **Stale "connected"** after sleep + VPN drop; ~10 s to notice once the network returned ([#20375](https://github.com/zed-industries/zed/issues/20375), closed stale).
- **Sub-sessions don't follow the parent**: after an SSH drop, ACP agent threads (Claude Code, Codex, others) keep the dead pipe while the remote server reports reconnected; only a workspace reload recovers ([#60213](https://github.com/zed-industries/zed/issues/60213), open; a manual "reload" control landed in PR #62669). Language servers also broke after reconnect ([#29032](https://github.com/zed-industries/zed/issues/29032)). INFER: the agent process should be owned by the daemon and addressed by a session id that survives transport churn, not bound to the transport that spawned it.
- **Heartbeat false alarms** blamed on OpenSSH 10.1 ([#39692](https://github.com/zed-industries/zed/issues/39692)) and periodic hourly drops with a remote agent running ([#59394](https://github.com/zed-industries/zed/issues/59394)).
- Zed v0.157 removed the old mode that routed remote traffic through Zed's servers; remoting is now direct SSH only.

## 3. JetBrains, Codespaces, dev tunnels, code-server and openvscode-server

Pinned sources for this section: `JetBrains/rd@d495569`, `microsoft/dev-tunnels@b73b0eb`, `microsoft/dev-tunnels-ssh@e65278d`, `coder/code-server@f07405c`. Line numbers were read from raw files at those commits.

### 3.1 JetBrains Gateway / Remote Development and the rd protocol

- **Split** ([split-mode docs](https://plugins.jetbrains.com/docs/intellij/split-mode-and-remote-development.html)): a thin *frontend* (Rider-platform client) renders the UI and runs typing assistance; the headless *backend* hosts the project model, indexing, analysis and execution. Plugins are split into frontend, backend and shared modules; the shared module declares RPC interfaces (kotlinx.serialization). JetBrains' guidance: latency-sensitive behavior must live on the frontend; a backend-only UI is streamed as drawing commands and pays a round trip per interaction. A built-in latency emulator delays all RPC for testing. JetBrains' 2025.2 notes say caret moves and breakpoints now apply locally first ([2025.2 highlights](https://blog.jetbrains.com/platform/2025/07/bringing-remote-closer-to-local-2025-2-highlights/); page returned 403, cited from search text).
- **Transport and auth** ([FAQ](https://www.jetbrains.com/help/idea/faq-about-remote-development.html)): direct, no JetBrains relay; "TLS 1.3 inside an SSH tunnel". A third-party teardown found the backend on `127.0.0.1:5990` behind SSH and an uploaded `remote-dev-worker` helper ([wyh.life](https://wyh.life/article/2022/11/13/how-jetbrains-gateway-works)).
- **rd `SocketWire`** (`rd-kt/rd-framework/src/main/kotlin/com/jetbrains/rd/framework/SocketWire.kt`):
  - Packet header **12 bytes**: int32 length + int64 sequence number (`:67`); length `-1` = ack, `-2` = ping (`:65-66`); max message 300 MB (`:68`). All model objects are multiplexed over one socket, addressed by `RdId`.
  - Sends are batched into ~16 KB chunks (`ByteBufferAsyncProcessor.kt:64`); `tcpNoDelay` on both ends.
  - **Ack and replay**: receiver drops `seqn ≤ maxReceived`, re-acks duplicates; on every (re)connect the sender re-sends all unacked chunks (`reprocessUnacknowledged`); acks are a high-water mark.
  - **Reconnect**: the server keeps the listening socket for reconnection; the client retries every **500 ms** (`:64`).
  - **Liveness**: heartbeat every **500 ms** (`base/WireBase.kt:29`); each ping carries the sender's tick and the last tick it saw from the peer; the link is alive while the gap is ≤ **3** ticks (`SocketWire.kt:70-72`). INFER: dead-peer detection in ~1.5-2 s, an order of magnitude faster than VS Code's 20 s, affordable because it runs over a private SSH tunnel.
  - **Model-level ownership**: `RdProperty`/`RdMap` carry a master version; a non-master write with a stale version is rejected, and map writes from the non-master side wait in `pendingForAck` until confirmed (`impl/RdProperty.kt`, `impl/RdMap.kt`). This is optimistic local echo with a designated authority, built into the data types.
- **Projector, abandoned**: streaming Swing/AWT drawing to a browser over WebSocket. Both repos archived 2024-03-26; JetBrains' stated reason is that a generic browser client cannot deliver "low latency, low network traffic" and local-quality features ([projector-server](https://github.com/JetBrains/projector-server)). INFER: the industry tried "stream the pixels/draw calls" and retreated to "smart client with local state and a semantic protocol".
- **Code With Me** (multi-viewer) ([security overview](https://www.jetbrains.com/help/clion/code-with-me-security-overview.html)): lobby + relay; peers try peer-to-peer first, then fall back to a relay; end-to-end TLS 1.3 with the host certificate's fingerprint in the join link, so the relay cannot MITM. Guest caps and timeouts: NOT FOUND.
- **Pain points** (YouTrack, search-result level only): a backend left running after a drop is not recognized and "Retry" starts a second one (IJPL-237929); reconnect after IDE restart fails (IJPL-217997); frozen backends need manual kill (IDEA-365808).

### 3.2 Microsoft dev tunnels (Remote Tunnels, vscode.dev, Codespaces)

- **Topology** ([security](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/security), [FAQ](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/faq)): host and client both dial *out* to an Azure relay (`global.rel.tunnels.api.visualstudio.com`, then a per-cluster host). Tokens are scoped per tunnel (client, host, manage-ports, manage), expire after ~24 h, and web clients send them as `X-Tunnel-Authorization: tunnel <token>` so they don't collide with the app's own `Authorization`. GitHub's Codespaces troubleshooting tells users to test the same relay domain ([troubleshooting](https://docs.github.com/en/codespaces/troubleshooting/troubleshooting-your-connection-to-github-codespaces)).
- **Framing**: WebSocket subprotocols `tunnel-relay-client[-v2-dev]` / `tunnel-relay-host[-v2-dev]` (`ts/src/connections/tunnelRelayTunnelClient.ts:41-50`). Inside is **SSH**; each forwarded port is an SSH channel. In v2 the relay is the SSH server and key exchange `none` is preferred because TLS already encrypts.
- **Reconnect** (`dev-tunnels-ssh:ProtocolExtensions.md`, `session-reconnect@microsoft.com`): every packet carries the last-received sequence number (+8 bytes); sent messages are cached until covered; the server keeps a disconnected session in a reconnectable list; the client reconnects with a token proving it knew the old session's secret plus its last-received seq; the server answers with its own proof and seq; both re-send. The cache is bounded by SSH flow control to **1 MB per channel**: a writer blocks once the window fills. The optional `session-latency@microsoft.com` extension adds 4 bytes per packet and measures RTT continuously from ordinary traffic, with no pings. Server-side TTL for reconnectable sessions: NOT FOUND.
- **Liveness and retry**: SSH keepalive **off by default** (`tunnelConnectionOptions.ts:57-71`); reconnect backoff 1 s → 13 s in code (the docstring says 100 ms → 12 s; they disagree, `relayTunnelConnector.ts:23-27`); browsers get only **5** reconnect attempts because the browser WebSocket API hides the HTTP status. The VS Code CLI host re-registers with the relay on a 5 s → 120 s backoff (`vscode@1155fd0:cli/src/tunnels/dev_tunnels.rs:1199`).
- **Limits** ([Azure limits](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits#dev-tunnels-limits)): 1,000 active connections per port; 20 MB/s per tunnel; 5 GB/month per user; HTTP gateway timeout fixed at 60 s ([Q&A](https://learn.microsoft.com/en-us/answers/questions/2148622/do-dev-tunnels-have-an-http-timeout-issue)).
- **Pain points**:
  - **Oversized message → deterministic reconnect loop**: on vscode.dev/agents, subscribing to a large agent conversation returned a single 1,055,731-byte snapshot; the tunnel closed (code 1000), the client reconnected, re-subscribed, got the same snapshot, and looped. Hypothesis: a 1 MB relay frame limit. Fix in progress via bounded views and chunking ([vscode#335232](https://github.com/microsoft/vscode/issues/335232), open; [AHP RFC #138](https://github.com/microsoft/agent-host-protocol/issues/138)).
  - Zombie host after DNS failure, 44 h dark ([#11550](https://github.com/microsoft/vscode-remote-release/issues/11550), §1.6).
  - Codespaces users report periodic "Disconnected" and relay 1006 failures without resolution ([community#191556](https://github.com/orgs/community/discussions/191556), [#207895](https://github.com/orgs/community/discussions/207895)); a third-party repro claims forwarded WebSockets close after ~4 min regardless of pings ([TrueBrain/codespaces-websocket](https://github.com/TrueBrain/codespaces-websocket), unconfirmed).

### 3.3 GitHub Codespaces

- One VM + container per codespace; VS Code server version must match the client exactly ([remote extensions](https://code.visualstudio.com/api/advanced-topics/remote-extensions)). Idle timeout default **30 min** (5-240 min); "regardless of your idle timeout setting, a codespace has a maximum lifetime of **12 hours**"; closing the tab doesn't stop the codespace; activity is typing, mouse or terminal output ([timeout docs](https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces)).
- The documented latency advice is only "pick a nearby region". The browser↔VM wire path is not documented beyond the relay domains; that it is dev tunnels + `PersistentProtocol` is INFER from §3.2.
- Pain point: the idle shutdown kills the server, so a tab left open returns to "Unknown reconnection token" → "Cannot reconnect" ([vscode#133918](https://github.com/microsoft/vscode/issues/133918)).

### 3.4 code-server and openvscode-server

- Both embed VS Code's own server (code-server via patches, openvscode-server as a direct fork), so reconnect is upstream `PersistentProtocol`; the grace default is 10,800 s, settable with `--reconnection-grace-time` ([code-server FAQ](https://github.com/coder/code-server/blob/main/docs/FAQ.md)). code-server's parent process owns HTTP/WS and hands upgraded sockets to the VS Code child (`src/node/routes/vscode.ts:244-255`); it touches a heartbeat file once a minute and supports `--idle-timeout-seconds`.
- **Fan-out**: single-user. Multi-user collaboration has been an open request for years ([code-server#33](https://github.com/coder/code-server/issues/33)).
- **Pain points, almost all from the hop in the middle**:
  - Reverse proxies that don't forward the WebSocket upgrade, or that cut idle sockets (nginx's 60 s default), produce 1006 loops ([#4443](https://github.com/coder/code-server/issues/4443), [#7016](https://github.com/coder/code-server/issues/7016); openvscode-server [#350](https://github.com/gitpod-io/openvscode-server/issues/350)).
  - **permessage-deflate corruption** ("invalid distance too far back") led maintainers to turn WebSocket compression off by default ([#3014](https://github.com/coder/code-server/issues/3014)). INFER: stateful compression and socket handoff/replay interact badly; compress at the message level or not at all.
  - Slow links: a 60 s handshake timeout fails on 1 Mbps and satellite links ([#2407](https://github.com/coder/code-server/issues/2407)).
  - iPad/Safari reconnect loops ([#2118](https://github.com/coder/code-server/issues/2118)).

## 4. Real-time multi-client designs (as far as they bear on many viewers of one live session)

### 4.1 Figma multiplayer

- **Topology** (FACT, [How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/), [Rust in production at Figma](https://www.figma.com/blog/rust-in-production-at-figma/)): WebSockets to a cluster; **one server process per document**, everyone on that document connects to it. Node handles the network and spawns a Rust child per document, talking over stdin/stdout. Only document state takes this path; comments, users and teams sync separately via Postgres.
- **Authority and echo**: the server orders by arrival (no timestamps); last-writer-wins per property per object. Clients apply their own changes immediately and **discard incoming server values that conflict with their own unacknowledged change**, which prevents flicker. Object creation uses client-generated ids that include a per-client id.
- **Reconnect**: download a fresh copy of the file, open a new socket, reapply offline edits on top. "Connecting and reconnecting are simple"; the hard part is updating already-connected documents.
- **Durability** ([Making multiplayer more reliable](https://www.figma.com/blog/making-multiplayer-more-reliable/)): previously a full checkpoint to S3 every 30-60 s (up to ~60 s loss; checkpoint spikes on every redeploy). Now a DynamoDB **journal every ~0.5 s** with a per-file incrementing sequence number; checkpoints record the sequence they cover; restart = latest checkpoint + journal tail. **95 % of edits saved within ~600 ms**; clients send updates every **33 ms** (30 fps); > 2.2 B changes/day; deploys close connections and wait for unsaved changes to persist, **< 1 s at p99**. A DynamoDB lock (UUID per file) prevents two processes owning one file; journal writes are conditional on it. Named future work: send recent journal entries on load instead of the whole file.
- **Pain point** ([LiveGraph](https://www.figma.com/blog/livegraph-real-time-data-at-scale/)): every deploy made all clients reconnect at once into an empty cache (thundering herd); fixed by deploying the cache separately from the edge.
- Viewers-per-document limit: NOT FOUND.

### 4.2 Linear sync engine

Source: the community reverse-engineering writeup [wzhudev/reverse-linear-sync-engine](https://github.com/wzhudev/reverse-linear-sync-engine) plus [Linear's talk summary](https://linear.app/now/scaling-the-linear-sync-engine).
- **Bootstrap over HTTP** (`/sync/bootstrap`, newline-delimited JSON, last line carries `lastSyncId`), then a WebSocket whose handshake reports the server's `lastSyncId`; a client behind asks for the missing deltas.
- **`lastSyncId` is a database-wide monotonic counter**: the server imposes a total order. Delta packets are broadcast **to all clients including the sender**.
- **Optimistic update**: the in-memory model changes at once; the transaction is queued (persisted to IndexedDB), batched per microtask into one mutation; the mutation's response returns the `lastSyncId` it produced, and the transaction completes only **when the stream reaches that id**. Rejection rolls back. Incoming deltas rebase pending updates (local value still wins until acked).
- **Pain point**: non-idempotent transactions resent after a crash error out (e.g. deleting something already deleted).
- Delta retention and heartbeat values: NOT FOUND.

### 4.3 Replicache and Zero (Rocicorp)

- **Replicache** ([how it works](https://doc.replicache.dev/concepts/how-it-works), [pull](https://doc.replicache.dev/reference/server-pull)): HTTP push/pull. Each client numbers its mutations; the server stores a per-client `lastMutationID`. Pull returns `{cookie, lastMutationIDChanges, patch}`; `clear` + full `put`s is the fallback when the cookie is unusable. Rebase: rewind to the last confirmed state, apply the patch, drop mutations ≤ `lastMutationID`, replay the rest, reveal atomically. A **poke** is a contentless "pull now" hint over any channel, keeping the live channel tiny. Local reads/writes < 1 ms.
- **Zero** ([mutators](https://zero.rocicorp.dev/docs/mutators), [connection](https://zero.rocicorp.dev/docs/connection)): `mutate()` returns **two promises**, `.client` (local apply done) and `.server` (server acknowledged). While connecting, reads work and writes queue; after `disconnectTimeoutMs` (default **1 min**) the state is `disconnected`, retries every **5 s**, writes are rejected; hidden tabs disconnect after **5 min**.
- INFER: for an append-only input stream (user prompts), no rebase is needed; "pending until its id appears in the ordered log" suffices.

### 4.4 Cloudflare Durable Objects, PartyKit, and the Agents SDK

Durable Objects (FACT, [limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [WebSockets best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [state API](https://developers.cloudflare.com/durable-objects/api/state/), [lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/), [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)):
- Hibernation API: up to **32,768** WebSockets per object (CPU and memory bind earlier). Incoming message ≤ **32 MiB** (larger closes with 1009). Soft limit **1,000 requests/s** per object. CPU **30 s** per request, reset by each incoming message.
- `serializeAttachment` ≤ **16,384 bytes** per socket, survives hibernation. Tags ≤ 10 per socket.
- `setWebSocketAutoResponse` answers a fixed request string (≤ 2,048 chars) **without waking the object**; protocol pings get automatic pongs and never reach `webSocketMessage`.
- Hibernation after **10 s** idle (no timers, no pending I/O); in-memory state is lost and the constructor re-runs. **Deploys restart every object and disconnect every socket.**
- Billing: incoming WebSocket messages count 20:1 as requests; outgoing are free; no duration billed while hibernating.
- Cloudflare's own advice: **batch 10-100 logical messages per frame, flushing every 50-100 ms or 50-100 messages**, because many small messages can overwhelm one object.
- SQLite storage up to 10 GB per object, 2 MB per row.
- Whether permessage-deflate works on hibernatable sockets is unresolved ([workerd#4091](https://github.com/cloudflare/workerd/issues/4091)); edge idle timeout for Worker/DO sockets: NOT FOUND.

PartyKit / PartyServer ([hibernation guide](https://docs.partykit.io/guides/scaling-partykit-servers-with-hibernation/), [PartySocket](https://docs.partykit.io/reference/partysocket-api/)): rooms on Durable Objects; documented ~100 connections per room without hibernation vs ~32,000 with it (128 MB per room). PartySocket reconnect defaults: min delay 1-5 s randomized, max 10 s, growth ×1.3, connect timeout 4 s, infinite retries, unbounded send queue. No sequence-numbered resume is built in.

**Cloudflare Agents SDK resumable streaming** (FACT, `cloudflare/agents@65ddec8:docs/agents/resumable-streaming.md`): the closest public prior art to "a streaming agent turn on a Durable Object".
- Stream chunks are persisted to SQLite as generated, **batched every 10 chunks**; the turn keeps running if the client leaves (`cancelOnClientAbort: false` by default; only an explicit `stop()` cancels).
- Reconnect handshake: client sends `CF_AGENT_STREAM_RESUME_REQUEST` **only after its message handler is registered** (to avoid the server's `onConnect` push racing an unready client) → server `CF_AGENT_STREAM_RESUMING` → client `CF_AGENT_STREAM_RESUME_ACK` → buffered chunks with `replay: true`, then live chunks.
- Replayed chunks are **applied in one batch** so transient states (a "Thinking…" indicator) don't flash. Every chunk carries a `seq`; the client skips replayed chunks at or below the highest `seq` it already applied.
- **Cutover**: the stream buffer is deleted in the same transaction that persists the finished assistant message, so a settled turn leaves nothing behind; abandoned in-flight buffers are reclaimed after 1 h without a chunk; stale streams older than 5 min are cleaned on restore.
- INFER: this is the in-flight-buffer + settled-log split the desk needs, already shaped for DO SQLite.

### 4.5 Pub/sub services with resume: Ably, Socket.IO, Phoenix

- **Ably** ([connection states](https://ably.com/docs/connect/states), [limits](https://ably.com/docs/platform/pricing/limits), [rewind](https://ably.com/docs/channels/options/rewind)): connection state is kept **~2 min**; the recovery key is connection key + last message serial. Disconnected → retry about every **15 s**; after 2 min → suspended, retry every **30 s**, channels reattach with `resumed=false` and the app must fetch history. System-initiated drops (deploys, rebalancing) reconnect with recovery "usually within a few hundred milliseconds". Per channel **50 msg/s**; message ≤ 64-256 KiB by plan.
- **Socket.IO** ([connection state recovery](https://socket.io/docs/v4/connection-state-recovery), [server options](https://socket.io/docs/v4/server-options/)): packets carry an offset; on reconnect the client sends session id + last offset and the server replays missed packets within `maxDisconnectionDuration` (docs example 2 min). The docs warn recovery "will not always be successful". Defaults: ping **25 s**, ping timeout **20 s**, permessage-deflate **off**.
- **Phoenix Channels** ([socket.js](https://raw.githubusercontent.com/phoenixframework/phoenix/main/assets/js/phoenix/socket.js), [Endpoint](https://phoenix.hexdocs.pm/Phoenix.Endpoint.html)): client heartbeat **30 s**; reconnect backoff `[10, 50, 100, 150, 200, 250, 500, 1000, 2000]` ms then 5 s; channel rejoin `[1, 2, 5]` s then 10 s; pushes while disconnected are buffered; server idle timeout 60 s. No server-side replay; the app re-sends state on rejoin.

### 4.6 Mosh: state synchronization and predictive echo

FACT from the [Mosh paper (USENIX ATC 2012)](https://www.usenix.org/system/files/conference/atc12/atc12-final32.pdf):
- **SSP**: UDP datagrams, each an idempotent diff from a numbered source state to a target state. No replay history; reordering and duplicates are harmless. The client roams by simply sending from a new address with a higher sequence number.
- The server sends the *latest* screen at a frame rate tied to RTT (minimum interval = SRTT/2, capped at **50 Hz**), skipping intermediate states, so floods don't fill buffers and Ctrl-C works within ~1 RTT. Collection interval **8 ms**; RTO floor **50 ms**; delayed ack **100 ms**; **heartbeat 3 s**.
- **Speculative local echo**: the client predicts each keystroke; predictions are grouped in epochs and shown once the server confirms one in the epoch; unconfirmed ones are underlined on slow paths. **The server decides confirmation** via an "echo ack" (the latest keystroke presented to the application for ≥ **50 ms**); an earlier client-timeout design flickered under jitter.
- Results: ~70 % of keystrokes displayed instantly; on 3G (RTT ~0.5 s) median keystroke latency **< 5 ms vs 503 ms for SSH**; wrong predictions on 0.9 % of keystrokes, corrected within one RTT.
- Stated limit: state sync is wrong when the user needs exact history (scrollback); use a log there.

### 4.7 Jupyter

- `jupyter_server` buffers kernel messages for a disconnected frontend and replays on reconnect (`buffer_offline_messages`, keyed by session) ([kernels API](https://jupyter-server.readthedocs.io/en/latest/api/jupyter_server.services.kernels.html)); an old issue shows replay silently skipped when the session key didn't match ([jupyter/notebook#4105](https://github.com/jupyter/notebook/issues/4105)). INFER: a single-consumer replay buffer is the wrong shape for many viewers; each viewer needs its own cursor into a shared log.

## 5. The closest analogue: Microsoft's Agent Host Protocol (AHP)

AHP is the protocol behind VS Code's agent host and vscode.dev/agents: a remote agent-session protocol carried over a managed relay to browser and desktop clients, which is the desk's problem almost exactly. Pinned at `microsoft/agent-host-protocol@1ef0642`.

- **Framing**: JSON-RPC 2.0 over any reliable ordered stream; every message is routed by `params.channel`, a URI such as `ahp-root://`, `ahp-session:/<uuid>`, `ahp-chat:/<cid>` (`docs/specification/overview.md`).
- **Connect**: `initialize` returns `serverSeq` plus state snapshots, each tagged `fromSeq` (`docs/specification/lifecycle.md`).
- **Resume** (FACT, `lifecycle.md` §Reconnection): the client sends `reconnect {clientId, lastSeenServerSeq, subscriptions[]}`. The server answers **either** `{type:"replay", actions:[…serverSeq…], missing:[…]}` (all missed action envelopes, plus subscriptions it can no longer serve, e.g. disposed sessions or revoked access) **or**, when the gap exceeds its replay buffer, `{type:"snapshot", snapshots:[{resource, state, fromSeq}]}`. Ordinary notifications are *not* replayed; the client re-lists. Replay-buffer size: NOT FOUND.
- **Optimistic echo** (`docs/guide/reconciliation.md`, "write-ahead reconciliation"): the client keeps `confirmedState` and `pendingActions[]`, and renders confirmed + pending. Its own action's echo pops it from pending; a foreign action applies to confirmed and pending are rebased on top; a rejected echo drops the pending action. Chat actions are append-only, so rebase is trivial; conflicts are server-wins.
- **Fan-out**: every action envelope carries `origin.clientId` and `serverSeq`; all subscribed clients apply the same ordered stream. That is how a client recognizes its own echo.
- **Flow control** (`docs/specification/windowed-delivery.md`): optional credit-based windows per subscription (`channel/credit`) with a hard per-message size limit and fragmentation; windowed subscriptions recover with their own `lastAppliedServerSeq`. Built to slow a terminal producer when one consumer lags.
- **Liveness**: a protocol-level `ping` exists for idle-timeout intermediaries; interval and timeout are "implementation-specific" (`docs/specification/transport.md:36-38`).
- **What went wrong**: the relay substrate (Azure Web PubSub) closes the socket on any frame > **1 MB**; an unbounded chat snapshot (1,055,731 bytes) then caused the deterministic reconnect loop in §3.2. The chunking RFC adds an `ahp/messageSegment` control notification with per-direction limits negotiated at `initialize` and `reconnect`, and explicitly leaves resumable transfer and compression out of scope ([RFC #138](https://github.com/microsoft/agent-host-protocol/issues/138)).


## 6. Numbers side by side

| System | Keepalive | Death verdict | Resume window (server keeps state) | Replay bound | Reconnect schedule |
|---|---|---|---|---|---|
| VS Code `PersistentProtocol` | 5 s both ways | 20 s silence (skipped under event-loop load) | 3 h; 5 min once another client connects | unbounded queue | 0, 5, 5, 10×5, 30… s; 30 s per attempt |
| VS Code terminals | 5 s (pty host) | n/a | 60 s local (6 s short) | snapshot: 100 lines scrollback | with the window |
| Zed SSH remoting | 5 s if idle | 5 missed × 5 s timeout | daemon lives 10 min without a client | unbounded queue | 3 attempts, then manual |
| Zed collab | 1 s if idle | 10 s silence; 2 s write timeout | 30 s room seat | state-based rejoin (versions) | 0.5 s doubling to 30 s, +0-100 % jitter |
| JetBrains rd | 500 ms | > 3 ticks (~1.5-2 s) | server socket kept open | all unacked chunks | every 500 ms |
| dev tunnels SSH | off by default | n/a | reconnectable session list (TTL not found) | 1 MB per channel (flow window) | 1 s → 13 s; browser 5 attempts |
| Mosh | 3 s | client warns | session lifetime | none: latest state only | roam on next packet |
| Ably | `maxIdleInterval` (default not found) | n/a | ~2 min | per-connection serial | 15 s, then 30 s when suspended |
| Socket.IO | 25 s | +20 s | `maxDisconnectionDuration` (2 min in docs) | stored packets by offset | client default |
| Phoenix | 30 s | missed reply | none | none | 10 ms … 2 s, then 5 s |
| Cloudflare Agents SDK | n/a | n/a | stream buffer until cutover; abandoned 1 h | SQLite chunk log, `seq` per chunk | client default |
| *Anthropic RC (from the sibling note)* | *`keep_alive` every 50 s* | *SSE: 45 s without a chunk* | *server session* | *none on the RC WebSocket; HTTP gap-fill* | *1 → 30 s ±25 %, 6 attempts, then manual* |

Latency-side numbers worth keeping in view: Mosh median keystroke < 5 ms vs 503 ms SSH on a 0.5 s RTT link; Figma clients send every 33 ms, 95 % of edits durable within ~600 ms; VS Code coalesces terminal output for 5 ms and re-splits writes above 256 KB; Mosh collects for 8 ms; Cloudflare advises batching per 50-100 ms or 50-100 messages; VS Code's terminal type-ahead (off by default, `localEchoLatencyThreshold` default 30 ms, `terminalTypeAheadConfiguration.ts:31, 43`) shows predictions once > 5 samples with > 30 % accuracy show a median latency ≥ 30 ms, and rolls back mispredictions after `max(500 ms, 1.5 × max latency)` (`vscode@1155fd0:src/vs/workbench/contrib/terminalContrib/typeAhead/browser/terminalTypeAheadAddon.ts:33-38, 1394, 1417-1423`). The intended hysteresis ("turn off below threshold × 0.5", `:38`) is written as `threshold / 0.5`, so in practice it switches off at anything below 30 ms.

---

## 7. Principles for a browser client + per-machine daemon + Durable-Object relay

Evidence strength: **[strong]** = several independent systems converge, or a production failure demonstrates it; **[medium]** = one strong system or a clear documented rationale; **[weak]** = inference from adjacent evidence.

### Ownership and ordering

1. **The daemon is the authority and sequencer for each session; the Durable Object is a rebuildable relay and cache.** **[strong]** The daemon owns the Claude Code process and the transcript, so it assigns `seq` per session (as AHP's agent host assigns `serverSeq`, Zed's collab host owns the project, Figma's per-document process orders edits). Deploys restart every DO and drop every socket; nothing correct should depend on DO memory, and anything in DO storage should be re-derivable from the daemon.
2. **One ordered log per session, with a monotonic integer `seq`, origin ids on every entry, and per-viewer cursors.** **[strong]** Linear `lastSyncId`, AHP `serverSeq` + `origin.clientId`, Ably serials, Socket.IO offsets. Each viewer resumes from its own cursor; one viewer's arrival, slowness or departure never changes another's state. VS Code's "new client shortens everyone's grace to 5 min" and Jupyter's single-consumer buffer are the counter-examples.
3. **Bind sub-sessions to session ids, never to the transport that spawned them.** **[strong]** Zed's agent threads die with the SSH pipe that carried them ([zed#60213](https://github.com/zed-industries/zed/issues/60213)); VS Code's extension host dies silently behind a live window (#11805). A transport reconnect must rebind every subscription, and the reply should say which ones are gone (AHP `missing[]`).

### Resume

4. **Two tiers: replay for short gaps, snapshot + tail for long ones, and never "reload to continue".** **[strong]** The reconnect request carries `{lastSeenSeq per session}`; the answer is `replay` (missed entries) or `snapshot` (state + `fromSeq`) or `missing`. This is AHP verbatim, and it is what VS Code lacks (its terminal state is "Cannot reconnect, please reload the window").
5. **Bound every replay buffer by bytes and fall back to snapshot when it overflows.** **[medium]** VS Code and Zed both queue unacked messages without limit; dev tunnels bounds at 1 MB per channel through flow control; AHP and Ably bound by buffer size or ~2 min. The snapshot path is what makes a bound safe.
6. **Make the snapshot a state, not a token log: settled transcript (paged, newest first) plus the in-flight message as one object.** **[strong]** VS Code terminals reattach from a serialized screen (100 lines by default) rather than raw bytes; Mosh sends only the latest state; the Cloudflare Agents SDK keeps an in-flight chunk buffer in SQLite and deletes it in the same transaction that persists the finished message. Apply replayed entries as one batch so transient states don't flash (Agents SDK `replay: true`).

### Liveness and reconnect

7. **Heartbeat every hop in both directions, piggyback acks on everything, and decide death in 10-20 s on public links.** **[strong]** VS Code 5 s / 20 s, Zed collab 1 s / 10 s, Mosh 3 s, rd 500 ms over private SSH. Any received byte counts as liveness (Zed, VS Code). On the DO, answer pings with `setWebSocketAutoResponse` so they neither wake the object nor bill it. Anthropic RC's 50 s keep-alive and 45-70 s offline detectors are the slow end of this range.
8. **Don't let a stalled client blame the network.** **[medium]** VS Code suspends its timeout verdict when its own event loop runs late (`LoadEstimator`, < 50 % of 1 s ticks on time). Browsers throttle background-tab timers, which produces the same false signal; check elapsed wall time before declaring a socket dead, and resync on `visibilitychange`.
9. **Measure liveness end to end, and show "machine offline" separately from "relay offline".** **[strong]** A tunnel host that was "up" but never re-registered stayed dark for 44 h ([#11550](https://github.com/microsoft/vscode-remote-release/issues/11550)); Zed showed "connected" over a dead VPN ([zed#20375](https://github.com/zed-industries/zed/issues/20375)). The DO should track the daemon's last heartbeat and push it to viewers; the daemon should restart its relay link (or exit) when that link is stuck.
10. **Retry by default while inside the resume window; treat only explicit server verdicts as permanent; re-resolve the endpoint each attempt; cap backoff, add jitter, retry immediately on `online` or tab focus.** **[strong]** VS Code forfeited a 3 h grace because one error lacked an errno ([#11805](https://github.com/microsoft/vscode-remote-release/issues/11805)) and retried a stale cached port ([#11866](https://github.com/microsoft/vscode-remote-release/issues/11866)); Zed and dev-tunnels' browser path give up after 3 and 5 attempts. Zed's 0.5 → 30 s with 0-100 % jitter is a sound default.
11. **Expect a reconnect herd on every relay deploy.** **[medium]** Cloudflare restarts every DO on deploy; Figma's LiveGraph hit a thundering herd into an empty cache. Close with a "restarting" code so clients reconnect at once with jitter, and make the first post-deploy resume cheap (snapshot from DO SQLite or the daemon, not a full history walk).

### Latency

12. **Render and accept input locally; send semantics, not views.** **[strong]** VS Code's `extensionKind`, Zed (parsing and highlighting local), JetBrains (typing assistance on the frontend), and Projector's abandonment all point one way. The composer, drafts, scroll, selection, slash-command and @-mention completion lists (cached) belong in the browser; only commands and session state cross the wire.
13. **Optimistic echo = client-generated id + pending queue + server-owned confirmation.** **[strong]** Linear completes a transaction when the stream reaches its `lastSyncId`; AHP pops pending on its own echo; Zero exposes `.client` and `.server` promises; Mosh lets the server decide which prediction was right, because client-side timeouts flickered under jitter. For append-only prompts, no rebase is needed: show the pending entry, then replace it in place when the entry with the same client id arrives at its `seq`.
14. **Coalesce on the producer, not in the relay.** **[medium]** VS Code coalesces terminal output for 5 ms, Mosh for 8 ms, Figma sends every 33 ms, and Cloudflare advises one frame per 50-100 ms or 50-100 messages because many tiny messages overwhelm a DO. Batch token deltas at the daemon (roughly one frame per 16-33 ms); have the DO forward frames unchanged to every viewer.
15. **Give each viewer its own flow control and let a lagging viewer fall back to snapshot.** **[medium]** VS Code pauses the pty at 100k unacked chars (resume at 5k) because the connection is shared with control traffic; Zed's collab peer uses a bounded 256-message inbox; AHP has per-subscription credit windows; Mosh skips intermediate states. Control traffic (permission prompts, interrupts) must never queue behind a token flood.

### Wire

16. **Cap frame size well below every hop's limit and chunk at the protocol layer from day one.** **[strong]** A 1.05 MB agent snapshot through a 1 MB relay limit became a deterministic reconnect loop ([vscode#335232](https://github.com/microsoft/vscode/issues/335232)); VS Code re-splits writes at 256 KB so the receiver can process incrementally. DOs accept 32 MiB inbound, but proxies and browsers on the path may not; page snapshots and answer an oversized message with an error, not a closed socket.
17. **Compress per message or not at all; avoid stateful permessage-deflate across socket handoffs.** **[medium]** Zed zstd-compresses each envelope; code-server turned WebSocket compression off by default after corruption ([#3014](https://github.com/coder/code-server/issues/3014)); VS Code must replay inflate history when it hands a socket to another process. DO support for permessage-deflate on hibernatable sockets is unresolved, so don't depend on it.
18. **Reconnect tokens should prove possession of a session secret, and the relay should not be able to impersonate either end.** **[medium]** dev-tunnels-ssh's `session-reconnect` exchanges proofs both ways; Code With Me puts the host certificate fingerprint in the join link so its relay cannot MITM; dev tunnels keeps relay auth in its own header (`X-Tunnel-Authorization`) and scopes tokens per role with ~24 h expiry.
19. **Measure RTT continuously from ordinary traffic and adapt.** **[weak]** dev-tunnels' latency extension adds 4 bytes per packet and needs no pings; VS Code's type-ahead shows predictions only when the measured median latency is ≥ 30 ms. Useful for deciding when to show predictive UI and when to warn about a slow machine.

### What I would copy first

1. **AHP's reconnect contract** (`reconnect {clientId, lastSeenSeq per session}` → `replay | snapshot | missing`), with the **daemon** assigning `seq` and the DO holding a bounded tail per session in SQLite. It fixes resume, multi-viewer catch-up and deploy recovery with one mechanism.
2. **The Cloudflare Agents SDK's in-flight buffer and cutover**: stream chunks into DO SQLite in batches, replay them flagged as replay and apply in one batch, and delete the buffer in the same transaction that commits the finished message. It is already shaped for Durable Objects and solves "viewer joins mid-turn".
3. **VS Code's per-hop discipline**: cumulative acks piggybacked on every frame, 5 s keepalive / 20 s verdict with the stalled-loop guard, and (the lesson from its failures) a retry classifier that keeps trying for the whole resume window.

