# The remote layer of the merged MAWS: machines, sessions, connection and trust (2026-10-26)

**Status.** This is a reviewed design draft, not approved for building. desk-sminos-orchestrator reviewed it against the code twice, and an adversarial review ran once; both are folded in (Decision Log 8–14). The owner's decisions are folded in through 2026-10-26.
- **Author:** the `remote-architecture` session.
- **Code review:** `desk-sminos-orchestrator`.
- **Readers:** the MAWS architect's composite spec for the MAWS–Desk merge cites this document and lifts its contracts (the Interfaces section).
- **This is the one trust model.** The composite and the desk-side sections don't define a second one.

**Where it stands.**
- **The direction.** The owner set it on 2026-10-26. Desk folds into the MAWS desktop app, and MAWS becomes the one interface for an organization: its people and their agents, machines, projects, and sessions that have owners. Desk Web pauses, and a web port of MAWS comes later.
- **Superseded.** This replaces desk's phase-1 security model (one shared org key; `2026-10-15-desk-design.md` §6 and DX7) for the merged product. It also retires desk's "not MAWS's web edition" ruling (2026-10-15).
- **Still in force.** The owner decisions about session ownership hold:
  - two lanes (2026-10-19);
  - no web terminal pane (F5, 2026-10-23);
  - terminal sessions stay plain and are controlled only through the bridge mod (F7, 2026-10-24);
  - the holder lives in MAWS's engine host (F3, 2026-10-24).

**The research it rests on** is in `research/desk-remote/` (MAWS PR #79):
- the synthesis, `web-maws-remote-research.ko.md`: connection contract §4, trust §3.5, machine endpoint §3.2–§3.4;
- the lane B holder, `session-holder-design.ko.md`;
- what a mod can reach in a terminal session, `mod-control-surface.md`;
- the shared control shapes across lanes, `lane-b-control-map.md`;
- Claude Desktop's SSH helper, `desktop-ssh-helper-protocol.md`;
- the two 2.1.310 spikes: `media-intake-spike.md` and `truncation-spike.md`.

Three notes for this draft are still being written: Claude Code's own SSH mode in 2.1.311, the engine's remote-tools channel, and the Claude Desktop 3.6556 helper diff. Where they could change a section, the section says so.

## Purpose

MAWS today assumes one Mac: its sessions, files and git are on the machine the window runs on. Desk showed that a person's work is not on one machine. It lives in projects whose sessions run on a MacBook, a Mac mini and Linux hosts, and a phone sometimes answers them. The merged MAWS is one app, signed in as one person of an org. It shows every machine that person may see, the org's projects, and the sessions in each, with the machine each session runs on. Sessions in no project sit under their machine.

This document is the layer under that interface. It decides:
- which process on a machine runs and controls a session;
- how an app on one Mac reaches a session on another;
- how a reconnect resumes without loss;
- how the machine knows who is asking and whether they may.

### The scene at its best

The owner opens MAWS on the MacBook.
- **The sidebar.** `MAWS` lists its sessions, each tagged with its machine: `maws-fe @macbook`, `maws-45 @mini`, `ci-opt @dc-1`, and so on.
- **A lane B session.** `maws-45` was opened from MAWS, so it runs under the mini's MAWS daemon with the full SDK surface:
  - its permission card shows the exact command, and a Touch ID press approves it;
  - the image the owner drops in reaches the model as an image block;
  - "rewind to here" is native.
- **A terminal session.** `maws-fe` was started in a terminal on the MacBook. It shows a narrower set of controls, the ones the bridge mod reaches. Each control the mod can't reach is greyed out with a reason.

Then a teammate joins.
- Jun is a member of the same org, and their agent in `ui-review @jun-mbp` asks the owner's `maws-fe` for the migration's column names through `sminos say`.
- The message arrives marked as coming from Jun's agent. `maws-fe` treats it as a peer's request, not the owner's instruction.
- Jun can open `maws-fe` only because the owner shared it with them at "view".

The lid closes, and when the MacBook wakes, every subscription resumes from its cursor within a second. Through all of it, the hub has carried frames it cannot read or forge.

### What it must not be

- **A host that changes how sessions run.** The engine is the user's installed Claude Code, unpatched (charter D-1). Terminal sessions stay plain processes (F7).
- **A path for raw process streams.** Raw process streams (PTY bytes, SDK stdio) never leave the machine (F5). What crosses the network is structured events and discrete, authenticated actions.
- **Dependent on the hub for correctness or authority.** The hub routes. It cannot cause execution or alter what a person sees. A deploy or eviction loses no data that a machine cannot rebuild.
- **One person's key standing in for everyone.** Every action and every log event names its writer, and the machine checks that writer's right to act.
- **A shared session by default.** A session belongs to whoever started it. Cooperation between people runs mainly through their agents.

## Terms

- **Member.** A person in the org. Identified by a stable member id, not by email.
- **Device.** One install of the MAWS app on one Mac account, holding that member's device keys. A member has one or more devices.
- **Machine.** One enrolled OS account on one host. A machine runs sessions as that account, under that account's Claude login. Each machine has exactly one **machine owner**, the member it acts for. A Mac where two people log in is two machines.
- **Endpoint module.** The narrow module inside the MAWS machine daemon that is the machine's network-facing side. It holds the machine's only connection to the hub, its key, its trust boundary and its policy (§2.1).
- **MAWS machine daemon.** The headless MAWS service on a machine. It contains the endpoint module and MAWS's machine-side services moved out of Electron main. It is the engine host's single client, and runs the engine host as a separate process (§2.1).
- **Engine host.** MAWS's E10 supervisor, hardened as the holder. It holds each lane B session's Query and MAWS's `maws` tool server, which it serves as an SDK MCP server (`src/shared/engine/initialize.ts:13`). It owns the `claude -p` processes through one session host per session (holder design §3.1–§3.2).
- **sminos daemon.** The machine's project-log and delivery daemon. It is local-only in this design.
- **Bridge mod.** sminos's in-process mod in every Claude Code session. It controls in lane A and only observes in lane B.
- **Lane A.** A session started in a terminal, or an engine `--bg` job. The bridge mod controls it.
- **Lane B.** A session opened from MAWS. It is `claude -p` stream-json, held by the engine host and controlled by the engine host's Query.
- **Owners.** The members a session acts for. A session has one owner by default and may have several ("A, B and 2 more").
- **Share.** A grant of a session to a member at a grade (§6).
- **Channel.** An end-to-end authenticated, encrypted stream between one device and one endpoint. The hub relays it without being able to read it (§5.4).
- **Plane.** A machine's per-session event stream, with a cursor of `(session, launch epoch, seq)`.
- **Client class.** What kind of client a device is (§5.10). The native Mac app is the only class in phase 1.

## Design

### 1. The shape

```
 member's Mac (MAWS app)             hub (Cloudflare: Worker + DOs)        machine (one OS account)
 ┌──────────────────────┐   wss      ┌─────────────────────────────┐ wss  ┌────────────────────────────────────┐
 │ renderer (no keys)   │ ─────────▶ │ Registry (org state, list)  │ ◀─── │ MAWS machine daemon (Node)         │
 │ main: device keys    │   sealed   │ Machine DO (relay, lease)   │      │  ├ endpoint module: key · policy · │
 │                      │ ◀───────── │ Project DO (log plane)      │ ───▶ │  │   ACL · channels · uplink       │
 └──────────────────────┘            └─────────────────────────────┘      │  ├ files · git · artifacts · Yjs · │
        │ same-uid local socket (when the app's own Mac is a machine)      │  │   settings (from Electron main) │
        └────────────────────────────────────────────────────────────────▶ │  └ engine host: Query · tool srv. │
                                                                           │      └ session hosts ─ claude -p   │
                                                                           │ sminos daemon (local only: log,    │
                                                                           │   delivery, lane A plane) ─ bridge │
                                                                           │   mod in each terminal claude      │
                                                                           └────────────────────────────────────┘
```

Three rules carry the design:
1. **The machine is the authority.** It owns the session processes, numbers every session's events, keeps the replay ring, holds the ACL, and decides every action.
2. **The hub is a relay that can read routing metadata and nothing else that matters.** Session content and actions travel inside channels between a member's device and the machine.
3. **The difference between the lanes stays inside the machine.** Both lanes produce the same plane and the same vocabulary, and each publishes a capability list per operation.

### 2. The machine

#### 2.1 Processes and their duties

| Process | Duties | Restarts without ending sessions? |
|---|---|---|
| **MAWS machine daemon** (Node, headless), with the **endpoint module** inside it | **Endpoint module:** <ul><li>the only outbound connection to the hub;</li><li>the machine key and the pinned org root, with verification of the signed org state (§5.2);</li><li>it terminates channels (§5.4);</li><li>policy: read-only mode, the permission-mode ceiling for spawns that come from outside, the session ACL and grades, and freshness of discrete actions;</li><li>it relays plane subscriptions, sealed for each subscriber;</li><li>it signs the log events this machine writes, and verifies arriving events before sminos gets them (RL10).</li></ul> **The rest of the daemon:** <ul><li>the machine-side services now in Electron main: session index and read model, launch/fork/acquire, git and scm, files, library index, artifacts and Yjs, settings (research §3.2).</li></ul> It is the engine host's single client. It relays lane B's plane from the engine host to subscribers. | Yes. Channels drop and resume by cursor. Its connection to the engine host drops and reconnects. The Query lives in the engine host, so it is untouched. |
| **Engine host** (Node, the hardened E10 supervisor) and its **session hosts** (small static binaries, one per session) | The lane B Query for each session, with its output checkpoint and durable request ledger (holder design §3.3). MAWS's `maws` tool server and SDK hook callbacks. Lane B process ownership: the output seq ring, the stdin offset, the writer fence, roster re-adoption, and the 24-hour reaping fence (holder design §3.1–§3.2). It produces lane B's plane. It is a separate process under the daemon (the MAWS architect's survey: today the Query is the engine host's Session). A daemon restart doesn't end its children, which is the lesson from Desktop's helper replacement. | The manager can restart; a session host's death ends its session. |
| **sminos daemon** (Python, stdlib, local only) | **Keeps:** <ul><li>git-mirror sync for projects with a git remote;</li><li>join-on-sight, `derive --all`, and retries of owed deliveries;</li><li>local delivery: peer messages through the engine's inbox socket, human words through the bridge, under §5.7's rule;</li><li>member state and the lane A plane;</li><li>lane A's RPC translation (`sminos_rpc.py`: decide, answer, steer, interrupt, model, compact, btw, media, command, read, stop-agent, tell), with MW4's agent resolution and MW5's media save (`sminos_media.py`);</li><li>request settlement (`sminos_requests.py`).</li></ul> **Hands to the endpoint module:** the uplink (`sminos_uplink.py`), hub enrollment (`sminos_hub.py`), hub log sync (`sminos_hublog.py`), HMAC coding (`sminos_codes.py`), the RPC member check, and the policy gate (`sminos_policy.py`). It talks to the daemon only over RL10, signs nothing, and does no AEAD. | Yes. |
| **Bridge mod** (in every Claude Code process) | **Lane A:** the controller (mod-control-surface; desk control-surface spec MW1–MW5). **Lane B:** observer only. It supplies subagent deltas and the `turn.step` reaping gate, and refuses control when MAWS's spawn marker is set. The observer mode is new work: `bridge.tsx` has no MAWS marker today. | It is part of the session. |

**One process, with the endpoint as a module** (the MAWS architect's ruling, 2026-10-26).
- Under one uid there is no isolation to buy. The daemon could read a 0600 key file anyway, and a headless Node process can't use the Enclave.
- Reviewability comes from the module boundary. The endpoint is its own package with its own tests, and a lint rule lets only the endpoint module import the key and policy code.
- Channel drops on a daemon restart are cheap by design, since they resume by cursor, and every hub deploy causes them anyway.
- The local path is the one MAWS uses most. Today it is app main → engine host → `claude`, and a separate endpoint would add a hop and a second versioned local protocol, kept forever.
- What gets isolated is what crashes, not what is trusted. If crash data shows a heavy service (Yjs, library indexing, capture) taking the daemon down, that service moves to a worker or child process inside the daemon.
- The composite carries a budget for local latency, measured against today's path.

**Handing the uplink over.** Once the daemon's endpoint module is enrolled, sminos stops its own DX2 uplink and goes local-only. It does this when the endpoint's RL10 socket exists, or a config flag says so. A machine never runs two uplinks under one name.

**The spawn ceiling.** The permission-mode ceiling bounds only spawns that arrive from outside. A `sminos spawn` from a local session stays unbound, as it is today.

#### 2.2 Install and versions

- The MAWS machine daemon ships as a headless package, versioned apart from the Electron app. It installs as a launchd agent on macOS and a user systemd unit on Linux. Its runtime is either the system's Node or a bundled single-executable build (§11).
- It runs on machines with no MAWS app: the Mac mini, devcloud Linux hosts and seats. On Linux the engine host's session hosts run in a user transient scope, with lingering on (holder design §3.1).
- On a Mac that is also a member's device, the app uses the local daemon over a same-uid socket and never starts its own copy of the services.
- Every hello carries `{protocol, build}`, and features are negotiated through capability lists (§3.3, §5.10), never through matching build ids.
- **A machine that is not upgraded fails visibly.** One still running desk's phase-1 sminos uplink (DX2 SSE+POST with the shared org key) is shown as *needs upgrade*.
  - It accepts no RPC from the merged app.
  - Its log events are displayed as *unverified (legacy)*.
  - It never fails silently.
- **The hub serves DX2 and RL1 side by side** for each machine until that machine has moved (§9).

#### 2.3 The machine's identity

- **The machine key.** At enrollment the endpoint module generates a P-256 key pair and keeps it as a 0600 file in the daemon's 0700 state directory, on every platform. A headless Node daemon can't use the Enclave. This is acceptable because the machine key protects nothing that code running as that OS account couldn't already do: that account runs the sessions.
- **The machine owner** is recorded in the signed org state (§5.2) when the machine enrolls, as the member whose device approved the enrollment.
- **The machine's ref** (P5 OX2; Decision Log 19). The daemon mints a `MachineRef` at its first run, before any enrollment, and never changes it. It is an opaque string, `[A-Za-z0-9_-]{16,64}`, drawn from at least 128 random bits. On a machine that enrolls through a delegation, the ref starts with the delegation's id and `_`, and the random bits follow. The daemon knows the delegation from its seed at first run (§5.3, RL5).
  - The ref lives in the profile's `machine.json`, outside the daemon's state directory, so a daemon that loses its state keeps its ref and re-enrolls under it (P5 O6).
  - **It is the machine's identity in every contract here.** Each field named `machine` carries it. The name is a display attribute of the org-state entry, which an admin may change. A rename re-issues nothing.
  - **Log writers are the one exception.** They stay `<name>/…`, as DX2's log plane has them (RL8), so moving them to refs doesn't fork the Project DO's writer rule. That costs two things:
    - A name is bound to one ref for the life of the org. RL5's append-only `machineNames` makes this checkable, and a name once used never passes to another machine. A replacement machine takes a new name.
    - A rename starts a new writer, so the machine's log history splits at the rename. Events under the old name still verify, through the same binding.
  - **RL5's machine entry carries it as `ref`,** set at enrollment and immutable after. Verifiers (the hub's Registry, apps and machines) refuse a state that changes an entry's ref, or holds two entries with one ref.
  - **A key change keeps the ref.** Re-enrolling the machine or rotating its key is an admin-signed state change of the entry's `pub`, and the entry's identity across it is its ref.
    - Channels pinned to the old key close.
    - The machine re-issues its listings and endpoint record under the new key.
    - The old key is retired, or revoked if the change is for a compromise (§5.2). Its events then verify, or don't, by that rule (RL8's key id).
  - **Why not the key's fingerprint.** It would change at enrollment and orphan every address the app persisted while the machine was signed out, and again at every rotation. The machine key stays a 0600 file (above), so the Enclave move concerns device keys, unless U4 makes `mawsd` a signed Electron process.

