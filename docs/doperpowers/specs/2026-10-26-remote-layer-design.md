# The remote layer of the merged MAWS: machines, sessions, connection and trust (2026-10-26)

**Status.** This is a design draft for review, not approved for building.
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
- **Endpoint.** The machine's network-facing service: its only connection to the hub, its key, its trust boundary and its policy (§2).
- **MAWS machine daemon.** The headless MAWS service on a machine. It holds the lane B Query and MAWS's machine-side services, and runs the engine host as a separate process (§2).
- **Engine host.** MAWS's E10 supervisor, hardened as the holder. It owns lane B `claude -p` processes through one session host per session (holder design §3.1–§3.2).
- **sminos daemon.** The machine's project-log and delivery daemon. It is local-only in this design.
- **Bridge mod.** sminos's in-process mod in every Claude Code session. It controls in lane A and only observes in lane B.
- **Lane A.** A session started in a terminal, or an engine `--bg` job. The bridge mod controls it.
- **Lane B.** A session opened from MAWS. It is `claude -p` stream-json, held by the engine host and controlled by the MAWS daemon's Query.
- **Owners.** The members a session acts for. A session has one owner by default and may have several ("A, B and 2 more").
- **Share.** A grant of a session to a member at a grade (§6).
- **Channel.** An end-to-end authenticated, encrypted stream between one device and one endpoint. The hub relays it without being able to read it (§5.4).
- **Plane.** A machine's per-session event stream, with a cursor of `(session, launch epoch, seq)`.
- **Client class.** What kind of client a device is (§5.10). The native Mac app is the only class in phase 1.

## Design

### 1. The shape

```
 member's Mac (MAWS app)                  hub (Cloudflare: Worker + DOs)            machine (one OS account)
 ┌───────────────────────┐   wss          ┌────────────────────────────┐   wss    ┌──────────────────────────────┐
 │ renderer (no keys)    │ ─────────────▶ │ Registry (org state, list) │ ◀─────── │ endpoint (Node)              │
 │ main: device keys     │  sealed frames │ Machine DO (relay, lease)  │  sealed  │  key · policy · ACL · uplink │
 │  (Secure Enclave)     │ ◀───────────── │ Project DO (log plane)     │ ───────▶ │   │ local sockets (0600)     │
 └───────────────────────┘                └────────────────────────────┘          │   ├─ MAWS machine daemon     │
        │ local socket, same uid (when the app's Mac is itself a machine)          │   │   Query · tool server ·  │
        └──────────────────────────────────────────────────────────────▶ endpoint  │   │   files · git · artifacts│
                                                                                   │   │   └ engine host ─ session│
                                                                                   │   │        hosts ─ claude -p │
                                                                                   │   └─ sminos daemon (log,     │
                                                                                   │       delivery, lane A plane)│
                                                                                   │         └ bridge mod in each │
                                                                                   │           terminal claude    │
                                                                                   └──────────────────────────────┘
```

Three rules carry the design:
1. **The machine is the authority.** It owns the session processes, numbers every session's events, keeps the replay ring, holds the ACL, and decides every action.
2. **The hub is a relay that can read routing metadata and nothing else that matters.** Session content and actions travel inside channels between a member's device and the machine.
3. **The difference between the lanes stays inside the machine.** Both lanes produce the same plane and the same vocabulary, and each publishes a capability list per operation.

### 2. The machine

#### 2.1 Processes and their duties

