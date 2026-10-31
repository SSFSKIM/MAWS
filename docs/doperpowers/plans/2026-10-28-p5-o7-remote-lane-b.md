# P5 O7 — Remote lane B at full depth (2026-10-28)

> **Parent:** `docs/doperpowers/plans/2026-10-27-p5-org.md` (P5), child **O7**, §"O7: Remote lane B at full depth". Parent pin: blob `e6f948e1b8fb8b8d0cb663c3d9d0420dcad11b64` at master `33935b949` (P5's Decision Logs 1–162; M1 was planned at blob `e673d56f`, master `629f1d467`, Decision Logs 1–91; re-pinned 2026-10-31 at the re-plan of M2–M7, after O3-E's landing).
>
> **What binds.** O7's section in P5 is this document's design, and P5's approval covers it. Binding with it:
> - P5 §3 (the connection manager: one connection per machine, RL2 over either carrier, direct tried first with a short timeout, the hub relay as fallback; a machine's departure greys only its sessions) and §5 (the remote surfaces); parent acceptance 4, 5 and 8;
> - the remote layer, `docs/doperpowers/specs/2026-10-26-remote-layer-design.md` (blob `437a03eb`), cited *RL §n*: RL2 (the channel), RL3 (subscriptions), RL4 (discrete actions), RL7 (capabilities), with §4 (connection: carriers, cursors, liveness, retry, the action's opId lifecycle) and §5.6 (step-up);
> - P5's contracts OX2 (machine-scoped addresses), OX8 (the app's hub connection), OX9 (namespace grades), and P5 Decision Logs 39 (the tailnet carrier is the default), 45 (O7's first milestone is the app's RL2 link on O6's connection-manager carrier; O7 never owns lane B's ledger; only offered commands cross), 51, 53 (the device keys and step-up are main's; O7's link consumes them), 63 (the endpoint record's `addresses` are `ws://` URLs with the port), 75 and 80 (the log views, which Decision Log 92 then gave to O8's project channel), 77 (`session.events`' `historyUnavailable`), 88 (what O6 left local until O7); and, from the re-plan, 92 (each milestone blocked separately; the log view is O8's), 98 and 101 (a remote pane over a `session.get` record once O3-D landed), 108 (the owner's answers A2, A4, A5, A6), 113 (O8 M2's listed rows and the opener registry), 126 (the step-up sheet is O7's re-plan's), 153 (O3-D landed: C1 and C5 delivered, the demand scan wake inherited), and O3's Decision Log 23 (O3-E landed: `git.*`, `scm.*`, `files.*`, `files.upload` in `mawsd` at `WIRE_MINOR` 12).
>
> **Built on.** O6's document `docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md` (blob `f5a91406`) and report `…-p5-o6-report.md`, landed (PR #268): the connection manager and `MachineLink` (`src/main/machines/manager.ts`), the link surface, the socket link and the second-profile stand-in. O10's document `docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md` (blob `4106f186`), M1–M9 landed: the protocol package's channel (`apps/org-protocol/src/channel.ts`), messages (`messages.ts`) and action (`action.ts`); the endpoint (`src/endpoint/`) with its offer table, subscriptions and op ledgers; the device keys and step-up in main (`src/main/device/`). O11, landed: the hub's app socket to a machine's object and the endpoint-record route. O2's document `…-p5-o2-mawsd.md` (its branch `p5-o2` near landing): `mawsd`, the pty host on a socket, the endpoint seam. O14's Interfaces §D: the history-attestation reader contract. Since M1, read at master 33935b949 for the re-plan: O2 landed (PR #296); O10 M10 and M11 landed (the endpoint runs inside `mawsd`); O3 landed whole (`docs/doperpowers/plans/2026-10-28-p5-o3-spine.md`, its "Contract requests answered" answering §H's C1 to C10; O3-D PR #372 and O3-E PR #390: the spine in `mawsd` under `src/services/`, the front on `machine.sock` with the shared stream catch-up `src/shared/host/stream-catchup.ts`, the services' ledger `machine.op`, `files.upload`, `files.readResolved`); O8 M1 to M3 and M5 landed (the production `OrgSession`, the listed rows and the opener registry, the app as the org's signer); O9 M9 landed (remote lane A over this link, `src/main/lane-a/remote.ts`, the shape M2 mirrors).
>
> **What this file holds.** The execution only. M1 landed (PR #285). M2, M3, M4 and M6 were re-planned on 2026-10-31 to be built, each by an executor with nothing but this document and the code, each by its own PR; M5 stays advisory until O4 and O5 land, with what it needs from each named; M7 closes with the acceptance run and the remote bench. Residue decisions are made where they bind, each with the alternative that lost, and listed in the Decision Log for P5's writer.

## Purpose

P5 makes MAWS one app over several machines. O6 gave the app a machine dimension and one connection manager, but its only other machine is a second profile on the same Mac. O10 built the door each machine opens to the outside: the endpoint, which speaks RL2 channels over the tailnet or through the hub. Nothing in the app walks through that door yet.

O7 makes the app use it, and then brings lane B to full depth across it. Lane B is a session opened from MAWS, running under the session's machine's daemon with the whole SDK surface. After O7:

- **The app holds one encrypted channel to each machine of its org (M1).** It dials the machine straight over the tailnet when it can, and through the hub when it can't. It survives drops, sleep and a switch between the two paths without losing or doubling an event or an action. Every later surface, O7's and O9's alike, crosses that one link.
- **A MAWS session on the mini or a Linux VM works from the MacBook as if it were local (M2–M7).** Its transcript streams with token deltas. Send, steer, interrupt, approvals and questions all work, and so do images, the diff, files and the editor. The panel's terminal runs in the remote worktree. Artifacts open and edit, and a dev server on the remote machine opens in the in-app browser through a forwarded port.
- **"+ Session" starts a session on another machine,** and two MAWS apps can watch and answer one session at once.

**How to see M1 working.** M1 is a main-process module. Its proof is the endpoint's own harness with the app's link in place of O10's test device. A real endpoint (`src/endpoint/`, with fake services behind it) listens on a loopback stand-in of its tailnet address and is reachable through desk-hub's Worker in Miniflare. Main's link, driven by the profile's real device keys (`src/main/device/keys.ts`) and a test org, comes `up` over the direct carrier, falls back to the relay when the direct address is dead, and switches back when it returns. It calls `session.status`, sends a lane B `session.send` that runs once across a forced drop, and streams a lane B session that resumes from its cursor with no event lost or repeated. The commands are in Concrete Steps. The owner sees nothing change until the app is signed in to an org, which is O8's sign-in (open question A1; landed since as O8 M1).

**How to see M2 working.** Sign the MacBook's app in (Settings › Org), and the mini's sessions appear under their machine chip as listed rows. Click a lane B row: its pane opens with the transcript's history and then streams deltas as the agent works; type and send, and the message appears in the mini's own MAWS within a round trip; approve a permission card here and it settles there. Hover the machine's row: "direct (tailnet)". Turn Wi-Fi off and on: the stream pauses and resumes with nothing lost. In a test, `e2e:remote` does the same against a second profile's `mawsd` on one Mac. M3 adds the terminal and forwarded ports, M4 the diff, files, uploads and "+ Session" on another machine, M6 attention across machines, M7 the numbers.

## Progress

- [x] M1 — The app's RL2 link (`RemoteLink`, O6's `MachineLink` over RL2) — built on branch `p5-o7-m1` (2026-10-28); landed (PR #285, master ccdc14943, P5 Decision Log 99; report `docs/doperpowers/plans/2026-10-28-p5-o7-report.md`)
- [ ] M2 — Lane B's conversation over the link, the step-up sheet and the carrier hover — re-planned 2026-10-31, executable; first
- [ ] M4 — Diff, files, uploads and spawn anywhere — re-planned 2026-10-31, executable; after M2, independent of M3
- [ ] M3 — Remote terminals and port forwarding — re-planned 2026-10-31, executable; after M2, independent of M4
- [ ] M6 — Attention and search across machines — re-planned 2026-10-31, executable; after M2
- [ ] M5 — Artifacts, documents and the client-bound surfaces — advisory; built when O4 and O5 land (what it needs from each is named in its section)
- [ ] M7 — Acceptance and the remote bench — after M2, M3, M4 and M6; the measured group on the mini under CI-opt's hold on the architect's go, the live runs on the owner's go

## Acceptance

The items, each with the milestone that proves it. Item 1 is M1's, as landed. Items 2 to 11 are what the re-plan of 2026-10-31 binds; each is observable from the MacBook's app, signed in to the org, against the mini (a Mac) and the acceptance VM (Linux), both cut over.

1. **The link (M1).** Main holds one RL2 link per machine its signed-in org state lists, and no other code in main or the renderer opens a channel.
   - A link comes `up` over the direct carrier when one of the machine's endpoint-record addresses answers within 1 s, and otherwise over the hub relay. `machines.list` then reports the machine `up` with that carrier.
   - On the relay, a probe or the 60 s recheck finds the direct carrier again and switches to it, with no event lost or repeated on an open subscription.
   - A `call` returns the endpoint's answer.
   - An action runs once across a forced drop on either carrier. It is resealed, or queried, and never doubled, which the fake engine host's own ledger shows. An action that could not be sent within 60 s ends `refused {reason: 'offline'}` and never runs.
   - A subscription resumes from its cursor across a forced drop of either carrier and a carrier switch. Every event's full cursor is checked against the producer's own numbering.
   - A device that a new org state removes sees its link stop with `removed`, and no retries follow until the session changes.
   - Proved by `test/machines/remote-link.test.ts` (direct) and `test/machines/remote-link.local.test.ts` (relay, through desk-hub's Worker in Miniflare), with unit suites under `src/main/machines/remote/`.
2. **Lane B at full depth anywhere** (P5 acceptance 4, but for artifact screenshots and export, which arrive with O5; M2 to M5, measured in M7). From the MacBook, a lane B session on the mini and one on the Linux VM each do all of the following, in the same pane and with the same controls as a local session:
   - stream with token deltas (M2);
   - send, steer and interrupt (M2);
   - approve and deny, and answer a question (M2);
   - take an image (M2);
   - show the diff, and open and edit a file (M4);
   - run a terminal in the worktree (M3);
   - open and edit an artifact (M5).
3. **The remote bench** (P5 acceptance 4's numbers; M7). On each carrier, measured by `e2e:remote-latency` against the same run's local numbers, and live from the MacBook with the clock offset estimated:
   - remote delta-to-paint p50 ≤ local p50 + one round trip + 10 ms;
   - a command's round trip ≤ two round trips + 20 ms;
   - open to first row ≤ 1.5 s;
   - resume ≤ engine start + one round trip.
4. **Spawn anywhere** (P5 acceptance 5; M4). "+ Session" with the mini or the VM chosen in its machine menu starts a lane B session there, after the sheet and Touch ID, which is in the sidebar under that machine within 5 s of the engine's first event and open in the pane.
5. **Two clients** (P5 acceptance 8; M2). MAWS on the mini and on the MacBook attach to one session at once. Both stream it, and an answer from one settles the card in the other within one round trip.
6. **Capabilities light up** (P5's O7 acceptance; M5). O4's and O5's surfaces on a remote session are drawn from its capability lists (RL7) as each lands, never from the lane or the machine.
7. **Migrated history.** Not O7's: the log view P5 Decision Logs 51, 75 and 80 named is O8's project channel (P5 Decision Log 92), which draws O14's attestations by its Interfaces §D. Kept here so the number stays stable.
8. **The step-up sheet** (P5 Decision Log 126; M2). An act that needs step-up shows a sheet on the window with the action's full text, every field one per line, and Continue and Cancel, before Touch ID; Cancel resolves the act `refused {reason: 'step-up-cancelled'}` and never prompts Touch ID; O8's org-state signing shows its words in the same sheet.
9. **Attention across machines** (P5 §8; M6). The dock badge, Needs you and ⌘⇧J count and open every reachable session's pending items on every machine, with or without a tab open; an item answered on either machine leaves the other's count within one round trip; an offline machine's items grey and leave the badge.
10. **The carrier** (P5 Decision Log 108's A2; M2). A remote machine's row hover reads "direct (tailnet)" or "via the hub"; "Hub unreachable" appears once while a machine is reached directly with the hub down; a device the org removed sees that machine's rows greyed with "This Mac is no longer allowed on `<machine>`".
11. **A lost range** (P5 Decision Log 77; M2). A transcript whose remote stream resumed past a lost range, and a local transcript whose `session.events` answered `historyUnavailable`, draw "Earlier history isn't available" where the gap is.

## Execution

### Constraints (bind every milestone)

- **The trust model is RL's, and the link adds no authority.** The machine decides every request (RL §5.5). The link never pre-judges a grade beyond choosing `call` or `act`, never builds a request the endpoint would have to trust, and treats the endpoint's refusals as final. Every RL2, RL3 and RL4 byte is `apps/org-protocol`'s: `connectChannel` and `Channel` for the channel, `readMessage` for the vocabulary, `Action` for actions. The link reimplements none of them (P5's protocol-package rule).
- **One link per machine (P5 Decision Log 45).** RL2 channels in the app are opened only by `src/main/machines/remote/`. Every consumer reaches a machine through `Machines.remote(ref)` (Interfaces §A): O7's later milestones, O9's remote lane A, O8's sharing actions and O5's surfaces. A boundary test enforces it (M1).
- **Main signs only what main built (RL §5.6; P5 Decision Log 53).** Actions are built in main from typed fields. Step-up goes only through `src/main/device/step-up.ts`'s signer, which the org session hands the link. No key, nonce or signed byte reaches the renderer.
- **The link module imports no Electron.** `src/main/machines/remote/**` and `src/main/org/{session,dev-session}.ts` run under vitest's `node` project. Wake, focus and the network watch reach them as injected probes from `src/main/machines/index.ts`. `src/main/device/step-up.ts` imports `electron` at its top, so it is injected and never imported at runtime by these files (a type-only import is fine).
- **How main imports the protocol package.** Main imports `apps/org-protocol` by its relative path with the `.ts` extension, as `src/main/device/keys.ts` does (`'../../../apps/org-protocol/src/index.ts'`), so electron-vite bundles it. Tests may import `org-protocol`. The `from 'org-protocol'` lines in Interfaces name the module, not the import path main writes.
- **The wire.** M1 adds no host command and no event, so it does not bump `WIRE_MINOR` and `wireFingerprint()` does not move. `machines.*` is main-to-renderer traffic, outside the manifest (`src/shared/ipc/wire.ts`'s header). It adds no `IpcError` code, since `IPC_ERROR_CODES` is an enum and an added member is breaking (O1). Later milestones that add host, pty-host or machine commands take P5 Decision Log 44's re-bump rule: `WIRE_MINOR` is contested, and whoever lands second re-bumps to master's minor plus one. Each of those milestones also re-runs `e2e:cross-build` on the merge tree.
- **RL2's vocabulary changes only additively and only behind a capability.** An unknown plaintext kind closes a channel (O10 Interfaces §A). An unknown message kind is ignored. A known kind with an unknown enum value is `malformed` and closes the channel (`readMessage`). So a later milestone that adds a plaintext kind, a message, or an `executor` value bumps `RL2_PROTOCOL.minor`, names a capability, and sends the new form only to a peer whose handshake listed that capability.
- **Settings.** O7 claims no settings version. Version 20 was O2's and 21 is O3-A's (the client file); `machine-settings.json` is at 1. A milestone that needs a setting asks P5's writer first; none of M2 to M7 does.
- **Machines and gates.**
  - Class 1a runs through `cd /tmp && W/scripts/ci-gate.sh W --gates static,unit,probes --class1a pool`.
  - Mac e2e runs with `--runner macos --lane hosted` for the groups in `.github/workflows/gate.yml`'s hosted list.
  - On this MacBook, run one focused vitest file at a time after `pnpm install --frozen-lockfile`. Run no e2e of an engine or connector scene, and nothing that touches the Keychain or raises a TCC or firewall dialog. Tests inject `excludeFromBackup` into `loadDeviceKeys` and a `confirm` into step-up, so neither `tmutil` nor Touch ID runs.
  - Before `ci-gate`, run `npx eslint` on the touched files.
- **Live tests run on staging only.** No step connects a device to the production hub. M1 needs no live hub at all: Miniflare stands in.
- **Hands off.** Never touch the owner's running MAWS, its build output under the main checkout, or its user data. Every profile is a scratch `MAWS_USER_DATA`. Never read `~/.config/claude-secrets`. Never stage `spikes/gws-onboarding/`, `.playwright-cli/`, `node_modules` or `plugin/`. Never edit the charter, P5, the remote layer, the ledgers or `docs/tech-debt-tracker.md`. Debt and residue go to this document's record and the PR body.
- **Commits.** End every commit message with `Sminos-Session: GUI AI agent workspace charter#37052769 (MAWS on macbook)` as a second `-m`, or the line the executor's own session is given. Add no other trailer. Never rebase. Merge origin/master in when a branch needs it.
- **Review.** Each milestone lands by its own PR, with doperpowers:reviewer-high before it goes to the architect. M1 is the device side of the trust boundary: it opens authenticated channels, builds and step-up-signs actions, and decides what is resealed. Later milestones are reviewed at the rung their re-plan names.
- **Added at the re-plan (2026-10-31), binding M2 to M7:**
  - **The offer table is the only door, and each row is tested.** Every name O7 makes reachable from another machine is a row in `src/endpoint/offers.ts` with its kind, executor, target rule and grade source (Interfaces §L), proved by a test under `test/endpoint/` that shows its admission for a caller who holds the grade and its refusal for one who doesn't. A handler O7 adds or changes in `src/endpoint/calls.ts`, `actions.ts`, `queries.ts` or `targets.ts` keeps `authorize.ts`'s decision order (its eight steps) as it is; a new target rule is a new value of `TargetRule` resolved there, not a bypass.
  - **Capabilities gate every RL2 addition.** The device's `h1` lists `DEVICE_CAPABILITIES` (`src/main/machines/remote/capabilities.ts`) and the endpoint's `h2` lists `ENDPOINT_CAPABILITIES` (`src/endpoint/capabilities.ts`), one constant each, which a milestone appends to (§M's table). A side sends a new message kind, a new `executor`, a new optional field another peer would find malformed, or a stream, only to a peer whose handshake listed the capability; otherwise it refuses locally (`not-offered`), since the peer would close the channel. `RL2_PROTOCOL.minor` (`apps/org-protocol/src/channel.ts`) moves to master's minor plus one at each landing that adds a capability; the capability, not the minor, is what a peer checks.
  - **The wire.** `WIRE_MINOR` is 12 at the re-plan (master 33935b949); the next free is 13. M2 and M6 change nothing on the manifest (`remote.*` is main-owned and stays out of it). M3 (`pty.op`, `pty.opQuery`) and M4 (`session.launch`, `files.upload`'s `part`, `SessionRecord.launchedBy`) each bump once, to master's minor plus one at landing (P5 Decision Log 44's re-bump rule), re-reading `src/shared/ipc/wire.ts` at the merge, and run `e2e:cross-build` on the merge tree. No enum gains a member and no `IpcError` code is added.
  - **Reads cross as calls, effects as acts, bytes as streams.** A `list`- or `view`-graded command goes as a `call` on the router's existing path (`dispatchOverLink`); anything graded higher is built into an RL4 act by the adapter from what the person saw; a byte flow (terminal output and input, a forwarded connection, later a document or an artifact page) is a §N stream opened under an act. No milestone admits a call above `view` or sends an effect outside the act path.
  - **Test seams are refused outside `MAWS_E2E=1`**, as the existing e2e seams are: `MAWS_E2E_LANE_B_OWNER` (§Q) and nothing else O7 adds grants or bypasses anything. `MAWS_DEV_ORG`'s `directMap` is honoured only in an unpackaged build, as the file's other fields are.
  - **The e2e group carries no wall-clock bound.** `e2e:remote` proves behaviour; every timed bound lives in the measured group `e2e:remote-latency` (`MEASURED_E2E`, the mini, CI-opt's hold, on the architect's go). `e2e:remote` joins `CLASS1_E2E` at the commit that adds its script and moves `e2e-default-specs.test.mjs`'s pin; it joins `HOSTED_MAC_E2E` only by gate-offload's rule (three of three green hosted runs on one tree), CI-opt's call.
  - **Review rungs.** M2, M3 and M4 at doperpowers:reviewer-high (each builds acts from what the person saw, M2 signs through the sheet, M3 adds message kinds and a ledger, M4 spawns and writes); M6 at medium; M7 at medium (a bench and a record). Each lands by its own PR, after a task review per milestone inside its execution.
  - **Files other planners touch at the same time** (O4, O5, O16, O8 and the desk track; reconciled in the architect's interface ledger): `src/main/index.ts`, `src/main/org/org-session.ts`, `apps/org-protocol/src/messages.ts`, `src/endpoint/{offers,calls,actions,queries,authorize,targets,endpoint,services}.ts`, `src/mawsd/endpoint-seam.ts`, `src/shared/ipc/schema/{session,files,pty,remote}.ts`, `src/shared/ipc/wire.ts`, `src/services/sessions/`, `src/services/files/upload.ts`, `package.json`, `.github/workflows/gate.yml`, and the renderer's `SessionPane`, controls, composer, transcript, sidebar, attention and panel tools. An executor that finds one of these moved under it merges master first and keeps both.

### Orientation

- **The connection manager today** (`src/main/machines/`).
  - `manager.ts` holds one `MachineLink` per machine. The local one is in-process (`local-link.ts`). Each other profile's serve directory, named by `MAWS_LOCAL_MACHINES` in an unpackaged build, gets a socket link (`socket-link.ts`).
  - The router hands every command for another machine to `ConnectionManager.dispatch` (`RouterOptions.remote`). A machine that is not `up` answers `host_unavailable` at once.
  - A link's events reach the windows through `emitFrom(machine, …)`.
  - `machines.list` and `machines.changed` report each machine's `{ref, name, local, state, since, generation}`. `generation` goes up by 1 at every `up`.
  - In the renderer, `connectShell` (`src/renderer/src/ipc/events.ts`) snapshots a machine at each new generation. The snapshot reads `engine.sessions`, `attention.list`, `session.list`, `session.projects.list` and `session.digests`, and a failed read is logged and leaves that store empty (`answer(...)`).
- **The channel, device side** (`apps/org-protocol/src/channel.ts`, O10 Interfaces §A).
  - `connectChannel(dial, me, org, {machine})` runs the SIGMA-I handshake over a fresh `ByteDuplex` per catch-up page and resolves at the endpoint's first sealed message (`caps`). It throws `ChannelError {reason}` on refusal.
  - The resolved `Channel` sends and receives sealed JSON. `part`s and the sealed `close` are handled inside it.
  - `DeviceIdentity` is `{org, member, device, clientClass, channelKey, build, capabilities}`.
  - `OrgView` (`org-view.ts`) is the verifier's head, certificates, `since` and `advance`. `memoryOrgView` holds one in memory.
- **The vocabulary** (`apps/org-protocol/src/messages.ts`, O10 Interfaces §B).
  - The device sends `call {id, name, input}`, `act {action}`, `query {opId, opCreated, executor}`, `sub {sub, session, view?, cursor, credit}`, `credit`, `unsub`, `ping` and `pong`.
  - The endpoint answers with `caps`, `result`, `ack`, `done`, `queried`, `subbed`, `ev`, `snap`, `paused`, `resumed`, `ended`, `ping`, `pong` and `close`.
  - Refusal reasons are `REFUSAL_REASONS`.
  - A `snap` carries a page of a JSON value's *text*: the device joins the `body` strings of pages `0..last` and parses them.
  - An `ev` too large for a message arrives as `{omitted: 'too-large', bytes}` at its cursor.
  - Every `ev` and `snap` costs its message's UTF-8 JSON length against the subscription's credit (`src/endpoint/subscriptions.ts`, `byteLength`). The endpoint caps credit at `SUB_CREDIT_MAX` (4 MiB) and allows `MAX_SUBS` (64) subscriptions per channel.
- **The endpoint's side** (`src/endpoint/`).
  - `offers.ts` is the only list of names that cross. Today it offers lane B's conversation (acts `session.send`, `steer`, `interrupt`, `answer`, `queue.edit`, `queue.promote`, `queue.setPaused`; calls `session.status`, `events`, `pendingRequest`, `pendingItems`, `queue.list`, `catalog`), lane A's `sminos.*`, and `endpoint.grant`, `endpoint.state`, `endpoint.listings`, `daemon.status` and `machine.identity`.
  - Calls are answered `result`.
  - A host error `host_unavailable` or `timeout` comes back as code `unavailable`. Other host error codes pass through (`calls.ts`).
  - A lane A read (`sminos.rows`, `diff`, `output`, `read`) must name the caller's own subscription on that session in `input.sub`.
  - Liveness: each side pings after 5–7 s of silence and closes after two unanswered pings (`channels.ts`, `PING_MS`).
  - On the direct carrier, a device that stops reading loses its socket: the listener's send buffer (`send-buffer.ts`, P5 Decision Log 91) ends the socket past its ceiling or its stall bound, and the link reads that as a transient carrier close. On the relay this holds only up to the hub: the endpoint's hub link is bounded, but the hub's last hop to the app socket has no byte or stall bound (`apps/desk-hub/src/objects/relay.ts`), a gap P5 Decision Log 94 tracks.
  - The direct listener allows 3 handshakes in a burst and 5 a minute per source address, and answers `503 busy` at the upgrade past that (`direct-listener.ts`, `HANDSHAKE_LIMITS`). It listens on port 47830 on tailnet addresses only.
  - Lane B's cursor is `(launchId, seq, idx)`. Lane A's is `(epoch, seq)`, the epoch being the endpoint's upstream subscription, which outlives a dropped channel for 120 s (`interest.ts`, `RESUME_MS`).
- **The hub, for an app** (O11; `apps/desk-hub/src/worker.ts`). Each route takes a member authenticated by Access, or by the local stand-in's header in tests (`credentials(email)` from `apps/desk-hub/test/support/local.ts`).
  - `GET /api/machines/<ref>/endpoint` returns `{record: Signed<EndpointRecord>}`, or 404 `no-endpoint`.
  - `GET /api/machines/<ref>/socket` is a WebSocket carrying the channel multiplex. Its binary messages are `[u8 open 1 | data 2 | close 3][u32 BE channel][payload]`. The app opens a channel with `open [tag][first payload]`. The hub answers `open [id][tag u32]` and numbers the channel. A close carries a u16 reason (`CHANNEL_CLOSE_REASONS`). At most 64 channels share one socket (`apps/org-protocol/src/relay.ts`).
  - `test/endpoint/carriers.ts`'s `RelayDialer` and `dialDirect` are working test versions of both carriers. M1 writes production ones.
- **The endpoint's test harness** (`test/endpoint/sub-harness.ts`): `startEndpoint`, `makeOrg`, `FakeEngineHost` (journal rows, lane B events, `host.op` through `opCommands`), `FakeSminos`, and `openRemote` (a TestDevice over the direct listener at loopback). `test/endpoint/miniflare-hub.ts` provides the hub, and `test/endpoint/channels.local.test.ts` shows an enrolled endpoint's listener on loopback in place of its tailnet address. M1's integration suites reuse these, with main's link in place of `TestDevice`.
- **The device in main** (`src/main/device/`). `loadDeviceKeys(profile, deps)` returns `{channel, stepUp}` signing keys from `<profile>/device/keys.json`. `createStepUp({device, key, confirm})` returns `{sign(request)}`, which builds the action, shows it, and signs it after confirmation. Neither is wired into startup today.
- **What nobody had built at M1.** The app held no org state, hub session or registered device. P5 Decision Log 38 gives the app's sign-in (Access's login transfer) to O8. M1 defined the seam it consumes, `OrgSession` (Interfaces §B), and production held a signed-out session until O8 M1 landed the sign-in (PR #287), which it has: a signed-in app now holds one link per listed machine.
- **What landed between M1 and the re-plan** (read at master 33935b949).
  - *The spine runs in `mawsd`* (O3-D, O3-E; `src/services/`, composed by `src/mawsd/spine-seam.ts`). Every `session.*` record command, attention, the owner channel, drafts, search, `git.*`, `scm.*`, `files.*` and `git.lsFiles` are `machine`-owned on the manifest, served on `machine.sock` by the front (`src/mawsd/front.ts`) and dispatchable by the endpoint through `EndpointServices.dispatch('machine', …)`, which loads the spine on need. The engine host's one client is permanent, so a remote lane B subscription is never `paused {no-app}` with a host started at or after O3-D (C1). A discovery read on a parked host wakes it and answers within 8 s (O3-D's demand scan wake, which M2's `session.get` inherits).
  - *Streams are one module* (`src/shared/host/stream-catchup.ts`): the endpoint's lane B plane (`src/endpoint/plane-b.ts`, `from: 'start'`) and the front's `session.follow` (`src/mawsd/front-streams.ts`, `from: 'now'`) share the rules the link's sink sees: `subbed {replay | snapshot | missing}`, a `snap` of the parts `status, queue, pendingItems, catalog`, then `ev`s, each at `(launchId, seq, idx)`; a relaunch moves the stream to a `snapshot` of the new launch; a lost range is `missing`. `front-streams.ts`'s `eventOf` maps parts to the renderer's events.
  - *The services' ledger* (`src/services/machine-ops.ts`, `<profile>/spine-ops.jsonl`; O3X7): `machine.op` claims any `machine`-owned act (a grade other than `list`, `view`, `client`, `internal`; a by-effect grade counts) and runs it once; `machine.opQuery` answers RL4's states. The endpoint's `actions.ts` already routes an act row whose executor is `machine` there and `queries.ts` routes a `machine` query; no production row names it yet, and org-protocol's `Executor` admits only `sminos | engine-host | endpoint` (M2 adds `machine` behind a capability; M3 `pty-host`).
  - *The engine host's ledger* (`src/engine-host/ops.ts`): `host.op` runs any engine-host command on a session this host handles, so offering `session.setModel` and its kin needs only rows.
  - *Uploads* (O3-E M3): `files.upload {appSessionId, files: [{name, bytes}]}` writes `<working directory>/.claude/desk-uploads/<appSessionId>/<uploadId>.<n>[.<ext>]`, 32 MiB per file and per call, claimed by `machine.op`; no surface calls it yet.
  - *The endpoint's reads*: `calls.ts` dispatches `engine-host` rows raw and, of `machine` rows, only `daemon.status`; `authorize.ts` refuses a call graded above `view` as `act-required`, and a `view`-graded call with no target rule's session as `no-target` (`session.search`, `attention.list`). `targets.ts` resolves an `appSessionId` through the engine host's `session.status`.
  - *The client port* (OX4; `src/mawsd/client-port.ts`): a request goes back to the connection that minted the asking `ClientRef`; the endpoint mints none and passes none, so a remote caller's `pick`, `save`, `reveal` or `notify` answers `noClient` (C7's half for M5).
  - *The pty host under `mawsd`* (O2): `pty-host.sock` serves one app; `mawsd` holds the pty credit when no app is attached and acks every frame; the endpoint's `pty.attach` is forced `credit: false`, its `pty.ack` and `pty.checkpoint` refused, and `onFrame` hands it every `pty.data` frame (the endpoint subscribes to none today). The host's ring is 512 KiB; nothing persists a checkpoint. No `pty.*` row exists and a `pty-host` act is `no-ledger`.
  - *O8's rows and the opener* (M2, PR #295): another machine's sessions are `ListedSession` rows (`src/renderer/src/stores/sessions.ts`, from `org.rows`), their machine the RL2 roster; `connectShell` takes no snapshot of a listed machine; a click calls `remoteOpenerFor(lane)` (`src/renderer/src/sessions/remote-openers.ts`), registered for lane A by O9 M9 (`src/renderer/src/lane-a/remote-connect.ts`), empty for lane B. O8 M1's `createOrgSession` is the production `OrgSession`; its `identity.capabilities` is `[]`.
  - *O9's remote adapter* (M9, PR #348; `src/main/lane-a/remote.ts`, `remote-state.ts`, `remote-outcomes.ts`; `test/lane-a/remote.test.ts`): the shape M2 mirrors: a `remote` wrap of the router (`routeLaneA` in `src/main/index.ts`), subscriptions turned into `emitFrom` events, acts built from typed fields with the session's context, outcomes mapped to the port's results, gaps refused with their reasons.
  - *The renderer today for an RL2 machine*: listed rows only; a lane B row's click selects it; the transcript's `ipcSource` reads `session.events` then `session.appEvents`; the composer sends images inline as base64 blocks (`SendContentSchema`: text 1 MiB, an image 5 MiB, a PDF 32 MiB) and a dropped file with a path as a mention relative to the cwd; `pty.list` is sent with no machine; `git.*` calls pass `{machine}`; transcript and terminal links open in the system browser through `layout.openExternal`; nothing reads `MachineState.carrier` or `refusal`; attention is partitioned per machine but read for none of the RL2 ones; `historyUnavailable` is read only to stop a backfill.
  - *The step-up prompt* (`src/main/device/step-up.ts`): `createStepUp` and `createStateSigner` take a `Confirm` strategy, `promptTouchIDConfirmation` by default, which shows Touch ID the summary only; `src/main/index.ts` passes neither a confirmation.
  - *Tests and scenes*: `e2e:machines` runs a second profile's private `mawsd` over the socket link; nothing drives RL2 in the built app, and `MAWS_DEV_ORG` is used by no test; `e2e/support/local-org.ts` starts a local org (wrangler dev) and enrolls a `mawsd`; `test/endpoint/sub-harness.ts` is a real endpoint over a fake engine host with injectable records; the latency bench (`e2e/local-latency.spec.ts`, `test/support/local-latency.ts`) measures delta-to-frame and round trip against one clock with the stub engine `test/support/latency-engine-stub.mjs`.

### Plan of Work

M1 landed. The re-plan of 2026-10-31 (Decision Log) keeps O7 one child: its milestones share one adapter in main, one e2e scene and one renderer machine dimension, and each later one consumes the one before, so they are milestones of one plan, each landed by its own PR after its own review, rather than children (the split judgement is in the Decision Log). The order is M2, then M4 and M3 in either order (both need M2's pane and nothing of each other; a branch that lands second merges master and re-bumps `WIRE_MINOR` and `RL2_PROTOCOL.minor` to master's plus one, and keeps both sets of offer rows and capabilities), then M6 (needs M2), then M5 once O4 and O5 have landed (advisory until then: its section names what it needs from each), then M7. Every milestone is executable by an engineer with this document and the code; the advisory one says what it needs and adds, not how.

### M1 — The app's RL2 link (`RemoteLink`, O6's `MachineLink` over RL2)

**At its end.**
- Main holds one link per machine that the signed-in org session's head lists, created and closed by the connection manager as the org session changes.
- Each link holds one RL2 channel to its machine. It takes the direct carrier when one of the machine's endpoint-record addresses answers within 1 s, and otherwise the hub relay. It switches back to direct when direct returns, reconnects through drops and sleep, and answers to probes on wake, unlock, focus and network change.
- To the connection manager the link is a `MachineLink`. The machine shows in `machines.list` with its state and carrier, and the router's `list`- and `view`-graded commands for that machine go through it as calls.
- To main's consumers it is a `RemoteLink`, reached through `Machines.remote(ref)`. It offers:
  - `call`;
  - `act`, with RL4's whole opId lifecycle: build, optional step-up, ack, done, reseal, query, tombstone;
  - `subscribe`, with RL3 cursors, resume, paging and credit;
  - `caps` (RL7's device half);
  - `probe`.
- The org session seam (`OrgSession`) exists. It has a signed-out production value, a development source behind `MAWS_DEV_ORG` in unpackaged builds only, and a test value.
- Nothing visible changes for the owner: production is signed out until O8.

**Touches.**
- New:
  - `src/main/org/session.ts`;
  - `src/main/org/dev-session.ts`;
  - `src/main/machines/remote/`: `link.ts`, `carriers.ts`, `acts.ts`, `subs.ts`, `endpoint-records.ts`, `source.ts`, `dispatch.ts`, `timing.ts`, their tests, and `boundary.test.ts`;
  - `test/machines/remote-link.test.ts` and `test/machines/remote-link.local.test.ts`.
- Changed:
  - `src/main/machines/manager.ts` (a second source of links);
  - `src/main/machines/index.ts` (composition, probes, `Machines.remote`);
  - `src/main/index.ts` (the session handed to `startMachines`);
  - `src/shared/ipc/schema/machines.ts` (two optional fields);
  - `vitest.config.ts` (both link suites join `TIMING_NODE_TESTS`);
  - `eslint.config.js` (the link's unit suites and `test/machines/**` may import the endpoint and its test harness);
  - `test/endpoint/sub-harness.ts`, additively (and `StartOptions.limits`, the direct listener's handshake limits, since the default per-source burst of 3 trips on loopback where every handshake shares one source): `FakeEngineHost` today handles only `session.answer` under `host.op` and doesn't route `host.opQuery`, so a `session.send` act is refused `unavailable` before any claim. It gains a `session.send` handler that records each run and appends a journal row (and so a lane B event), and routes `host.opQuery` to `opCommands(...).opQuery`, as `test/endpoint/actions.test.ts`'s `engineHost()` does. No existing suite depends on the refusal (`calls.test.ts` asserts only `act-required` for a call).

**Interfaces.** It produces §A (`RemoteLink`, `Machines.remote`), §B (`OrgSession`), §C (the manager's `RemoteSource`), §D (`MachineState.carrier` and `.refusal`) and §E (`<userData>/endpoint-records.json`, `MAWS_DEV_ORG`). It consumes O6's `MachineLink`, `ConnectionManager` and `LINK_REGISTRY`/`onLink`, O10's `connectChannel`, `readMessage`, `Action`, `verifyEndpointRecord` and `verifyMachineCert`, O10 M9's `loadDeviceKeys` and `createStepUp`, and O1's `gradeOf` and `codecOf`.

**Decisions.**

*The org session.*
- **The link consumes `OrgSession`; O8's sign-in produces the production one.** The seam is narrow (Interfaces §B). It carries the device's identity (with `loadDeviceKeys`' channel key), the held and verified org view, the step-up signer, and the hub's address with the headers an authenticated member's request carries. The production value in M1 is `signedOut()`. Rejected: O7 building sign-in, Access's login transfer and device registration, which P5 Decision Log 38 gives to O8, so that two children would build one sign-in. P5 finding F1 and open question A1 carry the scheduling consequence.
- **The development source** (`dev-session.ts`). It exists so that M2's two-profile e2e and O9's remote lane A e2e share one way to give an app a signed-in session, rather than each building one.
  - It is honoured only when the build is not packaged and `MAWS_DEV_ORG` names a directory. A packaged build ignores the variable with one log line, as `configuredMachines` does.
  - `createDevOrgSession` returns at once, signed out, and loads in the background. It fires `onChanged` once it is signed in, so main's startup never waits on it.
  - The directory holds `session.json` and `chain.json` (Interfaces §E).
  - The source verifies the chain with `verifyPinnedChain(chain, transitions, pins)` and holds it with `memoryOrgView`. It loads the profile's own keys with `loadDeviceKeys(userData)`.
  - It is signed out, with a log line naming why, in any of these cases: the head doesn't list `member`'s `device` with this profile's channel key (compare key ids), the chain doesn't verify, or the hub URL isn't `http://127.0.0.1:<port>` while a stand-in user is named. A stand-in header is meaningful only to the local hub.
  - Advances are not persisted.
  - Its step-up signer is `createStepUp` with main's real confirmation. It adds no bypass.

*The roster and the manager.*
- **Which machines get a link.** The candidates are every ref in the head's `state.machines` and every `body.machine` in `view.certificates().certs`, the local machine's ref left out. A candidate is in the roster when `machineKeys(head, ref, certificates, now)` (`apps/org-protocol/src/records.ts`) returns at least one key. That is the check `openChannel` makes against `h2`, so the roster is exactly the set of machines a handshake can succeed with: a contested ref, a dead certificate and a revoked key are all left out. Each machine is named by its entry, else by its live certificate's `name`. The roster is recomputed at each `OrgSession` change, and signed out it is empty.
- **Links are eager: one per listed machine for as long as it is listed.** Rejected: links opened on first use. A first use would then wait on a handshake, and the machine's state in the roster (its chip, an offline machine greying its rows) would stay unknown until someone used it. At P5's scale of a few machines, an idle channel costs one ping every 5–7 s.
- **The manager gains a second source of links** (Interfaces §C).
  - RL2 entries are keyed by ref, which they know from creation. They are listed `connecting` from creation, closed and dropped when the roster drops them, and renamed when the head renames them. Each change emits `machines.changed`.
  - `known-machines.json` stays the socket links' file. Rejected: persisting RL2 machines there, a second copy of what the held org state already says.
  - O6's one-link-up-per-ref rule spans both kinds. An RL2 link that comes `up` while another entry already reaches that ref `up` is closed, with a log line. This happens only when a test configures both a socket link and RL2 to one profile.
  - `dispatch` finds the entry by ref across both kinds.
- **What `machines.list` adds.** `MachineState` gains optional `carrier: 'socket' | 'direct' | 'relay'` (set while `up`) and `refusal: string` (set while a permanent verdict holds; Interfaces §D). They are main-to-renderer only. M1 draws neither. Open question A2 is how the UI shows them.

*Carriers.*
- **Endpoint records.**
  - The link fetches the machine's record at each connection attempt from `GET <hub>/api/machines/<ref>/endpoint`, within 2 s, with `hub.headers()`. It verifies the record with `verifyEndpointRecord(head, record, certificates, now)` and keeps the newest `issued`.
  - The record is cached in memory and in `<userData>/endpoint-records.json` (0600, written through a temporary file and a rename). Each record loaded from the file is verified again before use.
  - A failed fetch uses the cached record. So a hub outage, even across a relaunch, still dials direct, which P5 §3's "survives a hub outage" needs. Rejected: memory only, which loses the direct carrier exactly when a hub outage and a relaunch coincide.
- **Direct first, raced** (P5 §3; P5 Decision Log 39).
  - Every address in the record that is a `ws://` URL whose host lies in the tailnet's ranges (IPv4 `100.64.0.0/10`, IPv6 `fd7a:115c:a1e0::/48`, the ranges the listener binds; RL §4.1) is dialled at once.
  - The first WebSocket to open within `DIRECT_DIAL_MS` (1000 ms) carries the handshake. The rest are closed.
  - Any other address is skipped, with one log line per record. Rejected: dialling whatever a signed record names, which lets a compromised machine point the app's sockets at arbitrary hosts.
  - The dialler is injected (§A's `RemoteLinkDeps.dialDirect`), so tests map the tailnet address to the loopback port the harness listens on.
- **Direct attempts stay under the listener's limit.** The link keeps a per-machine bucket that mirrors `HANDSHAKE_LIMITS.perSource`: a burst of 3, refilling at 5 a minute. Each direct attempt takes a token, and the catch-up's reconnects each take one. An empty bucket sends the attempt straight to the relay. `timing.test.ts` pins the bucket equal to `src/endpoint/direct-listener.ts`'s constant (a test may import both). Rejected: dialling until the listener answers `busy`, which spends the limit the next probe needs.
- **The relay.** One app socket per link, `wss://<hub>/api/machines/<ref>/socket` (`ws://` for an `http://` hub), with `hub.headers()`, opened when the relay is needed and closed once the link is on direct.
  - Each RL2 channel on it is one tag and channel number. M1's production version of `RelayDialer` lives in `carriers.ts` and holds at most `MAX_CHANNELS_PER_SOCKET`.
  - A failed upgrade (401, 403, 404, 503) or a socket close is transient. An upgrade 401 or 403 also says the hub session needs renewing, which is the org session's provider's concern. The link logs it once.
  - No `hub` in the session means direct only.
- **Both carriers use `ws` 8.22.0,** already in the tree and bundled into main as it is into `mawsd`. Rejected: Node's global `WebSocket`, whose header option is undici's own.
- **Switching back to direct.** While on the relay, the link tries direct every `DIRECT_RECHECK_MS` (60 s) and on every probe, under the bucket.
  - When a direct handshake completes, the new channel becomes the link's channel. That swap is the linearization point. Sends go to the current channel only, and messages from a channel that is no longer current are dropped.
  - The relay channel is closed. Subscriptions and acts then resume on the new channel exactly as after a reconnect.
  - The link stays `up` throughout.
  - Rejected: running both channels to overlap subscriptions, which needs each stream deduplicated across two sources to save one round trip.

*The link's states.* The link has six internal states. It reports three outward through `MachineLink.state()`. Timing values are §G's.

| Internal | Reported | Meaning |
|---|---|---|
| `connecting` | `connecting` | the first attempt, before any `up` or verdict |
| `up` | `up` | a channel is current and `caps` has arrived |
| `reconnecting` | `up` | the channel was lost within the last `UP_GRACE_MS` (2 s); an attempt runs |
| `down` | `down` | no channel; retrying on the backoff |
| `refused` | `down` | a permanent verdict; no retry until the session changes or a person probes |
| `closed` | `down` | `close()` was called |

| State | Event | Next | Effect |
|---|---|---|---|
| `connecting`, `reconnecting`, `down` | attempt succeeds | `up` | record `caps`; resubscribe every subscription with its cursor; settle every act (below); send held calls |
| `connecting` | transient failure | `down` | backoff from its start |
| `reconnecting` | transient failure | `reconnecting` | next attempt on the backoff; the grace timer runs on |
| `reconnecting` | grace elapses | `down` | every subscription's sink gets `paused('offline')` |
| `down` | backoff due, or any probe | `down` (attempting) | an attempt; a probe also resets the backoff |
| `up` | channel lost: sealed `close` `restart`, `timeout` or any other transient reason, or a carrier close | `reconnecting` | an attempt at once |
| `up`, `reconnecting` | sealed `close {reason: 'removed'}` | `refused` | subscriptions `ended('removed')`; acts never sent resolve `refused {reason: 'removed'}`, acts sent and not settled resolve `unknown {reason: 'removed'}` (a refused device can't query); calls fail `removed` |
| any but `closed`, `refused` | `OrgSession` change that retires a machine key the current channel or a running attempt was authenticated against, or changes this device's identity | `reconnecting` (from `up`), unchanged otherwise | the trust generation goes up by one; the current channel is closed and an attempt runs at once; an attempt begun under an older generation is discarded when it completes |
| `up` | probe | `up` | `ping` now; no message of any kind within `PROBE_PONG_MS` (2 s) counts as channel lost (`timeout`) |
| `up` (relay) | direct recheck or probe, direct handshake completes | `up` (direct) | the switch above |
| `refused` | `OrgSession` changes, or a probe with reason `person` | `down` (attempting) | an attempt now |
| any | `close()` | `closed` | subscriptions `ended('closed')`; acts never sent resolve `refused {reason: 'closed'}`, acts sent resolve `unknown {reason: 'closed'}`; `close` sent on the channel; the relay socket closed |

- **Requests while `refused` or `closed`** end at once. A call fails `removed` (or `closed`), an act resolves `refused {reason: 'removed'}` (or `closed`), and a subscription is `ended('removed')` (or `closed`).
- **One attempt at a time.** A probe or a backoff timer that fires during an attempt is remembered, and runs one more attempt if that one fails.
- **Transient or permanent.**
  - Permanent: only a sealed `close {reason: 'removed'}`, which arrives authenticated inside the channel. `Channel.onClose` reports a sealed close's reason and a carrier's end alike, so every production carrier (`carriers.ts`, and the link's wrapper around any injected one) reports its own end as `carrier`, whatever reason the socket's close frame or the relay's channel close carried: a relay or a socket that closes with `removed` stays transient. The link's own view decides the rest without any peer's word: a machine that leaves the roster is closed by the manager, and a device the head no longer lists is signed out by its `OrgSession`.
  - Transient, and local to the carrier that produced it: every handshake `ChannelError`. `protocol`, `unknown-machine`, `revoked` and `contested` are raised from `h2` before its MAC and signature are checked (`openChannel`), and an endpoint's own refusal (`unknown-device`, `class`) reaches the device only as a carrier close. A hostile relay can forge any of them, so none stops the link, and the next attempt starts again from the direct carrier. Each is logged, once per reason per link. A machine that really speaks another major retries at the 30 s cap, which costs little. Rejected: stopping the link on these verdicts, which would let one rewritten `h2` on the relay keep the device off the direct carrier too.
  - `behind` is `connectChannel`'s own catch-up. It surfaces only when a page made no progress, and is transient.
- **Trust changes close the channel.** When an attempt begins, the link records the key ids `machineKeys(head, ref, certificates, now)` returns and the identity it presents (org, member, device, channel key id), under a trust generation. At each `OrgSession` change it recomputes both. If a recorded machine key is no longer current, or the identity differs, the generation goes up: the current channel is closed and re-authenticated at once against the new head, and an attempt still running under the older generation is discarded when it completes. The handshake checks the machine's key only once, so a channel authenticated by a key the org has since retired would otherwise keep serving, and a compromised old key would not close it voluntarily. The `OrgSession` provider fires `onChanged` whenever its view adopts a new head, a link's handshake `advance` included (§B). The generation an attempt carries is the one read before it reads the session, so a change while its keys are being computed discards it. A delegated machine's key also stops speaking for it when its delegation expires, with no session change: the same check runs at the next delegation `expires` of the machine's certificates, and the roster is recomputed at the next one of any certificate.
- **Backoff** (RL §4.6).
  - After going `down` the delays are 0, 1, 2 and 4 s, then 5 s until `RESUME_WINDOW_MS` (120 s, the endpoint's `RESUME_MS`) has passed, then 30 s. Each delay is jittered ±20%.
  - Every probe runs an attempt at once and restarts the schedule. A probe is wake (`powerMonitor` `resume`), unlock (`unlock-screen`), focus (`app` `browser-window-focus`), a network change, or a person's action on that machine.
  - A network change is a change in the set of non-internal addresses from `os.networkInterfaces()`, read every `NETWORK_POLL_MS` (2 s) while any link exists.
  - Only a permanent verdict stops the retries.
- **Grace and generations.** `up` survives a reconnect that completes within `UP_GRACE_MS`. Such a reconnect is not a new generation, so the renderer neither greys rows nor re-snapshots on a Wi-Fi blip. Past the grace the link reports `down`, and its next `up` is a new generation (O6 M4's reset). Rejected: `down` at every channel loss, which flashes a machine offline and re-reads it on every blip.
- **Liveness.** As the endpoint's (`src/endpoint/channels.ts` `#arm`), in periods of 5–7 s drawn anew each time. A period in which any message was heard resets the count. Each silent period sends `ping {at}`. The third silent period in a row closes the channel `timeout`. An endpoint `ping` is answered `pong {at}` at once.
- **The org state on the channel.** `connectChannel` advances `view` with what the handshake carries. A sealed `state {states, transitions}` from the endpoint is passed to `view.advance`. The endpoint sends none today. The link pushes no states.

*Calls.*
- `call(name, input)` sends `{t: 'call', id, name, input}` with a fresh `id` and resolves on the matching `result`. A call with no input sends `input: null`: `JSON.stringify` drops an `undefined` field, and the endpoint's `readMessage` would then find the `call` malformed and close the channel, taking every other stream with it.
- While the link is `reconnecting` or `down`, a call waits for `up` up to its timeout (`CALL_TIMEOUT_MS`, 10 s), then fails `offline`. A call in flight when its channel is lost is sent again on the next channel: reads are idempotent.
- Errors keep the endpoint's code (a `RefusalReason`, `unavailable`, or a host `IpcError` code passed through), plus the link's own `offline` and `timeout`.

*Acts* (RL4; RL §4.7). Table `acts.ts`, one entry per opId.
- **Building.**
  - `act(request)` builds `{v: 1, org, machine: ref, device, opId, opCreated, action, session?, context?, args, requestDigest?, nonce, created}` from the session's identity. `opId` is 16 random bytes in base64url and `nonce` is `NONCE_BYTES` random bytes. `opCreated` is the creation time. `created` is set at each send.
  - The caller supplies `context` and `requestDigest`. The link fills neither. For a lane B act the context is `{lane: 'B', launchId, engineSessionId}`. For a lane A act it is `{lane: 'A', session, launch}`.
  - A request whose `session` is set without a `context` is refused locally as `malformed`, since the endpoint would refuse it the same way.
  - `executor` defaults by name: `sminos.*` to `sminos`, `endpoint.*` to `endpoint`, anything else to `engine-host`.
- **Step-up** (RL §5.6). `request.stepUp` is `'required' | 'if-asked' | 'never'`, defaulting to `'if-asked'`.
  - `required` signs through `session.stepUp.sign({machine, action, args, session, context, requestDigest, opId, opCreated})` before the first send.
  - `if-asked` sends unsigned. An `ack refused {reason: 'step-up'}` then signs as above and sends again under the same `opId` with a fresh nonce. An act the endpoint refuses is claimed nowhere, so reusing the id runs nothing twice.
  - `never` takes a `step-up` refusal as final.
  - A cancelled or failed confirmation resolves `refused {reason: 'step-up-cancelled'}`.
  - The signer stamps its own nonce and times when the person confirms.
- **The send window.** An act is sent, or resealed, only within `ACT_FRESH_MS` (60 s, `FRESH_MS`) of its `opCreated`, or, for a step-up act, of its signature (the person's confirmation), so time spent at the prompt doesn't spend the window, as `step-up.ts` rules. One the link could not put on a channel within that window, because the link was `down` the whole time, resolves `refused {reason: 'offline'}` and is never sent. Rejected: holding acts until the machine returns, which would run a send, an interrupt or an approval minutes after the person asked. Open question A4 asks the owner whether sends should instead wait in an outbox.
- **Outcomes** (Interfaces §A's `ActOutcome`). After a send:
  - `ack accepted` makes it `accepted`;
  - `ack refused {reason}` resolves `refused {reason}` only while the act is not **ambiguous**. An act is ambiguous once a transmission of it may have reached the executing side without its answer reaching the link: its channel was lost after it was sent and before a terminal answer, or `ACK_TIMEOUT_MS` passed. A refusal of a later transmission says nothing about an earlier one, since the endpoint checks freshness, grade and lane B's context before the executor's ledger (`src/endpoint/actions.ts`): a send that ran, lost its `ack` and `done`, and was resealed after a relaunch is refused `context` although it ran. So a refused transmission of an ambiguous act is followed by a query, and the executor's ledger decides;
  - `done {outcome}` is read in the executing side's words. `{state: 'done', result}` and `{state: 'failed', error}` are terminal. `{state: 'refused', reason}` is terminal only while the act is not ambiguous. `{state: 'in-progress'}` and `{state: 'unknown'}` are not terminal: the link queries.
  - **While an act is ambiguous, no refusal settles it**: neither an `ack refused` nor a `done` whose outcome is `{state: 'refused'}`. A resealed copy can be accepted and still be refused by the executor before its ledger looks the id up: a closed ledger answers `refused unavailable` first (`src/shared/host/op-ledger.ts`, `begin`). So the link queries, and only the query's answer settles the act. A query's `unavailable` keeps the act ambiguous, and the link asks again on the query backoff.
- **After a lost channel**, at the next `up`:
  - an act sent but never acked, still within `ACT_FRESH_MS` and not step-up-signed, is **resealed**: a fresh `nonce` and `created`, the same `opId`, `opCreated`, `args`, `context` and `requestDigest` (O10 test-support's `TestDevice.reseal` shows the transformation). The executing side's ledger returns the stored result if it already ran.
  - every other non-terminal act (acked without `done`, past the window, or carrying a step-up) is **queried**: `query {opId, opCreated, executor}`.
  - An act with a step-up is never resealed: a reseal changes `nonce` and `created`, which the step-up signature covers, so it would need the person to confirm again for a resend they didn't ask for.
  - No `ack` within `ACK_TIMEOUT_MS` (10 s) on a live channel counts as lost, and the act is ambiguous from then. No `done` within `DONE_QUERY_MS` (60 s) after `accepted` starts querying.
  - Under `if-asked`, an `ack refused {reason: 'step-up'}` on an ambiguous act is queried like any other refusal, never signed and resent.
- **Queries.** A `queried` answer is read as follows:
  - `done` takes the outcome, read as `done`'s;
  - `refused` with an `outcome` is the op's own refusal, and terminal;
  - `refused` with the reason `unavailable` and no outcome (the executor's ledger can't be read now) asks again on the query backoff;
  - `refused` with any other reason and no outcome (`grade`, `class`: the machine will no longer say) resolves `unknown {reason}`;
  - `in-progress` and `unavailable` ask again after 1, 2, 4, 8 s, then every 15 s, while `up`;
  - `not-received` resolves `not-sent`. The machine has tombstoned the id, so nothing ran and nothing will;
  - `expired`, or a query still unresolved at `OP_HORIZON_S` by the app's clock, resolves `unknown {reason: 'expired'}`. Each act carries its own timer to that horizon, whatever the channel, so an act whose channel never returns still resolves: `unknown expired` if a copy went out, `refused expired` if none did.

  Only `not-sent` licenses sending again, under a new `opId`, and only the caller does it.
- **Pending acts live in memory.** An app quit forgets them. The machine's ledger still holds each result for a day, and nothing runs twice. Rejected: persisting them in the profile, which would surface an operation from an earlier run with no view to show it in.

*Subscriptions* (RL3). Table `subs.ts`.
- `subscribe(request, sink)` registers a subscription under a fresh 16-byte base64url `id`. The id is reused for that subscription on every later channel, so a lane A read can name it in `input.sub`. While the link is `up`, the link sends `{t: 'sub', sub: id, session, view, cursor, credit: SUB_INITIAL_CREDIT}`.
- **The cursor.**
  - It is the position of the last `ev` delivered to the sink. A `subbed {mode: 'replay'}` keeps it.
  - A `subbed {mode: 'snapshot' | 'missing'}` moves it to the `subbed` position, but only once that snapshot's `last` page has arrived. Until then a resubscribe sends the cursor as it stood.
  - A replace-whole `snap` (lane B's parts, a `cards` set) doesn't move it.
  - A resubscribe sends the cursor as it stands.
- **Delivery.**
  - `snap` pages are joined by their `body` strings and parsed once `last` arrives. A page out of order, or one from another position, discards the assembly and logs. The endpoint re-sends replace-whole state on every resume.
  - An `ev` at or before the cursor within the same epoch is dropped. Positions compare by `(seq, idx ?? -1)`. This is a defence: the endpoint already guarantees no repeat.
  - The sink gets `subbed`, `snapshot`, `event`, `paused`, `resumed` and `ended` in arrival order.
- **Credit.** Each delivered `ev` and `snap` counts its message's UTF-8 `JSON.stringify` length, as the endpoint charges. The link returns it as `credit` in batches of at least 256 KiB or every 250 ms, whichever comes first. A refund larger than `SUB_CREDIT_MAX` goes as several `credit` messages of at most that much, keeping the exact total, since the endpoint finds a larger one malformed. The sink is in-process, so delivery is consumption. M2 revisits this if the renderer's pace needs to push back.
- **Ending.** `ended {reason}` ends the subscription for good and removes it. `close()` sends `unsub` and removes it. A subscription beyond `MAX_SUBS` (64) on one link is `ended('busy')` at once, without a round trip.
- **Losing the channel.** At `down` past the grace, each sink gets `paused('offline')` once. The next `subbed` resumes it.

*The router's path* (`dispatch.ts`, `MachineLink.dispatch`).
- A command not on the link surface (`onLink(name)` false) answers `host_unavailable`, as the socket link does.
- A command whose `gradeOf(name)` is plainly `list` or `view` goes as `call(name, input)`. Its output is read with `codecOf(LINK_REGISTRY).readCommandOutput`. A value that fails the check answers `internal`.
- Any other command answers `internal` with `issues: {refusal: 'act-required'}` without a round trip. Lane B's acts reach the router path in M2, which fills their context and digest from what the person saw.
- Errors map as follows:
  - `offline` → `host_unavailable`;
  - `timeout` → `timeout`;
  - `unavailable` → `host_unavailable`;
  - an `IPC_ERROR_CODES` member passes through;
  - anything else → `internal` with `issues: {refusal: <code>}` and the message `<name>: refused <code> by machine <name>`.

  Rejected: a new `IpcError` code, which O1's rule makes breaking. `issues` is `unknown` and carries it additively.
- `ClientRef` is not sent: the channel's member and device are the caller (RL §5.5). `onEvent` emits nothing in M1. M2 turns lane B subscriptions into renderer events.

*What the renderer sees.* An RL2 machine that is `up` makes `connectShell` take its snapshot. Its main-owned reads are not offered and fail softly (logged, the store left empty), and the machine never counts as loaded. That is harmless, and it occurs only in a dev run or a test. M2, or whichever child builds remote rows (P5 finding F5), replaces those reads for RL2 machines. M1 does not change the renderer.

*Composition* (`src/main/machines/index.ts`, `src/main/index.ts`).
- `startMachines` takes `session: OrgSession`. In `src/main/index.ts` that is `createDevOrgSession(...)` when `MAWS_DEV_ORG` is set, else `signedOut()`. O8 later replaces it with its sign-in's session.
- It builds the remote source (with the local machine's ref, which the roster leaves out) and passes it to the manager. It exposes `remote(ref)`.
- The router's `remote` option stays the plain `machines.dispatch`, so that O9 M9 can wrap it (P5 Decision Log 93); whichever child lands second keeps both.
- It wires the probes: `powerMonitor` `resume` and `unlock-screen` to `probeAll('wake' | 'unlock')`, and `app` `browser-window-focus` to `probeAll('focus')`. The network watch lives in `source.ts` (Electron-free).
- `stop()` closes every link.

*The boundary* (`boundary.test.ts`).
- It reads every `.ts` and `.tsx` under `src/main` and `src/renderer`, except tests and `src/main/machines/remote/**`. It fails, naming the file, on any of `openChannel(`, `connectChannel(`, `acceptChannel(`, or the string `/api/machines/`.
- It also fails if any file under `src/main/machines/remote/` imports `electron`.

**Does not touch.**
- Sign-in, device registration, the hub's Registry socket and listings (O8).
- Lane B's renderer events and lane B acts on the router path (M2).
- Any offer-table row and anything in `src/endpoint/`.
- The engine host and the pty host.
- The renderer's stores and UI.
- `known-machines.json`'s format.
- Lane A (O9 consumes M1).

**Proves.** Acceptance 1. Each test below is named by the behaviour it pins.
- **`src/main/machines/remote/*.test.ts`** (fakes; no network):
  - `carriers.test.ts`: only tailnet `ws://` addresses are dialled. The first address to open wins and the others close. An empty bucket goes straight to the relay. The relay dialler opens tags, maps the hub's channel ids, and ends every channel when its socket closes.
  - `link.test.ts`, over a fake channel factory, covers every row of the transition table, including:
    - grace kept and grace elapsed (a new generation after `down`);
    - permanent against transient verdicts;
    - the backoff schedule, and its reset by a probe;
    - the probe's ping, and its `timeout`;
    - the switch from relay to direct: subscriptions resumed on the new channel, messages from the old one ignored;
    - `close()`.
  - `acts.test.ts`:
    - ack and done;
    - refused;
    - a drop before the ack within 60 s resealed with the same opId and opCreated and a new nonce and created;
    - a drop after the ack queried;
    - `in-progress` queried again;
    - `not-received` resolving `not-sent`;
    - a step-up act queried and never resealed;
    - `if-asked` signing after a `step-up` refusal and resending under the same opId;
    - a cancelled confirmation resolving `refused step-up-cancelled`;
    - an ambiguous act whose reseal is refused (`context`, `grade`) queried rather than resolved `refused`, and resolving with the first transmission's result when the ledger holds it;
    - an ambiguous act whose reseal is accepted and then answered `done {state: 'refused', reason: 'unavailable'}` (the first copy ran, its answers were lost, the ledger has since closed) queried rather than resolved `refused`, staying ambiguous while the query answers `unavailable`, and resolving `done` with the first copy's result once the ledger reopens;
    - a `step-up` refusal on an ambiguous act queried, never signed;
    - an act held past 60 s resolving `refused offline` and never sent;
    - `expired`, and `refused {reason: 'grade'}` resolving `unknown`.
  - `subs.test.ts`:
    - the cursor's rules (replay, a snapshot's last page, each `ev`);
    - pages joined, and an out-of-order page discarded;
    - an `ev` at or before the cursor dropped;
    - credit returned in batches;
    - `ended` removing the subscription;
    - a 65th subscription `ended('busy')`;
    - `paused('offline')` past the grace.
  - `endpoint-records.test.ts`: a record failing verification ignored; the newest `issued` kept; the file 0600 and re-verified at load; the cache used when the fetch fails.
  - `dispatch.test.ts`: `list` and `view` commands sent as calls, with their output checked; others refused locally with `act-required`; each error mapping.
  - `source.test.ts`: the roster from a head with entries, a live and a retired certificate, and a contested ref; recomputed on change; the network watch probing on an address change.
  - `timing.test.ts`: the bucket equal to `HANDSHAKE_LIMITS.perSource`, and the resume window equal to `RESUME_MS`.
  - `boundary.test.ts`.
- **`src/main/machines/manager.test.ts`, extended:**
  - RL2 entries listed `connecting` from creation, `up` with their carrier, dropped when the roster drops them, renamed on a rename;
  - a ref already `up` through a socket link refusing the RL2 link;
  - `dispatch` reaching an RL2 entry.
- **`src/main/org/dev-session.test.ts`:**
  - ignored in a packaged build;
  - signed in from a valid directory;
  - signed out, with its log line, for a chain that doesn't verify, for a head that doesn't list this profile's key, and for a stand-in user on a non-loopback hub.
- **`test/machines/remote-link.test.ts`** (the endpoint's `sub-harness.ts`, direct carrier at loopback, the profile's real keys through `loadDeviceKeys` with `excludeFromBackup` injected):
  - the link `up` over direct, and `caps` read;
  - `call('session.status')` answered;
  - a lane B `session.send` act whose channel is dropped before its `ack`, resealed, and run once, asserted on the fake engine host's recorded runs and journal, not on `host.op` having been dispatched;
  - a `session.send` that ran, whose `ack` and `done` were lost with its channel, and whose session was relaunched before the reconnect: the reseal is refused `context`, the link queries, and the act resolves `done` with the first run's result;
  - a carrier wrapper that rewrites the first `h2` (its protocol major, or its `keyId`) on one attempt: that attempt fails `protocol` or `unknown-machine`, the link keeps retrying, and the next attempt comes `up`;
  - a new head that replaces the machine's key under the same ref, adopted by the org session: the live channel is closed and re-authenticated against the new key, and an attempt that completes after the change under the old generation is discarded;
  - a lane B subscription resumed after a forced drop with every event's `(launchId, seq, idx)` checked against the fake host's numbering, nothing lost or repeated, a drop between two events of one row included;
  - a lane A `full` subscription, and a `sminos.rows` call naming its `sub`;
  - a new head removing the device, delivered to the endpoint as `test/endpoint/channels.test.ts`'s removal case does, closing the link `removed`, with no attempt after it until the org session changes;
  - `if-asked` step-up through the injected signer.
- **`test/machines/remote-link.local.test.ts`** (desk-hub's Worker in Miniflare, `test/endpoint/miniflare-hub.ts`; the endpoint enrolled and listed as in `channels.local.test.ts`):
  - with the direct address dead, the link `up` over the relay;
  - a subscription and a pending act surviving a forced relay drop;
  - the direct address brought back, then a probe switching the link to direct with the subscription continuing without loss or repeat;
  - the endpoint-record fetch failing (the hub stopped) after a record was cached, and the link still `up` over direct.

### M2 — Lane B's conversation over the link, the step-up sheet and the carrier hover

A lane B session on another machine opens from its row and works as a conversation: the transcript streams with token deltas, the composer sends, steers and interrupts, cards answer, images go inline, and two apps on one session both see an answer settle. M2 also builds the two small surfaces every later milestone needs: the step-up sheet (P5 Decision Log 126), which shows an action's text before Touch ID, and the machine row's carrier hover (A2, P5 Decision Log 108). It mirrors O9 M9's shape, so an executor reads `src/main/lane-a/remote.ts` first: an adapter in main that owns every byte on the wire, the renderer keeping the local driver's inputs and outputs.

**At its end.**
- A click on another machine's listed lane B row (O8 M2's `ListedSession`, lane `B`) opens its pane. Within 1.5 s the transcript shows the session's history and then streams live, deltas included. The composer sends, steers (Enter while a turn runs) and interrupts; a permission card approves or denies, a question answers; the model, effort and mode chips change the session; an image pasted or dropped goes with the message. Closing the tab ends the stream within 10 s. A send while the machine is unreachable waits 60 s, then shows "Not sent: `<machine>` is offline" with Send again (A4).
- Two apps signed in as the same member attach to one session: both stream it, and an answer from one settles the card in the other within one round trip.
- The machine row's hover says "direct (tailnet)" or "via the hub"; a device the org removed sees that machine's rows greyed with "This Mac is no longer allowed on `<machine>`"; "Hub unreachable" appears once, apart from any machine's offline greying.
- A remote transcript whose stream resumed past a lost range, and a local one whose `session.events` answered `historyUnavailable`, draw one bar, "Earlier history isn't available", where the gap is.
- An act that needs step-up (none in M2 for an owner on their own machine; a spawn in M4, a shell by a non-owner in M3, O8's org-state signing today) shows a sheet with the action's full text, Continue and Cancel, before Touch ID.
- Nothing changes for lane A, for a local lane B session, or for a signed-out app.

**Touches.**
- New: `src/main/lane-b/remote.ts` (the adapter), `remote-session.ts` (a remote session's fold: status, parts, record, capabilities), `remote-outcomes.ts` (an act's outcome as a command's result), `remote-interest.ts` (the tabs of RL2 machines), their tests; `src/main/machines/remote/capabilities.ts` (`DEVICE_CAPABILITIES`); `src/endpoint/capabilities.ts` (`ENDPOINT_CAPABILITIES`); `src/main/device/step-up-sheet.ts` and its test; `src/shared/ipc/schema/remote.ts` (main-owned `remote.*`, Interfaces §K); `src/renderer/src/lane-b/remote-connect.ts` (the opener, the `remote.*` events into a store) and `remote-session.ts` (the store); `test/lane-b/remote.test.ts`; `e2e/remote.spec.ts` and `e2e/support/remote-scene.ts` (Interfaces §Q).
- Changed: `src/endpoint/offers.ts` (§L's M2 rows), `src/endpoint/calls.ts` (a `machine`-executor call row dispatches `dispatch('machine', name, input)`, as an `engine-host` row does; today only `daemon.status` is routed), `src/endpoint/endpoint.ts` (`h2` lists `ENDPOINT_CAPABILITIES`), `apps/org-protocol/src/messages.ts` (`Executor` gains `machine`; `FROM_DEVICE.query` admits it), `src/main/machines/remote/acts.ts` and `link.ts` (`peerCapabilities()`; an act whose executor the peer did not list is refused locally), `src/main/org/org-session.ts` and `dev-session.ts` (`identity.capabilities` from `DEVICE_CAPABILITIES`; `session.json` gains `directMap`), `src/main/index.ts` (`routeLaneB` around `routeLaneA`; the sheet as the confirmation of `createStepUp` and `createStateSigner`), `src/mawsd/endpoint-seam.ts` (the records seam, §Q), the renderer: `session/SessionPane.tsx` (a listed lane B row with a record is a started pane), `session/controls/controls-for.ts` and `lane-b.ts` (the remote overlay), `sidebar/HoverCard.tsx` and `app/machine-mark.ts` (A2), `transcript/source/ipc.ts`, `older.ts` and `stores/transcript.ts` (the gap bar), `composer/` (the remote send's copy and the drafts rule), `stores/sessions.ts` (one row per address), `ipc/events.ts` (`remote.*`), `App.tsx` (the mount); `package.json` (`e2e:remote`), `.github/workflows/gate.yml` (`CLASS1_E2E`), `.github/scripts/e2e-default-specs.test.mjs` (its pin), `vitest.config.ts` (`TIMING_NODE_TESTS`), `eslint.config.js` (`test/lane-b/**` as `test/lane-a/**`).

**Interfaces.** Produces §J (the adapter and `routeLaneB`), §K (`remote.*`), §L's M2 rows, §M's `machine` executor and the capability constants, §P (the sheet), §Q (the e2e scene and the dev org's `directMap`). Consumes §A (`RemoteLink`), O8 M2's `ListedSession` and `registerRemoteOpener` (`src/renderer/src/sessions/remote-openers.ts`), O3-D's `session.get` and the stream rules of `src/shared/host/stream-catchup.ts`, `requestDigestOf` (`src/shared/host/request-digest.ts`), and O9's `linkView` shape (`src/main/lane-a/remote-outcomes.ts`) for the link's words.

**Decisions.**

*Subscriptions follow the tabs.* The renderer asks for nothing: main subscribes to a remote lane B session while any window's `main.tabs` holds its address, and ends the subscription `UNSUBSCRIBE_LINGER_MS` (10 s) after the last tab closes, so a tab switched away and back doesn't open a new stream. `remote-interest.ts` reads the layout as `src/main/sessions/interest.ts` does (`sessionsInTabs`'s input) and groups addresses by machine, keeping RL2 machines only. Rejected: a renderer `watch` command as O9's `laneA.watch` (lane B's renderer has no per-session connect step: local events are broadcast, and the transcript's `ipcSource` opens on the tab), and subscribing to every listed session (64 subscriptions per channel is the endpoint's cap, and a server lists hundreds).

*One subscription per session, `full`, from the start.* The stream's parts and events become the events the renderer already consumes, emitted with `emitFrom(machine, …)` so the renderer lifts them to the machine (`src/mawsd/front-streams.ts`'s `eventOf` is the mapping to copy): `status` → `session.status`; `queue` → `session.queue`; `catalog` → `session.catalogChanged`; `pendingItems` → `attention.changed {appSessionId, items}` for that session, the broker items turned into attention items the way main's local attention service turns them (the renderer never reads `session.brokerItems`); `ev` → `session.eventBatch`, coalesced per macrotask into one batch of at most 500 events. The first `subbed` of a subscription says nothing to the renderer. A later `subbed {replay}` says nothing either. A later `subbed {snapshot}` (a relaunch: the session was resumed, or `/clear`) and a `subbed {missing}` (a range the journal lost) each emit `remote.gap {appSessionId, launchId}` before the parts that follow, and the renderer draws the gap bar at that point of the transcript; it is the one signal lane B has for "events between were not delivered", and the local path's `historyUnavailable` draws the same bar (below). An `ev` body `{omitted: 'too-large'}` is a gap too. Rejected: re-reading the transcript from the journal at each `snapshot` (the renderer pages history itself through `session.events` over the link, as locally; a re-read would double what it holds).

*The record.* At subscribe, the adapter reads `session.get {appSessionId}` over the link (§L; a `view` call) and emits it as `session.changed {record, cause: 'live', revision}` for the machine, so the sessions store holds a record under the address and `SessionPane` takes its started branch; P5 Decision Log 101 names this switch from the listed row to the record. A `session.get` that answers null or `grade` (a fresh session whose engine hasn't reported its id yet, tracker row "A fresh lane B session has no `engineSessionId`") is retried at 0.5, 1, 2 and 4 s, and the pane shows "Opening on `<machine>`…" meanwhile. The record stays after the tab closes. The sidebar draws one row per address: a session with a record is its record row, and its listed row is hidden (O8 M2's listed rows are their own node kind; the executor dedups where the tree is built). Rejected: a pane over the listed row alone with a parallel state as O9's `LaneAState` (every panel tool reads `SessionRecord | null` for its directory and worktree, which M4's diff, files and terminal need).

*Acts.* The adapter takes, for an RL2 machine, every `session.*` act §L offers in M2 and builds `link.act({action, session: <bare appSessionId>, context: {lane: 'B', launchId, engineSessionId}, args, executor, requestDigest?})`: the context from the last `session.status` the subscription delivered (an act before the first status, or on a session with no open tab, is refused `internal {refusal: 'not-open'}` with "open the session to drive it", O9's `NOT_OPEN`); `args` is the command's input with its ids lowered to bare ids; `requestDigest` for `session.answer` from `requestDigestOf(appSessionId, request)` over the pending request the adapter reads with `session.pendingRequest` (also what answers the renderer's `attention.request`, below); `executor` is `engine-host` for the engine host's commands and `machine` for `session.acquire` (the resume behind a send to a released session; P5 Decision Log 36: `converse`). `session.update` is not offered: its reader fields (unread, last seen, pinned) are the owner's on the machine's index until O8 M6 keys them per member (P5 Decision Log 36), so a remote session's read marks stay in this app's memory and the executor confirms the renderer tolerates the refusal, as for drafts. Sends are serialized per session as O9's are: one `session.send` or `steer` in flight, the next created only at the outcome, at most 8 waiting; a `session.interrupt` or `session.answer` never waits behind a send. Step-up is the link's `if-asked`. Rejected: building acts in `dispatchOverLink` from the registry alone, which has no status to fill the context from.

*Outcomes as results* (`remote-outcomes.ts`). `done {result}` is the command's output, checked with the link surface's codec as `dispatchOverLink` checks a call's; `failed {error}` passes the error through as the command's; `refused {reason}` maps by §F (`offline` → `host_unavailable` with the message "Not sent: `<machine>` is offline", which the composer shows with Send again, A4); `not-sent` → `host_unavailable` "not sent"; `unknown {reason}` → `timeout` with "`<machine>` took the message but its answer was lost; check the transcript". A `session.send` waits for its outcome at most `SEND_ANSWER_MS` (5 s, O9's) and then answers `{disposition: 'queued', messageUuid: null, queueId: <opId>}` while the act goes on; the transcript shows the message when the engine echoes it.

*Reads.* A `list`- or `view`-graded command for an RL2 machine goes as a call through the router's existing path (`dispatchOverLink`), so the pane's reads need only their offer rows (§L): `session.events` (history, `before`, `seek`, `agentId`), `session.appEvents`, `session.status`, `session.catalog`, `session.queue.list`, `session.get`, `session.getContextUsage`, `session.getUsage`, `session.getWorkspaceDiff`, `session.getSettings`, `session.listModels`, `session.listPermissionRules`, `session.getStatus`, `session.mcpStatus`, `session.getSessionCost`, `session.history.list`. Two reads the pane makes have no row and get substitutes in the adapter: `attention.request {appSessionId, requestId}` is answered from `session.pendingRequest` over the link, shaped as main's local handler shapes it; `engine.models` (graded `spawn`, machine-wide) is answered from `session.listModels` for the session the composer is in. Drafts: `session.drafts.get` and `.set` are not offered (a draft on another machine's index is per member, O8 M6), so the composer keeps a remote session's draft in memory for the app's run and the executor confirms the composer tolerates the refused read. `fs.readSpill` and `fs.agentEvents` (`view`, path-only) are offered in M4 with the checkout rule; until then a spilled result on a remote session shows its placeholder.

*The capability list* (RL7's per-session half; O10 leaves it to O7; O9's residue 8). The adapter publishes `remote.session {address, link, stream, controls, reason}` (§K) at each change: `link` as O9's `linkView` (the link's state, carrier, refusal, this member and its machine rights from `caps`); `stream` is `live`, `paused` (`paused('offline')` or `no-app`), `gap` or `ended`; `controls` is the lane B port's table with the remote overlay: closed with a reason are `media` beyond inline images until M4 ("files to a session on another machine wait for uploads", `MEDIA_GAP`'s pattern), `take-over` and `reopen` (not offered remotely), `forget`, `rewind` and `rewind-files` until their rows (M4), `subagent-rows` (the remote agents feed is O9's gap, kept), and every control while `reason` stands (the link down, the device refused, no status yet). The renderer's `laneBControls` takes the overlay for a remote session (`controls-for.ts` chooses it when the record's machine has a `remote.session` state). The member's rank on the session is not computed here (tracker row "Main cannot know a member's rank on a remote session"): the endpoint is the authority, and a `refused grade` is shown on the control that asked, as lane A shows it.

*Pending items in the pane.* The `pendingItems` part reaches the attention store as `attention.changed` for that session only (above), so the pane's docked card and the session's row show the request; Needs you, the badge and ⌘⇧J count it once the record exists (the derive requires a record). Machine-wide attention, with no tab open, is M6's.

*The gap bar.* One renderer component draws "Earlier history isn't available" as a row of the transcript, from two sources: `remote.gap` (above), and a `session.events` page that answered `historyUnavailable: true` (the local path, P5 Decision Log 77's tracker row). `TranscriptEntry` gains a `gap` kind at the position the signal names (the launch's first event for a `snapshot`, the cursor for a `missing`, the page's start for `historyUnavailable`); `RemoteTranscriptSlot`'s `older-failed` bar is the precedent for its look. Rejected: a toast (the gap is positional).

*The carrier hover* (A2, P5 Decision Log 108). `useMachineMark` gains `carrier` and `refusal` from `MachineState`; `SessionHoverCard` and `ListedHoverCard` show "direct (tailnet)" for `direct`, "via the hub" for `relay`, nothing for `socket` or local. A machine whose `refusal` is `removed` greys its rows with "This Mac is no longer allowed on `<name>`" in place of "machine offline". "Hub unreachable" is drawn once, in the sidebar's org header, from `org.status`'s `hubAccess: 'unreachable'` while any RL2 machine is `up` (P5 §3's hub-offline, channel-up); the chip itself shows no carrier.

*The step-up sheet* (P5 Decision Log 126; §P). `sheetConfirmation` is a `Confirm` (`src/main/device/step-up.ts`) that shows the prompt's `text` in a macOS sheet on the focused window (`dialog.showMessageBox` with `message: summary`, `detail: text`, buttons Continue and Cancel, Cancel the cancel button and Escape) and, on Continue, runs `promptTouchIDConfirmation`'s prompt with the summary; Cancel at the sheet resolves `{ok: false, reason: 'cancelled'}` and never prompts Touch ID; with no window, the sheet is a window-less message box. `src/main/index.ts` passes it to both `createStepUp` calls (the dev and the production session) and to `createStateSigner` (O8 M3's org-state signing: its summary and text are the signer's, so the weekly re-sign and a revocation show their words). Rejected: an in-app sheet in the renderer (a security confirmation that must show even when no page is loaded, and a second surface to keep in step with main's words; A7 asks the owner whether the native sheet's look is acceptable).

*The `machine` executor on RL2.* `session.acquire` is a `machine` act (O3-D's ledger, §L), the first act O7 sends to that executor, so M2 adds `machine` to org-protocol's `Executor` and `FROM_DEVICE.query`, behind the capability `rl2.executor.machine` (§M): the endpoint lists it in `h2`, the device in `h1`, and the link refuses an act for an executor the peer did not list, locally, `refused {reason: 'not-offered'}`, since the peer would close the channel on the query it would later need. `RL2_PROTOCOL.minor` moves to 1 at this landing (master's plus one). Rejected: waiting for M4 (a released remote session could not be resumed by a send in M2).

*The e2e scene* (§Q; the tracker row "No e2e group drives main's RL2 link in the built app"). Profile B is a private `mawsd` as `e2e:machines` starts one, with `MAWS_ENDPOINT_DIRECT=1`, a fake tailnet interface table (`src/mawsd/process-endpoint.test.ts`'s `--require` pattern, through `NODE_OPTIONS`), enrolled in a local org (`e2e/support/local-org.ts`'s `startLocalOrg().enroll`) and the records seam below; profile A is the app under test, signed in through `MAWS_DEV_ORG`, whose directory the scene writes from A's own device keys (`loadDeviceKeys` with `excludeFromBackup` stubbed) listed in the org by the local hub's admin, with a `directMap` from B's advertised tailnet address to its loopback port. The relay is the local hub; the direct carrier is the mapped address. B's session runs the replay engine with `e2e:c7`'s fixtures (sends, a permission, a question), started over B's `machine.sock` by the spec. Two things are dev-only: `directMap` in `session.json`, honoured by `dev-session.ts` only in an unpackaged build, and the records seam `MAWS_E2E_LANE_B_OWNER=<member>`, which `src/mawsd/endpoint-seam.ts` turns into an `authorization.records` source answering `{owners: [member], access: 'listed', shares: []}` for every lane B session the spine knows, only under `MAWS_E2E=1` (the pattern of the e2e seams refused outside it). In production lane B records come from sminos's member frames through O12's lane B observer, which M7's live runs need on the mini and the VM (open question A11). Rejected: a fake endpoint in the spec's process in place of B's `mawsd` (it proves the app, not the machine, and M7's live run is the only other end-to-end), and a sminos fake over RL10 in the e2e (its harness is vitest's).

*What `connectShell` does for an RL2 machine* is unchanged: no snapshot (O8 M2 skips listed machines), rows from listings; the inferred race where `machines.changed` precedes `org.rows` and the five reads fail softly is harmless (each store starts empty and the rows load after) and is not changed here.

**Does not touch.** `git.*`, `files.*`, `scm.*`, `pty.*`, uploads, `session.launch` and the machine picker (M3, M4); attention beyond a subscribed session, search across machines (M6); the client port over RL2, artifacts, documents (M5); the link's carriers, acts and subscriptions beyond `peerCapabilities()` and the executor check; O8's rows code and `org.*`; the engine host, the pty host, `src/services/` (the `session.get` and `session.acquire` handlers exist); any `WIRE_MINOR` bump (nothing on the manifest changes: `remote.*` is main-owned).

**Proves.** Acceptance 2's conversation half (stream, send, steer, interrupt, approve and deny, answer a question, take an image), 5, 8, 10 and 11.
- **`src/main/lane-b/*.test.ts`** (fakes; no network): the tabs-to-subscriptions rule with the linger; each part's event and the batching of `ev`s; `remote.gap` at a later `snapshot`, a `missing` and an `omitted` body; the record's retry; the act's context and digest; send serialization; every outcome's mapping, A4's copy included; the capability overlay and `remote.session` at each change; the substitutes for `attention.request` and `engine.models`.
- **`src/main/device/step-up-sheet.test.ts`**: the sheet shows the full text before any Touch ID; Cancel never prompts; Continue prompts with the summary; the state signer takes the same confirmation.
- **`test/lane-b/remote.test.ts`** (`node-timing`; the endpoint harness with `FakeEngineHost`, the link with the profile's real keys, the adapter through `routeLaneB`, as `test/lane-a/remote.test.ts` is built): the pane's opening reads and the stream, with every event's `(launchId, seq, idx)` checked against the fake host; a send that runs once across a forced drop; an answer whose digest the host checks; an interrupt that does not wait behind a queued send; `session.acquire` as a `machine` act, refused locally `not-offered` against a harness endpoint that lists no `rl2.executor.machine`; a relaunch's `snapshot` and a lost range's `missing` each producing one `remote.gap`; two devices on one session, an answer from one settling the other's `pendingItems` (acceptance 5); the 60 s hold ending `host_unavailable` with A4's words; a `removed` close ending the stream and greying.
- **`e2e:remote`** (`e2e/remote.spec.ts`, §Q): from A, B's listed row opens; the transcript streams the replay's deltas; a send appears in B's transcript (read over B's `machine.sock`); a permission card from the fixture answers; the hover reads "via the hub", then "direct (tailnet)" after the map and a probe; the machine's link `up` on each carrier in `machines.list`. No wall-clock bound beyond Playwright's own timeouts; the measured numbers are M7's.
- Renderer unit tests (vitest's display project): the gap bar from both sources; the hover's three texts; the controls overlay's reasons; one row per address.

### M4 — Diff, files, uploads and spawn anywhere

The panel's diff, file tree and editor work for a remote session through that machine's checkout services (O3-E's `git.*`, `scm.*`, `files.*` in `mawsd`); a dropped file lands in the session's attachments directory on its machine before the message goes; and "+ Session" gains the machine menu (A5), so a lane B session starts on the mini or the VM with the sheet and Touch ID.

**At its end.**
- In a remote session's pane the Files tool lists and watches the checkout, the viewer opens a file and the editor saves it; the git status and diff follow the checkout's changes; the SCM tool stages, commits, pushes and opens a pull request; the review tool holds diffs. Reveal in Finder and Open externally are greyed with "on `<machine>`" (they would open on the machine, not here; M5 routes them if a reader appears).
- A file dropped into a remote session's composer uploads to `<working directory>/.claude/desk-uploads/<appSessionId>/` on the machine, with a progress mark on the chip, and the message carries the machine's path as a mention; a 32 MiB PDF arrives whole. Images still go inline when they fit (M2); a larger image uploads like a file.
- "+ Session" shows a machine menu beside the project picker, defaulting to this Mac and listing the machines where the project has a checkout; one line under it reads "Lane B on `<machine>` · `<machine>`'s inference route". Send asks Touch ID at the sheet (a spawn always needs step-up) and the new session is in the sidebar under its machine within 5 s of the engine's first event, open in the pane.
- The requester is recorded on the session for O12's observer to claim as its owner.

**Touches.**
- New: `src/services/sessions/launch.ts` (`session.launch`'s handler), `src/renderer/src/composer/frame/MachineMenu.tsx`, `src/renderer/src/composer/editor/remote-uploads.ts`, tests; `test/endpoint/checkout-rule.test.ts`.
- Changed: `src/endpoint/offers.ts` (§L's M4 rows), `src/endpoint/targets.ts` and `authorize.ts` (the `checkout` target rule), `apps/org-protocol/src/messages.ts` (`call.session?`, behind `rl2.call-session`), `src/main/machines/remote/link.ts` (`call` takes an optional `session`), `src/main/machines/remote/dispatch.ts` (a path-only command of an RL2 machine carries the session the renderer named), `src/main/lane-b/remote.ts` (the M4 acts; uploads in parts; `session.launch`), `src/shared/ipc/schema/session.ts` (`session.launch`; `SessionRecordSchema.launchedBy`), `src/shared/ipc/schema/files.ts` (`files.upload`'s `part`), `src/shared/ipc/grades/session.ts` (`session.launch` is already `spawn`), `src/services/files/upload.ts` (parts), `src/services/machine-ops.ts` (nothing: `session.launch` is claimable by its grade), `src/shared/ipc/wire.ts` (`WIRE_MINOR`), `src/shared/ipc/routes.ts` (`session.launch` addressed by machine), the renderer: `composer/editor/controller.ts` and `paste.ts` (a drop on a remote session), `sessions/connect.ts` and `keymap/actions-runtime.ts` (the machine menu's flow), `composer/frame/ProjectRow.tsx`, `tools/code/**` and `tools/scm/**` (the `{machine}` and `session` each path-only call carries; the greyed reveal and open), `stores/git.ts`, `sessions/useSetupIntent.ts`.

**Interfaces.** Produces §L's M4 rows, §M's `call.session`, §O's `session.launch`, `files.upload` parts and `launchedBy`. Consumes §J, O3-E's `files.upload` and `files.read`, O3-D's `session.get`, the endpoint's `spawnRefusal` and `SPAWN_FIELDS` (`src/endpoint/policy.ts`), `machine.op` (`src/services/machine-ops.ts`).

**Decisions.**

*The checkout rule* (O10 left `git.*` and `fs.holders` "until O7 gives them a session or checkout rule"). `scm.*` and `files.*` name their session (`appSessionId`), so the `appSessionId` rule applies as it does to lane B's conversation, the endpoint reading the session's rank through `session.status` as today. `git.*`'s reads take `directory` or `repoRoot`, `fs.readSpill` and `fs.agentEvents` a path, so for them `call` gains an optional `session: SessionRef` (§M, additive, behind `rl2.call-session`) and the row's target rule is `checkout`: the endpoint resolves the session from `call.session` as it resolves a subscription's, takes the rank from it, reads the record with `dispatch('machine', 'session.get', {appSessionId})` and admits the call only when the input's `directory`, `repoRoot` or `path`, realpathed, is one of the record's roots (`directory`, each of `additionalDirectories`, `worktree.path`) or lies under one; else `no-target`. The renderer already passes `{machine}` for these; the client now passes the session it is in too (`src/renderer/src/ipc/client.ts`'s path-class rule gains a `session` option the panel tools fill from their session). Rejected: an `appSessionId` added to every git input (a wire change to every caller for one consumer), and grading the reads at the machine level (`view` on any session would open every checkout).

*Writes are acts under the services' ledger.* `files.write`, `files.upload`, `scm.stage`, `unstage`, `discard`, `commit`, `push`, `pr.create` and `remote.cancel` are `machine` acts the adapter builds with the session's context (the `appSessionId` rule); their `done.result` is the command's output. `git.worktree.add`, `remove` and `deleteBranch` are not offered: a worktree for a new session is `session.launch`'s, and a remote cleanup waits for a reader. `files.reveal` and `files.openExternal` are not offered (they act on the asking client through the client port, M5's).

*Uploads in parts.* The channel's message limit is 4 MiB (`MESSAGE_MAX_BYTES`) and an upload may be 32 MiB (`UPLOAD_FILE_MAX_BYTES`), so `files.upload` gains an optional `part: {upload, index, last}` (§O): a call with `part` carries one file's part of at most `REMOTE_UPLOAD_PART_BYTES` (2 MiB decoded), the service stages `<root>/.staging/<upload>` (0600, created exclusively at index 0), appends a part only at its expected index (else `{status: 'refused', reason}`), bounds the whole at 32 MiB, and at `last` moves it to its final `<uploadId>.<n>.<ext>` name and answers its path (a part before the last answers `paths: []`); staging older than a day is swept with the roots. Each part is its own `machine.op` claim, so a reseal after a lost channel answers the stored result and writes nothing twice. The adapter runs one upload at a time per session, parts in order, and the composer's chip shows the part count. A local upload (the renderer on its own machine) keeps the one-call form. Rejected: M3's byte streams for uploads (M4 would then wait on M3), and bounding remote uploads at one message.

*What a drop sends.* On a remote session, `classifyFile`'s three outcomes become: an image that fits inline (its act under 4 MiB) goes inline as in M2; any other file, a larger image or a PDF included, uploads and is mentioned by the machine's path, relative to the session's working directory as a local path mention is. The engine reads images and PDFs by path.

*`session.launch`* (§O; O10's `session.launch` row, P5's "lane B spawn (constructing a launch spec)"). A new `machine`-owned command, graded `spawn`, whose input is exactly DX6's spawn fields (`checkout`, `worktree?`, `brief?`, `model?`, `effort?`, `permission_mode?`) so the endpoint's `spawnRefusal` applies as it does to `sminos.spawn` (the ceiling, a known checkout, no other field). Its handler in the spine composes what the renderer does today: `session.create` with the project of `checkout` (a project row whose directory is the checkout) and the location (`directory`, or a new worktree named `worktree` on a new branch of that name from HEAD), `session.intent.patch` with the model, effort and permission mode, and `session.start` with the brief as the first message, on the machine's own settings (the route, the launch profile); it answers `{appSessionId}` once the start is `launching`. A checkout the machine lists but has not trusted answers `{status: 'refused', reason: 'untrusted'}` ("trust it on `<machine>` first"). It is claimed by `machine.op` like any `machine` act, so a replayed spawn answers the first one's id. The claim's member and device are recorded on the intent and the record as `launchedBy: {member, device, opId}` (an additive optional field of `SessionRecordSchema`), the handoff P5 §7 and RL §5.8 need: O12's lane B observer reads it and sminos claims the requester as the session's owner, with the spawn action as its proof; until O12 reads it, the session's owners are the machine's (today's rule), which for an org of one is the same person. Rejected: `session.create` + `intent.patch` + `start` as three acts (an intent has no engine session, so the `appSessionId` rule can't place the second and third), and a MAWS-shaped input (`spawnRefusal` would refuse every field).

*The machine menu* (A5, P5 Decision Log 108). `session.projects.list` is offered as a `list` call with the `machine` target (§L), and the composer's project chip lists, for the focused org project, this Mac and each `up` RL2 machine whose projects answer a row of the same org project id (`OrgProject.id`, O6's key), by name; the line under it names the lane and the route. Choosing another machine makes Send build `session.launch` through the adapter (`stepUp: 'required'`) instead of the local create-and-start; the New chat tab stays local until the launch answers, then the tab moves to the address the answer names and M2's pane takes over. A spawn with a dropped file uploads after the launch answers, to the new session. The route's name comes from the machine's `daemon.status` when its remote form carries one, else the line reads "`<machine>`'s inference route" (the executor reads `remoteDaemonStatus`).

*`WIRE_MINOR`.* `session.launch`, `files.upload`'s `part` and `launchedBy` are additive: one bump, to master's minor plus one at landing (13 if nothing lands first), `e2e:cross-build` on the merge tree.

**Does not touch.** Terminals and forwarding (M3); attention and search (M6); artifacts, documents, reveal and open on the client (M5); O12's observer and sminos; the files service's read rules (O3-E's); the local New chat flow for this Mac.

**Proves.** Acceptance 2's diff and file items, 4.
- **`test/endpoint/checkout-rule.test.ts`**: a `git.status` with a `call.session` the caller views and a directory under its worktree answers; one outside the roots is `no-target`; one with no `session` is `no-target`; a `fs.readSpill` path under `directory` answers; `files.upload` with parts out of order refused; `session.launch` with a field outside `SPAWN_FIELDS` refused `spec-field`, over the ceiling `ceiling`, on an unlisted checkout `unknown-checkout`.
- **`src/services/sessions/launch.test.ts`**: the composed launch on the spine root (`src/services/spine-root.test.ts`'s pattern): a session created, patched and started on the machine's settings; `launchedBy` on the record; an untrusted checkout refused; a replayed `machine.op` answering the first id.
- **`src/services/files/upload.test.ts`**, extended: parts staged, appended in order, moved at `last`, bounded at 32 MiB, swept.
- **`test/lane-b/remote.test.ts`**, extended: an upload of 5 MiB in three parts across a forced drop writing once; `files.write` as a `machine` act; `session.launch` with the sheet's injected confirmation, the new session streaming in the same test.
- **`e2e:remote`**, extended: the Files tool lists B's checkout and the editor saves a file there (read back over B's `machine.sock`); the SCM tool commits; a dropped text file appears under B's `desk-uploads` and the message mentions its path; "+ Session" on B starts a session that opens in the pane.

### M3 — Remote terminals and port forwarding

The panel's terminal for a remote session is a shell in that machine's worktree from its pty host; a `localhost` link in a remote session opens in the in-app browser through a port forwarded over the link (A6). Both ride one new RL2 facility, byte streams, which M5's artifact proxy and document frames reuse.

**At its end.**
- In a remote session's pane, the Terminal tool opens a shell in the session's worktree on its machine; typing, resizing, ⌘-click on links and the tab's exit state work as locally; a reload of the app re-attaches to the same shell and shows the ring's tail; closing the tab kills nothing (the shell lives with the machine until killed, as locally).
- A `localhost:<port>`, `127.0.0.1:<port>` or `0.0.0.0:<port>` link in a remote session's transcript or terminal opens in the in-app browser, its tab marked "forwarded from `<machine>`", without asking; the page loads from the machine's own loopback through the link. A port nothing listens on shows the browser's connection error.
- A non-owner with a `shell` grant sees the sheet and Touch ID once per shell or forward; the owner sees neither.
- The tracker row "`hostReady` reads the local pty host even for another machine's terminal" closes: a remote terminal's readiness is its machine's link.

**Touches.**
- New: `src/pty-host/ops.ts` (`pty.op`, `pty.opQuery` over `src/shared/host/op-ledger.ts`), `src/endpoint/streams.ts` (the stream table and its planes: pty and tcp), `src/endpoint/forwards.ts` (the endpoint's forward table), `src/main/machines/remote/streams.ts` (the link's half), `src/main/lane-b/remote-pty.ts` and `remote-forward.ts` (the adapter's halves), `src/main/forwards.ts` (the local listeners), tests; `test/endpoint/streams.test.ts`.
- Changed: `apps/org-protocol/src/messages.ts` (`Executor` gains `pty-host`; the stream kinds, §M, behind `rl2.streams` and `rl2.executor.pty-host`), `src/endpoint/offers.ts` (§L's M3 rows), `actions.ts` and `queries.ts` (the `pty-host` executor branch, as `machine`'s), `endpoint-actions.ts` (`forward.open` as a graded own action), `authorize.ts` and `gate.ts` (the `stream` request kind), `endpoint.ts` (`onFrame` subscribed; the capabilities), `src/shared/ipc/schema/pty.ts` (`pty.op`, `pty.opQuery`; `WIRE_MINOR`), `src/shared/ipc/schema/remote.ts` (`remote.forward.open`, `.close`), `src/main/machines/remote/link.ts` (`openStream`), `src/main/lane-b/remote.ts` (the pty acts and the forward act), `src/main/index.ts` (the forwards' listeners closed at shutdown), the renderer: `terminal/registry.ts` (`pty.list` per machine; `pty.ack` and `pty.checkpoint` for a remote pty stay in the adapter), `tools/terminal/index.ts` (`hostReady` by machine), `transcript/view/markdown/Link.tsx`, `pty-links` and the browser tool (the forwarded tab and its mark), `src/main/pty-links.ts` and `open-external.ts` (a loopback link of a remote session is a forward).

**Interfaces.** Produces §L's M3 rows, §M's streams and `pty-host`, §N (streams on the link and the endpoint), §O's `pty.op` and `remote.forward.*`. Consumes §J, O2's pty host (`pty.attach {credit: false}`, the ring, `onFrame`), the endpoint's own ledger (`src/endpoint/endpoint-actions.ts`), the gate's query path for a binding (`src/endpoint/queries.ts`).

**Decisions.**

*Acts, then streams.* Every `pty.*` command is `shell` (OX9), so a call is `act-required` (O10's rule, kept: no `authorize.ts` change admits a `shell` call). The discrete ones are acts under a ledger the pty host keeps (`pty.op`, `pty.opQuery`, §O, mirroring `src/engine-host/ops.ts`): `pty.spawn`, `pty.attach`, `pty.kill` and `pty.list`; the endpoint's `actions.ts` gains a `pty-host` branch beside `machine`'s, dispatching `pty.op` with the claim, and `queries.ts` routes `pty-host` to `pty.opQuery`. `pty.attach` and `pty.list` are reads claimed under an opId: a replayed attach answers the stored replay, whose offsets are absolute, so the device's offset dedup makes it harmless. The bytes (`pty.write`, `pty.data`, `pty.resize`, `pty.ack`) are not acts: they go over a stream (§N) opened under the act that authorized the pty. Rejected: `pty.write` as an act (a keystroke is not an operation; a fsynced claim per key), and admitting `shell` calls (a change to O10's decision order for two reads).

*Streams* (§N; RL §4.8). A stream is opened by the device under an act it sent on this channel: `streamOpen {id, kind, op, …}` names the act's `opId`, and the endpoint admits it when that executor's ledger answers `done` with a binding of this channel's member and device and a name the kind allows (`pty.spawn` or `pty.attach` for `pty`, `forward.open` for `tcp`), the pty or forward named being the one the act's result names; the authorization is the query path's, so step-up and the grade were decided at the act. Data goes as `streamData {id, offset, data}` in chunks of at most `STREAM_CHUNK_BYTES` (64 KiB, base64 in JSON), each direction under the other side's credit (`streamCredit`, granted at open and refunded as bytes are taken, at most 4 MiB), with `streamControl` for a pty's resize and `streamClose {reason}` from either side. A stream dies with its channel; the device reopens on the next channel from its offsets. Rejected: a binary plaintext kind now (a change to the sealing layer and `Channel`, O10's package, for a 33 % saving on terminal output; M7 measures, and a binary kind stays the named follow-up if the forward's throughput needs it).

*The pty stream.* Output: the endpoint subscribes to `onFrame` and forwards each `pty.data` frame of a streamed pty as `streamData` at the frame's `offset`, under the device's credit; frames past the credit are held up to `STREAM_BACKLOG_BYTES` (512 KiB, the ring's size) and then the stream is closed `behind`: the device reopens with `from: <its last offset>` through a new `pty.attach` act and the ring's replay fills the gap, or, if the ring moved past it, the terminal draws "[output lost]" as a reload's lossy restore does. The pty's own flow control is untouched: `mawsd` holds the credit when no app is attached (it acks every frame) and the attached app holds it otherwise, so a slow remote viewer never pauses the pty for a local one. Input: the device's keystrokes go as `streamData` with the device's own byte offset per pty, the endpoint writes them through `pty.write` and remembers the last offset it wrote per `(device, ptyId)` for the resume window, dropping a repeat after a reopen (RL §4.8's dedup). Resize is a `streamControl {resize: {cols, rows}}`, applied through `pty.resize`. The renderer's `pty.ack` becomes the stream's credit refund and `pty.checkpoint` is kept in the adapter's memory per pty for the app's life (`mawsd` refuses the endpoint's; O2's seam): a reload within the app restores exactly; a new app run restores from the ring's tail (A9).

*The terminal's machine.* `pty.spawn` goes to the session's machine already (PtyId is addressed); `pty.list` is sent with no machine today and becomes per machine (the registry asks each machine whose sessions it has tabs for; for an RL2 machine it is a `pty.list` act whose answer the adapter filters to this device's sessions); `pty.hostState` for an RL2 machine is answered by the adapter from the link's state (`up` is ready), which closes the tracker row. `pty.foreground` and `pty.openLink` are not offered: the remote tab's title is its label, and ⌘-click opens through main as any link.

*Forwarding* (A6, P5 Decision Log 108; §O). `remote.forward.open {machine, port}` (main-owned, renderer to main) opens a listener on `127.0.0.1:0` in main, runs the act `forward.open {port}` on the link (the endpoint's own executor, graded `shell`, target the machine, claimed in the endpoint's `ops.jsonl`; its result `{forward, port}`), and answers `{localPort}`; each accepted connection opens a `tcp` stream naming the forward, which the endpoint connects to `127.0.0.1:<port>` on the machine, bytes both ways under credit, a connect failure answering `streamRefused {reason: 'unreachable'}` and the local socket reset. A listener lives until `remote.forward.close`, the link's close or quit; a forward dies with its channel and is re-opened by a fresh act on the next (the listener stays, so the browser's retry works). Where a link is clicked: `Link.tsx` and `pty-links` route a loopback URL of a remote session to the browser tool with `{forward: {machine, port}}` instead of `layout.openExternal`; the browser tool asks `remote.forward.open`, loads `http://127.0.0.1:<localPort><path>` and marks the tab "forwarded from `<machine>`" beside its title. The grade is `shell` (P5 Decision Log 92's item 13). Rejected: a forward as a `machine` command with sockets in `mawsd`'s core (the bytes would cross the seam twice).

*`WIRE_MINOR`.* `pty.op` and `pty.opQuery` are additive: one bump at landing to master's minor plus one, `e2e:cross-build` on the merge tree. `RL2_PROTOCOL.minor` moves likewise.

**Does not touch.** The pty host's table, flow control and ring; `mawsd`'s credit rule and relay; documents and the artifact proxy (M5 reuses §N); the local terminal's path.

**Proves.** Acceptance 2's terminal item, §5's port forwarding.
- **`src/pty-host/ops.test.ts`**: a claimed spawn runs once and a replay answers the stored result; `opQuery`'s states; the ledger's file under the pty host's directory.
- **`test/endpoint/streams.test.ts`**: a `streamOpen` under a foreign opId refused `grade`; one under a `pty.attach` of another pty refused; output under credit, held past it, closed `behind` at the backlog; an input repeat after a reopen dropped; a `tcp` stream to a listening port carrying an HTTP round trip, one to a closed port `unreachable`; a stream ending with its channel.
- **`test/lane-b/remote.test.ts`**, extended: a shell spawned on the harness's pty host (the endpoint harness gains a fake pty host that emits frames), typed into and read back across a forced drop with nothing repeated; a reload (a new registry) re-attaching from the ring; a forward whose local listener serves a fetch through the link.
- **`e2e:remote`**, extended: a terminal in B's worktree runs `pwd` and shows the worktree; a dev server started in that terminal (`python3 -m http.server`) is opened from its `localhost` link in the in-app browser with the mark.

### M6 — Attention and search across machines

Overview and attention span machines (P5 §8): the dock badge, Needs you and ⌘⇧J count and open every reachable session's items on every machine, and conversation search spans them.

**At its end.**
- A permission raised on the mini with no tab open shows in Needs you under its listed row, counts in the dock badge, and ⌘⇧J opens it in M2's pane; answering it there, or on the mini, clears it everywhere within one round trip. A machine offline greys its items and keeps their count out of the badge.
- A notification is raised for a remote item as for a local one, once per item across the app's windows (A8).
- The sidebar's search answers from every `up` machine, each hit under its machine.

**Touches.**
- New: `src/endpoint/plane-feeds.ts` (the `attention` feed), `src/main/lane-b/remote-attention.ts` (one feed per link), tests.
- Changed: `apps/org-protocol/src/messages.ts` (`sub.feed?`, behind `rl2.feeds`), `src/endpoint/offers.ts` (§L's M6 rows), `targets.ts`, `authorize.ts` and `calls.ts` (the `each-session` target rule and its filters), `subscriptions.ts` (a feed subscription's plane), `src/main/machines/remote/subs.ts` (a feed request), `src/shared/ipc/schema/remote.ts` (`remote.attention`), `src/main/attention/notifier.ts` (the remote counts and notifications), the renderer: `attention/derive.ts` (a listed row counts), `stores/attention.ts` (a remote snapshot), the search surface (per-machine queries merged).

**Interfaces.** Produces §L's M6 rows, §M's `feed`, §R. Consumes §J, O3-D's `attention.list` and `attention.changed` on `onEvent`, O8 M2's listed rows.

**Decisions.**

*The `each-session` rule.* `attention.list` and `session.search` answer per session for the whole machine; neither names a target. A new `TargetRule`, `each-session`, admits the call for any member at `list` (as `endpoint.listings` is admitted) and has `calls.ts` filter the answer to the sessions the caller holds the row's grade on (`view`): `attention.list`'s items by `appSessionId`, `session.search`'s hits likewise. Rejected: a rank-filtered `session.list` (C5's refused alternative; listings are the rows), and offering `attention.list` at `list` unfiltered (it carries every session's requests).

*The feed.* `sub` gains an optional `feed: 'attention'` (§M; `session` absent with it), behind `rl2.feeds`, and the endpoint streams it from `onEvent`'s `attention.changed` (owner `machine`): every opening is a `snapshot` whose `snap` is the filtered `attention.list`, then each change of a session the member views goes as `ev {body: {appSessionId, items}}` at a rising `seq` under the epoch `attention:<endpoint boot id>`; it is re-authorized at every record change and new head as other subscriptions are. Main opens one feed per RL2 link while the link is `up` and emits `remote.attention {machine, items}` at each snapshot and `attention.changed` for the machine at each event; the renderer applies the snapshot to the machine's partition as `connectShell` applies a local one. Rejected: `cards` subscriptions per listed session (one per session against a cap of 64).

*Counting without a record.* `needsYou` requires a record; for an RL2 machine a listed row stands in, so an item of a session with no open tab is drawn under its listed row. The badge: `updateBadge` adds the remote feeds' pending counts to `allAttention()`'s. Notifications: the notifier raises one for a remote item as for a local one, keyed by the item's address; a click opens the session through M2's opener (A8 is the owner's call; built as recommended).

*Search.* `session.search` is offered with the `each-session` rule; the renderer's search sends the query to this Mac and each `up` RL2 machine (`{machine}`) and merges the hits under their machines; a machine that answers `host_unavailable` is left out with no error.

**Does not touch.** The attention core, the notifier's local path, the phone's pushes (O13), the project channel (O8 M7, which consumes M2's cards and this feed).

**Proves.** Acceptance 9.
- **`test/endpoint/feeds.test.ts`**: the feed's snapshot filtered to the member's sessions; a change on a session the member can't view not delivered; the snapshot again after a resubscribe; a record change ending the feed `removed` for a member who lost `view`; `session.search`'s hits filtered.
- **`test/lane-b/remote.test.ts`**, extended: a request raised on the harness with no tab reaching `remote.attention`; an answer from a second device clearing it.
- **`e2e:remote`**, extended: a permission from the fixture with B's tab closed shows in Needs you and the badge (`app.dock` read through the harness), ⌘⇧J opens it, answering clears both; search finds a word of B's transcript.

### M5 — Artifacts, documents and the client-bound surfaces *(advisory; built when O4 and O5 land)*

A remote session's artifacts open and edit; the client-bound tools reach the attached app over the link; O4's and O5's capabilities light up from the capability lists. It stays advisory because three of its inputs are other children's, named here so their planners build to them.

**What it adds.** Artifact pages through the daemon's HTTP artifact endpoint (O5), proxied over a §N stream of kind `http`; documents as Yjs updates over §N streams of kind `document` on the endpoint's channel range (`EndpointServices.documents`, O2's seam); the client port across the channel: the endpoint mints a `ClientRef` per channel (`<device>/<channel>`), passes it to `dispatch`, and the front routes that ref's `clientPort.request` back through a new seam member (`EndpointServices.clientPort.onRequest`/`answer`, changed in `DaemonServices` and `EndpointServices` together), which the endpoint carries as RL2 `client {id, kind, request}` / `clientAnswer {id, answer}` behind `rl2.client-port`, so `pick`, `save`, `confirm`, `reveal`, `openExternal` and `notify` from a remote session's agent reach the app that asked, and O4's consent flows open there; `show_pane` (the engine-host event `maws.pane.show`) rides the same path. Offer rows: `artifacts.*` reads (`view`) and edits (`manage`, `machine` acts once O5 moves them), `library.read` and `library.*` reads once O4 moves the library's files, `files.reveal` and `files.openExternal` (now reaching the asking client).

**Needs, by name.**
- *From O5:* the artifact HTTP endpoint reachable in-process from `mawsd` (its socket or token), so the endpoint can proxy a request over a stream without a second credential; the capability entries `artifact_screenshot` and `artifact_export` in a session's catalog or capabilities, so the pane lights them; U3's outcome for the agent's browser on a remote session, and, if it is a screencast, its frame format, which M5 carries as a stream kind.
- *From O4:* capability entries for connectors, Send to and the library on a session; consent opened on the asking client through the client port (above); the library's files in `mawsd` behind `machine`-owned reads.
- *From O3X6 (the front):* the seam member for a non-socket client's port requests (above), which is `mawsd`'s and the desk track's together.

**Acceptance mapping.** Item 2's artifact open and edit (screenshot and export are O5's), item 6.

### M7 — Acceptance and the remote bench

Everything above is run from the MacBook against the mini and the Linux VM, and the bench of OX7 gains a remote mode that measures item 3's numbers on each carrier.

**At its end.**
- Acceptance 2, 4, 5, 8, 9, 10 and 11 hold live, recorded in Outcomes with the owner's sitting notes.
- `e2e:remote-latency`, a measured group, reports on the mini, for the direct and the relay carrier, remote delta-to-paint, command round trip, open-to-first-row and resume after a drop, each within item 3's bound against the same run's local numbers.
- The live bench from the MacBook against a scratch machine on the mini and one on the VM records the same numbers over the real tailnet, with the clock offset's estimate and spread.
- P5 acceptance 7's app half (M1's F8; not this document's item 7): after a sleep and wake, every remote subscription resumes within 1 s of the network returning (the link's probes), read from the link's log lines in the live sitting and from the forced-drop case of the measured group.

**Touches.** New: `e2e/remote-latency.spec.ts`, `test/support/remote-latency.ts`; changed: `package.json`, `.github/workflows/gate.yml` (`MEASURED_E2E`), this document's Outcomes.

**Decisions.**

*The measured group* (§S). `e2e:remote-latency` reuses `e2e:remote`'s scene with the latency stub engine (`test/support/latency-engine-stub.mjs`) on profile B and the local-latency measures (`e2e/local-latency.spec.ts`) taken through M2's pane: 3 turns of 300 deltas, the first discarded; 220 `session.getContextUsage` invokes; the time from the row's click to the first transcript row; a forced carrier drop and the time from its restore to the first event after the gap. It runs the local case first on the same tree, then direct, then relay, and records all three to `test-results/remote-latency.json` with the link's own round trip (the median of 100 `ping`/`pong` pairs) per carrier; the bounds are item 3's, each relative to the same run's local number and round trip. One machine, one clock, as the local bench. It is `MEASURED_E2E` only, on the mini under CI-opt's hold, on the architect's go; validity is Rule B's, read as the latency bench's is.

*The live bench.* The same spec in a `remote` mode against a real machine: a scratch profile's `mawsd` on the mini (`mini-bench`) and on the acceptance VM (`vm-bench`), each running the latency stub, enrolled through the owner's app with a code and revoked after (O9 M10's scratch-device pattern), so no production session is touched. Two clocks: the spec estimates the offset from at least 50 `ping {at}`/`pong {at}` exchanges at the run's start and end (the median half round trip against the endpoint's stamps) and reports delta-to-paint with the estimate's spread; a spread over 5 ms voids the run. It runs on the owner's go, from the MacBook, and never on the gate.

*The live sitting.* Acceptance 2 and the rest run by hand against the owner's real sessions, as O9 M10 did: the checklist is in Concrete Steps, each item ticked with its evidence in Outcomes. It needs the mini and the VM cut over (done), the MacBook signed in (O8 M1), lane B records on both machines (A11), and the tailnet listener reachable from the MacBook.

**Does not touch.** The product.

**Proves.** Item 3, P5 acceptance 7's app half, and the live run of items 2, 4, 5, 8, 9, 10 and 11.

### Concrete Steps

Run all steps from the milestone's worktree `W`, after `pnpm install --frozen-lockfile`.

    # iterate, one focused file at a time (this MacBook)
    npx vitest run --project node src/main/machines/remote/link.test.ts
    npx vitest run --project node src/main/machines/remote/acts.test.ts
    npx vitest run --project node src/main/machines/remote/subs.test.ts
    npx vitest run --project node src/main/machines/manager.test.ts
    npx vitest run --project node-timing test/machines/remote-link.test.ts         # real sockets; about 10 s
    npx vitest run --project node-timing test/machines/remote-link.local.test.ts    # Miniflare; about 5 s on this MacBook

    # lint the touched files, then the gates (never run the gates' commands locally)
    npx eslint src/main/machines src/main/org src/main/index.ts src/shared/ipc/schema/machines.ts test/machines
    cd /tmp && W/scripts/ci-gate.sh W --gates static,unit,probes --class1a pool
    cd /tmp && W/scripts/ci-gate.sh W --gates e2e:machines --runner macos --lane hosted    # the manager changed under O6's scene

Expected:
- Each vitest file ends `Test Files  1 passed`.
- In `remote-link.local.test.ts`, the carrier check logs a link `up` over `relay`, then over `direct` after the probe.
- `ci-gate` prints `GREEN <run-url>`.
- `e2e:machines` passes unchanged. Its two liveness bounds are wall-clock assertions that have flaked on a 3-core hosted Mac (P5 Decision Log 88), so a red there is rerun once before it is read as a regression.

The OX7 bench is not required: M1 changes neither the local link's path nor the router's local branch.
**M2 to M7** (added at the re-plan; each from its milestone's worktree `W` after `pnpm install --frozen-lockfile`).

    # M2: iterate
    npx vitest run --project node src/main/lane-b
    npx vitest run --project node src/main/device/step-up-sheet.test.ts
    npx vitest run --project node-timing test/lane-b/remote.test.ts           # real endpoint, fake engine host; about 15 s
    npx vitest run --project display src/renderer/src/lane-b src/renderer/src/transcript/view/GapRow.test.tsx
    npx eslint src/main/lane-b src/main/device src/endpoint src/renderer/src/lane-b test/lane-b e2e/remote.spec.ts e2e/support/remote-scene.ts
    cd /tmp && W/scripts/ci-gate.sh W --gates static,unit,probes --class1a pool --peer none
    cd /tmp && W/scripts/ci-gate.sh W --gates e2e:remote,e2e:machines,e2e:lane-a,e2e:c7,e2e:transcript,e2e:settings --runner macos --lane hosted --peer none

    # M4 and M3 (each its own branch): the same, plus
    npx vitest run --project node test/endpoint/checkout-rule.test.ts src/services/sessions/launch.test.ts src/services/files/upload.test.ts   # M4
    npx vitest run --project node src/pty-host/ops.test.ts test/endpoint/streams.test.ts                                                       # M3
    cd /tmp && W/scripts/ci-gate.sh W --gates static,unit,probes,e2e:cross-build --class1a pool            # the merge tree, since each bumps WIRE_MINOR
    cd /tmp && W/scripts/ci-gate.sh W --gates e2e:remote,e2e:code,e2e:scm,e2e:machines --runner macos --lane hosted --peer none   # M4
    cd /tmp && W/scripts/ci-gate.sh W --gates e2e:remote,e2e:terminal,e2e:browser,e2e:machines --runner macos --lane hosted --peer none   # M3

    # M6
    npx vitest run --project node test/endpoint/feeds.test.ts src/main/lane-b/remote-attention.test.ts
    cd /tmp && W/scripts/ci-gate.sh W --gates e2e:remote,e2e:to-human,e2e:machines --runner macos --lane hosted --peer none

    # M7: the measured group (CI-opt launches it on the mini, on the architect's go; never from this MacBook)
    cd /tmp && W/scripts/ci-gate.sh W --gates e2e:remote-latency --runner macos --peer none
    # expected in the run's artifact test-results/remote-latency.json: per carrier, deltaToFrame.p50 <= local.p50 + rtt.p50 + 10,
    # roundTrip.p50 <= 2 * rtt.p50 + 20, openToFirstRowMs <= 1500, resumeMs <= engineStartMs + rtt.p50; invalidReasons []

Expected: each vitest file ends `Test Files  1 passed`; `ci-gate` prints `GREEN <run-url>`; in `e2e:remote`'s log, A's link reads `up` over `relay`, then over `direct` after the map and a probe; `e2e:machines`' two liveness bounds are rerun once before a red is read as a regression (P5 Decision Log 88).

**M7's live runs** (the owner's go; from the MacBook, never a gate):

    # the bench, against a scratch machine (mini-bench, then vm-bench), enrolled from the owner's app with a code and revoked after
    MAWS_REMOTE_BENCH_MACHINE=<ref> pnpm e2e:remote-latency-live
    # reports test-results/remote-latency-live.json with the clock offset's estimate and spread; a spread over 5 ms voids the run

    # the sitting, against the owner's real sessions on the mini and the VM, each item ticked in Outcomes with its evidence:
    #   1. open a listed lane B session: history, then deltas         7. open and edit a file; the diff follows
    #   2. send, steer (Enter mid-turn), interrupt                     8. a terminal in the worktree; `pwd`
    #   3. approve and deny a permission; answer a question            9. a dev server's localhost link in the in-app browser, marked
    #   4. paste an image; drop a PDF (its path on the machine)       10. "+ Session" on the VM: the sheet, Touch ID, the row within 5 s
    #   5. two apps (the mini's own, the MacBook's) on one session    11. a permission with no tab: Needs you, the badge, ⌘⇧J
    #   6. the hover: "direct (tailnet)"; Wi-Fi off: "via the hub"   12. lid closed 2 min, opened: the stream resumes within 1 s of the network (the link's log)

### Interfaces and Dependencies

No new dependency. M1 uses `ws` 8.22.0 (in the tree), `org-protocol` (workspace) and zod 4.

**§A. The remote link** (`src/main/machines/remote/link.ts`; reached through `Machines.remote`). This is the interface O9 and every later consumer use by name. Nothing else opens a channel.

    import type { ActionContext, RequestDigest, Cursor, SessionRef, Executor, RefusalReason, CapsMessage, ByteDuplex, Channel, EndpointRecord, Signed } from 'org-protocol';
    import type { MachineRef } from '@shared/machine/ref';
    import type { OrgSession, SignedIn } from '../../org/session';
    import type { MachineLink } from '../manager';

    export type Carrier = 'direct' | 'relay';
    export type ProbeReason = 'wake' | 'unlock' | 'focus' | 'network' | 'person';
    export type DeviceCaps = Omit<CapsMessage, 't'>;                                  // RL7's device half: { member, device, clientClass, machine: { grades }, stateVersion }

    export interface RemoteLink extends MachineLink {
      readonly machine: MachineRef;                                                   // known from the org state at creation, never null
      readonly name: string;                                                          // the org state's name, updated on a rename
      carrier(): Carrier | null;                                                      // null while no channel is current
      refusal(): string | null;                                                       // the permanent verdict holding it `refused`, else null
      caps(): DeviceCaps | null;                                                      // the latest `caps`, null before the first
      onCaps(listener: (caps: DeviceCaps) => void): () => void;
      call(name: string, input: unknown, options?: { timeoutMs?: number }): Promise<CallResult>;
      act(request: ActRequest): ActHandle;
      subscribe(request: SubscribeRequest, sink: SubscriptionSink): Subscription;
      probe(reason: ProbeReason): void;                                               // `person`: a person acted on this machine (also lifts `refused`)
      // MachineLink.onState fires on a reported-state change, and also when the carrier or the refusal changes under the
      // same reported state (a relay-to-direct switch), so the manager re-emits machines.changed; neither is a new generation.
    }

    export type CallResult = { ok: true; output: unknown } | { ok: false; error: { code: RefusalReason | 'offline' | 'timeout' | string; message?: string } };

    export interface ActRequest {
      action: string;                         // an offered name: a registry command, 'sminos.<rpc>', 'endpoint.grant' | 'endpoint.state', O8's 'record.*'
      session?: string;                       // the bare target: lane B's appSessionId, lane A's engine session id (lane A also names it in args.session)
      context?: ActionContext;                // mandatory with `session` (RL4)
      args: unknown;
      requestDigest?: RequestDigest;
      stepUp?: 'required' | 'if-asked' | 'never';   // default 'if-asked'
      executor?: Executor;                    // default by name: 'sminos.' → 'sminos', 'endpoint.' → 'endpoint', else 'engine-host'
    }
    export type ActProgress = 'waiting' | 'sent' | 'accepted' | 'unknown';            // waiting: not yet on a channel; unknown: lost track, querying
    export type ActOutcome =
      | { state: 'done'; result: unknown }                                            // it ran
      | { state: 'failed'; error: unknown }                                           // it was tried and failed
      | { state: 'refused'; reason: RefusalReason | 'offline' | 'step-up-cancelled' | string }   // nothing ran (the endpoint's, the executor's or the link's word)
      | { state: 'not-sent' }                                                         // query said not-received: tombstoned; nothing ran or will
      | { state: 'unknown'; reason: 'expired' | 'grade' | 'class' | 'removed' | 'closed' | string };  // final, outcome unknown
    export interface ActHandle {
      readonly opId: string;
      readonly opCreated: string;
      progress(): ActProgress;
      onProgress(listener: (progress: ActProgress) => void): () => void;
      readonly outcome: Promise<ActOutcome>;                                          // never rejects
    }

    export interface SubscribeRequest { session: SessionRef; view?: 'full' | 'cards'; cursor?: Cursor | null }
    export interface SubscriptionSink {
      subbed(mode: 'replay' | 'snapshot' | 'missing', at: Cursor): void;              // a snapshot or missing starts the stream over from `at`
      snapshot(at: Cursor, value: unknown): void;                                     // one whole snapshot or replace-whole part, its pages joined and parsed
      event(at: Cursor, body: unknown): void;                                         // lane B: a SessionEvent (or { omitted: 'too-large', bytes }); lane A: one sminos plane message
      paused(reason: string): void;                                                   // the endpoint's ('no-app') or the link's ('offline')
      resumed(): void;
      ended(reason: string): void;                                                    // final; the link won't resume it
    }
    export interface Subscription {
      readonly id: string;                                                            // stable across channels; a lane A read names it in input.sub
      cursor(): Cursor | null;
      close(): void;                                                                  // sends unsub
    }

    export interface RemoteLinkDeps {
      machine: { ref: MachineRef; name: string };
      session: OrgSession;                                                            // read at every attempt
      records: EndpointRecords;                                                       // endpoint-records.ts
      dialDirect?(url: string, timeoutMs: number): Promise<ByteDuplex>;               // carriers.ts's by default; tests map the tailnet address to loopback
      openRelay?(url: string, headers: Record<string, string>): Promise<RelaySocket>; // carriers.ts's by default
      handshake?(dial: () => Promise<ByteDuplex>, signedIn: SignedIn, machine: MachineRef): Promise<Channel>;
                                                                                      // connectChannel(dial, signedIn.identity, signedIn.view, { machine }) by default;
                                                                                      // link.test.ts passes an in-memory Channel, so the state machine runs with no crypto
      timing?: Partial<RemoteTiming>;
      now?(): number;
      random?(): number;                                                              // the jitter, for tests
      log(line: string): void;
    }
    export function createRemoteLink(deps: RemoteLinkDeps): RemoteLink & { rename(name: string): void };   // the source renames on a head's rename

    // carriers.ts
    export function dialDirect(url: string, timeoutMs: number): Promise<ByteDuplex>; // one ws:// WebSocket, binary messages; rejects past timeoutMs
    export interface RelaySocket {                                                   // one app socket to the machine's object; at most MAX_CHANNELS_PER_SOCKET channels
      dial(): Promise<ByteDuplex>;                                                    // a new channel: its first send is the hub's `open [tag][payload]`
      onClose(listener: (reason: string) => void): void;                              // every channel on it has ended by then
      close(): void;
    }
    export function openRelaySocket(url: string, headers: Record<string, string>, timeoutMs?: number): Promise<RelaySocket>;  // rejects on a failed upgrade (RelayUpgradeError, its status)
    // Both carriers end every ByteDuplex as 'carrier' (CARRIER_CLOSED), whatever the socket or the relay said.

    // endpoint-records.ts
    export interface EndpointRecords {
      // The newest record for `ref` that verifies against `signedIn.view` now: fetched from the hub within RECORD_FETCH_MS when
      // it answers, else the cache (memory, then the file); null when neither holds one. A fetched record replaces the cached
      // one only when its `issued` is later.
      resolve(ref: MachineRef, signedIn: SignedIn): Promise<Signed<EndpointRecord> | null>;
    }
    export function createEndpointRecords(deps: { file: string; fetch?: typeof fetch; now?(): number; log(line: string): void }): EndpointRecords;

    // timing.ts: §G's table as one object; RemoteTiming is its type
    export const REMOTE_TIMING: RemoteTiming;

    // src/main/machines/index.ts
    export interface Machines {
      dispatch: RemoteDispatch;
      remote(machine: MachineRef): RemoteLink | null;                                 // the one link to that machine, or null when the org lists none
      onRemote(listener: (machines: readonly MachineRef[]) => void): () => void;      // the roster changed: links were created or closed
      serve(): void;
      stop(): Promise<void>;
    }

**§B. The org session** (`src/main/org/session.ts`). O7 M1 defines it. O8's sign-in implements it for production.

    import type { DeviceIdentity, OrgView } from 'org-protocol';
    import type { StepUpRequest, StepUpResult } from '../device/step-up';           // a type-only import: no Electron at runtime

    export interface OrgSession {
      current(): SignedIn | null;                                                     // null: signed out, or this profile's device not listed in the held state
      onChanged(listener: () => void): () => void;                                    // sign-in, sign-out, a new head adopted by any path (a link's handshake `advance`
                                                                                      // included), the hub's address or credentials changed
    }
    export interface SignedIn {
      identity: DeviceIdentity;                                                       // clientClass 'native-mac'; channelKey from loadDeviceKeys; build: main's build string; capabilities []
      view: OrgView;                                                                  // verified; its provider persists what `advance` adopts
      stepUp: { sign(request: StepUpRequest): Promise<StepUpResult> };                // createStepUp over the same keys file's step-up key
      hub: HubAccess | null;                                                          // null: no hub; the direct carrier only
    }
    export interface HubAccess {
      url: string;                                                                    // https://… in production; http://127.0.0.1:<port> in tests and dev runs
      headers(): Promise<Record<string, string>>;                                     // what an authenticated member's request to the hub carries (Access, or the local stand-in's)
    }
    export function signedOut(): OrgSession;

    // src/main/org/dev-session.ts (unpackaged builds only)
    export function createDevOrgSession(input: { dir: string; userData: string; packaged: boolean; build: string;
      stepUp: (keys: DeviceKeys, device: { org: string; device: string }) => SignedIn['stepUp'];   // main passes (keys, device) => createStepUp({ device, key: keys.stepUp })
      loadKeys?: typeof loadDeviceKeys;                                                            // tests inject one with excludeFromBackup stubbed
      log(line: string): void }): OrgSession & { loaded: Promise<void> };   // returns at once, signed out; signs in when its load succeeds (onChanged fires), else stays out with a log line; tests await `loaded`

**§C. The manager's second source** (`src/main/machines/manager.ts`, `src/main/machines/remote/source.ts`).

    export interface RemoteSource {
      machines(): readonly { ref: MachineRef; name: string }[];                       // the roster: the head's machines and live certificates, local and contested refs left out
      onChanged(listener: () => void): () => void;
      connect(machine: { ref: MachineRef; name: string }): MachineLink;               // a RemoteLink; the source keeps it for `link`
    }
    // ConnectionManagerDeps gains `remote?: RemoteSource`; every other field is unchanged.
    export function createRemoteSource(deps: { session: OrgSession; userData: string; local: MachineRef; log(line: string): void; now?(): number;
      networkPollMs?: number; interfaces?(): NodeJS.Dict<NetworkInterfaceInfo[]>;   // os.networkInterfaces by default; tests inject the watch
      linkDeps?: Partial<RemoteLinkDeps> }): RemoteSource & {
      link(machine: MachineRef): RemoteLink | null;
      probeAll(reason: ProbeReason): void;
      close(): void;
    };

**§D. `machines.*`** (`src/shared/ipc/schema/machines.ts`; main-owned, outside the wire manifest).

    // MachineStateSchema gains:
    carrier: z.enum(['socket', 'direct', 'relay']).optional(),   // while up
    refusal: z.string().optional(),                              // while a permanent verdict holds (an RL2 link `refused`)

**§E. Files.**
- `<userData>/endpoint-records.json` is the client's own: `{ "version": 1, "records": { "<ref>": Signed<EndpointRecord> } }`. It is 0600 and written through a temporary file and a rename. A file that doesn't read is logged and read as empty.
- `MAWS_DEV_ORG=<dir>` is honoured only in an unpackaged build. The directory holds:

      session.json  { "version": 1, "org": "<org id>", "member": "<member id>", "device": "<device id>",
                      "pins": { "roots": ["<key id>"], "recoveryPub": "<B64>" },
                      "hub": { "url": "http://127.0.0.1:<port>", "standinUser": "<email>" } | null }
      chain.json    { "chain": Signed<OrgState>[], "transitions": Signed<RootTransition>[], "certificates": Certificates }

  A harness makes it by loading the scratch profile's keys first (`loadDeviceKeys`), listing that device's `channelPub` and `stepUpPub` in the org through `OrgAdmin` or the org fixtures, and writing both files.

**§F. Refusals on the router path.** `{ ok: false, error: { code: 'internal', message: '<name>: refused <reason> by machine <name>', issues: { refusal: '<reason>' } } }`, with `offline` and `unavailable` → `host_unavailable`, `timeout` → `timeout`, and an `IPC_ERROR_CODES` member passed through.

**§G. Timing** (`src/main/machines/remote/timing.ts`; each a field of `RemoteTiming`, overridable in tests).

| Name | Value | From |
|---|---|---|
| `DIRECT_DIAL_MS` | 1000 | P5 §3's short timeout |
| `DIRECT_BUCKET` | burst 3, 5 a minute | `HANDSHAKE_LIMITS.perSource` |
| `DIRECT_RECHECK_MS` | 60 000 | — |
| `RECORD_FETCH_MS` | 2000 | — |
| `UP_GRACE_MS` | 2000 | — |
| `BACKOFF_MS` | 0, 1000, 2000, 4000, then 5000; ±20% | RL §4.6 |
| `RESUME_WINDOW_MS` | 120 000, then 30 000 between attempts | `RESUME_MS` |
| `PING_SILENCE_MS` | 5000–7000 | `PING_MS` |
| `PROBE_PONG_MS` | 2000 | — |
| `NETWORK_POLL_MS` | 2000 | — |
| `CALL_TIMEOUT_MS` | 10 000 | the socket link's |
| `ACT_FRESH_MS` | 60 000 | `FRESH_MS` |
| `ACK_TIMEOUT_MS` | 10 000 | — |
| `DONE_QUERY_MS` | 60 000 | — |
| `QUERY_BACKOFF_MS` | 1000, 2000, 4000, 8000, then 15 000 | — |
| `SUB_INITIAL_CREDIT` | 1 MiB | ≤ `SUB_CREDIT_MAX` |
| `CREDIT_BATCH` | 256 KiB or 250 ms | — |

**§H. Contract requests** (for P5's writer to carry into each child's decomposition). These say what O7 needs, not how to build it.

*To O3*, the services host and the spine:
- **C1. An app-less lane B event source.** The endpoint's `onEvent` must see every lane B session's events whether or not an app is attached, through O3's per-client subscriptions, so a remote viewer is never `paused {no-app}` (O10 M8, P5 Decision Log 29). Keep `historyUnavailable` (P5 Decision Log 77).
- **C2. The moved namespaces cross builds and name their target.** `git.*`, `files.*`, `scm.*`, drafts, `session.search` and `session.deletions.list` become `machine`-owned on the wire manifest. For each, O7 needs a way to bind a path to a session's checkout on the machine: the RL6 record (or `session.status`) carries the session's `cwd` and worktree, and the machine's checkouts are known to the endpoint's `CheckoutSource` with MAWS's projects added (O10 M5).
- **C3. Ledgers and an executor name for moved acts.** Every act-graded command that moves into `mawsd` keeps an op ledger (`src/shared/host/op-ledger.ts`, O10 M7), and O3 names the executor that RL4's `query` routes to. O7 adds that name to RL2's `query.executor` behind a capability (Constraints, "RL2's vocabulary").
- **C4. A machine-side spawn.** An entry point that starts a lane B session from a remote request: checkout, worktree choice, model, effort, permission mode and brief. It builds the launch spec from the machine's own settings (settings' machine half), writes the RL6 record with the requester as owner and the spawn action as its proof (RL §5.8), and keeps a ledger. O7 offers it and builds the picker. O10's ceiling and checkout rules apply at the endpoint.
- **C5. Per-member reads.** A remote caller is a member, not the machine's owner. O7 needs either listings as the only source of another machine's rows (P5 finding F5), or a `session.list`-shaped read filtered by the caller's rank. Drafts and reader state are kept per member, which is O8's rule (P5 Decision Log 36); O3's index must allow those keys.
- **C6. A per-member attention feed.** The attention core in `mawsd` exposes the items on sessions a member may `view`, as a stream the endpoint can serve as a machine-wide subscription. O7 defines that view on RL2.
- **C7. The client port across the channel.** The daemon's OX4 port routes a call to the client that asked, including a client attached over RL2 through the endpoint. Today a request with no local client answers `noClient`. O7 defines the RL2 messages. O3 defines which client asked, a `ClientRef` for a remote device.
- **C8. Uploads.** A `machine`-owned write into a session's attachments directory, bounded in size and kept under a ledger.
- **C9. Interest from remote viewers.** A remote device's lane B subscriptions count in OX5's union, which O10 M8 already reports through `interest.report`. O3's sweep, which replaces `layout.json`, reads that union, so a session someone is watching from another machine is not released as idle.
- **C10. Artifact ownership.** On the machine, an artifact id resolves to its session, so a remote read or edit is graded on that session.
- **Budget.** Whatever O3 adds to `mawsd` for C1–C10 counts against acceptance 14's bound (P5's Risks row).

*To O4.* Capability entries for connectors, Send to and the library on a session, so the app greys and lights them by capability. Consent flows opened on the client through C7.

*To O5.* The artifact HTTP endpoint and the render service's capability entries (screenshot, export). U3's outcome for the agent's browser on a remote session: if it is a screencast to the app, O7 carries the stream as an RL2 kind.

*To O8.*
- **The production `OrgSession`** (§B): Access's login transfer, device registration, the held org chain persisted with `advance`, and the hub's address and headers.
- **The remote-rows source** (P5 finding F5): OX8's verified listings, merged per machine into the stores, if O8 takes it.

*To O9.*
- Consume `Machines.remote(ref)` (§A) for remote lane A: `act('sminos.<rpc>', …)` with lane A's context, `subscribe({lane: 'A', id}, sink)`, and `call('sminos.rows', {session, sub: subscription.id, …})`.
- Build no channel. `boundary.test.ts` refuses one.
- Share the remote-rows source with O7, under whichever child P5 names.

**§I. Contract additions.**
- **Now (M1):**
  - `RemoteLink` and `Machines.remote` (§A);
  - `OrgSession` (§B);
  - `RemoteSource` (§C);
  - `MachineState.carrier` and `.refusal` (§D, no wire bump);
  - `endpoint-records.json` and `MAWS_DEV_ORG` (§E);
  - the router-path refusal mapping (§F);
  - the boundary test.

  M1 adds no `WIRE_MINOR` bump, no settings version, no offer-table row and no e2e group.
- **Later (advisory, each re-planned):**
  - Offer-table rows: lane B spawn (C4), `pty.*` and port forwarding (M3), documents and artifacts (M5), `git.*`, `files.*`, `scm.*`, `fs.holders`, uploads, `session.search`, `session.deletions.list` (M4), and the lane B panel reads (M2).
  - RL2 minor bumps with capabilities: binary kinds for pty output, document frames and forwarded bytes; `query.executor` values; an optional `session` on `call`; endpoint-to-device `client` requests; a machine-wide attention view.
  - Likely `WIRE_MINOR` bumps for a pty-host ledger command and for any engine-host read O7 adds.
  - One e2e group, `e2e:remote` (M2).
  - No settings version.
The sections below were added at the re-plan of 2026-10-31. §H's requests to O3 were answered in O3's composite (`docs/doperpowers/plans/2026-10-28-p5-o3-spine.md`, "Contract requests answered"): C1, C3, C5, C6, C7's machine half and C9 by O3-D, C2 and C8 by O3-D and O3-E, C4 in part (the spawn's requester-as-owner goes to M4 with O12), C10 refused as existing.

**§J. The remote lane B adapter** (`src/main/lane-b/remote.ts`; M2, extended by M3, M4 and M6). Main's one consumer of `RemoteLink` for lane B, reached by the router through `routeLaneB`. It owns every subscription, act and stream for lane B sessions on RL2 machines; the renderer keeps the local driver's commands and events.

    import type { MachineRef } from '@shared/machine/ref';
    import type { CommandName, CommandResult, EventName, EventPayload } from '@shared/ipc/schema';
    import type { MainContext, RemoteDispatch } from '../ipc/router';
    import type { RemoteLink } from '../machines/remote/link';
    import type { LayoutFileStore } from '../layout/store';

    export interface RemoteLaneBDeps {
      local: MachineRef;
      layout: Pick<LayoutFileStore, 'get' | 'onChange'>;                    // main.tabs: the addresses of RL2 machines are the interest
      remote(machine: MachineRef): RemoteLink | null;                        // Machines.remote
      onRemote(listener: (machines: readonly MachineRef[]) => void): () => void;   // Machines.onRemote: a link closed ends its sessions
      emit<N extends EventName>(machine: MachineRef, name: N, payload: EventPayload<N>): void;   // emitFrom
      pendingRequestShape: typeof shapeAttentionRequest;                    // main's local attention.request shaping, reused
      timing?: Partial<RemoteLaneBTiming>;
      now?(): number;
      log(line: string): void;
    }
    export interface RemoteLaneBTiming {
      unsubscribeLingerMs: number;   // 10 000: a closed tab's subscription outlives it this long
      recordRetryMs: readonly number[];   // 500, 1000, 2000, 4000: session.get retried for a session the engine host can't place yet
      sendAnswerMs: number;          // 5000: session.send answers by then (queued) while its act goes on
      sendQueueMax: number;          // 8
      batchMax: number;              // 500 events per session.eventBatch
    }
    export const REMOTE_LANE_B_TIMING: RemoteLaneBTiming;

    export interface RemoteLaneB {
      /** Whether the adapter takes `name` for an RL2 machine (§L's lane B acts, the substitutes, M3's pty and forward names, M4's writes). */
      handles(name: CommandName): boolean;
      dispatch(link: RemoteLink, name: CommandName, input: unknown, ctx: MainContext): Promise<CommandResult<CommandName>>;
      stop(): void;                  // every subscription closed before the links (shutdown order)
    }
    export function createRemoteLaneB(deps: RemoteLaneBDeps): RemoteLaneB;
    /** The router's `remote`: a name the adapter handles, for a machine `remote` answers, goes to it; everything else to `base` (routeLaneA, then the manager). */
    export function routeLaneB(base: RemoteDispatch, remote: (machine: MachineRef) => RemoteLink | null, laneB: RemoteLaneB): RemoteDispatch;

    // remote-session.ts: one per subscribed session
    export interface RemoteSessionState {
      machine: MachineRef; app: string;                                      // the bare appSessionId
      status: SessionStatus | null;                                          // the last `status` part: the act's context
      record: SessionRecord | null;                                          // session.get's answer, emitted as session.changed
      stream: 'opening' | 'live' | 'paused' | 'gap' | 'ended';
      launch: string | null;                                                 // the current launchId
      sends: number;                                                         // acts waiting
    }
    // remote-outcomes.ts
    export function outcomeAsResult(name: CommandName, machine: string, outcome: ActOutcome): CommandResult<CommandName>;   // §F's mapping, A4's words
    export function controlsOverlay(state: RemoteSessionState, link: LinkView): Record<ControlKey, Capability>;           // the remote reasons over laneBControls' table

Composition in `src/main/index.ts`: `installRouter({ …, remote: routeLaneB(routeLaneA(machines.dispatch, remote, remoteLaneA), remote, remoteLaneB) })`, `shutdown.add('remote lane B', () => remoteLaneB.stop())` before `'remote lane A'`.

**§K. `remote.*`** (`src/shared/ipc/schema/remote.ts`; main-owned, outside the wire manifest, as `machines.*` and `org.*`; its ids are addresses as the IPC boundary lifts them).

    // events, main to renderer
    'remote.session': { address: AppSessionAddress; link: { state: 'up' | 'down' | 'connecting'; carrier: 'direct' | 'relay' | null; refusal: string | null; member: string; rights: ('spawn' | 'shell' | 'machine-admin')[] };
                        stream: 'opening' | 'live' | 'paused' | 'gap' | 'ended'; controls: Record<ControlKey, { available: true } | { available: false; reason: string }>; reason: string | null }
                        // reason: why no control acts (the link down, this device refused, no status yet); null when they do
    'remote.gap':     { appSessionId: AppSessionAddress; launchId: string }   // M2: a later snapshot, a missing range or an omitted event: the transcript draws the bar here
    'remote.attention': { machine: MachineRef; items: AttentionItem[] }      // M6: a feed's snapshot for the machine; attention.changed follows per session
    // commands, renderer to main (M3)
    'remote.forward.open':  { machine: MachineRef; port: number } → { localPort: number }   // a listener on 127.0.0.1:<localPort> forwarding to the machine's 127.0.0.1:<port>
    'remote.forward.close': { machine: MachineRef; port: number } → void

**§L. The offer rows O7 adds** (`src/endpoint/offers.ts`). Each row: kind, executor, target rule, grade source. Unless noted, a registry command takes its grade from O1's declaration.

| Milestone | Names | Kind | Executor | Target | Note |
|---|---|---|---|---|---|
| M2 | `session.events`, `session.status`, `session.pendingRequest`, `session.pendingItems`, `session.queue.list`, `session.catalog` | call | engine-host | `appSessionId` | O10's, kept |
| M2 | `session.getContextUsage`, `session.getUsage`, `session.getWorkspaceDiff`, `session.getSettings`, `session.listModels`, `session.listPermissionRules`, `session.getStatus`, `session.mcpStatus`, `session.getSessionCost` | call | engine-host | `appSessionId` | the pane's reads |
| M2 | `session.get`, `session.appEvents`, `session.history.list` | call | machine | `appSessionId` | `calls.ts` dispatches a `machine` call row as an `engine-host` one |
| M2 | `session.send`, `steer`, `interrupt`, `answer`, `queue.edit`, `queue.promote`, `queue.setPaused` | act | engine-host | `appSessionId` | O10's, kept |
| M2 | `session.queue.hold`, `queue.remove`, `setModel`, `setEffort`, `setThinking`, `setPermissionMode`, `stopTask`, `sideQuestion`, `mcpToggle`, `mcpReconnect`, `rewind`, `rewindFiles`, `setKeep`, `generateTitle` | act | engine-host | `appSessionId` | through `host.op`; `rewind`, `rewindFiles` and `forget` are lit in M4's overlay once the files panel can show their effect |
| M2 | `session.acquire` | act | machine | `appSessionId` | `machine.op`; the resume behind a send to a released session (P5 Decision Log 36) |
| M4 | `files.list`, `files.read`, `files.watch`, `files.unwatch`, `scm.status`, `scm.push.plan`, `scm.pr.plan`, `scm.remote.last`, `scm.pr.state` | call | machine | `appSessionId` | |
| M4 | `git.status`, `git.branches`, `git.diff`, `git.log`, `git.watch`, `git.unwatch`, `git.lsFiles`, `git.worktree.list`, `git.worktree.status`, `git.worktree.branch` | call | machine | `checkout` | `call.session` names the session; the input's directory must lie in its roots |
| M4 | `fs.readSpill`, `fs.agentEvents` | call | engine-host | `checkout` | path-only reads of the pane |
| M4 | `files.write`, `files.upload`, `scm.stage`, `scm.unstage`, `scm.discard`, `scm.commit`, `scm.push`, `scm.pr.create`, `scm.remote.cancel` | act | machine | `appSessionId` | `machine.op` |
| M4 | `session.launch` | act | machine | `machine` | grade `spawn`; `spawnRefusal` over its args |
| M4 | `session.projects.list` | call | machine | `machine` | grade `list`: the machine menu |
| M3 | `pty.spawn`, `pty.attach`, `pty.kill`, `pty.list` | act | pty-host | `machine` | grade `shell`; `pty.op`; the pty's bytes are a §N stream |
| M3 | `forward.open` | act | endpoint | `machine` | `grade: 'shell'` (not a registry name); the endpoint's own ledger; its result names the forward |
| M6 | `attention.list`, `session.search` | call | machine | `each-session` | admitted at `list`, the answer filtered to the sessions the caller holds `view` on |
| M5 | `artifacts.*` reads and edits, `library.*` reads, `files.reveal`, `files.openExternal` | call / act | machine | `appSessionId` | advisory; with O4 and O5 |

Not offered, and why: `git.worktree.add`, `remove`, `deleteBranch` (a new session's worktree is `session.launch`'s; no remote reader for a cleanup); `fs.holders` (its one caller is the take-over flow, disabled remotely; P5's O7 contracts line names it, see the Decision Log's F9); `session.deletions.list` (`manage`-graded, a Settings surface of the machine's owner); `session.drafts.*` and `session.update` (per member, O8 M6); `pty.foreground`, `pty.openLink`, `pty.hostState`; `session.create`, `intent.*`, `start`, `fork` (the spawn is `session.launch`); `engine.models` (`spawn`; `session.listModels` stands in).

**§M. RL2 additions** (`apps/org-protocol/src/messages.ts`, `channel.ts`), each behind a capability a side lists in its handshake. The device's are `DEVICE_CAPABILITIES`, the endpoint's `ENDPOINT_CAPABILITIES`; both list every capability their build implements.

| Capability | Milestone | What it admits |
|---|---|---|
| `rl2.executor.machine` | M2 | `Executor` gains `machine` (`FROM_DEVICE.query` admits it); `RL2_PROTOCOL.minor` 1 |
| `rl2.executor.pty-host` | M3 | `Executor` gains `pty-host` |
| `rl2.streams` | M3 | the stream kinds of §N: `streamOpen`, `streamOpened`, `streamRefused`, `streamData`, `streamControl`, `streamCredit`, `streamClose` |
| `rl2.call-session` | M4 | `call` gains `session?: SessionRef`, read by the `checkout` target rule |
| `rl2.feeds` | M6 | `sub` gains `feed?: 'attention'` (`session` absent with it); §R |
| `rl2.client-port` | M5 | `client {id, kind, request}` endpoint to device; `clientAnswer {id, answer}` device to endpoint |

A kind a peer did not list is never sent to it; the link and the endpoint each refuse locally. An unknown kind still closes a channel (`readMessage`), which the capability rule makes unreachable between two conforming builds.

**§N. Streams** (M3; `src/endpoint/streams.ts`, `src/main/machines/remote/streams.ts`). A byte flow between a device and its machine, inside the sealed channel, opened under an act the device sent on that channel.

    // messages (JSON, base64 data), behind rl2.streams
    { t: 'streamOpen', id, kind: 'pty' | 'tcp', op: string /* the authorizing act's opId */, credit: number,
      pty?: { ptyId: string; from: number /* output offset */; inputFrom: number /* this device's input offset */ }, tcp?: { forward: string } }
    { t: 'streamOpened', id, pty?: { info: PtyInfo; nextOffset: number; replayFrom: number }, credit: number }   // the endpoint's credit for the device's bytes
    { t: 'streamRefused', id, reason: 'grade' | 'unknown' | 'unreachable' | 'busy' | 'malformed' }
    { t: 'streamData', id, offset: number, data: string }        // ≤ STREAM_CHUNK_BYTES (64 KiB) decoded; offset: the sender's byte count before this chunk
    { t: 'streamControl', id, control: unknown }                 // pty: { resize: { cols, rows } }
    { t: 'streamCredit', id, bytes: number }                     // ≤ 4 MiB; the receiver's refund
    { t: 'streamClose', id, reason: 'closed' | 'behind' | 'exit' | 'carrier' | 'removed' | string }

Rules. `id` is the device's, 16 random bytes base64url, unique on its channel; at most `MAX_STREAMS` (32) per channel (`busy`). The endpoint admits an open when the act `op` names answers `done` from its executor's ledger (`pty.opQuery`, or the endpoint's own) with a binding of this channel's member and device and a name the kind allows (`pty.spawn` or `pty.attach` for `pty`, `forward.open` for `tcp`), and the pty or forward named is the one that act's result names; else `grade`. Each side sends data only within the other's credit; output past the device's credit is held up to `STREAM_BACKLOG_BYTES` (512 KiB) and then the stream closes `behind`. A `pty` stream's output offsets are the pty host's (`pty.data`'s); its input offsets are the device's, numbered per pty from this app's first open, and the endpoint keeps the last offset it wrote per `(device, ptyId)` for `RESUME_MS` and drops a repeat. A `tcp` stream connects to the machine's `127.0.0.1:<port>` at open (`streamOpened` after the connect; `unreachable` on failure) and ends whole with either side's close. A stream dies with its channel (`carrier`); the device reopens on the next channel from its offsets. Streams carry no liveness of their own.

    // the link's half
    export interface StreamRequest { kind: 'pty' | 'tcp'; op: string; credit?: number; pty?: { ptyId: string; from: number; inputFrom: number }; tcp?: { forward: string } }
    export interface StreamSink { opened(opened: StreamOpened): void; data(offset: number, bytes: Uint8Array): void; credit(bytes: number): void; closed(reason: string): void }
    export interface RemoteStream { readonly id: string; send(bytes: Uint8Array): void; control(control: unknown): void; credit(bytes: number): void; close(reason?: string): void }
    // RemoteLink gains:
    openStream(request: StreamRequest, sink: StreamSink): RemoteStream;      // closed('not-offered') at once when the peer lists no rl2.streams
    peerCapabilities(): readonly string[] | null;                             // the current channel's h2 list; null while no channel is current

**§O. Commands and fields O7 adds to the wire** (each an additive manifest change).

- `pty.op`, `pty.opQuery` (`src/shared/ipc/schema/pty.ts`, owner `pty-host`, grade `internal`; M3): the shapes of `machine.op` and `machine.opQuery` (`MachineOpInputSchema`, `HostOpOutputSchema`, `HostOpQueryOutputSchema`), over `<pty host directory>/pty-ops.jsonl` (`src/pty-host/ops.ts`); runs `pty.spawn`, `pty.attach`, `pty.kill` and `pty.list` through the host's table.
- `session.launch` (`src/shared/ipc/schema/session.ts`, owner `machine`, grade `spawn`, route class addressed by machine; M4):

      input:  { checkout: string; worktree?: string; brief?: string; model?: string; effort?: string; permission_mode?: string }   // DX6's spawn fields, exactly
      output: { status: 'ok'; appSessionId: AppSessionId } | { status: 'refused'; reason: 'untrusted' | 'unknown-checkout' | 'worktree-exists' | string }

- `SessionRecordSchema.launchedBy?: { member: string; device: string; opId: string }` (`src/shared/graph/session.ts`; M4): set by `session.launch`'s handler from the `machine.op` claim; read by O12's observer.
- `files.upload`'s `part?: { upload: string; index: number; last: boolean }` (`src/shared/ipc/schema/files.ts`; M4): with it, `files` holds one entry of at most `REMOTE_UPLOAD_PART_BYTES` (2 MiB decoded); staging `<root>/.staging/<upload>`; a part at an unexpected index is `{status: 'refused', reason: 'part out of order'}`; the last part answers the file's path, earlier ones `paths: []`.
- `forward.open` (an endpoint action name, not a registry command; M3): args `{ port: number }` (1 to 65535); result `{ forward: string; port: number }`; the forward lives with its channel.

**§P. The step-up sheet** (`src/main/device/step-up-sheet.ts`; M2).

    import type { Confirm } from './step-up';
    export function sheetConfirmation(deps: {
      window(): BrowserWindow | null;                 // the focused window, else any; null: a window-less box
      dialog: Pick<typeof dialog, 'showMessageBox'>;
      prompt: Confirm;                                // promptTouchIDConfirmation(systemPreferences) in production
    }): Confirm;
    // message: prompt.summary; detail: prompt.text; buttons ['Continue', 'Cancel'], defaultId 0, cancelId 1; type 'question'.
    // Continue → prompt(prompt); Cancel or a closed sheet → { ok: false, reason: 'cancelled' }.

`src/main/index.ts` passes `sheetConfirmation(…)` as `confirm` to both `createStepUp` calls and to `createStateSigner`.

**§Q. The e2e scene** (`e2e/support/remote-scene.ts`; M2, extended by M3, M4, M6, M7).

    export interface RemoteScene {
      org: LocalOrg;                                  // e2e/support/local-org.ts
      b: ProfileDaemon & { ref: MachineRef; directPort: number };   // profile B: private mawsd, MAWS_ENDPOINT_DIRECT=1, a fake tailnet table, enrolled as 'B'
      devOrgDir: string;                              // A's MAWS_DEV_ORG: session.json (hub: the local org, standinUser: the admin) and chain.json listing A's device
      stop(): Promise<void>;
    }
    export async function startRemoteScene(opts: { scratch: string; aUserData: string; laneBOwner: string; directMap: boolean }): Promise<RemoteScene>;

- `session.json` gains `directMap?: Record<string, string>` (an advertised `ws://` address to the one to dial), honoured by `dev-session.ts` only in an unpackaged build and applied by the link's `dialDirect` through `RemoteLinkDeps` as the suites inject it.
- `MAWS_E2E_LANE_B_OWNER=<member id>`: under `MAWS_E2E=1` only, `src/mawsd/endpoint-seam.ts` passes `authorization.records` answering `{owners: [member], access: 'listed', shares: []}` for every lane B session the spine knows; absent, or outside `MAWS_E2E`, nothing changes.
- Profile B's engine is the replay engine with `e2e:c7`'s fixtures; the spec starts B's session over `machine.sock` (`e2e/support/profile-daemon.ts`'s `reachMachine`) and reads B's transcript the same way to confirm what A sent.

**§R. Feeds** (M6; `src/endpoint/plane-feeds.ts`). `sub {sub, feed: 'attention', cursor, credit}` opens the machine's attention feed for the caller: `subbed {mode: 'snapshot', epoch: 'attention:<boot id>', seq}` then a `snap` whose value is `attention.list`'s answer filtered to the sessions the member holds `view` on; each later `attention.changed` of such a session is an `ev {body: {appSessionId, items}}` at the next `seq`; a record change or a new head re-authorizes it as subscriptions are, ending it `removed` for a member who lost `view` on every session. The link's `subscribe` takes `{feed: 'attention'}` in place of `session`.

**§S. The remote bench** (M7; `e2e/remote-latency.spec.ts`, `test/support/remote-latency.ts`). `test-results/remote-latency.json`:

    { local: Measures, direct: Measures & { rtt: Stats }, relay: Measures & { rtt: Stats }, bounds: { deltaToFrameP50Ms, roundTripP50Ms, openToFirstRowMs: 1500, resumeMs }, invalidReasons: string[], budgetMisses: string[], load: … }
    // Measures: { deltaToFrame: Stats; roundTrip: Stats; openToFirstRowMs: number; resumeMs: number; engineStartMs: number }; Stats: { p50, p95, n }

`e2e:remote-latency-live` writes `remote-latency-live.json` with `clock: { offsetMs, spreadMs, samples }` and voids the run when `spreadMs > 5`.

## Open questions for the owner

Each is built provisionally as recommended, unless it says otherwise, and changed if the owner answers differently.

- **A1. When the owner first sees remote machines in MAWS** (scheduling; for the architect and the owner). M1 runs now, but no production app can open a channel until it is signed in to the org, which is O8's sign-in (P5 Decision Log 38). *Recommendation:* split O8's sign-in into a first milestone and dispatch it now. It needs only O6 and O11, both landed, and its production `OrgSession` turns M1 on. *Alternative:* wait for O8 as planned, which also holds O9's remote lane A.
- **A2. How the app shows a machine's path to it.** *Recommendation:* show no carrier on the machine chip. The machine row's hover says "direct (tailnet)" or "via the hub". "Hub unreachable" appears once, apart from any machine's "offline" greying, as P5 §3's "hub-offline, channel-up". A device the org removed greys that machine's rows with "This Mac is no longer allowed on `<machine>`". *Alternatives:* a small relay mark on the chip; showing nothing beyond online and offline. **[owner, 2026-10-28: as recommended; P5 Decision Log 108.]**
- **A3. Whether O7's log view exists** (for the architect first). P5 Decision Logs 51, 75 and 80 name "O7's log views" as a reader of migrated history, and P5 Decision Log 51 calls it "a project-wide view of what a person's sessions said". O8's project channel reads the same log plane. *Recommendation:* fold it into O8's channel, so the log plane has one reader and O14's B4 waits on one. *Alternative:* keep it in O7 as a per-person filter of the project's agent-to-agent traffic (M6).
- **A4. A message sent to a remote session while its machine is unreachable.** *Recommendation:* hold it for 60 s, then show "Not sent: `<machine>` is offline" with Send again. M1 builds this rule. *Alternatives:* an outbox that sends typed messages whenever the machine returns, with answers and interrupts never waiting; failing at once. **[owner, 2026-10-28: as recommended; P5 Decision Log 108.]**
- **A5. The "+ Session" machine picker** (M4; to settle before it is re-planned). *Recommendation:* a machine menu beside the project picker, defaulting to this Mac, that lists the machines where the project has a checkout, with one line under it saying the lane and the inference route. *Alternatives:* the machine folded into the project row ("maws @ mini"); a two-step dialog. **[owner, 2026-10-28: as recommended; P5 Decision Log 108.]**
- **A6. Forwarded ports** (M3). *Recommendation:* a `localhost:<port>` link in a remote session opens through a forward in the in-app browser, marked "forwarded from `<machine>`", without asking. *Alternatives:* an explicit "Forward port…" command; asking each time. **[owner, 2026-10-28: as recommended; P5 Decision Log 108.]**
Added at the re-plan of 2026-10-31. Each is built as recommended unless answered otherwise; the product calls among them are marked.

- **A7. The step-up sheet's form** (M2; product). *Recommendation:* macOS's own sheet on the window (`dialog.showMessageBox`): the action's summary as its message, every field one per line as its detail, Continue and Cancel; then Touch ID with the summary. It shows even before a page loads, needs no second copy of main's words, and is the pattern a Mac user reads as a security confirmation. *Alternative:* an in-app sheet in MAWS's own style, which can show the same text with richer layout once the native one has proved the flow.
- **A8. Notifications for another machine's sessions** (M6; product). *Recommendation:* this Mac notifies for a remote session's pending item as it does for a local one, once per item, and a click opens the session; the phone's push (O13) arrives too, as it does today for local sessions. *Alternative:* count remote items in the badge and Needs you but raise no notification for them.
- **A9. A remote terminal after a new app run** (M3; product). The machine refuses a remote viewer's emulator checkpoint (O2's rule), so this app keeps it in memory for its run: a reload restores exactly, a new app run restores from the ring's tail (the last 512 KiB), which is what a local terminal shows when its checkpoint is missing. *Recommendation:* accept. *Alternative:* persist the checkpoint in this app's profile per remote pty, which keeps old state for shells that may have ended.
- **A10. Reveal in Finder and Open externally on a remote file** (M4; product). They act on the asking client, so on this Mac they can only open a copy. *Recommendation:* grey them with "on `<machine>`" until M5 routes the client port, and let "Open externally" then download the file to this Mac's temporary directory and open it. *Alternative:* hide them for remote sessions.
- **A11. Lane B records on the real machines** (M7; for the architect). The endpoint authorizes a lane B session from sminos's member record (O12's lane B observer, item 7). M7's live runs need every lane B session on the mini and the VM to have one; the e2e uses a seam instead. *Recommendation:* confirm with the desk track that O12 item 7's records reach the endpoint on both machines at their current sminos before M7 is scheduled, and if not, make it M7's first precondition.

## Surprises & Discoveries

- Observation: the endpoint checks freshness, grade and lane B's context before it reaches the executor's ledger, so a refused reseal does not prove that an earlier copy never ran.
  Evidence: `src/endpoint/actions.ts` `#execute`: `session.status` is compared with `action.context` (`refuse('context')`) before `host.op` is dispatched.
- Observation: `openChannel` raises `protocol`, `unknown-machine`, `revoked` and `contested` from `h2` before checking its MAC and signature, so a relay can forge all four.
  Evidence: `apps/org-protocol/src/channel.ts` `openChannel`: the major and `machineKeys(...)`/`h2.keyId` checks come before `macVerifies` and `verifyInput`.

- Observation: the app holds no org state, hub session or registered device. P5 Decision Log 45's edge for M1 holds for building and testing, but a production device can't open a channel until O8's sign-in.
  Evidence: `src/main` imports `apps/org-protocol` only in `src/main/device/` (keys and step-up), and nothing calls `loadDeviceKeys` or `createStepUp` at startup. The hub's app routes (`/api/machines/<ref>/{socket,endpoint}`) take an Access-authenticated member (`apps/desk-hub/src/worker.ts`), and P5 Decision Log 38 gives that sign-in to O8.
- Observation: remote terminals and port forwarding need no O3. `pty.*` is the pty host's, and O2 forks it under `mawsd`. Diff, files and the editor do need O3: `git.*` (13), `files.*` (7) and `scm.*` (12) are all `owner: 'main'`.
  Evidence: `src/shared/ipc/schema/pty.ts` has 10 `owner: 'pty-host'`; `git.ts`, `files.ts` and `scm.ts` have only `owner: 'main'`.
- Observation: a lane A read names the caller's own subscription. The link's subscription id must therefore be stable across channels and exposed to O9.
  Evidence: `src/endpoint/calls.ts` `#laneA`: `!isText(input.sub, 128)` → `malformed`; `this.ctx.subscription(channel, input.sub)`.
- Observation: a `snap` carries a page of a JSON value's text, not a value.
  Evidence: `src/endpoint/subscriptions.ts` `snap()`: `pagesOf(JSON.stringify(value), …)`; "the device joins the pages' bodies and reads them".
- Observation: a step-up signature covers `nonce` and `created`, so a resealed step-up action needs a new confirmation.
  Evidence: `apps/org-protocol/src/action.ts` `actionSigningInput`: the action without `stepUp` and `webauthn` only; `src/main/device/step-up.ts` stamps a fresh nonce and `created` at confirmation.

- Observation (M1): the direct listener's per-source handshake limit (a burst of 3, 5 a minute) trips on loopback, where every handshake of a suite shares one source address, so a suite that reconnects more than three times is refused `503 busy`.
  Evidence: `src/endpoint/direct-listener.ts` `HANDSHAKE_LIMITS`; the direct suite's reconnect cases failed until `test/endpoint/sub-harness.ts`'s `StartOptions.limits` raised the listener's limit and the link's `DIRECT_BUCKET` was raised to match.
- Observation (M1): `Channel.onClose` hands the link a sealed `close`'s reason and a carrier's end through one listener, so a socket close frame or a relay channel close reading `removed` looked like the machine's sealed verdict.
  Evidence: `apps/org-protocol/src/channel.ts`, the channel's close path; fixed on the device side by `carriers.ts` and the link's `sealedOnly` wrapper, which report every transport end as `carrier` (Decision Log, 2026-10-28, finding 1).
- Observation (M1): the hub's last hop to the app socket has no byte or stall bound, so the claim that a device which stops reading loses its socket holds only for the direct carrier.
  Evidence: `apps/desk-hub/src/objects/relay.ts`; P5 Decision Log 94 tracks it.
- Observation (M1): the repository's eslint `no-restricted-imports` rule keeps `src/main` from importing `src/endpoint` and `test/endpoint`, tests included, which the link's suites need for a real endpoint and its harness.
  Evidence: `eslint.config.js`; a block added for `src/main/machines/remote/*.test.ts`, `src/main/org/*.test.ts` and `test/machines/**`.
- Observation (M1): an org state that drops a machine's key must list it in `retired`, so a rotation in a test is a successor with the new key and a retired entry for the old one.
  Evidence: `apps/org-protocol` org-state validation; the direct suite's `rotation()` helper.
- Observation (re-plan): a device cannot query a `machine` act today, since org-protocol's query validator admits only `sminos`, `engine-host` and `endpoint`, while the endpoint already routes `machine` queries and acts to `machine.opQuery` and `machine.op`.
  Evidence: `apps/org-protocol/src/messages.ts` `FROM_DEVICE.query`; `src/endpoint/queries.ts` "`machine` is no member of RL2's executor until O7 adds it behind a capability".
- Observation (re-plan): `session.acquire`, the resume behind a send to a released session, is a `machine` act, so M2 needs the `machine` executor on RL2 or a released remote session could not be driven.
  Evidence: `src/services/machine-ops.ts` `claimable` over the registry's owners; the grade `{floor: 'converse', byEffect: true}` in `src/shared/ipc/grades/session.ts`; the composer's `sendHumanPrompt` calling `session.acquire` when the record has no ready process.
- Observation (re-plan): a remote upload cannot be one call: the channel's message limit is 4 MiB and `files.upload` admits 32 MiB.
  Evidence: `MESSAGE_MAX_BYTES` in `apps/org-protocol/src/channel.ts`; `UPLOAD_FILE_MAX_BYTES` in `src/shared/ipc/schema/files.ts`.
- Observation (re-plan): `git.*`'s reads take a directory, not a session, so no existing target rule can grade them; `scm.*` and `files.*` take `appSessionId` and need none.
  Evidence: `DirectorySchema` and `RepoRootSchema` in `src/shared/ipc/schema/git.ts`; `Session` and `SessionPathSchema` in `scm.ts` and `files.ts`.
- Observation (re-plan): a spawn composed of MAWS's own commands cannot cross: an intent has no engine session, so `session.intent.patch` and `session.start` have no target the endpoint can place, and `spawnRefusal` admits only DX6's six fields.
  Evidence: `src/endpoint/targets.ts` `laneB` (through `session.status`); `SPAWN_FIELDS` in `src/endpoint/policy.ts`.
- Observation (re-plan): the endpoint holds no lane B records of its own: they come only from sminos's member frames, and a profile with no sminos (every e2e scene) authorizes no lane B request.
  Evidence: `src/endpoint/endpoint.ts` `records: authorization.records ?? this.rl10.members`; `src/endpoint/rl10/members.ts`'s header.
- Observation (re-plan): the pty's credit needs no change for a remote viewer: `mawsd` acks every frame while no app is attached, and the attached app's acks drive it otherwise, so a slow remote viewer can only fall behind, never pause the pty.
  Evidence: `src/mawsd/daemon.ts`'s `credit: 'daemon' | 'app'` and its `hosts.onRaw('pty-host')` ack; `pty.attach` forced `credit: false` for the endpoint.
- Observation (re-plan): the renderer takes no snapshot of a listed machine and reads neither `carrier` nor `refusal`, and a listed lane B row's click selects only, so M2's renderer work is the opener, the pane's started branch over a record, the overlay and the hover, not a new store.
  Evidence: `src/renderer/src/ipc/events.ts` `takeRoster` (`listedMachines.has(m.ref)` → `continue`); `src/renderer/src/sidebar/ListedRow.tsx` `activate`; `src/renderer/src/sessions/remote-openers.ts`.
- Observation (re-plan): the local latency bench holds only on one machine: the stub engine and the runner share one clock, so a remote bench across machines must estimate the offset.
  Evidence: `e2e/local-latency.spec.ts`'s header; `BENCH.clockWithinMs` in `test/support/local-latency.ts`.
- Observation (re-plan): `pty.list` answers every pty on the machine, unfiltered, and the renderer filters by session; a remote `pty.list` act must be filtered at the adapter or the endpoint.
  Evidence: `src/pty-host/table.ts` `list`; `src/renderer/src/terminal/registry.ts`.

## Decision Log

- Decision: Verification. This document gets one `doperpowers:adversarial-reviewer` buildability round on its execution section, focused on M1, repeated until a round yields nothing worth changing. M1's PR gets doperpowers:reviewer-high: it is the device side of RL2, it builds and step-up-signs actions, and it decides what is resealed. M2–M7 each get their own buildability round when they are re-planned after O3's cut, and the review rung that re-plan names.
  Rationale: M1 sits on the trust boundary, as O10's milestones did. The advisory milestones can't be reviewed for buildability before their dependencies exist.
  Date/Author: 2026-10-28, O7's planner.

- Decision: The first buildability round (doperpowers:adversarial-reviewer, 3 P1 and 2 P2, each verified against the code) is folded in. An ambiguous act's refused reseal is now queried, not read as "nothing ran". Handshake verdicts no longer stop the link, since they come from an unauthenticated `h2`. A trust generation closes a channel whose machine key the org retired. M1 now extends `test/endpoint/sub-harness.ts` so that a `session.send` runs and `host.opQuery` answers, and its proofs gained the four cases these need. M3's terminal rows are all acts (`pty.*` is `shell`, and a call takes only `list` or `view`), with the pty's flow control and checkpoints named.
  Rationale: each finding was real against the code; the review's verdict otherwise found the signed-out seam, the stable subscription ids, the cursor rules, the tolerant output codec and the no-bump decision sound.
  Date/Author: 2026-10-28, O7's planner.

- Decision: The second round (1 P1) is folded in. A `done` whose outcome is `{state: 'refused'}` no longer settles an ambiguous act either, because a closed ledger refuses `unavailable` before it looks the id up. Only a query settles an ambiguous act, and a query's `unavailable` keeps it ambiguous. The round found the other four fixes complete, and no new contradiction.
  Rationale: verified against `src/shared/host/op-ledger.ts` `begin`.
  Date/Author: 2026-10-28, O7's planner.

- Decision: The third round, narrowed to that fix, found nothing (approve at `edc83be65`). The review has converged: rounds of 5, then 1, then 0 findings.
  Rationale: the skill's stop rule; a round that yields nothing worth changing.
  Date/Author: 2026-10-28, O7's planner.

- Decision: M1's interface additions, checked with the architect before the tests were written. (1) `createRemoteSource` takes `local: MachineRef`, since the roster leaves the local ref out and §C's deps didn't carry it, and an optional `interfaces()` so tests inject the network watch. (2) A step-up act's 60 s send window runs from its signature, not from `opCreated`; the signer still receives and keeps `opId` and `opCreated`. (3) `MachineLink.onState` also fires when the carrier or the refusal changes under the same reported state, so a relay-to-direct switch re-emits `machines.changed` without a new generation. (4) A probe's ping is answered by any message that arrives within `PROBE_PONG_MS`, not only a `pong`. Also: the link reads `up` when `connectChannel` resolves (at `caps`), and it checks an act with `isAction` before sending and refuses one that fails as `malformed`, since the endpoint would close the whole channel on it.
  Rationale: (1) the roster can't be computed without it; (2) a slow Touch ID prompt would otherwise end a confirmed act `refused offline`, against `step-up.ts`'s rule that time at the prompt doesn't make an act stale; (3) the manager reports the carrier, and a switch changes it; (4) every message already proves the channel live, as the liveness rule counts it. The architect agreed all four and the pre-check.
  Date/Author: 2026-10-28, O7 M1's executor.

- Decision: Finding 1 [P1], fixed by (a). A sealed `close {reason: 'removed'}` couldn't be told from a carrier close carrying the same word, because `Channel.onClose` reports both through one listener. Every production carrier now reports its own end as `carrier` (`CARRIER_CLOSED`), whatever the close frame or the relay's channel close said, and the link wraps every duplex it hands the handshake (`sealedOnly`), so an injected dialler can't leak a transport reason either. `removed` therefore reaches the link only from inside the channel. Tests: `carriers.test.ts` (a raw WebSocket close with reason `removed`, and a relay channel close, each end `carrier`), and the direct suite's carrier ended as `removed`, which stays transient.
  Rationale: (b), an additive change to org-protocol's `Channel`, was not needed: with every carrier normalised below the channel, no transport word reaches `onClose`.
  Date/Author: 2026-10-28, O7 M1's executor, from the architect's review.

- Decision: Finding 2 [P2]. A query answered `refused` with the reason `unavailable` and no outcome asks again on the query backoff; any other reason with no outcome (`grade`, `class`) resolves `unknown {reason}`. §"Queries" says so now. Test: `acts.test.ts`.
  Rationale: `unavailable` is the executor's ledger closed for a moment, not the machine declining to say.
  Date/Author: 2026-10-28, O7 M1's executor, from the architect's review.

- Decision: Finding 3 [P2]. A call with no input sends `input: null`. Test: `link.test.ts`, a void call answered while a subscription on the same channel stands.
  Rationale: an `undefined` field vanishes in `JSON.stringify`, and the endpoint closes the channel on the malformed `call`, ending every other stream.
  Date/Author: 2026-10-28, O7 M1's executor, from the architect's review.

- Decision: Finding 4 [P2]. A credit refund is split into messages of at most `SUB_CREDIT_MAX`, keeping the exact total. Test: `subs.test.ts`, an overdraw beyond the cap.
  Rationale: the endpoint finds a larger `credit` malformed.
  Date/Author: 2026-10-28, O7 M1's executor, from the architect's review.

- Decision: Finding 5 [P2]. Liveness matches the endpoint's `#arm`: a period in which anything was heard resets the count, each silent period pings, and the third silent period in a row closes `timeout`. §"Liveness" says so now. Tests: `link.test.ts`.
  Rationale: the two sides should agree on when a quiet channel is dead.
  Date/Author: 2026-10-28, O7 M1's executor, from the architect's review.

- Decision: An act with no `ack` within `ACK_TIMEOUT_MS` on a live channel is marked ambiguous and queried, not resealed. A reseal goes only after the channel is lost (sent, not acked, unsigned, within its window).
  Rationale: on a live channel the first copy is most likely queued, not lost; a query costs one round trip and lets the ledger answer, and `not-received` tombstones the id so a late first copy can't run. Rejected: resealing on the ack timeout, which on a slow endpoint would put two copies in flight for the ledger to deduplicate.
  Date/Author: 2026-10-28, O7 M1's executor.

- Decision: Orientation's claim that a device which stops reading loses its socket is narrowed to the direct carrier; the hub's last hop has no bound (P5 Decision Log 94).
  Rationale: the architect's review, verified against `apps/desk-hub/src/objects/relay.ts`.
  Date/Author: 2026-10-28, O7 M1's executor.

- Decision: Both link suites run in vitest's `node-timing` project (`TIMING_NODE_TESTS`), the direct one included: it runs a real endpoint over real sockets and the handshake's WebCrypto under wall-clock timeouts.
  Rationale: the timing project's pattern for suites that run real carriers (`test/endpoint/channels.local.test.ts` and its siblings).
  Date/Author: 2026-10-28, O7 M1's executor.

- Decision: reviewer-high's three findings on the built branch (2 P1, 1 P2), each reproduced by the reviewer and fixed by one fix wave with a test that failed first. (1) An attempt stamped its trust with the generation read after `machineKeys` resolved, so a session change during that await could let a channel authenticated against the superseded view be adopted; the generation is now read before the session. (2) A delegated machine's certificate key lapses at its delegation's `expires` with no session change, and nothing rechecked it; the link rechecks trust and the source the roster on a timer at the next expiry (`nextCertExpiry`, `timeoutAt`, stepped at most a day). (3) An act whose channel was lost and never came back never resolved, since the horizon check lived only in the query path; each act now has its own horizon timer.
  Rationale: (1) and (2) let a channel outlive the org's trust in the key it was made under, which the trust generation exists to prevent; (3) breaks `ActHandle.outcome`'s promise to settle. An act that never had a copy out settles `refused expired` at the horizon rather than `unknown`, as `close()` distinguishes the two.
  Date/Author: 2026-10-28, O7 M1's executor.

- Decision: the first class 1a run was red on `link.test.ts` alone (11 of 26 on one unit shard). The suite holds the clock and lets real async work run for a fixed number of event-loop turns, and an attempt's key ids use WebCrypto's digest on libuv's thread pool, which a loaded runner shares. The suite now computes the same key ids synchronously (a `vi.mock` of `keyId`). Reproduced locally with the pool contended: 26 of 26 red before, 26 of 26 green after.
  Rationale: a test race, not a link bug; acts and subs passed under the same contention unchanged.
  Date/Author: 2026-10-28, O7 M1's executor.

- Decision: The review has converged. A narrow reviewer-high round on the fix commit (336d08000) found nothing, and its focused runs passed: link 28, acts 22, source 4. That makes two rounds: 3 findings, then 0.
  Rationale: the stop rule; a round with nothing worth changing.
  Date/Author: 2026-10-28, O7 M1's executor.

- Decision: The owner answered A2, A4, A5 and A6 as recommended. The provisional builds stand: M1's 60 s hold (A4) is unchanged; M3's and M4's re-plans build A6's forward and A5's machine menu as written; A2's carrier hover lands with the first milestone that carries a link's carrier to the renderer.
  Rationale: the owner's product calls; recorded in P5 Decision Log 108.
  Date/Author: 2026-10-28, the architect, from the owner's answers.

- Decision: The re-plan of M2 to M7 (2026-10-31), at master 33935b949 after O3-E's landing (P5 Decision Log 92's condition). Verification for the re-planned milestones: this document gets one independent spec review and one doperpowers:adversarial-reviewer buildability round on its execution section (M2 to M4 first), repeated until a round yields nothing worth changing; M2, M3 and M4 land at doperpowers:reviewer-high, M6 and M7 at medium. The split judgement: O7 stays one child. Its remaining milestones share one state owner on the app side (the adapter and the renderer's machine dimension), one proof scene (`e2e:remote` and the endpoint harness), and each later milestone consumes the one before; the parts with other owners (the pty host's ledger, the endpoint's rows, the spine's `session.launch`) are small and land with the milestone that needs them. The split signals that do show (M3's byte streams and ledger against M4's spine rows; M7's measured verification) are milestone boundaries, as O3-D's and O3-E's planners read theirs. Rejected: children for M2 to M4, which would put one adapter, one scene and one `src/main/index.ts` composition on three branches to reconcile.
  Rationale: decomposing's gate (one agent can own it; O9 ran ten milestones as one child) and its keep-together rule (the adapter and the scene are not meaningful apart).
  Date/Author: 2026-10-31, O7's re-planner.

- Decision: The order is M2, then M4 and M3 in either order, then M6, M5 when O4 and O5 land, M7 last. M4 before M3 by value (acceptance 4 and the file surfaces are the daily use; M3's streams are the riskiest protocol work and go after the adapter has proved itself), not by dependency.
  Rationale: both need only M2's pane; a branch that lands second re-bumps the wire and the RL2 minor.
  Date/Author: 2026-10-31, O7's re-planner.

- Decision: Subscriptions follow the tabs, with a 10 s linger, rather than a renderer watch command (O9's `laneA.watch`) or every listed session.
  Rationale: lane B's renderer has no connect step for a session (events are broadcast and the transcript opens on the tab), and the channel's 64-subscription cap would not cover a server's listings. Rejected: a watch command (a new renderer surface for one consumer); every listed session (the cap, and the engine host woken for sessions nobody looks at).
  Date/Author: 2026-10-31, O7's re-planner.

- Decision: The remote pane runs over a record read by `session.get` and emitted as `session.changed`, with one row per address in the sidebar, rather than over the listed row with a parallel state.
  Rationale: every panel tool reads `SessionRecord | null` for the session's directory and worktree, which M4 and M3 need; P5 Decision Log 101 names the switch. Rejected: O9's `LaneAState` shape for lane B (a second record shape for the same kind of session).
  Date/Author: 2026-10-31, O7's re-planner.

- Decision: `rl2.executor.machine` lands in M2, for `session.acquire` and `session.update`, not in M4.
  Rationale: a send to a released remote session resumes it through `session.acquire`, a `machine` act; without it M2's conversation would stop at the first idle release. Rejected: an engine-host act for the resume (the resume is the session service's, in the spine).
  Date/Author: 2026-10-31, O7's re-planner.

- Decision: The step-up sheet is macOS's own sheet through `dialog.showMessageBox`, composed as a `Confirm` before Touch ID, and given to O8's state signer as well (A7).
  Rationale: P5 Decision Log 126 asks for the text before Touch ID and for O8's confirm hook to change with it; a native sheet shows with no page loaded and keeps main's words the only copy. Rejected: an in-app sheet (a second surface to keep in step).
  Date/Author: 2026-10-31, O7's re-planner.

- Decision: Streams are JSON message kinds with base64 data, behind `rl2.streams`, opened under an act's opId and authorized by that act's ledger binding; a binary plaintext kind is the named follow-up if M7's forward throughput needs it.
  Rationale: one facility for terminals, forwards, and M5's documents and artifact pages, with no change to the sealing layer or to O10's authorization order; the act carries the grade and the step-up. Rejected: a binary kind now (a change to `Channel` for a 33 % saving on terminal output); `pty.write` as acts (a fsynced claim per keystroke); admitting `shell` calls for `pty.list` and `pty.attach` (a change to `authorize.ts`'s rule for two reads: they are acts under the pty host's ledger instead).
  Date/Author: 2026-10-31, O7's re-planner.

- Decision: The pty host keeps its own ledger (`pty.op`, `pty.opQuery`, mirroring `src/engine-host/ops.ts`) rather than `mawsd` claiming pty acts through `machine.op`.
  Rationale: the effect lands in the pty host, as lane B's lands in the engine host (P5 Decision Log 45's rule); `machine.op` claims `machine`-owned commands only and the bus's `invoke` doesn't reach the pty relay. Rejected: widening `claimable` to `pty-host` names (a second owner's commands under the spine's lock).
  Date/Author: 2026-10-31, O7's re-planner.

- Decision: `git.*`'s reads and the path-only `fs.*` reads cross under a `checkout` target rule fed by an optional `session` on `call` (behind `rl2.call-session`): the endpoint takes the rank from the named session and admits the call only for a path within that session's roots.
  Rationale: the inputs name a directory, not a session, and the directory alone grades nothing. Rejected: an `appSessionId` on every git input (a wire change to every local caller); grading the reads at the machine level (`view` on any session would open every checkout).
  Date/Author: 2026-10-31, O7's re-planner.

- Decision: Remote uploads go as parts of `files.upload` (an additive optional `part`), 2 MiB per act, each claimed by `machine.op`, staged on the machine and moved into place at the last part.
  Rationale: the 4 MiB message against the 32 MiB file; a part per act keeps the reseal rule and the ledger's run-once. Rejected: M3's streams for uploads (an order dependency M4 doesn't need); one message per upload (a 2.9 MiB bound the owner's PDFs exceed).
  Date/Author: 2026-10-31, O7's re-planner.

- Decision: The remote spawn is one new command, `session.launch`, with DX6's spawn fields, composed on the machine from `session.create`, `intent.patch` and `start`, recording the requester as `launchedBy` for O12's observer.
  Rationale: `spawnRefusal` admits DX6's fields only, and an intent has no engine session for the endpoint to place MAWS's own three commands by. Rejected: three acts; a MAWS-shaped input.
  Date/Author: 2026-10-31, O7's re-planner.

- Decision: Attention and search cross under an `each-session` target rule (admitted at `list`, the answer filtered per session to the caller's `view`), and the live feed is a `feed` on `sub` behind `rl2.feeds`.
  Rationale: both answer for the whole machine and name no session; a filtered answer keeps O10's rule that nothing of a session reaches a caller below its floor. Rejected: `cards` subscriptions per listed session (the cap); a rank-filtered `session.list` (C5's refused alternative).
  Date/Author: 2026-10-31, O7's re-planner.

- Decision: `e2e:remote` runs profile B's real private `mawsd` enrolled in a local org, A signed in through `MAWS_DEV_ORG` with a dev-only `directMap`, and a lane B records seam under `MAWS_E2E=1`; the measured numbers are `e2e:remote-latency`'s, on the mini.
  Rationale: the tracker row asks for the built app over a real endpoint; the direct carrier needs a dial map on one Mac (the listener advertises a tailnet address); lane B records exist only through sminos in production. Rejected: a fake endpoint in the spec's process (the app proven, the machine not); a sminos fake over RL10 in e2e (vitest's harness); wall-clock bounds in `e2e:remote`.
  Date/Author: 2026-10-31, O7's re-planner.

- Decision: `fs.holders` and `session.deletions.list` are not offered; `git.worktree.add`, `remove` and `deleteBranch` are not offered; `files.reveal` and `files.openExternal` wait for M5's client port.
  Rationale: no remote reader for the first two (the take-over flow is disabled remotely; deletions are the machine owner's Settings surface); a new session's worktree is `session.launch`'s; the client-bound two act on the asking client (A10).
  Date/Author: 2026-10-31, O7's re-planner.

The residue for P5's Decision Log. Each item is decided where it binds (M1 unless marked), with the alternative it rejected:

1. M1 defines `OrgSession` and holds `signedOut()` in production, plus a development source behind `MAWS_DEV_ORG` in unpackaged builds; O8's sign-in implements it. Rejected: O7 building sign-in, so that two children build it.
2. One RL2 link per machine the held org state lists, eager. Rejected: links on first use.
3. `RemoteLink` extends O6's `MachineLink` with `call`, `act`, `subscribe`, `caps` and `probe`. It is reached only through `Machines.remote(ref)`, and `boundary.test.ts` refuses any other channel opener in main or the renderer. Rejected: a raw message pipe, which would have each consumer reimplement RL4's lifecycle; and a second link for O9 (P5 Decision Log 45).
4. Direct first: tailnet `ws://` addresses raced within 1 s, under a per-machine bucket that mirrors the listener's handshake limit; the relay otherwise; direct rechecked every 60 s and on every probe; a switch after the new handshake completes. Rejected: dialling any signed address; dialling until `busy`; overlapping two channels during a switch.
5. `up` survives a reconnect within 2 s, and is not a new generation. Rejected: `down` at every loss.
6. The only permanent verdict is a sealed `close {reason: 'removed'}`. Every handshake failure is transient and local to its carrier, because `protocol`, `unknown-machine`, `revoked` and `contested` come from an unauthenticated `h2`, and the endpoint's own refusals arrive as a bare carrier close. The link's own view drops a machine (the roster) or the device (sign-out). Rejected: stopping the link on handshake verdicts, which would let a hostile relay keep the device off the direct carrier too.
6a. A trust change closes the channel: a retired machine key or a changed device identity bumps a trust generation, re-authenticates at once, and discards older attempts. Rejected: relying on the endpoint to close channels under a retired key, which a holder of a compromised key would not do.
7. Acts: sent or resealed only within 60 s of creation; acked-without-done and older acts queried; a step-up act never resealed; `if-asked` signs after a `step-up` refusal under the same opId; a refusal (an `ack` or a refused `done`) is final only for an act that is not ambiguous, and an ambiguous act is settled by a query alone; pending acts in memory. Rejected: resealing up to `OP_HORIZON`; query-only; reading a reseal's refusal as "nothing ran"; persisting pending acts.
8. Subscriptions: the cursor moves at each delivered `ev`, and to a snapshot's position only once its last page arrives; subscription ids are stable across channels; credit is returned on delivery. Rejected: one subscription id per channel, which would break lane A reads after a reconnect.
9. Endpoint records are fetched at each attempt, verified, and cached in `<userData>/endpoint-records.json`, so a hub outage across a relaunch still dials direct. Rejected: memory only.
10. On the router path, `list`- and `view`-graded commands go as calls, and refusals map to `internal` with `issues.refusal`. Rejected: a new `IpcError` code, which is breaking.
11. `MachineState` gains optional `carrier` and `refusal`, main-to-renderer only. Rejected: a separate `machines.transport` event.
12. Both carriers use `ws`. Rejected: Node's global `WebSocket`.
13. (M3, direction) Port forwarding is graded `shell`. Rejected: per-session `view`.
14. (Schedule) M3 needs O2 and O10 M10, not O3. M2 needs O3 only for app-less machines.
15. (M1, as built) Every production carrier reports its own end as `carrier`, so only a sealed `close` names the machine's word. Rejected: an additive change to org-protocol's `Channel` that marks sealed closes, unnecessary once no transport word reaches it.
16. (M1, as built) A step-up act's send window runs from its signature. Rejected: from `opCreated`, which a slow confirmation would spend.
17. (M1, as built) An ack timeout on a live channel queries the act; a reseal follows only a lost channel. Rejected: resealing on the ack timeout.
18. (M1, as built) The direct listener's handshake limits are a `StartOptions` field of the endpoint's test harness, and the link's `DIRECT_BUCKET` an override, for suites on loopback. Rejected: a test-only bypass in the listener.
19. (M1, as built) The link's suites may import `src/endpoint` and `test/endpoint` (an eslint exception for those test files only). Rejected: copying the harness under `test/machines`.
20. (Shape) O7 stays one child; M2, then M4 and M3 in either order, then M6, M5 with O4 and O5, M7 last. Rejected: children.
21. (M2) Subscriptions follow the tabs with a 10 s linger; the pane runs over a `session.get` record emitted as `session.changed`, one row per address. Rejected: a watch command; a parallel state.
22. (M2) `rl2.executor.machine` and `RL2_PROTOCOL.minor` 1 in M2, for `session.acquire`. Rejected: waiting for M4.
23. (M2) The step-up sheet is macOS's own, before Touch ID, for acts and for O8's state signing (P5 Decision Log 126). Rejected: an in-app sheet.
24. (M2) The gap bar from `remote.gap` and `historyUnavailable` (closes P5 Decision Log 77's tracker row). Rejected: a toast.
25. (M2) Drafts of a remote session stay in memory until O8 M6. Rejected: `session.drafts.*` rows.
26. (M3) Streams as JSON kinds behind `rl2.streams`, opened under an act's opId; `pty.spawn`, `attach`, `kill`, `list` as acts under the pty host's own ledger; `forward.open` as the endpoint's own graded action; a binary kind the named follow-up. Rejected: `pty.write` as acts; `shell` calls; a `machine` forward.
27. (M3) A remote terminal's checkpoint lives in this app's memory (A9). Rejected: persisting it in the profile.
28. (M4) The `checkout` target rule over `call.session` (`rl2.call-session`). Rejected: an `appSessionId` on git's inputs.
29. (M4) Uploads in 2 MiB parts of `files.upload`, each a `machine.op` claim. Rejected: streams; one message.
30. (M4) `session.launch` with DX6's fields and `launchedBy` for O12. Rejected: three acts.
31. (M4) `session.projects.list` offered at `list` for the machine menu. Rejected: a dedicated checkouts read.
32. (M6) The `each-session` rule and the `attention` feed (`rl2.feeds`); a listed row counts in Needs you; this Mac notifies for remote items (A8). Rejected: `cards` per listed session; a filtered `session.list`.
33. (Scenes) `e2e:remote` over a real `mawsd`, a local org, `MAWS_DEV_ORG` with `directMap`, and the records seam `MAWS_E2E_LANE_B_OWNER` under `MAWS_E2E=1`; `e2e:remote-latency` measured on the mini; the live bench against scratch machines with the clock offset estimated. Rejected: a fake endpoint; bounds in `e2e:remote`.
34. (Rows) `fs.holders`, `session.deletions.list`, `git.worktree.add/remove/deleteBranch`, `engine.models` and the drafts are not offered; `files.reveal` and `openExternal` wait for M5.

P5 findings for its writer (things in P5 that are wrong or incomplete):

- **F1.** The edge P5 Decision Log 45 gives M1 (O6, O10 and O11 alone) is right for building, but it omits sign-in. No production device opens a channel before O8's sign-in (Decision Log 38), so O7 M1's value and O9's remote lane A both wait on O8, and O8 is blocked by O12 for its other parts. See A1.
- **F2.** The in-app proof of any remote surface, a real endpoint inside `mawsd`, waits for O10 M10, which waits for O2. The Ordering table's O7 row doesn't show O10 M10 for M2 and M3.
- **F3.** "O7's log views" (Decision Logs 51, 75, 80; O14 §D) have no place in O7's purpose or in §5, and O8's project channel reads the same log plane. See A3.
- **F4.** O7's Edges say "blocked by O3" for everything after M1, but remote terminals and port forwarding (M3) need only O2 and O10 M10, and lane B's conversation (M2) needs O3 only on a machine with no app.
- **F5.** No child owns the rows of another machine's sessions in the sidebar. The renderer snapshots a machine through main-owned reads (`session.list`, `session.projects.list`, `session.digests`, `attention.list`), which the endpoint refuses to offer because they would list private sessions (O10 M5). Rows for an RL2 machine have to come from RL6 listings: OX8's from the hub, or `endpoint.listings`. O9 needs that source first (remote lane A), O8 owns OX8's listings, and O7 needs it for lane B. Recommendation: O8's first milestone, with sign-in, since it already fetches the listings; O7 and O9 consume it.
- **F6.** P5's list of O7's offer-table rows (lane B spawn, remote terminals and documents, `git.*`, `fs.holders`) omits rows that acceptance 4 needs: `files.*` and `scm.*` (open and edit a file), uploads (§5's drag and drop), port forwarding (§5), and the lane B panel reads (`session.getWorkspaceDiff` and the like).
- **F7.** O7's Contracts line omits OX4 (the client port across the channel, for client-bound tools and consent) and OX5 (a remote viewer's interest), both of which O7's later milestones use.
- **F8.** P5 acceptance 7's resume within 1 s after wake is carried by no child's acceptance. The link carries the app's half (M1's probes; M7 measures it), O9 lane A's subscriptions ride the same link, and O13 carries the phone's.
- **F9.** P5's O7 contracts line names `fs.holders` among O7's rows; its only caller is the take-over flow, which is disabled remotely (O9's residue 13), so O7 offers it to no reader. `[parent-impact]`: strike it from the line, or name the reader.
- **F10.** P5's O7 "Edges" and the Ordering table's O7 row still read the pre-O3 edges ("M1 now"; M2 "also by O3 for a machine with no app"; M4 "O3-E"); every one of those has landed. The edges now: M2 by nothing unlanded; M3 and M4 by M2; M6 by M2 (and O8 M1, landed); M5 by M2, O4 and O5; M7 by M2, M3, M4 and M6, with A11's precondition. The O10 status line "M11 next" is stale too (O10's document ticks M11 on 2026-10-29).
- **F11.** RL §6.3 lists a machine's rights as `spawn` and `machine-admin`; OX9, O10 and O8 add `shell`, which O7's terminals and forwards are graded by. The remote layer's text is a step behind P5's; for its writer.
- **F12.** The endpoint authorizes a lane B session only from sminos's member record (O12 item 7's observer); nothing in P5's O7 or O12 sections says O7's live proof depends on it (A11).
- **F13.** The `client` requests O7's §I promised (endpoint-to-device) are M5's and depend on a seam member of O3X6 (the front routing a non-socket client's port requests through the endpoint seam), which O3's recomposition should name as O7 M5's with the desk track.

## Outcomes & Retrospective

**M1 (2026-10-28).** Acceptance 1 is met in tests, and nothing changes for the owner until O8's sign-in provides a production `OrgSession`.
- **What landed:**
  - main's RL2 link (`src/main/machines/remote/`) with the org session seam (`src/main/org/`);
  - the manager's second source of links, `Machines.remote`, and `machines.list`'s `carrier` and `refusal`.
- **Proof in tests:**
  - the unit suites under `src/main/machines/remote/`, `src/main/org/dev-session.test.ts` and the extended manager suite;
  - a real endpoint over the direct carrier (`test/machines/remote-link.test.ts`, 13);
  - the hub's multiplex in Miniflare (`test/machines/remote-link.local.test.ts`, 4): up over the relay; a relay drop with an act that runs once and a subscription that loses and repeats nothing; the probe's switch to direct; the hub away across a relaunch.
- **Where the build departed from the plan, each in the Decision Log:**
  - the five findings the architect raised before the gates;
  - the four interface additions;
  - the ack-timeout query;
  - reviewer-high's three trust and expiry fixes;
  - the test-race fix the first gate run exposed.
- **Retrospective:**
  - The plan's tables held: every row of the transition table became a test as written. The fixes were all at the edges the tables left implicit: transport words reaching a sealed-close listener; time as an input to trust; a timer that a lost channel cleared.
  - For later milestones: treat every `await` between reading the session and stamping trust as a window for a stale view, and give every promise the API calls "never pending" a deadline that no transport event clears.
  - The endpoint's loopback handshake limit and the eslint import boundary both cost a round. Each is now a harness option and a scoped exception, recorded for O9's suites, which will meet both.
**M2 to M7.** Pending — written at each milestone's landing and at finish.