### 3. Sessions: the two lanes

#### 3.1 Lane B is the first-class lane

- **The chain.**
  - Output: `claude -p --input-format stream-json --output-format stream-json` → session host (seq ring, stdin offset, writer fence) → the engine host's Query (output checkpoint before every input, durable request ledger) → X1 events on lane B's plane → the daemon's endpoint → each subscriber's channel.
  - Actions go the other way: channel → endpoint module (verify, authorize) → engine host's Query → session host → stdin.
- **What it must do.** All of holder design §3.1–§3.3 and §5 is binding here. Two points in particular:
  - a Query restart is not a process restart;
  - pending permission and dialog requests are delivered again on re-initialize and de-duplicated by request id.
- **The Query stays on the machine,** not in the client app. Claude Desktop's SSH mode keeps the Query in the client, which suits one user with one client. It does not suit MAWS, for three reasons:
  1. MAWS's in-process MCP tools and SDK hook callbacks live with the Query, and they must act on the session's machine: its files, git and artifacts.
  2. A client that sleeps would stall every hook callback and tool call of a running session.
  3. Two clients (two of the owner's Macs, or a collaborator) would need the single writer handed between apps. A session's capabilities would then depend on which app happened to hold it.
- **Tools bound to the client app** are `show_pane` and notifications. They are served from whichever app is attached, through MAWS's own tool server in the engine host.
  - This draft first also listed the agent's in-app browser tab and its screenshots. The composite moves capture, export and screenshots onto the machine's render service, because the attached client's fonts and artifact copy aren't the machine's.
  - It also recommends the agent's tab engine on the session's machine, because the tab must reach that machine's localhost. Where the tab finally lives follows the composite's spike U3.

  How a client-bound tool call works:
  - the tool call is forwarded over the attached owner's channel to that app;
  - with no app attached, the tool answers "no MAWS app is attached" and appears as an unavailable capability.

  This uses no engine feature. The engine's own remote-tools channel (`remote_tools_announce`, `remote_tool_call`) is gated to managed cloud workers and refuses a local SDK host (the remote-tools note), so MAWS can't use it without a patch.
- **Media** goes in as user-message image and document blocks directly (lane-b-control-map, "Image / PDF intake").
- **"Forget after this point"** uses native `rewind_conversation` (lane-b-control-map). Whether it survives `--resume` cleanly is unmeasured, and the lane A substitute failed exactly there (truncation spike), so it is measured before it ships (§12).

#### 3.2 Lane A: terminal and `--bg` sessions

- **The chain.**
  - Output: the bridge mod → bridge child → sminos daemon's plane (sminos numbers each session's events and keeps the ring; research §4 #1) → endpoint → subscriber channels.
  - Actions: channel → endpoint (verify, authorize) → sminos → bridge.
- **What it can do** is what the mod reaches, and no more: the desk control-surface spec and MW1–MW5, and `mod-control-surface.md` for the rest.
- **Approvals race the terminal.** A lane A approval competes with the terminal's own dialog, and the first answer wins. The card says so.
- **No live move to lane B (F7).** A lane A session is never moved live to lane B. Once its process has ended, its conversation can be reopened as lane B with `--resume` (holder design §3.5). That is refused while a live owner process exists, and `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` is never set automatically.

#### 3.3 One vocabulary and per-operation capabilities

- **The vocabulary.** The app draws X1 events in both lanes. Lane A's bridge rows and `turn.step` deltas are adapted to X1 in a shared package on the client side (research §3.7).
- **Capability lists.** Each session's snapshot carries one capability entry per operation: `{available, reason?}`. The keys and the shared request and result shapes are those of `lane-b-control-map.md`, "Proposed shared shapes", which the composite lifts.
  - The app draws controls from capabilities, never from the lane name.
  - Where the lanes mean different things for the same operation, the result says which (for example `method: 'native-rewind' | 'prefix-compaction'`, or MCP status `exact: boolean`).
- **The client's own capabilities.** The endpoint sends the capabilities the machine grants this device (§5.5, §5.10) beside the session's. The app greys out what either list lacks.

#### 3.4 Which lane a new session gets

- **From MAWS.** A session started from MAWS is lane B on any machine whose MAWS daemon runs. On a machine with only sminos, it is a lane A `claude --bg` job, and the app says so before it starts.
- **From a terminal.** A session started in a terminal is always lane A. Owner decision 1 (2026-10-22, 10-24) still holds: the lane follows where the session started.

#### 3.5 Session identity

- **The address.** Every session is addressed as `machine/session`.
- **Lane B context** is `(holderId, processEpoch, engineSessionId, bindingGeneration)` (holder design §3.1). `/clear`, `/branch` and resume change `engineSessionId` and `bindingGeneration` without changing the process. Actions sealed against the old binding are refused.
- **Lane A** carries the engine session id and the bridge's launch epoch.
- **The cursor** is `(session, launch epoch, seq)` in both lanes. The epoch is the lane B binding or the lane A launch.
- **The record.** The machine keeps a durable session record (Interfaces RL6): owners, shares, origin, project, and lane. It is authoritative. The hub sees only the listing fields §6.2 allows.

### 4. Connection

The contract is the research's §4, adopted whole. The points that bind every implementation:

1. **One outbound WebSocket per endpoint, and one WebSocket per app to each hub object it uses.** Desk's SSE+POST uplink is retired. Python's lack of a WebSocket client was its reason, and the endpoint is Node.
   - **RL2 has two carriers.** It travels either in RL1's `{channel, seq, bytes}` multiplex through the hub, or over a **direct WebSocket to the endpoint module**, where the app can reach it. Every machine in the acceptance set is on the owner's tailnet (the MAWS architect's design constraint, 2026-10-26).
     - The endpoint advertises its reachable addresses in a machine-signed record (RL6). The app tries direct first, with a short timeout, and falls back to the hub. The composite's measurement U2 (in O11) picks the default.
     - The direct listener binds only to the tailnet interface. It carries nothing but RL2, with the handshake before any output and the same grades, freshness and policy. So a direct connection gains no authority the relayed one lacks. This keeps desk's binding that the machine decides what it executes: the hub still never connects into a machine, and a direct peer is just another RL2 client.
     - Switching carriers means a new handshake, and subscriptions resume by cursor.
     - The hub stays for discovery, listings, the log plane, the phone, and anything off the tailnet.
   - The app connects directly to the Machine DO of each machine it is using, so a session frame crosses one hub object, not two (research §3.3).
   - Spike 3 still has to measure this topology.
2. **Every frame stays under 1 MiB at the hub.** Channel frames carry at most 256 KiB of plaintext. Larger payloads are split by the protocol, and snapshots are paged.
3. **Cursors.** Each subscription carries `(session, launch epoch, seq)`. A resubscription is answered with `replay | snapshot | missing`. A different epoch means a snapshot. Replay comes from the producer's ring, which is lane B's session host and Query, or lane A's sminos plane. Overflow becomes a snapshot of state, never a token log.
4. **Each viewer is independent.** Every viewer has its own cursor and flow control. A slow viewer is moved to a snapshot. Control traffic never queues behind a token flood.
5. **Liveness.** Both directions ping the application layer on every hop every 5–7 s, skipped while traffic flows. Two misses make the verdict. The app probes at once on wake, on network change and on focus. "Machine offline" and "hub unreachable" are shown separately.
   - The machine's hub lease, renewed by `hb-ack` and fenced by connection generation, stays as desk built it.
6. **Retry.** Retries continue through the whole resume window, with jitter, and re-resolve the endpoint each time. A human action resets the backoff. Only an explicit verdict from the machine is a permanent failure.
7. **Discrete actions carry a stable operation id and their target, and are time-bound even inside a channel.**
   - **What every action carries.**
     - An `opId`, chosen once by the app and kept across every reseal.
     - `opCreated`, the app's clock when it chose the `opId`, also kept across every reseal.
     - The session `context` it targets (§3.5): lane B's binding, or lane A's launch epoch.

     The channel and any step-up or WebAuthn signature cover all three.
   - **Each executing side keeps one durable ledger keyed by `opId`, holding the claim and the result together.**
     - **Lane A:** sminos's existing RPC ledger, re-keyed from the RPC nonce to `opId`. It already records the claim before the run, answers a known id from the ledger without running it again, and fails closed: while the ledger can't be read, no RPC runs (`sminos_rpc.py:16, 165, 279-401`).
     - **Lane B:** the engine host's ledger, beside the Query, built the same way.
     - **The endpoint module keeps no op ledger.** It checks freshness and channel replay. It forwards `query {opId}` and the `not-received` tombstone to the executing side, over RL10 for lane A. Splitting the claim and the result across a process boundary would open two crash windows: a claim whose action never arrives stays `in-progress` forever, and a run whose claim is lost runs again.
     - A repeated `opId` returns the stored result and never executes twice.
     - The ledger is kept for a day, as desk's is (`KEPT_S = 86400`).
     - **An id has a horizon, so pruning never reopens it** (desk-sminos-orchestrator, 2026-10-27). A reseal carries a fresh `created`, so freshness alone would let a resealed copy of a pruned id run again.
       - The executing side refuses an action whose `opCreated` is older than `OP_HORIZON = KEPT_S − 3600` s by its own clock, with `expired`. It answers `query` for such an id `expired`, whether the ledger still holds it or not.
       - It refuses an action whose `opCreated` is later than its `created` by more than the freshness window, as malformed. With freshness, no entry is received more than two minutes before its `opCreated`. So an entry is pruned only after its id is past the horizon, whatever the app's clock did.
     - MW5 made the upload id the RPC nonce. A reseal changes the nonce, so the upload id moves to `opId`.
   - **The context is checked again at dispatch.** The daemon or engine host (lane B), or the bridge (lane A), rechecks it, not only the endpoint. So an action that arrives after a resume or a `/clear` is refused.
   - **Freshness.** An action is refused past a 60 s window, measured by the machine's clock against its `created`. The channel prevents replay and reordering, but the hub can still hold a frame.
   - **Resealing.** An action whose request is still pending is resealed by the app: a new nonce and `created`, the same `opId`, `opCreated`, arguments and request digest. The app stops resealing an action past `OP_HORIZON` by its own clock and asks `query` instead.
   - **A lost acknowledgement isn't "not sent".** The app asks `query {opId, opCreated}` (RL4) and shows *outcome unknown* until the machine answers `done | in-progress | refused | not-received | expired`.
     - `expired` stays *outcome unknown, too old to retry*. It never shows as not sent.
     - `unavailable` means the executing side's ledger can't be read right now. Nothing runs while it can't, and the app asks again later.
     - Only `not-received` shows *not sent, send again*.
     - The machine then tombstones that `opId`, so a late copy is refused.
     - A resend uses a new `opId`.
8. **Byte-stream inputs** (MAWS's own `pty.*` terminals, should they be offered remotely) are de-duplicated by offset inside the channel, with no per-frame age check. No web or remote terminal into a Claude Code session exists (F5).

### 5. Identity and trust

#### 5.1 Principals and keys

All keys are P-256: ECDSA for signatures, ECDH for channel keys. Node, WebCrypto and the Secure Enclave all support it, and Ed25519 is not available in the Enclave.

| Principal | Key(s) | Where | Notes |
|---|---|---|---|
| **Org root** | The set of admin device keys, plus one offline recovery key (owner decision §10.2) | The admins' devices; the recovery key offline with the owner | Signs the org state (§5.2). |
| **Member** | No key of its own. A member is the set of its device keys listed in the org state | — | The member id is stable. The email is an attribute, so an email change is an org-state edit. |
| **Device** | A **channel key** (signs handshakes and routine actions) and a **step-up key** (signs execution-grade actions, with a Touch ID access control) | Signed builds: the Secure Enclave, through a native module in Electron main. Unsigned builds, which the first milestones are (owner, 2026-10-26): software P-256 keys in a 0600 file in the app's data directory, with step-up gated by a LocalAuthentication prompt in main. Never visible to the renderer | Main signs only a typed request it built and rendered itself (§5.6). The org state records each device's `keyStorage: 'enclave' \| 'software'`, so a machine can require `enclave` for execution grade once signed builds exist. |
| **Phone** (web class, §5.10) | A non-extractable WebCrypto P-256 channel key in the browser's storage, plus a passkey for each approval | The phone's browser | Hub-served code can use the key without extracting it. §5.10 bounds what this class may do. |
| **Machine** | A machine key | The endpoint (§2.3) | Signs channel handshakes, the log events it writes, and attestations about the sessions it hosts (§5.8). |

#### 5.2 The signed org state

- **What it is.** One document lists the org's members (id, email, role, device public keys), its machines (name, machine public key, owner), the grants on each machine (§6.3), and the projects.
  - It is versioned and hash-chained: `version`, `prev`.
  - A root key signs it.
  - The hub stores it and serves it. It cannot forge it, and it cannot roll it back unnoticed.
- **How a machine checks it.**
  - At enrollment it pins two things: the root key set and the offline recovery key.
  - It accepts a new state only if it links to the head it holds. It keeps a durable high-water mark and refuses rollback.
  - When a newer state removes a device, member, delegation or machine, or revokes a certificate, the machine closes every affected channel and subscription at once. That covers every grade, `view` included, not only actions that need step-up.
- **Revocations are delivered directly, with acknowledgement.**
  - Besides publishing the new state, the admin device sends each removal to every machine as an RL4 action over that machine's channel.
  - Each machine acknowledges, but only after the removal is durable. The admin's app lists any machine that hasn't applied it yet.
  - The endpoint module passes revocations down to sminos over RL10. sminos holds owed deliveries and retries them for up to 60 ticks (`sminos_owed.py`). So every delivery checks its signer against the current state when it is delivered, not only when it was imported. Words a revoked device wrote before its removal are then never delivered afterwards.
  - The hub can delay a revocation only by also cutting the admin's channel to that machine, and the admin then sees the revocation as pending.
  - A pending revocation can be applied on the machine itself, through the same-uid local app or a local command.
- **Retiring a key is not revoking it** (desk-sminos-orchestrator, 2026-10-27). Both stop a key from signing anything new. They differ in what happens to what it signed before.
  - **Revocation** is for a key that may be compromised: a lost device, a stolen machine key. It is retroactive. Nothing the key signed is delivered afterwards (above), and readers show its past events as *signed by a revoked key*, never as verified. A key whose fate is unknown is revoked. A revoked key is listed in the state's append-only `revoked` (RL5), so a verifier holding only the head can tell it from a key it has never seen.
  - **Retirement** is for a key that leaves honestly: a deleted VM, a Mac that is wiped and decommissioned, a device replaced by a new one, a machine key rotated with no suspicion. It records `{keyId, notAfter}`. Events whose own timestamp is at or before `notAfter` verify for good, and later ones are refused.
    - The anchor is the signer's own timestamp, so retirement trusts the key not to sign backdated events. That holds when the key has been destroyed, or was never at risk; otherwise, revoke.
    - `notAfter` is set once the key is gone, with a margin for clock skew, since nothing can sign with it after that.
    - The timestamp compared is the event's signed `created`, never the hub's `ts`, which no signer covers. So every v2 event carries `created` inside its signature (RL8).
    - **A retirement can still become a revocation.** The key moves from `retired` to `revoked` (RL5), and the revocation is delivered like any other. A key enters `retired` only in the step where it stops being current, and `notAfter` never moves.
    - **A delegation's expiry retires its certificates** at its `expires`, with the same trust: a VM under it that may be compromised calls for revoking the delegation.
    - A log position would be a stronger anchor, but each session is its own writer, so the anchor would need a high-water mark per writer. The positions also come from the hub, which isn't trusted.
  - **Who signs it.** An admin's retirement or revocation is always a state change, of a device's key, an enrolled machine's or a delegation certificate's (desk-sminos-orchestrator, from O11 M1's review). An admin-retired certificate's key enters `retired`, with the certificate's ref as its holder. A revoked one enters `revoked`.
    - **Why not a separate admin-signed record.** A verifier would check the record's signer against the admins of the state it holds. Once that admin is demoted, removed or rotated, the record reads as from an unknown signer, and a revoked certificate gets its authority back. Records carry no time and the state no role history, so a verifier can't tell that the signer was an admin when it signed. Verifying at ingest and keeping the verdict fails open on every machine enrolled later. In the state, the entry is signed again with every successor by whoever signs the head, so no later change to the admins can orphan it.
    - A certificate's revocation is then delivered and acknowledged like any other (above), and it reaches sminos over RL10.
    - **The delegation key may retire its own certificates** without an admin: a record `{keyId, notAfter}`, signed by the certificate's own delegation key, which the hub stores and serves beside the certificates. So `devcloud vm delete` retires its VM unattended. The record's signer is the delegation, whose key never changes and which stays in the state after it expires (RL5), so its authority can't lapse the way an admin's role can.
    - A compromised VM holding the delegation key could retire its siblings. Their history still verifies, so that is only a denial of service, which the delegation key can already cause.
    - Revoking a single certificate takes an admin, because revocation is retroactive: a delegation key that could revoke would discredit its siblings' history.
    - A certificate retired more than once is retired at the earliest `notAfter`, its delegation's `expires` included. A revocation overrides every retirement.
  - **A retired certificate stops being live**, so it no longer contests its name (§5.3), and a recreated VM under the same delegation can take the old name. Freeing a retired entry's name in `machineNames` is deferred (P5 Decision Log 23). Nothing in this initiative retires an enrolled machine's entry.
- **There is a backstop age.** Every action, except those from a same-uid app on the machine's own Mac (§5.11), needs a state issued within the last 30 days.
  - Any running admin app signs a no-change successor weekly. Until the app is an admin device, the stand-in root (below) signs one at the owner's hand, and the owner is told before the head turns 30 days old (O13).
  - If no admin device has run for 30 days, remote actions stop and the app says why.
  - The security clock is the state's authenticated `issued`, never the time the hub delivered it.
- **Who writes it.**
  - Admin changes are signed by an admin device: adding or removing a member, changing a role, removing a device, adding a machine or a delegation.
  - A member adding their own new device needs a signature from one of that member's existing devices, and then an admin's countersignature. The admin's own devices need only an existing admin device.
  - Under a one-person org, that is one press on the owner's other Mac.
- **Writers are serialized.** The hub accepts a successor only if it links to the current head. A writer whose successor loses retries on the new head. For an org of a few admins that is enough, and it keeps one serialized chain rather than forks.
- **The residual: a stolen admin key.** It can sign successors, so the backstop doesn't bound its abuse.
  - What ends it is a root transition signed by the offline recovery key, which every machine accepts over any state signed by the old root set (RL5).
  - The hub withholding the transition shows the same way as a pending revocation.
  - In the first milestones, software device keys make this risk larger. The org is one person, and that person's Macs are the admin devices.
- **A software root** (p5-desk-track-owner, from O13; Decision Log 28). Until signed builds, every root key is a software key, the app's own device's included (§5.1, O10 M9). So the org's first root may be a software device. Production's is a command on the owner's Mac (O13's `deployment admin`), since the app's Org page (O8) comes later. A 0600 file is readable by every process of its uid, so what bounds a software root is how many copies of its key exist, and what can make it sign.
  - **No copies.** An admin device's key file is kept out of every backup and sync scope. It is excluded from Time Machine, never under a synced directory (iCloud Drive, or `~/.claude`, which syncs between the owner's Macs), and never in a store that agents read secrets from.
    - A copy is a root key the state doesn't list. A key with a copy can't be retired honestly either, since retirement needs the key destroyed (above).
    - A lost admin key is replaced through the owner's other admin device or the recovery key (§8), never restored from a backup.
    - The exclusion applies from the moment the file is created. The app's key file (`<profile>/device/keys.json`, O10 M9, `src/main/device/keys.ts`) is created today with none, and an O10 follow-up writes it excluded. Excluding a file later leaves the copies already made, so a device whose key file may have been copied before then is re-registered with new keys (§11) before it becomes a root.
  - **Signing takes the person.** Against a deployment, a stand-in reads its signing confirmation from the terminal (`/dev/tty`), never from stdin. A process with no terminal, such as an agent's shell, then can't sign through it. This stops a mistaken run, not a process that reads the key file.
  - **A stand-in ends.** A root device that isn't the app is a stand-in. Once the app's device is a root, a successor the app signs removes the stand-in, and its keys go into `revoked`.
    - Revoking it discredits nothing it signed. A state verifies against its predecessor, and an endorsement only in the step that adds its device, so every state and device it signed stands. O13's command signs no log events, so retiring its keys would keep nothing more.
    - The stand-in's end is the app's arrival, not the Enclave: the app's device is a software device too until signed builds, and its move to the Enclave is a later re-registration (§11).

#### 5.3 Enrollment

- **A machine.** The app of the member enrolling it makes a one-time code.
  - The code carries the hub URL, a one-time redemption token, the org root's public key, the recovery key's public key, and a one-time **pairing secret** `k`.
  - `k` travels from app to machine by the person's hand and never through the hub. The code carries no secret org key; desk's code carried the org key (DX7).
  1. `sminos hub enroll`, or its successor in the endpoint, reads the code from a hidden prompt or stdin, never from an argument.
  2. It generates the machine key and redeems the token for the machine's Access service token.
  3. It sends its public key and its ref with `MAC(k, name ‖ machinePub ‖ ref ‖ tokenId)`. Each field is length-prefixed, so no two inputs encode alike: HMAC-SHA-256 under domain `smns-enroll-mac-v1`, a u32 big-endian length before each field, and `k` of at least 16 bytes, with a test vector in the protocol package (O11 M1). The member's device checks the MAC, so a key or ref the hub substituted fails. Only then does it sign the machine into the org state, with its owners set (§6.3): that member by default, or the org.
     - A ref the state already holds is a re-enrollment of that machine. The app says so, and the new state replaces the entry's key and keeps its owners unless the member changes them.
  4. Until that state version arrives, the machine is *pending* and executes nothing.
- **An unattended machine** (a devcloud VM enrolling at boot) can't get a device signature, so it enrolls through a **delegation**.
  - An admin signs the delegation into the org state. Today's provisioning key becomes that delegation, and its existing fields fit it: `{id, pub, prefix, expires, maxUses, offlineRevokeS, owners}` (`identity.ts:245-266`).
  - The provisioning secret store then holds the delegation's private key instead of the org key.
  - The booting machine generates its key, and signs its own machine certificate with the delegation key, so nothing passes through the hub to be substituted. The name must sit under the prefix. Prefixes keep certificate names apart from enrolled machines' names and from other delegations' (RL5), so a delegation's key only ever speaks for names under its own prefix.
  - The certificate carries the machine's ref. The ref starts with the delegation's id and `_`, so no certificate of another delegation can claim it (RL5). A ref already held by an org-state entry, or claimed by two live certificates, makes verifiers refuse every certificate that claims it, and the admin's app shows the conflict. So a compromised VM can deny another VM its ref, but can't take it.
  - Uses are counted by the hub, as a courtesy only. A compromised VM holds the delegation key and can mint further machines under the prefix until the delegation expires or is revoked. Revoking the delegation removes them all.
  - Verifiers accept the certificate while the delegation is live, with the delegation's owners as the machine's owners. No new org-state version is needed per VM.
  - The hub stores the certificates, and serves them beside the state.
- **A device.** A new MAWS install generates its keys: in the Enclave on signed builds, as software keys before that (§5.1).
  - The approving device shows a one-time pairing code, which the person types into the new install. The new device sends its public keys with a MAC under that code, as for a machine.
    - The MAC holds only while the code is secret, and a code passed by clipboard is readable by every process of the uid. So both screens also show a short fingerprint of the new device's entry, computed by the protocol package beside the MAC, and the person compares them before approving (Decision Log 28).
    - The fingerprint is over the same canonical entry the MAC covers: the org, the member, and the device's id, class, `keyStorage` and every credential (`channelPub`, `stepUpPub` where present, and the passkey's `credentialId`, `publicKey` and `rpId`). A fingerprint of one key leaves the others substitutable by whoever holds the code.
    - Two entries that verify under one code are both refused, since the code has leaked.
  - An admin countersigns when needed (§5.2).
  - The phone registers its WebCrypto key and its passkey the same way.
  - The org's first device, at org setup, signs the first state with itself as root, and makes the offline recovery key.
    - `recoveryPub` never changes after genesis, not even in a root transition (`apps/org-protocol/src/org-state.ts`). A recovery key lost is lost for the life of the org. A stolen one gives its holder, for the life of the org, the power to sign a root transition that every machine accepts.
    - So setup writes the recovery key's private half only where the owner keeps it offline (§10.2). It is never written to the disk that holds an admin key, nor into any backup or sync scope. A file written beside the admin key and moved afterwards has already been on that disk.
    - Before it signs the genesis, setup reads the recovery key back from there and checks it against `recoveryPub`, so the org never pins a recovery key the owner can't produce.

#### 5.4 Channels

- **What a channel is.** A channel is a mutually authenticated session between one device and one endpoint, relayed by the hub without being readable there.
- **The handshake.**
  - Ephemeral P-256 ECDH on both sides.
  - Each side signs the transcript with its long-term key: the device's channel key and the machine key.
  - The transcript includes the org-state version each side holds, the device id, the machine's ref and the client class.
  - The pattern is SIGMA-I (sign-and-MAC). The exact construction and its test vectors belong to the Interfaces (RL2).
- **After the handshake.**
  - Frames are AES-256-GCM, with keys from HKDF per direction and a 64-bit sequence number in each nonce.
  - A gap, a reorder or a repeat closes the channel.
  - Keys are rotated every 2^20 frames or 24 h, whichever comes first.
- **Sealing per subscriber.** Each subscriber gets its own sealed copy of a stream, so there is no group key in phase 1. This relaxes one research target: the machine's uplink now grows with the number of viewers (research §1, "machine load independent of viewer count"). At the org's scale that costs nothing. Per-session content keys would restore it, and they arrive only with hub-stored ciphertext (§7.3).
- **What the channel gives that desk lacked.**
  - Display integrity: a transcript, diff or request card a person approves from cannot have been altered by the hub. This closes research §3.5's open item.
  - No hub-served code. The native app's code is not served by the hub, so the hub cannot exfiltrate keys from it (research §3.5's limit on browser keys). The trust root becomes MAWS's release signing and update channel (§11).