| Process | Duties | Restarts without ending sessions? |
|---|---|---|
| **Endpoint** (Node, small, rarely changed) | The only outbound connection to the hub. Holds the machine key and the pinned org root. Verifies the signed org state (§5.2). Terminates channels (§5.4). Enforces policy: read-only mode, the permission-mode ceiling, the session ACL and grades, and freshness of discrete actions. Relays plane subscriptions to their subscribers, each sealed for that subscriber. Signs the log events this machine writes. | Yes. Channels drop and resume by cursor. |
| **MAWS machine daemon** (Node, headless) | The lane B Query for each session (holder design §3.3). MAWS's in-process MCP tool server and hook callbacks. The machine-side services now in Electron main: session index and read model, launch/fork/acquire, git and scm, files, library index, artifacts and Yjs, settings (research §3.2). It produces lane B's plane. | Yes. The Query re-adopts each session (holder design §3.3). |
| **Engine host** (Node, the hardened E10 supervisor) and its **session hosts** (small static binaries, one per session) | Lane B process ownership: the output seq ring, the stdin offset, the writer fence, roster re-adoption, and the 24-hour reaping fence (holder design §3.1–§3.2). It is a separate process under the daemon. A daemon restart doesn't end its children, which is the lesson from Desktop's helper replacement. | The manager can restart; a session host's death ends its session. |
| **sminos daemon** (Python, stdlib) | The project log, and delivery into sessions: human words through the bridge, peer messages through the engine's inbox socket. The lane A plane, built from bridge rows. Reached only over local 0600 sockets. It no longer holds the uplink, signs nothing, and does no AEAD. | Yes. |
| **Bridge mod** (in every Claude Code process) | Lane A: the controller (mod-control-surface; desk control-surface spec MW1–MW5). Lane B: observer only. It supplies subagent deltas and the `turn.step` reaping gate, and refuses control when MAWS's spawn marker is set. | It is part of the session. |

The endpoint and the MAWS daemon are two processes, not one. The endpoint's job is small and security-critical, and it holds every channel. The daemon is large and changes weekly. Separating them means a MAWS update doesn't drop every channel, and the code that holds keys and enforces policy stays small enough to review. This is the same split as the holder's host and manager. The cost is one local hop. The research measured the bridge hop at milliseconds (`bridge-perf-bench.md`); the endpoint–daemon hop should be measured too (§12).

#### 2.2 Install and versions

- The endpoint and the MAWS machine daemon ship as one headless Node package, versioned apart from the Electron app. They install as launchd agents on macOS and user systemd units on Linux.
- They run on machines with no MAWS app: the Mac mini, devcloud Linux hosts and seats. On Linux the engine host's session hosts run in a user transient scope, with lingering on (holder design §3.1).
- On a Mac that is also a member's device, the app uses the local endpoint over a same-uid socket and never starts its own copy of the services.
- Every hello carries `{protocol, build}`, and features are negotiated through capability lists (§3.3, §5.10), never through matching build ids.
- **A machine that is not upgraded fails visibly.** One still running desk's phase-1 sminos uplink (DX2 SSE+POST with the shared org key) is shown as *needs upgrade*.
  - It accepts no RPC from the merged app.
  - Its log events are displayed as *unverified (legacy)*.
  - It never fails silently (§9).

#### 2.3 The machine's identity

- **The machine key.** At enrollment the endpoint generates a P-256 key pair. On macOS the key is kept in the Secure Enclave only when the endpoint runs as a signed helper that may use it. Otherwise, and always on Linux, it is a 0600 file in the endpoint's 0700 state directory. This is acceptable because the machine key protects nothing that code running as that OS account couldn't already do: that account runs the sessions.
- **The machine owner** is recorded in the signed org state (§5.2) when the machine enrolls, as the member whose device approved the enrollment.

### 3. Sessions: the two lanes

#### 3.1 Lane B is the first-class lane

- **The chain.**
  - Output: `claude -p --input-format stream-json --output-format stream-json` → session host (seq ring, stdin offset, writer fence) → the MAWS daemon's Query (output checkpoint before every input, durable request ledger) → X1 events on lane B's plane → endpoint → each subscriber's channel.
  - Actions go the other way: channel → endpoint (verify, authorize) → daemon → Query → host → stdin.
- **What it must do.** All of holder design §3.1–§3.3 and §5 is binding here. Two points in particular:
  - a Query restart is not a process restart;
  - pending permission and dialog requests are delivered again on re-initialize and de-duplicated by request id.