- **Revoking a share or a device** closes that device's subscriptions or channels at the machine. Nothing is rekeyed.

#### 5.5 Authorization at the machine

- **Every request is checked at the endpoint.** Each subscription and action is checked against four things:
  - the device's member in the current org state;
  - the session record's owners and shares;
  - the machine's grants;
  - the machine's own policy.
- **The machine's policy** moves from sminos into the endpoint:
  - read-only mode;
  - the permission-mode ceiling;
  - spawning only into checkouts known on that machine;
  - no arbitrary flags, environment or shell.
- **The hub's checks are courtesy only.** The hub may refuse early to save a round trip, but it never decides.
- **Every operation maps to a grade at the endpoint module, including indirect paths.** Disabling a control in the UI is not authorization.
  - `send` carries literal text.
  - Text that starts with `/` is a command. It is classified by lane A's route table or lane B's command catalog, and graded by its effect:
    - `/compact`, `/clear`, `/rewind` and `/resume` take `manage`;
    - a session-only model or effort change takes `converse`;
    - unknown commands take `manage`.
  - Lane B's own compact, which is a queued `/compact` user message (lane-b-control-map), is graded the same way.

**Grades**, from lowest to highest. Each includes the ones below it, except where noted.

| Grade | Allows | Default holder |
|---|---|---|
| `list` | See the session in listings (§6.2) | Every org member, unless the session's access is `private` |
| `view` | Subscribe to the session's plane: transcript, subagents, diff | Owners; shares at view or above; every member when access is `org-view` or `org-converse` |
| `converse` | Send, steer, interrupt, answer a question, side question | Owners; shares at converse or above; every member when access is `org-converse`. The restriction to the route's principal on personal routes is deferred (§6.4). |
| `approve` | Answer permission requests and dialogs that execute | Owners; shares at approve. Never org-wide. Deferred like `converse` (§6.4). |
| `manage` | Change owners and shares, end the session, compact, rewind | Owners |
| `spawn` (per machine, not per session) | Start a session on this machine | The machine's owners; members granted it (§6.3) |
| `machine-admin` (per machine) | Read-only mode, ceilings, grants | The machine's owners; members granted it |

#### 5.6 Step-up

- **Which actions need it.** Execution-grade actions carry a step-up signature, Touch ID-gated, over the action's digest:
  - spawn;
  - approving on a session the member doesn't own;
  - changing shares or owners;
  - machine-admin changes.
- **What is signed.** Main builds the action from typed fields, renders the exact text the person confirms, and signs that action's canonical form. The renderer can ask for an action, but it never supplies the bytes that are signed.
- **Approvals are bound** to the digest of the request as displayed: session, tool-use id, tool name, SHA-256 of the input. The machine executes only if the digest matches the request still pending (desk §6, kept).
- **Routine approvals** on the member's own session from an unlocked app need no step-up by default. The owner can require it for every approval (§10.5).

#### 5.7 The log plane

- **Every log event carries its writer's signature.** That is a device for a human's words, or the hosting machine for events it writes on behalf of its sessions (§5.8). Machines verify before importing into their logs, and apps verify before drawing.
- **The endpoint does the cryptography for sminos.** It signs what the machine's sminos daemon wrote as it uploads, and verifies what arrives before handing it to sminos over the local socket. Python stays stdlib-only.
- **Who may write a person's words.** Today any `human` event is delivered into its session as the owner's words, through the bridge (`sminos.py:145-153`). That holds whether `<machine>/human` or `hub/<member>` wrote it. Under this model, a `human` event is delivered as words only in two cases:
  - it is signed by a device whose member holds `converse` on the target session;
  - it is signed by the machine, attesting its owner's words from the owner's own terminal `sminos say`. This is the operator path, run outside any session (RL8).

  Any other `human` event is delivered as a peer message, or refused. Without this rule, a member with no grade on a session could reach it as the owner's words through the log.
- **The operator path proves less than it looks.** Its guard is only an environment check: an agent can run `env -u CLAUDE_CODE_SESSION_ID sminos say …` (`sminos.py:7817-7833`). So a machine-attested `human` event proves only that something under that OS account wrote it. Such words are delivered as words only into sessions on that same machine whose owners include the machine's owner. Everywhere else they arrive as a peer message. Words into another machine's session need a device signature.
- **Signatures are made once and kept.** Machines store events unsealed and today seal them at upload, under a nonce derived from the event (`sminos_hublog.py:14-18, 80-97`). The hub refuses a different payload at a stored position as `conflict` (`project.ts:413-418`). ECDSA signatures are randomized, so signing again on a resend would break that.
  - The endpoint module therefore signs each event once and keeps a ledger keyed by `(project, writer, seq)`. Every resend reuses the stored signature.
  - The ledger works with Enclave and WebCrypto keys, which can't sign deterministically. That is why it was chosen over RFC 6979.
- **Load.** Every machine follows every project (`sminos_uplink.py:37-41`), so it verifies every event, a fresh machine's whole backlog included. That's cheap in Node, but it belongs in the endpoint module's benchmark (§12).
- **Rejected alternative:** having sminos verify through `/usr/bin/openssl`. That can verify signatures but can't carry an AEAD channel, so there would be two trust implementations.
- **Phase 1 residual:** log contents stay readable by the hub, because the hub routes on `to` and `kind`. Encrypting log bodies needs group keys and is deferred (§7.3).

#### 5.8 Agents acting for their owners

- **Delivery is today's `sminos say`, unchanged** (owner, 2026-10-26: "the same mechanism as today's sminos say, only with each session labelled with who owns it").
  - Agents in one org message each other as they do now, and a message may wake its recipient.
  - The only addition is the owner label, carried with the sending session and signed so that it can be trusted.
  - There is no recipient policy, narrowing or off switch in this initiative.
  - As today, a peer message never counts as a person's words and never approves anything. Human words come through the bridge and peer messages through the inbox, so the two can't be confused (§5.7).
- **The label is an attestation.** The hosting machine signs `{machine, session, owners, ownersProof, origin, orgStateVersion}` into the event (RL9). A receiving machine accepts it only if the sending machine is in the current org state, and each claimed owner is one of:
  - one of the machine's owners, per the org state or its delegation certificate. For this check, an org-owned machine's owners are the org's admins (the `@machine` token, below);
  - proven by `ownersProof`: device signatures from the owners themselves, namely the requester's signed spawn action for a MAWS spawn, and an existing owner's signed `manage` action for each co-owner added (§6.1). A `sminos spawn` child copies its parent's owners and proofs, and records the parent's session id.

  Grants play no part in this check. They bound spawning only at the hosting machine, which holds the current grants and gets revocations directly (§5.2). Owner sets are small, and each proof is a few hundred bytes.