- **The Query stays on the machine,** not in the client app. Claude Desktop's SSH mode keeps the Query in the client, which suits one user with one client. It does not suit MAWS, for three reasons:
  1. MAWS's in-process MCP tools and SDK hook callbacks live with the Query, and they must act on the session's machine: its files, git and artifacts.
  2. A client that sleeps would stall every hook callback and tool call of a running session.
  3. Two clients (two of the owner's Macs, or a collaborator) would need the single writer handed between apps. A session's capabilities would then depend on which app happened to hold it.
- **Tools bound to the client app.** These are the agent-driven in-app browser tab, its screenshots, and the app's notifications. They are served from whichever app is attached, through MAWS's own tool server on the machine:
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
   - The app connects directly to the Machine DO of each machine it is using, so a session frame crosses one hub object, not two (research §3.3).
   - Spike 3 still has to measure this topology.
2. **Every frame stays under 1 MiB at the hub.** Channel frames carry at most 256 KiB of plaintext. Larger payloads are split by the protocol, and snapshots are paged.
3. **Cursors.** Each subscription carries `(session, launch epoch, seq)`. A resubscription is answered with `replay | snapshot | missing`. A different epoch means a snapshot. Replay comes from the producer's ring, which is lane B's session host and Query, or lane A's sminos plane. Overflow becomes a snapshot of state, never a token log.
4. **Each viewer is independent.** Every viewer has its own cursor and flow control. A slow viewer is moved to a snapshot. Control traffic never queues behind a token flood.
5. **Liveness.** Both directions ping the application layer on every hop every 5–7 s, skipped while traffic flows. Two misses make the verdict. The app probes at once on wake, on network change and on focus. "Machine offline" and "hub unreachable" are shown separately.
   - The machine's hub lease, renewed by `hb-ack` and fenced by connection generation, stays as desk built it.
6. **Retry.** Retries continue through the whole resume window, with jitter, and re-resolve the endpoint each time. A human action resets the backoff. Only an explicit verdict from the machine is a permanent failure.
7. **Discrete actions are time-bound even inside a channel.** Spawn, send, steer, interrupt, answer, approve and the rest are refused past a 60 s window (the machine's clock against the action's `created`). The channel prevents replay and reordering, but the hub can still hold a frame.
   - An action whose request is still pending is resealed by the app: new nonce and `created`, the same arguments and request digest.
   - Anything else past its window shows as *not sent, send again*.
   - The machine keeps its nonce ledger at least as long as the acceptance window.
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
  - It pins the root at enrollment.
  - It accepts only a higher version that links to the one it holds.
  - It refuses a list older than the one it holds.
  - For execution-grade actions it requires a state no older than a maximum age (default 24 h), refreshed by the hub on every change and daily.
- **The residual.** Revocation reaches a machine only as fast as the hub delivers the new state. Withholding it can delay a removal, but only up to that maximum age for execution-grade actions.
- **Who writes it.**
  - Admin changes are signed by an admin device: adding or removing a member, changing a role, removing a device, and adding a machine.
  - A member adding their own new device needs a signature from one of that member's existing devices, and then an admin's countersignature. The admin's own devices need only an existing admin device.
  - Under a one-person org, that is one press on the owner's other Mac.

#### 5.3 Enrollment

- **A machine.** The app of the member enrolling it makes a one-time code. The code carries the hub URL, a one-time redemption token and the org root's public key. It carries no secret org key; desk's code carried the org key (DX7).
  1. `sminos hub enroll`, or its successor in the endpoint, reads the code from a hidden prompt or stdin, never from an argument.
  2. It generates the machine key and redeems the token for the machine's Access service token.
  3. It sends its public key. The member's device then signs the machine into the org state with that member as its owner.
  4. Until that state version arrives, the machine is *pending* and executes nothing.
- **A device.** A new MAWS install generates its keys in the Enclave and shows a short code. The member approves it from an existing device, and an admin countersigns when needed (§5.2). The org's first device, at org setup, signs the first state with itself as root.

#### 5.4 Channels

- **What a channel is.** A channel is a mutually authenticated session between one device and one endpoint, relayed by the hub without being readable there.
- **The handshake.**
  - Ephemeral P-256 ECDH on both sides.
  - Each side signs the transcript with its long-term key: the device's channel key and the machine key.
  - The transcript includes the org-state version each side holds, the device id, the machine name and the client class.
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

**Grades**, from lowest to highest. Each includes the ones below it, except where noted.

| Grade | Allows | Default holder |
|---|---|---|
| `list` | See the session in listings (§6.2) | Per owner decision §10.1 |
| `view` | Subscribe to the session's plane: transcript, subagents, diff | Owners; shares at view or above |
| `converse` | Send, steer, interrupt, answer a question, side question | Owners; shares at converse or above |
| `approve` | Answer permission requests and dialogs that execute | Owners; shares at approve (if §10.1 allows that grade) |
| `manage` | Change owners and shares, end the session, compact, rewind | Owners |
| `spawn` (per machine, not per session) | Start a session on this machine | Machine owner; members it has granted (§6.3) |
| `machine-admin` (per machine) | Read-only mode, ceilings, grants | Machine owner |

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
- **Rejected alternative:** having sminos verify through `/usr/bin/openssl`. That can verify signatures but can't carry an AEAD channel, so there would be two trust implementations.
- **Phase 1 residual:** log contents stay readable by the hub, because the hub routes on `to` and `kind`. Encrypting log bodies needs group keys and is deferred (§7.3).

#### 5.8 Agents acting for their owners

- **What an agent message carries.** When a session `sminos say`s across owners, the hosting machine signs an attestation into the event: `{machine, session, owners, origin}`. A receiving machine accepts the attestation only if:
  - each claimed owner is entitled on the sending machine, being that machine's owner or holding `spawn` there;
  - the sending machine is in the current org state.
- **The limit that leaves.** A compromised machine can still lie about which of its entitled members owns a session. It cannot claim members who have no standing on it.
- **Delivery at the recipient machine** follows the recipient's policy (owner decision §10.3; recommended: deliver as a peer request).
  - The message reaches the session as a cross-session message from another agent, marked with the sender's owners, never as the owner's words.
  - It confers no grade. An agent can't approve, share or spawn on behalf of the person whose agent it messaged.
  - Human words always come through the bridge, and peer messages through the inbox (sminos today), so the two can't be confused.
- **Default owners** by how a session started (desk-sminos-orchestrator's sminos-side rule):
  - a terminal session: its machine's owner;
  - a session MAWS spawned: the signed requester;
  - a session spawned with `sminos spawn`: the spawning session's owners.

#### 5.9 What the hub can and can't do

It can:
- see routing metadata: org, member ids, machine names, project ids, session ids, sizes, timing;
- see the listing fields §6.2 allows, and the log plane's contents (§5.7);
- delay or drop frames, or deny service;
- delay revocation up to the maximum age (§5.2).

It can't:
- read or alter channel contents (transcripts, diffs, actions);
- forge an action, a log event or an org-state version;
- replay an action;
- make a person approve something other than what the machine holds.

The hub's deployer has the same limits, as long as the app comes from MAWS's signed release channel (§11).

#### 5.10 Client classes

- **The class is part of the identity.** It is in the device's org-state entry and in the channel handshake. The endpoint grants per class.
- **Phase 1 has two classes:**
  - **`native-mac`** is the MAWS app, with every grade.
  - **`web-cards`** is the phone. The owner kept the phone loop through the Desk Web pause (2026-10-26): desk-web's push notifications, and its question and permission cards, and nothing else. Its grades are:
    - `list`;
    - the pending request cards of sessions the member may approve, sealed through a channel like any other subscription;
    - answering a question;
    - approving or denying a pending permission request.

    Every answer and approval from this class carries a WebAuthn assertion whose challenge is the action's digest (RL4), verified against the passkey listed for that device. This class's code is served by the hub, so its key can be used without being extracted. The assertion makes such use need the person's biometric gesture at that moment. It proves presence, not intent, since the browser's prompt doesn't show the digest. Accepted residual: a hostile deploy could get a pending request on the member's own sessions approved during a gesture the person made for another card. It can't send, spawn, share or manage.
- **A later web port of MAWS** is class `web`. It gets `list`, `view` and `converse`. Its `approve`, `manage`, `spawn` and admin actions need confirmation on a native device, or `web-cards`' per-action assertion for approvals.

#### 5.11 The local boundary

- **Inside one OS account, the trust boundary is the uid**, as now. The endpoint–daemon, endpoint–sminos and bridge sockets live in 0700 directories as 0600 sockets, owner-checked, with symlinks refused (sminos already does this: `sminos_bridge.py:1434-1443`). Authentication comes before any output (holder design §6).
- **An app on its own machine** talks to the local endpoint over a same-uid socket with the device's identity. The endpoint applies the same grades. In practice that member is the machine's owner.

### 6. Ownership, sharing and visibility (enforcement side)

Owner decisions are pending for three choices in this section (asked 2026-10-26; §10.1). The mechanism below supports every option they offered, and the recommended defaults are marked.

#### 6.1 Owners

- **Default owners** follow §5.8.
- **More owners.** Adding an owner ("owned by many") is a `manage` action by an existing owner. The machine records it in the session record and attests it from then on.
- **Removal.** An owner can remove themselves. Removing another owner takes `manage` plus step-up. A session always keeps at least one owner.

#### 6.2 Visibility

- **Recommended:** every member sees the listing; contents are locked. The listing fields are owners, machine, project, lane, state and title. The machine publishes them to the hub, which serves them to org members. Transcripts and actions need `view` or higher.
- **If the owner chooses "own and shared only"**, two changes follow:
  - Listings are sealed per member: the machine publishes per-member listing frames over channels, not one hub-readable listing.
  - The hub can no longer serve listings while the machine sleeps.

#### 6.3 Machine grants

- **Recommended:** members other than the machine owner spawn only with the machine owner's grant.
- **Who signs a grant.** The machine owner's device signs the grant `{machine, member, rights: ['spawn'], version}`, and the machine verifies it against the org state. The admin's signature isn't needed, so the machine owner decides about their own machine.
- **A grant is a delegation.** A session spawned under it runs as the machine's OS account and under its Claude login. Its owner is the member who spawned it.
- **Alternatives:**
  - "Org resource" makes `spawn` a role-wide right in the org state.
  - "Never" removes grants entirely.

#### 6.4 Credentials

- **One login per machine.** A machine's sessions use that machine's Claude login, and possibly its gateway. Spawning on a granted machine spends the machine owner's subscription. The app says so at spawn.
- **Per-member credentials on a shared machine** are out of scope. If needed, they would be a separate machine (a separate OS account) per member.

### 7. The hub

#### 7.1 Objects

- **Registry, one per org.** It holds the org-state chain, members' Access identities (email → member id), enrollment state, and listings (§6.2). Member management is new: today the only member is the bootstrap admin (registry.ts:971).
- **Machine DO, one per machine.** It terminates the endpoint's WebSocket and holds its lease. It relays channel frames between the endpoint and each attached app's socket, without decrypting them, and keeps presence and pending-request *counts* for badges.
- **Project DO, one per project.** The log plane: storage, fan-out and signed-event checks (as courtesy).
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
- **The phone (`web-cards`)** keeps desk's Web Push. The hub sends a notification that says only that a session is waiting ("`maws-45` asks something"). That needs the hub to know a session has a pending request, which is metadata it already sees (§5.9). The card's contents come over the phone's channel.
- **APNs for the Mac app** needs the signed app (§11). Until then, a Mac app that isn't running gets nothing.

### 8. Failure and recovery

| Event | What survives | Recovery |
|---|---|---|
| Hub deploy or DO eviction | Everything on machines | Sockets reconnect. Channels re-handshake. Subscriptions resume by cursor (replay, or snapshot if the ring overflowed). |
| Endpoint restart | Sessions, the Query, sminos | Channels drop. Apps reconnect, resume by cursor and reseal pending actions. |
| MAWS daemon restart | Lane B processes and their CLI work | Query re-adoption: checkpoint, `stdinApplied` rebase, pending requests redelivered. In-flight MAWS tool calls are answered "outcome unknown" from the ledger (holder design §3.3). |
| Session host dies | — | The session ends and is shown as ended, with resume offered. |
| App sleeps or quits | Everything on the machine | Pending requests wait. Client-bound tools answer "no app attached". On wake, resume by cursor. |
| Machine sleeps | — | Shown as machine offline. Listings stay (if hub-readable). Contents unavailable until the lid-closed tail (§7.3). |
| Device lost | — | An admin removes the device, or the member removes it from another device. Machines refuse it once the new state arrives (within the maximum age for execution grade). |
| Machine compromised | — | Remove it from the org state. Its past attestations stay in the log, marked by state version. |
| All admin devices lost | Machines keep working read-only for execution grade after the maximum age | The recovery key signs a new root set (§10.2). Without it, every machine is re-enrolled. |
| Mixed versions | — | §2.2: not-upgraded machines show *needs upgrade*, execute nothing from the merged app, and their events display as unverified. |

### 9. Migration from desk phase 1

1. The merged app sets up the org root on the owner's device. That makes the first signed state, with the existing admin as its member and their existing machines listed as pending.
2. Each machine upgrades to the endpoint and re-enrolls with a new code (§5.3). Its log is kept.
3. The phone's desk-web cards move to the `web-cards` class (§5.10).
   - The phone registers a device: a WebCrypto channel key plus its passkey, approved from the owner's Mac.
   - It answers through RL4 actions over a channel instead of DX6 RPCs coded with the org key.
   - The phone loop must keep working at every step, so the hub serves both paths for a machine until that machine has moved.
4. When the last machine and the phone have moved, the shared org key is retired. The hub deletes the wrapped copies, and the endpoint ignores DX1 codes. Until then, events coded with the old key display as *unverified (legacy)*.

### 10. Open owner decisions, with recommendations

| # | Decision | Recommendation | When the alternative is better |
|---|---|---|---|
| 10.1 | Session visibility, share grades, and spawn rights on another member's machine (asked in this session's chat, 2026-10-26) | Org-wide listing with locked contents. Share grades view / converse / approve. Spawning only with the machine owner's grant. | "Own and shared only" when members must not learn of each other's work at all (§6.2's costs apply). |
| 10.2 | Org root recovery | Admin device keys plus one offline recovery key, made at org setup and kept by the owner. | Accept re-enrolling everything if keeping an offline key is unwanted. |
| 10.3 | Default policy for agent messages across owners | Deliver as a peer request, marked. The recipient can narrow it or turn it off. | Default off for orgs that mix trust levels. |
| 10.4 | Lid-closed viewing | Phase 1 without it. The encrypted tail (§7.3) is the first later child, if lid-closed reading matters. The phone loop is decided: kept as `web-cards` (§5.10). | Pull the tail into phase 1 if the sleeping MacBook stays the main scene. |
| 10.5 | Step-up on routine approvals of your own session | Not required by default. | Required where devices are shared or left unlocked. |

### 11. Dependencies

- **MAWS release signing, notarization and an updater** (C12 P1-R1..R4).
  - Today MAWS is an unsigned or development-signed build from source (`electron-builder.yml`: `identity: null`, `hardenedRuntime: false`). The trust root is therefore merge rights to MAWS master plus the build Mac.
  - The owner will get an Apple Developer ID. The design assumes signed builds. The first milestones run unsigned, with software device keys (§5.1).
  - The org is the owner alone for the next months (owner, 2026-10-26), so shipping to a second member, and with it C12, is not in the first milestones. The people model is built in from the start anyway, so a second member is an org-state edit, not a redesign.
  - Notifications through APNs need signing too.
- **Secure Enclave keys from Electron,** once the build is signed. This needs a small native module in main. A permanent Enclave key in the data-protection keychain needs a keychain-access-group entitlement. Moving a device from `software` to `enclave` keys is a device re-registration: a new device entry, with the old one removed.
- **The headless Node package** for the endpoint and daemon, on macOS and Linux, versioned apart from the app (§2.2).
- **Member management in the hub's Registry:** invite, role, removal, email change. None of it exists today.

### 12. Unknowns to settle by spike or measurement

1. Software device keys in an unsigned build: where main keeps them (a 0600 file, or a keychain item whose access-control list an unsigned app can actually set), and whether LocalAuthentication works there for step-up (§5.1).
2. The `-p` reaping gate: does `turn.step` hold cron-fired and task-notification turns in a `-p` process, and does SIGTERM drain the same way as in the TUI (holder design §9)?
3. Native `rewind_conversation` across `--resume`: duplicated or restored content, as the lane A substitute showed (truncation spike).
4. Hub topology and throughput: app → Machine DO relay of sealed frames, with per-hop latency and the cost per active session (research §8 spike 3).
5. The endpoint–daemon local hop's cost (§2.1).
6. Claude Code's SSH mode in 2.1.311, and the Desktop 3.6556 helper. If either gives MAWS a better process owner or transport without patching the engine, §2.1's engine-host row may change. The notes are in progress.
7. Linux transient scope and lingering under `KillUserProcesses`. macOS TCC attribution for `claude` launched by a launchd daemon (holder design §9).

### 13. Decisions taken here, and alternatives rejected

**Taken:**
- The endpoint and the MAWS daemon are separate processes (§2.1).
- One curve, P-256.
- No group keys in phase 1.
- Pairwise sealing per subscriber.
- The 60 s window on discrete actions is kept inside channels.
- The machine key is a 0600 file where the Enclave isn't available.
- Grants are signed by the machine owner, not the admin.
- Listings are hub-readable under the recommended visibility.
- Access is for admission only.

**Rejected:**
- *The Query in the client app* (§3.1).
- *sminos as the trust boundary with an OpenSSL CLI* (§5.7).
- *Group-keyed live streams* in phase 1 (§5.4).
- *A web terminal* (F5).
- *Moving live terminal sessions* (F7).
- *The engine's remote-tools channel* for client-bound tools, since it is gated to managed cloud workers (§3.1).
- *Keeping desk's shared org key with per-member HMAC subkeys.* The machine could tell writers apart, but the hub that stores the keys' wraps, and any machine holding them, could still forge.

## Interfaces (the contracts the composite lifts)

These are named here with their binding fields. Byte-level schemas and test vectors are written by the child that builds each, against this list.

- **RL1, Endpoint ↔ hub.**
  - One WebSocket.
  - The hello is `{protocol, build, machine, leaseGeneration}`, authenticated by the Access service token.
  - The hub multiplexes channel frames as `{channel, seq, bytes}` opaque to the hub.
  - Lease and `hb`/`hb-ack` as in DX2. Frames are under 1 MiB.
- **RL2, Channel.**
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
  - The fields are `{action, session?, args, requestDigest?, nonce, created, stepUp?}`, sealed inside the channel.
  - `stepUp` is the step-up signature over the canonical action.
  - Refused past 60 s, and refused on a reused nonce.
  - The answer is immediate (`accepted | refused {reason}`). The outcome arrives on the plane.
- **RL5, Signed org state.**
  - The fields are `{org, version, prev, issued, members[{id, email, role, devices[{id, class, channelPub, stepUpPub}]}], machines[{name, pub, owner}], projects[...]}`, with signatures by root keys.
  - Grants are separate records signed by machine owners: `{machine, member, rights, version}`.
- **RL6, Session record** (machine-held).
  - `{machine, session, lane, origin, project?, owners[], shares[{member, grade}], created, context}`.
  - The listing projection is `{owners, machine, project, lane, state, title}`.
- **RL7, Capabilities.**
  - Per session: lane-b-control-map's `ControlCapabilities`.
  - Per device: `{grades granted, clientClass}`.
- **RL8, Log event signature.**
  - The writer is a `device | machine`, signing over the canonical event.
  - It replaces DX1's HMAC for the merged product.
- **RL9, Attestation of a cross-owner say.**
  - `{machine, session, owners, origin, orgStateVersion}`, signed by the machine key, inside the log event.

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