- **The residual.** A compromised machine can reuse a proof to label another of its sessions with that owner. It can't label a session with a member who never spawned or was never added on that machine.
- **Default owners** by how a session started (desk-sminos-orchestrator's sminos-side rule):
  - a terminal session: its machine's owners, recorded as the token `@machine` (below);
  - a session MAWS spawned: the signed requester. Desk spawns already record `by` as the hub member id (`sminos_rpc.py:618-620`).
  - a session spawned with `sminos spawn`: the spawning session's owners, **copied into the new record at spawn time**, and it copies the parent's principal and inference route fields (§6.4). Starting the child on the parent's slot is deferred with account-managed inference: `claude --bg` gives a seat the bg supervisor's environment, not the spawner's. A terminal parent carries no proofs, and its children copy its `@machine`. Today sminos records `by` as the spawner's alias (`caller_alias()`, `sminos.py:7598, 7693`), and aliases change and are reused. sminos must also record the spawner's session id, and never resolve owners later through the alias.
- **Lane A's session record** is sminos's member record. It has no owners field today, so that field is new. Sessions that predate it default to `@machine`.
- **The `@machine` token** (desk-sminos-orchestrator, 2026-10-27). Before cutover nothing on a machine knows its owner's member id: `hub.json`, `org.json` and the hub's welcome carry none. So sminos records `@machine` wherever a default above names the machine's owners: terminal sessions, their `sminos spawn` children, records that predate the field, and the daemon's reconciliation.
  - **What it means.** The machine's owners in the signed org state, or its delegation's (§5.3): its member owners, or the org's admins when the org owns the machine. It never resolves to `'org'` as an owner, because owners hold `approve` and `approve` is never org-wide (§5.5). The admins already sign an org-owned machine's grants (§6.3).
  - **Who resolves it, and when.** The endpoint module, only against signed org state:
    - at dispatch, against the current state, for grades (§5.5);
    - when it attests (RL9) or lists (RL6's projection), against the version it stamps.
  - **It never leaves the machine.** Attestations and listings carry member ids.
  - **It isn't an alias.** A terminal session carries no `ownersProof`, so receivers check its owners against the machine's current owners anyway. A member id copied at creation would fail that check after an ownership change; the token follows the change. A change to `machines[].owners` or to the admins re-issues the listings of `@machine` records with a new revision.
  - **It can stand beside member ids.** An owner added by a `manage` action is recorded as a member id with its proof.
  - **As a principal** it means the binding of the record's inference slot on this machine (§6.4). With no explicit binding, the default slot binds to the machine's sole member owner, or to `'org'` on an org-owned machine. A machine with several member owners binds its default slot explicitly. Until it does, the principal is unresolved, which nothing enforces in this initiative.
  - It can't collide with a member id (32 hex) or with `'org'`.
  - **Rejected:** the hub returning the enrolling member at redemption. That needs a hub change and a re-enrollment, for a value O14's v2 re-enrollment supersedes anyway.

#### 5.9 What the hub can and can't do

It can:
- see routing metadata: org, member ids, machine refs and names, project ids, session ids, sizes, timing;
- see the listing fields of sessions that aren't `private`, and the log plane's contents, which are org-readable by design (§5.7, §6.2);
- delay or drop frames, or deny service;
- delay a revocation, but only visibly to the admin (§5.2);
- report presence and pending counts, which the app labels as hub-reported.

It can't:
- read or alter channel contents (transcripts, diffs, actions);
- forge an action, a log event or an org-state version;
- replay an action;
- make a person approve something other than what the machine holds;
- fabricate a listing, since listings are machine-signed (§6.2).

The hub's deployer has the same limits, as long as the app comes from MAWS's signed release channel (§11).

#### 5.10 Client classes

- **The class is part of the identity.** It is in the device's org-state entry and in the channel handshake. The endpoint grants per class.
- **Phase 1 has two classes:**
  - **`native-mac`** is the MAWS app, with every grade.
  - **`web-cards`** is the phone. The owner kept the phone loop through the Desk Web pause (2026-10-26): desk-web's push notifications, and its question and permission cards, and nothing else. Its grades are:
    - `list`;
    - the pending request cards of sessions the member **owns**, sealed through a channel like any other subscription;
    - answering a question;
    - approving or denying a pending permission request on those sessions. Approvals on a session shared with the member need the native app.

    **Every answer and approval from this class carries a WebAuthn assertion.** Its challenge is SHA-256 of the canonical action (RL4). The machine checks:
    - the listed passkey's public key, credential id and `rpId`;
    - the origin;
    - the user-verification flag;
    - a monotonic signature counter, where the authenticator keeps one.

    Why it is needed: This class's code is served by the hub, so its key can be used without being extracted. The assertion makes such use need the person's biometric gesture at that moment. It proves presence, not intent, since the browser's prompt doesn't show the digest. Accepted residual: a hostile deploy could get a pending request on the member's own sessions approved during a gesture the person made for another card. It can't send, spawn, share or manage.
- **A later web port of MAWS** is class `web`. It gets `list`, `view` and `converse`. Its `approve`, `manage`, `spawn` and admin actions need confirmation on a native device, or `web-cards`' per-action assertion for approvals.

#### 5.11 The local boundary

- **Inside one OS account, the trust boundary is the uid**, as now. The daemon's RL10 socket, the engine host's socket and the bridge sockets live in 0700 directories as 0600 sockets, and authentication comes before any output (holder design §6). sminos already makes the directory 0700 and binds the socket at a temp name, chmod 0600, then renames it (`sminos_bridge.py:1434-1443`). Checking the socket's owner and refusing symlinks are **new requirements**.
- **An app on its own machine** talks to the local daemon over a same-uid socket with the device's identity. The endpoint applies the same grades. In practice that member is the machine's owner.

### 6. Ownership, sharing and visibility (enforcement side)

All of this section's choices are decided (owner, 2026-10-26).

#### 6.1 Owners

- **Default owners** follow §5.8. On a machine owned by several members or by the org (§6.3), a terminal session's owners are the machine's owners.
- **More owners.** Adding an owner ("owned by many") is a `manage` action signed by an existing owner's device. The machine records the signed action in the session record and carries it in every attestation from then on (`ownersProof`, §5.8). Other machines can then accept a co-owner who has no grant on the hosting machine.
- **Removal.** An owner can remove themselves. Removing another owner takes `manage` plus step-up. A session always keeps at least one owner.

#### 6.2 Visibility and access

**Each session has a general access level**, set by its owners, the way a shared document is. The default is `listed`.

| Access | Listing | Contents and actions |
|---|---|---|
| `private` | Owners and shares only | Owners and shares only |
| `listed` (default) | Every org member: owners, machine, project, lane, state, title | Owners and shares only |
| `org-view` | Every org member | Every member may `view`; owners and shares as granted |
| `org-converse` | Every org member | Every member may `view` and `converse`; `approve` and `manage` stay with owners and shares |

- **Individual shares** add a member at `view`, `converse` or `approve` (§5.5), whatever the general level.
- **The sidebar.** It shows the member's own sessions first. Other people's sessions sit behind a per-project toggle, each with its owner and machine (owner, 2026-10-26).
- **Where listings come from.**
  - The machine publishes the listing fields of every session that isn't `private` to the hub, which serves them to org members.
  - Each listing record is signed by the machine: `{session, revision, issued, fields}` (RL6). The app verifies it, and labels a cached one with its age when the machine is offline.
  - A `private` session's listing goes only over channels, to its owners' and shares' devices. The hub learns nothing about a private session except the traffic its machine sends.

**What travels where.** The hub can't keep content private by filtering the log plane: each writer's seqs are contiguous, so a withheld event becomes a permanent gap. The log plane is therefore org-readable by design, which fits `sminos say` staying as it is (§5.8).
- **Channels only, sealed to members whose grade allows them:**
  - transcripts;
  - pending requests with their tool input;
  - usage and settings reads;
  - what a session says to its own person (desk's project chat of `<message>`s).
- **The log plane:** inter-agent `say` traffic and project-level events.
- **What this means for `private`.** A `private` session's `say` messages to other agents are still org-readable. The app says so where `private` is set.
- **Today, with the org as the owner alone,** nothing visible changes. The split matters once a second member joins.

#### 6.3 Machine owners and grants

- **A machine's owners** are one or more members, or the org itself (owner, 2026-10-26). The org owns shared machines such as devcloud VMs and the mini, if the owner says so. A delegation's machines take the delegation's owners (§5.3).
- **Per-machine IAM.** The machine's owners grant members rights on it: `spawn` and `machine-admin` (owner, 2026-10-26: "IAM can name each user's rights per machine").
  - The grant is `{machine, machineKey, member, rights, version}`, signed by an owner's device, or by an admin device when the org owns the machine. `machineKey` is the id of the machine key it was signed for.
  - **The machine verifies a grant once, when it arrives,** against the org state it holds then, and keeps the highest version per member.
    - A grant in force stays in force when its signer later stops being an owner or an admin, or retires the device that signed it. Re-checking against the current state would lose a lower grant's replacement once its signer was demoted, and the lower grant would be back in force.
    - It ends when a higher version replaces it, or when its signer's key is revoked. The member then holds no grant until an owner signs a higher version, never a lower version again.
    - The hosting machine is the only verifier of its grants (§5.8). Its grant ledger keeps the highest version per member and the ids of the machine keys this daemon has held, and it lives beside the machine key in the daemon's state directory.
    - **Losing that state fails closed.** A daemon that lost its state keeps its ref (§2.3), but has no key, so it re-enrolls with a new one (§5.3). It accepts only grants naming a key its ledger holds. So a grant replayed from before is refused, even one the lost ledger had already superseded. The machine's owners sign its grants again for the new key, and the app shows each one before signing, since the hub that serves the old ones isn't trusted.
    - A daemon that finds its key without its ledger, or its ledger without its key, starts as unenrolled. The state directory is kept out of backups (`tmutil addexclusion` on macOS), so a restore can't bring back an old key with an old ledger. A VM restored from a snapshot can, and that residual is its operator's.
  - Without a grant, nobody but the owners can spawn there.
- **A grant is permission to use the machine.** A session spawned under a grant runs as the machine's OS account. Its owner and principal are the member who spawned it, and its record names its inference route. Running it under the spawner's own slot or route instead of the machine owner's login is deferred to account-managed inference (§6.4).

#### 6.4 Credentials: the record names the principal and the inference route

**The owner's ruling** (2026-10-26, through the MAWS architect). Keep what is designed now. A later phase introduces account-managed inference: each account manages its own inference through a server-side gateway, for example the owner's Claude subscriptions, Codex subscriptions and OpenRouter. That phase is how the credential will follow the principal. In this initiative the fields are binding, and enforcement is deferred.

**Binding now.**
- **Every session record names its principal and its inference route** (RL6). The route is a slot or a gateway route, never a token.
  - A slot is a Claude Code config dir: the default, or a `CLAUDE_CONFIG_DIR`.
  - A gateway or API route is a settings file passed with `--settings`, as desk spawns already do.
  - The machine binds each slot to a member or to the org; the machine owner's login is the owner's. The account identity is read on the machine and goes no further than that binding.
- **How it is known.** In lane B the daemon chose it at spawn. In lane A sminos reads it from the session's environment and its recorded launch settings. A `sminos spawn` child copies its parent's principal and route fields (§5.8).
- **MAWS never stores or relays claude.ai tokens.** Sign-in happens on the machine, through Claude Code's own flow.

**Deferred to account-managed inference** (owner, 2026-10-26).
- **The multi-person driving rule.** Anthropic's terms bind it: consumer accounts may not be made "available to anyone else", Team seats can't "route their work through another user's account", and third parties may not route requests through Free, Pro or Max credentials (the architect's `identity-prior-art.md` §3).
  - Typing into, steering or approving in a session on a personal account uses that account.
  - So once a second person joins, `converse` and `approve` by non-principals on a personal route must be refused, unless the route is an org or gateway route that admits several drivers.
  - Nothing enforces this in this initiative, because the org is one person. The fields above let the later phase enforce it without a rewrite.
- **Spawning on another member's machine** under that member's own slot or route, rather than the machine owner's login (§6.3).
- **Two open questions:** A's agent working on B's agent's message on A's quota, and the identity inventory's item 6.7. The owner's agent-messaging model already makes the first the ordinary case.

**Per-member credentials on a shared machine, later.** There are two routes: a separate OS account per member, or inference through the member's own gateway route. `ANTHROPIC_UNIX_SOCKET` is one engine-supported transport for the latter (the CC SSH-mode note, §3). An org policy with `allowedProviders` set refuses such sessions.

### 7. The hub

#### 7.1 Objects

- **Registry, one per org.** It holds the org-state chain, members' Access identities (email → member id), enrollment state, and listings (§6.2). Member management is new: today the only member is the bootstrap admin (registry.ts:971).
- **Machine DO, one per machine.** It terminates the endpoint's WebSocket and holds its lease. It relays channel frames between the endpoint and each attached app's socket, without decrypting them, and keeps presence and pending-request *counts* for badges.
- **Project DO, one per project.** The log plane: storage, fan-out and signed-event checks (as courtesy). It no longer carries pending requests and their tool input. Today every browser gets all of them; they move to channels (§6.2).
- **Human sign-in** stays Cloudflare Access by email, for admission to the hub only. Authority comes from device keys, never from the Access session.

#### 7.2 Constraints that bind

- **Frames** are under 1 MiB (§4.2).
- **A deploy** keeps old instances serving for about 5 minutes, then answers `stale-generation`. Clients reconnect, re-handshake their channels and resume by cursor. Correctness never depends on a DO's memory.
- **Presence and leases** are kept in storage, as desk does today.

#### 7.3 Storage

- **Phase 1:** the hub stores no session content. It keeps an in-memory reconnect buffer per channel at most (research §7, option a).
- **Later child,** gated on owner decision §10.4 (lid-closed viewing): a bounded, encrypted recent tail per session (option b).
  - The machine encrypts under a per-session content key, wrapped to each member device that has `view`, and rotates it on any revocation.
  - The same keys would let the machine send one copy per stream instead of one per viewer (§5.4).
  - This is the only place phase 2 needs group keys.

#### 7.4 Notifications

- **While the app runs,** it raises native notifications from the events on its channels.
- **Pushes go only to the devices of a session's owners and approve-shares.** That needs an owners projection at the hub (from RL6's listing projection, or per-member over channels for `private` sessions), which the hub doesn't have today.
- **The phone (`web-cards`)** keeps desk's Web Push. The hub sends a notification that says only that a session is waiting ("`maws-45` asks something"). That needs the hub to know a session has a pending request, which is metadata it already sees (§5.9). The card's contents come over the phone's channel.
- **APNs for the Mac app** needs the signed app (§11). Until then, a Mac app that isn't running gets nothing.

### 8. Failure and recovery

| Event | What survives | Recovery |
|---|---|---|
| Hub deploy or DO eviction | Everything on machines | Sockets reconnect. Channels re-handshake. Subscriptions resume by cursor (replay, or snapshot if the ring overflowed). |
| MAWS daemon restart (the endpoint module with it) | Sessions, the Query and the tool server (in the engine host), sminos | Channels drop, and the daemon's client connection to the engine host drops. Both reconnect, apps resume by cursor and reseal pending actions. |
| Engine host restart | Lane B processes and their CLI work (session hosts keep them) | Query re-adoption: checkpoint, `stdinApplied` rebase, pending requests redelivered. In-flight MAWS tool calls are answered "outcome unknown" from the ledger (holder design §3.3). |
| Session host dies | — | The session ends and is shown as ended, with resume offered. |
| App sleeps or quits | Everything on the machine | Pending requests wait. Client-bound tools answer "no app attached". On wake, resume by cursor. |
| Machine sleeps | — | Shown as machine offline. Listings stay (if hub-readable). Contents unavailable until the lid-closed tail (§7.3). |
| Device lost | — | An admin removes the device, or the member removes it from another device. The removal goes to every machine directly, and each acknowledges it. The admin's app lists any machine that hasn't (§5.2). |
| Machine compromised | — | Remove it from the org state. Its past attestations stay in the log, marked by state version. |
| All admin devices lost, or an admin key stolen | Sessions keep running. Remote actions stop after the 30-day backstop if no admin signs | The offline recovery key signs a root transition to a new admin set (§5.2, RL5). |
| Mixed versions | — | §2.2: not-upgraded machines show *needs upgrade*, execute nothing from the merged app, and their events display as unverified. |

### 9. Migration from desk phase 1

**Sequencing** (agreed by the MAWS architect and desk-sminos-orchestrator). The protocol is built once.
- RL1–RL4 go first, with software device keys and a signed org state of one member.
- Nothing new goes over DX2 or the org key. DX2 stays only for machines and the phone that haven't moved yet.

**Each machine cuts over once and for good.** As soon as a machine's endpoint module is enrolled:
- It rejects every DX6 RPC.
- It rejects any DX1-coded input that could cause execution or delivery as words.
- Legacy-coded events from machines that haven't moved never arrive as a person's words. During the migration window they arrive only as peer messages marked *unverified (legacy)*, and carry no authority, like any peer message.
- History is imported as inert records.

The hub serves both protocols, but a migrated endpoint accepts only one trust model.

**The other direction.** An unmigrated machine verifies only DX1 HMAC. Without help, its sessions would stop receiving messages from migrated machines, and the owner's words from MAWS.
- So until the org key retires, the migrated endpoint module codes everything it sends twice: RL8 v2 and the legacy HMAC. The MAWS app does the same for the owner's words, unwrapping the org key the way desk-web does today.
- This dual-coding is outbound only. The migrated side still accepts no DX1 input. The hub accepts an event that carries both codes.
- This is preferred over migrating every machine in one window, because the mini runs the owner's unattended seats (journal, Telegram).

**One ordering this forces.** The phone must keep working (owner), and a migrated endpoint takes no DX6. So `web-cards` (step 4) ships no later than the first cutover of a machine whose sessions the owner answers from the phone.
- The first cutover can be a devcloud acceptance VM the phone never answers for. That proves RL1–RL4 before `web-cards` exists, and keeps desk-web's RL2 work off the critical path.
- Until a machine cuts over, the phone keeps DX6 for that machine.

**Steps.**
1. **Set up the org root** on the owner's device. That makes the first signed state, with the existing admin as its member, their existing machines listed as pending, and the offline recovery key made (§10.2).
2. **Upgrade each machine and re-enroll it in place** with a new code (§5.3), keeping its name, as `hub enroll --replace` does today.
   - Log writers are `<enrolled name>/…`, so a new name would split the log's history.
   - The mini still runs a pre-MW1 sminos, so upgrading it comes first. The upgrade goes through `mini-ops`, a session on the mini, at the owner's request. The owner's standing rule forbids driving `claude` over ssh there, and that covers both the sminos upgrade and installing the daemon. This is an operational dependency.
   - The hub serves DX2 and RL1 side by side for each machine until that machine has moved. The exception is the machine's own re-enrollment: redeeming its code ends its DX2 credential, so from then until it is listed and cut over, it is on neither path (Decision Log 29).
3. **Re-attest history.** At migration, each machine signs its own past events once. The hub's existing project logs then display as *attested at migration by `<machine>`* instead of *unverified (legacy)* for good.
4. **Move the phone's cards to `web-cards`** (§5.10), no later than the first cutover of a machine the owner answers from the phone (above).
   - The phone registers a device: a WebCrypto channel key plus its passkey, approved from the owner's Mac.
   - It answers through RL4 actions over a channel.
   - This means desk-web implements RL2 in WebCrypto (ECDH, HKDF and AES-GCM are all available there). It is not free.
   - The phone loop keeps working at every step, except for that pause at the cutover of a machine it answers. The pause falls inside a window the owner names, with no session waiting and nothing owed (owner, O14's Q3).
5. **Retire the shared org key** once the last machine and the phone have moved. The hub deletes the wrapped copies, and the endpoint module ignores DX1 codes.

### 10. Open owner decisions, with recommendations

| # | Decision | Recommendation | When the alternative is better |
|---|---|---|---|
| 10.1 | Session access, share grades, machine rights | **Decided (owner, 2026-10-26):**<ul><li>a per-session access level of `private`, `listed` (the default), `org-view` or `org-converse`;</li><li>shares at view, converse or approve;</li><li>machines owned by members or by the org, with per-machine IAM grants (§6.2, §6.3).</li></ul> | — |
| 10.2 | Org root recovery | **Decided (owner, 2026-10-26):** an offline recovery key, made at org setup and kept by the owner, which can sign a new set of admin keys. | — |
| 10.3 | Agent messages across owners | **Decided (owner, 2026-10-26):** today's `sminos say`, with a signed owner label. A message may wake its recipient. No new policy (§5.8). | — |
| 10.4 | Lid-closed viewing | **Decided (owner, 2026-10-26):** the encrypted tail (§7.3) is a later child, not in the first release. The phone loop is kept as `web-cards` (§5.10). | — |
| 10.5 | Step-up on routine approvals of your own session | **Decided (owner, 2026-10-26):** not required. | — |

### 11. Dependencies

- **MAWS release signing, notarization and an updater** (C12 P1-R1..R4).
  - Today MAWS is an unsigned or development-signed build from source (`electron-builder.yml`: `identity: null`, `hardenedRuntime: false`). The trust root is therefore merge rights to MAWS master plus the build Mac.
  - The owner will get an Apple Developer ID. The design assumes signed builds. The first milestones run unsigned, with software device keys (§5.1).
  - The org is the owner alone for the next months (owner, 2026-10-26), so shipping to a second member, and with it C12, is not in the first milestones. The people model is built in from the start anyway, so a second member is an org-state edit, not a redesign.
  - Notifications through APNs need signing too.
- **Secure Enclave keys from Electron,** once the build is signed. This needs a small native module in main. A permanent Enclave key in the data-protection keychain needs a keychain-access-group entitlement. Moving a device from `software` to `enclave` keys is a device re-registration: a new device entry, with the old one removed.
- **The headless daemon package,** on macOS and Linux, versioned apart from the app (§2.2). Its runtime is a choice to make: either the mini and the devcloud Linux hosts get a system Node, or the package bundles its own runtime as a single-executable build. Which Node those hosts have today hasn't been checked.
- **Member management in the hub's Registry:** invite, role, removal, email change. None of it exists today.

### 12. Unknowns to settle by spike or measurement

1. Software device keys in an unsigned build: where main keeps them (a 0600 file, or a keychain item whose access-control list an unsigned app can actually set), and whether LocalAuthentication works there for step-up (§5.1).
2. The `-p` reaping gate: does `turn.step` hold cron-fired and task-notification turns in a `-p` process, and does SIGTERM drain the same way as in the TUI (holder design §9)?
3. Native `rewind_conversation` across `--resume`: duplicated or restored content, as the lane A substitute showed (truncation spike).
4. Hub topology and throughput: app → Machine DO relay of sealed frames, with per-hop latency and the cost per active session (research §8 spike 3).
5. The budget for local latency: MAWS's own local sessions must not get slower than today's app main → engine host → `claude` path (§2.1).
6. **The Desktop 3.6556 helper** (`research/desk-remote/desktop-ssh-helper-3.6556.md`).
   - Its core contract hasn't changed: seq replay, stdin-offset de-duplication, line-aligned checkpoints.
   - What changed:
     - liveness (how an OpenSSH link is judged silent), adoption and deployment safeguards;
     - hardened RPC framing;
     - interrupts it couldn't deliver are now persisted.
   - The holder design takes these as inputs when it is revised; nothing here changes.
   - **Claude Code 2.1.311's SSH mode is settled.** It offers no session service MAWS could use instead of the engine host. Its parts are an entrypoint marker, Desktop config metadata, a telemetry name, and `ANTHROPIC_UNIX_SOCKET` inference routing (`research/desk-remote/cc-ssh-mode-2.1.311.md`). The engine-host design stands.
7. **Linux and macOS process attribution.** On Linux: transient scope and lingering under `KillUserProcesses`. On macOS: TCC attribution for `claude` launched by a launchd daemon (holder design §9).
8. **The endpoint module's verification load:** a fresh machine verifying every project's backlog (§5.7).
9. **Later phase (account-managed inference): credential slots for `claude --bg` and for sminos's discovery** (§5.8, §6.4).
   - Does `claude --bg` honour a non-default `CLAUDE_CONFIG_DIR` that `sminos spawn` passes explicitly?
   - For the per-member-slot milestone, not phase 1: `sminos.py` never reads `CLAUDE_CONFIG_DIR`; only `sminos_bridge.py:376` and `sminos_plane.py:2200` do. Its session discovery appears to assume the default config dir, so sessions on a second slot would be invisible to join-on-sight.

### 13. Decisions taken here, and alternatives rejected

**Taken:**
- The endpoint is a module inside the MAWS machine daemon, and the engine host is a separate process (§2.1, the architect's ruling).
- One curve, P-256.
- No group keys in phase 1.
- Pairwise sealing per subscriber.
- The 60 s window on discrete actions is kept inside channels.
- The machine key is a 0600 file where the Enclave isn't available.
- Grants are signed by the machine owner, not the admin.
- Listings are hub-readable (§6.2).
- Access is for admission only.

**Rejected:**
- *A separate endpoint process* beside the daemon (§2.1). This was the first draft's position. It buys no isolation under one uid, and costs a hop and a second local protocol.
- *The Query in the client app* (§3.1).
- *sminos as the trust boundary with an OpenSSL CLI* (§5.7).
- *Group-keyed live streams* in phase 1 (§5.4).
- *A web terminal* (F5).
- *Moving live terminal sessions* (F7).
- *The engine's remote-tools channel* for client-bound tools, since it is gated to managed cloud workers (§3.1).
- *Keeping desk's shared org key with per-member HMAC subkeys.* The machine could tell writers apart, but the hub that stores the keys' wraps, and any machine holding them, could still forge.

## Interfaces (the contracts the composite lifts)

These are named here with their binding fields. Byte-level schemas and test vectors are written by the child that builds each, against this list. Every field named `machine` carries the machine's ref (§2.3), never its name. RL8's writer prefix is the exception: it is the name, bound to one ref by RL5's `machineNames`.

- **RL1, Endpoint ↔ hub.**
  - One WebSocket.
  - The hello is `{protocol, build, machine, leaseGeneration}`, authenticated by the Access service token.
  - The hub multiplexes channel frames as `{channel, seq, bytes}` opaque to the hub.
  - Lease and `hb`/`hb-ack` as in DX2. Frames are under 1 MiB.
  - An `endpoint {record}` frame carries the machine's endpoint record (RL6) up to the hub, which stores it and serves it to the org's apps (O11 M4). Its signature domain is `smns-endpoint-v1`. The app verifies it against `machines[].pub` and keeps the newest `issued`; the hub refuses a record older than the one it holds.
- **RL2, Channel.** It is carried either in RL1's multiplex or over a direct WebSocket to the endpoint module (§4.1). The bytes and handshake are the same on both.
  - The SIGMA-I handshake over P-256, carrying `{deviceId, machine, clientClass, orgStateVersion}`.
  - HKDF-SHA-256 per direction.
  - AES-256-GCM frames carrying a 64-bit sequence number and at most 256 KiB of plaintext.
  - Rekeying every 2^20 frames or 24 h.
  - Closed on any gap.
- **RL3, Subscription.**
  - The request is `subscribe {session, cursor: {epoch, seq} | null, credit}`.
  - The answer is `replay | snapshot | missing`.
  - Credit-based flow control, and snapshot paging.
- **RL4, Discrete action.**
  - The fields are `{opId, opCreated, action, session?, context?, args, requestDigest?, nonce, created, stepUp?, webauthn?}`, sealed inside the channel. The canonical action includes `opCreated`.
  - `context` is mandatory for any action on a session.
  - `stepUp` is the step-up signature over the canonical action.
  - `webauthn` is `{credentialId, authenticatorData, clientDataJSON, signature}`, whose challenge is SHA-256 of the canonical action.
  - Refused past 60 s, and refused on a reused nonce. A repeated `opId` returns its stored result.
  - Refused `expired` when `opCreated` is older than `OP_HORIZON = KEPT_S − 3600` s, and refused as malformed when `opCreated` is later than `created` by more than 60 s (§4.7).
  - The answer is immediate (`accepted | refused {reason}`). The outcome arrives on the plane.
  - `query {opId, opCreated}` answers `done {result} | in-progress | refused | not-received | expired | unavailable`. The executing side's ledger answers it; the endpoint module only forwards it (§4.7). `opCreated` is required: without it, a pruned id would answer `not-received`, and the resend that follows could run an action twice.
  - Revocations are RL4 actions too, sent by an admin device to each machine and acknowledged (§5.2).
- **RL5, Signed org state.**
  - The fields are `{org, version, prev, issued, root: {keys[], recoveryPub}, members[{id, email, role, devices[{id, class, keyStorage, channelPub, stepUpPub, passkey?: {credentialId, publicKey, rpId}}]}], machines[{ref, name, pub, owners: memberId[] | 'org'}], delegations[{id, pub, prefix, expires, maxUses, offlineRevokeS, owners}], projects[...]}`, with signatures by root keys.
  - Grants are separate records signed by a machine owner's device, or by an admin device for org-owned machines: `{machine, machineKey, member, rights, version}` (§6.3).
  - Machine certificates under a delegation are `{machine, name, pub, delegation, use}`, signed by the delegation key.
  - `ref` is immutable and unique across the state's entries and the live certificates (§2.3, §5.3).
  - A certificate's ref starts with its delegation's id and `_`, followed by at least 128 random bits. Delegation ids are 32 lowercase hex digits (`apps/desk-hub/src/protocol/identity.ts`, the provisioning key's `id`), with no `_`, so no ref falls under two delegations, and the check needs the certificate alone. A rule refusing refs that two delegations' certificates claim would have held only while the hub served every certificate. An enrolled machine's ref never starts with `<id>_` for a delegation id the state holds, live or revoked. The refs O6 mints are 22 characters, too short to.
  - `machineNames: {name, ref}[]` is append-only (desk-sminos-orchestrator's O11 M1). A successor keeps every pair its predecessor holds, and adds the pair of each new or renamed entry. No name is ever held under two refs. Names compare by their lower-cased key, as the hub compares them today (`machineNameKey`, `identity.ts:139`), because a name becomes file names on disks that ignore case. Each step checks against its predecessor alone, so by induction the rule holds over the whole chain, and machines verify it as the hub does.
  - **Name namespaces** (desk-sminos-orchestrator, from O11 M1; Decision Log 25). A certificate's name starts with its delegation's prefix, and a prefix is never empty. Names and prefixes compare by their lower-cased key, as `machineNames` does. Two rules hold within each state, checkable on the state alone:
    - no name in `machineNames` starts with any delegation's prefix, a revoked delegation's included;
    - no delegation's prefix equals another's or starts with it, a revoked delegation's included.
    - So no certificate's name, live or retired, is ever an enrolled machine's name or another delegation's. Without these rules, a delegation's key could mint a certificate under an enrolled machine's name, retire it at once with a future `notAfter`, and sign events as that machine until then, because the conflict rules see live claims only.
  - Within one delegation, a live certificate whose name another live certificate claims under a different ref is refused. A retired certificate's name passes to a recreated VM under the same delegation (§5.2).
  - Inside its own prefix, a delegation's key can still write as a sibling or as a retired VM. That is its trust domain: every VM under it holds the key, and the remedy is revoking the delegation, which takes all of its history (§5.3).
  - **A prefix and a delegation id are each used once in the life of the org** (desk-sminos-orchestrator, from O11 M1's review; Decision Log 26). An expired delegation stays in the state, and a revoked one's `revoked` entry names its id and prefix, so both stay reserved. A freed prefix would reopen revoked history: a newer delegation could certify an old VM's public key under its old name, needing no private key, and that VM's events would verify again, since only the delegation's key is in `revoked`, never its VMs'. A delegation is renewed by extending its `expires` while it is live; a later delegation takes a new prefix.
  - `retired: {keyId, pub, notAfter, holder}[]` holds retired device and machine keys, and the keys of certificates an admin retires. `holder` names whose key it was: a ref (an enrolled machine's or a certificate's), or a member and device id. The `pub` lets a verifier holding only the head check past events after the holder's current key has changed. An entry is added only in the step where its key stops being current, or where an admin retires the certificate, and its `notAfter` never changes. An entry leaves `retired` only into `revoked`.
  - `revoked: {keyId, holder}[]` holds every revoked key: a device's, a machine's, a delegation's or a certificate's (Decision Log 24). A delegation's holder is `{delegation, prefix}`.
    - It is append-only: a successor keeps every entry its predecessor holds.
    - A device or machine key that the predecessor holds as current and the successor doesn't enters `retired` or `revoked` in that step. A delegation's key leaves the state only into `revoked`. In that step, every `retired` entry whose holder is a ref starting with that delegation's id and `_` moves into `revoked` too, so `revoked` alone says whose signatures are revoked.
    - A key in `revoked` is never current, never retired and never a live certificate's.
    - A key in `retired` is never current again either, nor a live certificate's. So a key that leaves the current set never returns to it. A machine restored from an older state re-enrolls with a new key (§5.3). Without this rule, a machine rotated from K1 to K2 and then back to K1 would sign through K1 as a current key, past K1's `notAfter`. The validator's tests carry that K1 → K2 → K1 sequence (O11 M1).
    - Each of these checks needs only the state and its predecessor, so even a verifier holding only the head never sees a revoked key come back.
  - A revoked key never becomes current again, for example as a re-added device carrying the key it had before: its old events would read as verified again. `revoked` makes that a check on the state (above). Decision Log 23 had placed it in the admin's app and in each verifier's own record of revoked key ids, because the state didn't list revocations. The admin's app (O8, the Org page that edits and signs the org state) still refuses to sign such a state, as every verifier refuses it.
  - A delegation certificate is live while its delegation is live and its key is neither retired nor revoked. Its retirement by its delegation key is a record `{keyId, notAfter}` signed by that key, and the hub serves it beside the certificates (§5.2). A certificate under a revoked delegation isn't live, and none of its events verify.
  - A delegation's `id`, `pub` and `prefix` never change: a new key is a new delegation. Its `expires` changes only while both the old and the new value are later than the successor's `issued`, so no certificate's retirement moves. An expired delegation stays in the state. Dropping a delegation moves its key, and its certificates' retired keys, to `revoked`. That revokes every certificate under it, their history included, and the admin's app says so before it signs.
  - A root transition `{fromVersion, newRootKeys[], issued}` is signed by the recovery key. Machines accept it over any state signed by the old root set.
    - The states it supersedes may hold revocations that `fromVersion` lacks: honest ones, and ones the stolen key made. The first state under the new root is authoritative for `revoked`. On accepting it, a verifier drops any revocation it holds that this state doesn't, including removals it received directly (§5.2), and not before, so the transition alone reopens nothing.
    - The admin's app (O8) holds the superseded states, and offers each of their revocations for the first state under the new root.
  - Grants are checked only by the hosting machine (§5.8).
- **RL6, Session record** (machine-held).
  - `{machine, session, lane, origin: {kind: 'terminal' | 'maws' | 'sminos-spawn', requester?, spawnerSession?}, principal: memberId | 'org' | '@machine', inference: {kind: 'slot', configDir} | {kind: 'route', settingsRef}, project?, owners: (memberId | '@machine')[], ownersProof[], access: 'private' | 'listed' | 'org-view' | 'org-converse', shares[{member, grade}], created, context}`.
  - Owners are copied at spawn and never resolved later through an alias. `@machine` isn't an alias: the endpoint module resolves it against signed org state, and it never leaves the machine (§5.8).
  - The listing projection is `{session, revision, issued, fields: {owners, machine, project, lane, state, title}}`, signed by the machine key. The app shows the machine's name from the org state, so a rename re-issues no listing.
  - **Withdrawing a listing** (p5-desk-track-owner, O10 M3; Decision Log 27). A session that stops being listed, because it becomes `private` or its record is removed, gets one last revision whose `state` is `gone`, signed like any other, with `owners`, `project` and `title` empty.
    - The Registry keeps it, so its high-water mark still refuses a replay of an earlier revision.
    - It leaves gone records out of the listings it serves, except in a feed of changes since a member's cursor, so an app that cached the session drops it.
    - Listing the session again is a new, higher revision.
  - The machine's endpoint record is `{machine, addresses[], issued}`, signed by the machine key. It carries the direct RL2 addresses (§4.1).
- **RL7, Capabilities.**
  - Per session: lane-b-control-map's `ControlCapabilities`.
  - Per device: `{grades granted, clientClass}`.
- **RL8, Log event signature.**
  - The writer is a `device | machine`, signing over the canonical event.
  - A machine's writer prefix is its name (§2.3). A verifier accepts the event only if `machineNames`, or the signer's certificate, binds that name to the signer's ref, and the key id names a key of that ref that is current, or retired at a `notAfter` no earlier than the event's timestamp.
  - A revoked key's events never verify (§5.2).
  - Every v2 event carries its signer's `created` inside the signature, and retirement compares against that, never against the hub's `ts`. That covers a device's `hub/<member>` events.
  - The refusal verdicts include `contested`, naming the refs that claim a name, and `name-retired` (O11 M1).
  - The signature names its signer with a key id, and uses a new domain version (`…-v2`). Today's `mac` is fixed at `{nonce 16 B, value 32 B}`, and nothing names the signer (`log-store.ts:52`, `project.ts:1353, 1428`, `sminos_codes.py:49-50`).
  - The v1 verification path stays for history, or a signed checkpoint freezes it.
  - Signatures are made once and reused on every resend (§5.7).
  - The operator path: a machine-signed `human` event attests its owner's words from the owner's own terminal `sminos say`, outside any session (§5.7).
  - It replaces DX1's HMAC for the merged product.
- **RL9, Attestation of a session's owners** on a say.
  - `{machine, session, owners, ownersProof, origin, orgStateVersion}`, signed by the machine key, inside the log event. `owners` are member ids, with `@machine` resolved at `orgStateVersion` (§5.8).
  - `ownersProof` is a list of device-signed actions: the requester's spawn action, and `manage` add-owner actions. Each names the machine. A proof verifies by RL8's key rule, against the action's signed `created`: its device key is current, or retired at a `notAfter` no earlier than `created`, and never revoked. So replacing a device doesn't strip its member from the sessions it spawned or joined.
- **RL10, Endpoint module ↔ sminos daemon** (local 0600 socket, same uid).
  - Log events go both ways. Upward events are signed by the endpoint module as they leave; downward events are verified before sminos imports them.
  - Lane A RPCs come in, already authorized.
  - The lane A plane goes out.
  - Member state and listing fields go out.
  - `query {opId}` and `not-received` tombstones come down to sminos's ledger.
  - Revocations come down, and sminos applies them to owed deliveries (§5.2).
  - The socket's presence tells sminos to stay local-only (§2.1).

## Decision Log

1. **2026-10-26.** The remote layer is one document, and it holds the one trust model. The composite cites it, and desk-sminos-orchestrator writes the code-facing sections and the children (agreed among remote-architecture, desk-sminos-orchestrator and the MAWS architect, on the owner's direction to this session).
2. **2026-10-26.** The Query stays on the machine. Client-bound tools are capabilities of an attached app, served through MAWS's tool server (§3.1). desk-sminos-orchestrator first proposed moving the Query to the client app, and withdrew that after the critique.
3. **2026-10-26.** Per-member principals are a phase-1 requirement, not an org-phase deferral. The trust boundary moves into a Node endpoint. sminos becomes local-only (§2.1, §5.7).
4. **2026-10-26.** Group keys are out of phase 1. Live streams use pairwise channels (§5.4).
5. **2026-10-26, owner (round 1 through the MAWS architect).**
   - The org is the owner alone for the next months, with the people model built in from the start.
   - Signing is planned (an Apple Developer ID), and the first milestones run unsigned with software device keys.
   - A remote MAWS session's controller is on its machine.
   - The phone loop stays through the Desk Web pause: push notifications plus question and permission cards, and nothing else. It is the `web-cards` client class (§5.1, §5.10, §7.4, §9, §11).
6. **2026-10-26, the MAWS architect's ruling.** One machine daemon contains the endpoint as a narrow module. The engine host stays a separate process under it. This replaces the first draft's separate endpoint process (§2.1).
7. **2026-10-26, owner (round 1, part 2).**
   - Agent messages across owners are today's `sminos say` plus a signed owner label (§5.8).
   - The sidebar shows the member's own sessions first, and others' behind a per-project toggle (§6.2).
   - The lid-closed tail is a later child (§7.3).
   - Recovery is an offline key (§10.2).
8. **2026-10-26, folded from desk-sminos-orchestrator's code review:**
   - the duty split against the sminos code, and RL10;
   - the rule for who may write a person's words (§5.7);
   - owner provenance on spawns, and co-owners in attestations (§5.8, §6.1);
   - migration in place, with re-attestation (§9);
   - the max-age exemption for the local app (§5.2).
9. **2026-10-26, owner (this session's questions).**
   - App first, a web surface where possible, and the app connects directly to its own machine's daemon.
   - Each session has an access level set by its owners, the way a shared document does: `private`, `listed` (the default), `org-view` or `org-converse`.
   - Shares are at view, converse or approve.
   - Spawning on another member's machine needs the machine owners' grant. Machines are owned by members or by the org, with per-machine IAM (§6.2, §6.3).
10. **2026-10-26, folded from desk-sminos-orchestrator's identity inventory:**
   - RL8 gets a key id and a v2 domain;
   - a signature ledger keeps re-uploads byte-identical;
   - unattended machines enroll through admin-signed delegations;
   - machine-attested human words are delivered as words only on the same machine;
   - the log plane is org-readable, and content moves to channels;
   - pushes go only to owners;
   - verification load joins the benchmark (§5.3, §5.7, §6.2, §7, RL5, RL8).
11. **2026-10-26, folded from the adversarial review** (doperpowers:adversarial-reviewer, at debf7c879 plus working-copy changes; twelve findings, all adopted):
   - enrollment bound by a pairing secret the hub never sees;
   - revocations delivered directly and acknowledged, freshness for every grade, a 30-day backstop instead of a 24 h maximum age that the hub couldn't renew;
   - root transition by the recovery key, with a stolen admin key stated as a residual;
   - owners proven by the owners' own device signatures instead of grants;
   - per-machine cutover with no dual trust;
   - `opId` and an outcome ledger against duplicate actions;
   - the session context, mandatory and rechecked at dispatch;
   - phone approvals only on owned sessions, and the WebAuthn checks spelled out;
   - commands graded by effect;
   - machine-signed listings.

   The cutover forces an ordering: `web-cards` ships before the phone's machines cut over (§9; relaxed in entry 13).
12. **2026-10-26, from the MAWS architect's identity research on Anthropic's terms.** The credential follows the principal:
   - every session names its credential slot;
   - on a personal credential, only its principal may `converse` or `approve`;
   - spawning on another member's machine runs under the spawner's own slot or an org credential;
   - MAWS never relays claude.ai tokens (§5.5, §6.3, §6.4, RL6).

   This narrows the owner's share levels (§6.2) to org credentials for driving. The architect is putting that consequence to the owner.
13. **2026-10-26, desk-sminos-orchestrator's re-review against the code.**
   - One op ledger per executing side (sminos's for lane A, re-keyed to `opId`), with no claim in the endpoint module.
   - Revocations acknowledged once durable, and re-checked at delivery.
   - A `sminos spawn` child starts on its parent's credential slot.
   - Outbound dual-coding during migration.
   - `mini-ops` as an operational dependency.
   - The phone ordering relaxed to machines the owner answers from the phone (§4.7, §5.2, §5.8, §9, §12, RL10).
14. **2026-10-26, owner (through the MAWS architect).**
   - Keep the current design. A later phase introduces account-managed inference, where each account manages its inference through a server-side gateway.
   - The principal and inference-route fields are binding now. Enforcement of multi-person driving on personal routes, and per-spawner slots, are **deferred** to that phase (§6.4).
   - No step-up on routine approvals of your own session (§10.5).
15. **2026-10-26, the Query's placement, corrected** (the MAWS architect's code survey at master `c3507722d`, `src/shared/engine/initialize.ts:13`).
   - The lane B Query, the `maws` tool server and the SDK hook callbacks live in the **engine host**, which is today's E10 Session. The machine daemon (the endpoint module plus main's moved services) is the engine host's single client.
   - Revisions before `9575f58c4` put the Query in the daemon. Don't build from them.
   - A daemon restart leaves the Query untouched. Only an engine host restart triggers re-adoption (§2.1, §3.1, §8).
16. **2026-10-26, from the composite's critique** (through the MAWS architect).
   - RL2 also runs over a direct tailnet WebSocket to the endpoint module, which advertises its addresses in a machine-signed record. The app tries direct first, and U2 picks the default (§4.1, RL6).
   - The client-bound tools are `show_pane` and notifications. Capture, export and screenshots move to the machine's render service, and the browser tab's home follows U3 (§3.1).
17. **2026-10-27, desk-sminos-orchestrator's O12 and O11 M4 needs.**
   - RL6's `owners` and `principal` admit the token `@machine`, which the endpoint module resolves against signed org state and which never leaves the machine (§5.8).
   - An org-owned machine's owners resolve to the org's admins, never to `'org'`, so `approve` stays off org-wide. Receivers check terminal-session owners the same way (§5.8).
   - As a principal, `@machine` resolves through the slot binding. A machine with several member owners binds its default slot explicitly (§5.8, §6.4).
   - RL1 gains an `endpoint {record}` frame for the machine-signed endpoint record (domain `smns-endpoint-v1`), stored and served by the hub (O11 M4).
18. **2026-10-27, desk-sminos-orchestrator's O12 buildability review.**
   - RL4 gains `opCreated`, set once with the `opId`, kept across reseals, and covered by the seal and the canonical action.
   - An op older than `OP_HORIZON = KEPT_S − 3600` s is refused `expired`, and `query` answers `expired` for it, so pruning the ledger never reopens an id.
   - An `opCreated` later than `created` by more than the freshness window is malformed. That bounds clock skew, so the hour's margin holds.
   - `query` carries `opCreated` (required), and gains `expired` and `unavailable` (the ledger can't be read; O12 calls it `failed`) (§4.7, RL4).
19. **2026-10-27, the machine ref** (P5 Decision Log 21, through the MAWS architect; the format from desk-sminos-orchestrator's O11 M1).
   - RL5's machine entry gains `ref`: the `MachineRef` the daemon mints at its first run, `[A-Za-z0-9_-]{16,64}` from at least 128 random bits, set at enrollment, immutable, and unique across entries and live certificates.
   - Every contract field named `machine` carries the ref. The name is a display attribute, and a rename re-issues nothing.
   - A key change keeps the ref. It is an admin-signed change of the entry's `pub`, and old signatures verify against the versions that held the old key.
   - The enrollment MAC covers the ref, with length-prefixed fields. A delegation's certificate carries it, and a contested ref is refused, never resolved in either claimant's favour (§2.3, §5.3, RL5, RL6).
   - Rejected: the key's fingerprint. It would change at enrollment and at every rotation.
20. **2026-10-27, log writers stay name-based** (desk-sminos-orchestrator, O11 M1).
   - Decision Log 19's "every field named `machine`" covers the contracts' identity fields, not RL8's writer prefix. Writers stay `<name>/…`, which keeps DX2's log-plane vocabulary and the Project DO's writer rule.
   - RL5 gains an append-only `machineNames: {name, ref}[]`. A name is held under one ref for the life of the org, so the writer prefix maps to one ref over the whole chain, checkable by induction from each predecessor.
   - Without it, a renamed machine, plus a new machine taking its old name, would let one machine write as the other.
   - Costs: a used name never passes to another machine, and a rename splits the machine's log history.
   - Rejected: ref-keyed writers, which drop the guard but fork the log plane's writer rule during the migration.
21. **2026-10-27, retirement is not revocation** (desk-sminos-orchestrator's question about Decision Log 20's "live certificate"; the MAWS architect's note on reusing names).
   - Revocation is for a key that may be compromised, and it is retroactive. Retirement is for a key that leaves honestly, and it records `{keyId, notAfter}`; events stamped at or before `notAfter` verify for good (§5.2).
   - A delegation certificate's retirement can be signed by its delegation key, so `devcloud vm delete` retires its VM unattended. A retired certificate no longer contests its name, so a recreated VM can reuse it.
   - The anchor is the signer's own timestamp, trusted because a retired key is destroyed or was never at risk. Rejected: a log position as the anchor, which would need a high-water mark per writer (each session is its own writer) taken from the untrusted hub. Rejected: trusting the hub's verdict stored at ingest.
   - Freeing an enrolled machine's name is still deferred (P5 Decision Log 23).
22. **2026-10-27, desk-sminos-orchestrator's O11 M1 refinements of Decision Log 21, adopted.**
   - A retired entry is `{keyId, pub, notAfter, holder}`, so a verifier holding only the head can check past events.
   - Dropping a retired key revokes it. An entry is added only in the step where its key stops being current, so a dropped key can't come back, and that is checkable against the predecessor alone. `notAfter` never moves.
   - Every v2 event signs its `created`, and retirement compares against it, never against the hub's `ts`.
   - A delegation's expiry retires its certificates at `expires`.
   - The enrollment MAC is HMAC-SHA-256 under `smns-enroll-mac-v1`, with u32 big-endian lengths and `k` of at least 16 bytes.
   - Verdicts include `contested` and `name-retired` (§5.2, §5.3, RL5, RL8).
23. **2026-10-27, a revoked key never becomes current again** (desk-sminos-orchestrator's residue on Decision Log 22). A check against the predecessor alone can't see a revoked key come back as a current one. So the admin's app (O8, the org interface; corrected from O7), which holds the whole chain, refuses to sign such a state, and the hub and any machine that saw the revocation refuse it from their own record (RL5).
24. **2026-10-27, revocations live in the signed state** (desk-sminos-orchestrator's proposal, from a P1 that O11 M1's review reproduced; generalized here).
   - The P1: an admin-signed certificate revocation or retirement, verified against the current state's admins, loses its signer once that admin is demoted, removed or rotated, and the revoked certificate gets its authority back. Records carry no time and the state no role history.
   - Every admin retirement and revocation is a state change. RL5 gains an append-only `revoked: {keyId, holder}[]` for every key class. An admin-retired certificate enters `retired`. A device or machine key that leaves the state enters `retired` or `revoked` in that step, a delegation's key enters `revoked`, and a key leaves `retired` only into `revoked` (Decision Log 22 had dropping it revoke the key).
   - Each check needs only a state and its predecessor. That replaces Decision Log 23's per-verifier record of revoked key ids, and readers holding only the head can tell a revoked key from an unknown one.
   - Across a root transition, the new chain's `revoked` is authoritative, and the admin's app offers each revocation of the superseded states for the new chain, since the stolen key may have made some.
   - The delegation key's retirement of its own certificates stays a record, so `devcloud vm delete` stays unattended. Its signer can't lapse: a delegation's `id`, `pub` and `prefix` never change, its `expires` moves only while both values lie ahead, and an expired delegation stays in the state.
   - The same lapse reached grants and `ownersProof`. A grant is verified once, by its hosting machine as it arrives, and stays in force until a higher version replaces it or its signer is revoked. A proof verifies by RL8's key rule against its action's `created` (§6.3, RL9).
   - A grant names the machine key it was signed for. A daemon that loses its state loses its key and its grant ledger together, keeps its ref (P5 O6), and re-enrolls with a new key. It then refuses every grant from before, so an untrusted hub can't replay a superseded grant (the adversarial review on #199).
   - A key in `retired` never becomes current again, as one in `revoked` can't. Otherwise a rotation from K1 to K2 and back to K1 would restore K1's authority past its `notAfter` (the same review).
   - Cost: revoking a VM takes a state signature, as revoking a device does.
   - Rejected: verifying at ingest and keeping the set (O11 M1's executor). A machine enrolled later has no set, and would accept a compromised VM's events. Rejected: `revokedCerts` for certificates alone, the proposal as first made. It leaves Decision Log 23's check stateful, and a certificate dropped from `retired` would look live again.
25. **2026-10-27, certificate names live in their delegation's namespace** (desk-sminos-orchestrator, from a forgery O11 M1 found).
   - The forgery: a delegation's key mints a certificate under an enrolled machine's name, retires it at once with a future `notAfter`, and signs events as that machine until then. The name conflict rules see live claims only, which Decision Log 21 chose so that a retired certificate frees its name.
   - RL5 adds two rules, each checked on the state alone: no `machineNames` name starts with a delegation's prefix, and no two delegations' prefixes match or nest. A prefix is never empty. A certificate's name then never meets an enrolled machine's name or another delegation's.
   - The same trick on refs is closed the same way: a certificate's ref starts with its delegation's id and `_`, so no certificate of another delegation can claim it, checked on the certificate alone. A rule refusing refs that two delegations claim would have depended on the hub serving both certificates (desk-sminos-orchestrator). A VM's ref is minted with its state and can't change delegation, so a VM outlives its delegation only through an extended `expires`.
   - Names and prefixes compare by their lower-cased key, as the hub compares names today, since a name becomes file names on disks that ignore case.
   - Inside one delegation, the key can still write as a sibling or as a retired VM. That is its trust domain, as minting further VMs already is, and revoking the delegation takes all of its history.
   - An expired delegation's prefix stays reserved. A revoked delegation's prefix may be reused.
   - Rejected: putting certificate names into `machineNames` at admission, which needs a state change per VM and ends the unattended mint. Rejected: stamping `machineNames` pairs with their state's `issued`, which compares against a time the forger signs.
26. **2026-10-27, a delegation's prefix and id are used once** (desk-sminos-orchestrator, from O11 M1's medium review; reverses Decision Log 25's freed prefix).
   - The gap: once a revoked delegation's prefix was freed, a newer delegation could certify an old VM's public key under its old name, with no private key, and the VM's revoked history verified again. Only the delegation's key was in `revoked`, never its VMs'. And an admin-retired certificate key kept verifying its history after its delegation was revoked.
   - A revoked delegation's `revoked` entry names `{delegation, prefix}`. The namespace rules count revoked prefixes as well as live and expired ones, so every prefix and id is used once in the life of the org.
   - In the step that drops a delegation, every `retired` entry whose holder ref starts with its id and `_` moves into `revoked`, checked against the predecessor. Rejected: a derived rule that such keys count as revoked. With the explicit move, `revoked` stays the one place that says a signature is revoked.
   - An enrolled machine's ref never starts with `<id>_` for a delegation id the state holds, live or revoked.
   - Cost: a devcloud prefix that was revoked can't come back, so the next delegation takes a new prefix.
27. **2026-10-27, withdrawing a listing** (p5-desk-track-owner, from building O10 M3).
   - RL1 had no way to withdraw a listing. The Registry keeps each one at its highest revision, so a session that left the listing or went `private` stayed visible with its title and owners.
   - RL6's `state` gains `gone`: a last signed revision with `owners`, `project` and `title` empty. The Registry keeps it for its high-water mark, and serves it only in change feeds.
   - Its owners are emptied too, so from then on a `private` session's owners stay off the hub, as §6.2 has it. Pushes for a private session already take their owners per member over channels (§7.4).
28. **2026-10-27, a software root, and the recovery key at org setup** (p5-desk-track-owner, from O13, which roots production before O8).
   - Production holds no signed state, and the phone's device entry (O13) needs one before the app's Org page (O8) exists. O13 roots it with a command on the owner's Mac that has a software device of its own.
   - A software root is admitted. Every root key is a software key until signed builds, the app's own device's included, so an Enclave-held first root would leave the org unrooted until C12.
   - What bounds a software root is how many copies of its key exist, and what can make it sign. So admin key files stay out of every backup and sync scope, and a stand-in signs only on a confirmation from the terminal.
   - The exclusion holds from a key file's creation. The app's key file is created today without it, so a device whose file may have been copied first is re-registered with new keys before it becomes a root.
   - A stand-in ends once the app's device is a root, and its keys go into `revoked`. Its end is the app's arrival, not the Enclave, which the app's device reaches only with signed builds.
   - `recoveryPub` never changes after genesis, so how setup handles the recovery key holds for the org's life. Setup writes it only where the owner keeps it offline, and reads it back and checks it before the genesis is signed.
   - Device pairing compares a fingerprint of the new device's whole entry on both screens, since the pairing code may travel by a clipboard that every process of the uid can read. It covers what the MAC covers, every credential included, so a leaked code can't swap one key while another still matches.
   - The backstop needs a signer while the stand-in is the only admin device, so the stand-in signs a no-change successor at the owner's hand before the head turns 30 days old.
   - Rejected: retiring the stand-in's keys. It signs no log events, so retirement keeps nothing that revocation loses, and it needs the key destroyed, which a file kept for weeks can't show.
   - Rejected: requiring an Enclave-held first root, which no build can make before signed builds.
29. **2026-10-28, a re-enrollment in place ends the machine's DX2 at its redemption** (p5-desk-track-owner, from the adversarial review of O14 M6).
   - The hub keeps one credential per machine name, and redeeming a re-enrollment code ends the old one at once, as it does today. From the redemption until the machine is listed and sminos is welcomed, the machine is on neither DX2 nor RL, and the phone's loop for it pauses.
   - The owner approved the pause, bounded (O14's Q3): a 30-minute window the owner names, with no session waiting and nothing owed, a card test within 10 minutes of the cutover, and an undo back to DX2 within 60 minutes of the redemption. Nothing is lost in it: owed deliveries wait, and after the cutover the phone reaches the machine's questions through `web-cards`.
   - The trust model is the same either way. Accepting one trust model is the machine's rule, enforced at sminos's welcome (O12 M5), and the hub is trusted with availability only.
   - Rejected: keeping the DX2 credential until the endpoint's first RL1 claim (O14 M6 as first written). Its review found that doing it safely needs a migration state for the credential with its own deadline, deletion by token id, and a cutover bound atomically to an accepted claim from the new credential. That is a state machine in a security-sensitive credential lifecycle, to save a few minutes once per machine inside a window the owner already approved.
