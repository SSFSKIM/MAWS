# P5 O7 — Remote lane B at full depth (2026-10-28)

> **Parent:** `docs/doperpowers/plans/2026-10-27-p5-org.md` (P5), child **O7**, §"O7: Remote lane B at full depth". Parent pin: blob `e673d56fda4e1716cf3c1e05bae55595c8747e28` at master `629f1d467` (P5's Decision Logs 1–91; first drafted at `12ee346b8`, re-pinned for Decision Logs 90 and 91, neither of which names O7).
>
> **What binds.** O7's section in P5 is this document's design, and P5's approval covers it. Binding with it:
> - P5 §3 (the connection manager: one connection per machine, RL2 over either carrier, direct tried first with a short timeout, the hub relay as fallback; a machine's departure greys only its sessions) and §5 (the remote surfaces); parent acceptance 4, 5 and 8;
> - the remote layer, `docs/doperpowers/specs/2026-10-26-remote-layer-design.md` (blob `437a03eb`), cited *RL §n*: RL2 (the channel), RL3 (subscriptions), RL4 (discrete actions), RL7 (capabilities), with §4 (connection: carriers, cursors, liveness, retry, the action's opId lifecycle) and §5.6 (step-up);
> - P5's contracts OX2 (machine-scoped addresses), OX8 (the app's hub connection), OX9 (namespace grades), and P5 Decision Logs 39 (the tailnet carrier is the default), 45 (O7's first milestone is the app's RL2 link on O6's connection-manager carrier; O7 never owns lane B's ledger; only offered commands cross), 51, 53 (the device keys and step-up are main's; O7's link consumes them), 63 (the endpoint record's `addresses` are `ws://` URLs with the port), 75 and 80 (O7's log views draw O14's migration attestations by O14's Interfaces §D), 77 (`session.events`' `historyUnavailable`), 88 (what O6 left local until O7).
>
> **Built on.** O6's document `docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md` (blob `f5a91406`) and report `…-p5-o6-report.md`, landed (PR #268): the connection manager and `MachineLink` (`src/main/machines/manager.ts`), the link surface, the socket link and the second-profile stand-in. O10's document `docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md` (blob `4106f186`), M1–M9 landed: the protocol package's channel (`apps/org-protocol/src/channel.ts`), messages (`messages.ts`) and action (`action.ts`); the endpoint (`src/endpoint/`) with its offer table, subscriptions and op ledgers; the device keys and step-up in main (`src/main/device/`). O11, landed: the hub's app socket to a machine's object and the endpoint-record route. O2's document `…-p5-o2-mawsd.md` (its branch `p5-o2` near landing): `mawsd`, the pty host on a socket, the endpoint seam. O14's Interfaces §D: the history-attestation reader contract.
>
> **What this file holds.** The execution only. M1 is specified to be built now by an engineer with nothing but this document and the code. M2–M7 are **advisory**: their acceptance mapping, offer-table rows and dependencies, to be **re-planned after O3's cut**. Residue decisions are made where they bind, each with the alternative that lost, and listed in the Decision Log for P5's writer.

## Purpose

P5 makes MAWS one app over several machines. O6 gave the app a machine dimension and one connection manager, but its only other machine is a second profile on the same Mac. O10 built the door each machine opens to the outside: the endpoint, which speaks RL2 channels over the tailnet or through the hub. Nothing in the app walks through that door yet.

O7 makes the app use it, and then brings lane B to full depth across it. Lane B is a session opened from MAWS, running under the session's machine's daemon with the whole SDK surface. After O7:

- **The app holds one encrypted channel to each machine of its org (M1).** It dials the machine straight over the tailnet when it can, and through the hub when it can't. It survives drops, sleep and a switch between the two paths without losing or doubling an event or an action. Every later surface, O7's and O9's alike, crosses that one link.
- **A MAWS session on the mini or a Linux VM works from the MacBook as if it were local (M2–M7).** Its transcript streams with token deltas. Send, steer, interrupt, approvals and questions all work, and so do images, the diff, files and the editor. The panel's terminal runs in the remote worktree. Artifacts open and edit, and a dev server on the remote machine opens in the in-app browser through a forwarded port.
- **"+ Session" starts a session on another machine,** and two MAWS apps can watch and answer one session at once.

**How to see M1 working.** M1 is a main-process module. Its proof is the endpoint's own harness with the app's link in place of O10's test device. A real endpoint (`src/endpoint/`, with fake services behind it) listens on a loopback stand-in of its tailnet address and is reachable through desk-hub's Worker in Miniflare. Main's link, driven by the profile's real device keys (`src/main/device/keys.ts`) and a test org, comes `up` over the direct carrier, falls back to the relay when the direct address is dead, and switches back when it returns. It calls `session.status`, sends a lane B `session.send` that runs once across a forced drop, and streams a lane B session that resumes from its cursor with no event lost or repeated. The commands are in Concrete Steps. The owner sees nothing change until the app is signed in to an org, which is O8's sign-in (open question A1).

## Progress

- [x] M1 — The app's RL2 link (`RemoteLink`, O6's `MachineLink` over RL2) — built on branch `p5-o7-m1` (2026-10-28); its PR carries the gate runs and the review (report `docs/doperpowers/plans/2026-10-28-p5-o7-report.md`)
- [ ] M2 — Lane B's conversation over the link — *advisory; needs O10 M10 (so O2); app-less machines need O3*
- [ ] M3 — Remote terminals and port forwarding — *advisory; needs O2's pty host and O10 M10, not O3*
- [ ] M4 — The moved namespaces: diff, files, uploads and spawn anywhere — *advisory; needs O3*
- [ ] M5 — Artifacts, documents and the client-bound surfaces — *advisory; needs O3, O5, O4*
- [ ] M6 — Attention across machines, and the log view — *advisory; needs O3, O8's hub connection*
- [ ] M7 — Acceptance and the remote bench — *advisory; needs all of the above and the cutovers*

## Acceptance

The items, each with the milestone that proves it. Items 2–7 are restated from P5 and are advisory until their milestones are re-planned after O3's cut.

1. **The link (M1).** Main holds one RL2 link per machine its signed-in org state lists, and no other code in main or the renderer opens a channel.
   - A link comes `up` over the direct carrier when one of the machine's endpoint-record addresses answers within 1 s, and otherwise over the hub relay. `machines.list` then reports the machine `up` with that carrier.
   - On the relay, a probe or the 60 s recheck finds the direct carrier again and switches to it, with no event lost or repeated on an open subscription.
   - A `call` returns the endpoint's answer.
   - An action runs once across a forced drop on either carrier. It is resealed, or queried, and never doubled, which the fake engine host's own ledger shows. An action that could not be sent within 60 s ends `refused {reason: 'offline'}` and never runs.
   - A subscription resumes from its cursor across a forced drop of either carrier and a carrier switch. Every event's full cursor is checked against the producer's own numbering.
   - A device that a new org state removes sees its link stop with `removed`, and no retries follow until the session changes.
   - Proved by `test/machines/remote-link.test.ts` (direct) and `test/machines/remote-link.local.test.ts` (relay, through desk-hub's Worker in Miniflare), with unit suites under `src/main/machines/remote/`.
2. **Lane B at full depth anywhere** (P5 acceptance 4, but for artifact screenshots and export, which arrive with O5; M2–M5, measured in M7). From the MacBook, a lane B session on the mini and one on the Linux VM each do all of the following:
   - stream with token deltas;
   - send, steer and interrupt;
   - approve and deny, and answer a question;
   - take an image;
   - show the diff, and open and edit a file;
   - run a terminal in the worktree;
   - open and edit an artifact.
3. **The remote bench** (P5 acceptance 4's numbers; M7). On each carrier, measured against the same bench as the local numbers:
   - remote delta-to-paint p50 ≤ local p50 + one round trip + 10 ms;
   - a command's round trip ≤ two round trips + 20 ms;
   - open to first row ≤ 1.5 s;
   - resume ≤ engine start + one round trip.
4. **Spawn anywhere** (P5 acceptance 5; M4). "+ Session" on the mini or the VM starts a lane B session, which is in the sidebar within 5 s of the engine's first event.
5. **Two clients** (P5 acceptance 8; M2). MAWS on the mini and on the MacBook attach to one session at once. Both stream it, and an answer from one settles the card in the other.
6. **Capabilities light up** (P5's O7 acceptance; M5). O4's and O5's surfaces on a remote session are drawn from its capability lists (RL7) as each lands, never from the lane or the machine.
7. **Migrated history** (P5 Decision Logs 75, 80; M6, unless open question A3 folds it into O8). A DX1 event whose project and writer have a stored attestation that verifies and covers its seq is drawn "attested at migration by `<name>`", and any other DX1 event "(unverified, legacy)", by O14's Interfaces §D consumer contract.

## Execution

### Constraints (bind every milestone)

- **The trust model is RL's, and the link adds no authority.** The machine decides every request (RL §5.5). The link never pre-judges a grade beyond choosing `call` or `act`, never builds a request the endpoint would have to trust, and treats the endpoint's refusals as final. Every RL2, RL3 and RL4 byte is `apps/org-protocol`'s: `connectChannel` and `Channel` for the channel, `readMessage` for the vocabulary, `Action` for actions. The link reimplements none of them (P5's protocol-package rule).
- **One link per machine (P5 Decision Log 45).** RL2 channels in the app are opened only by `src/main/machines/remote/`. Every consumer reaches a machine through `Machines.remote(ref)` (Interfaces §A): O7's later milestones, O9's remote lane A, O8's sharing actions and O5's surfaces. A boundary test enforces it (M1).
- **Main signs only what main built (RL §5.6; P5 Decision Log 53).** Actions are built in main from typed fields. Step-up goes only through `src/main/device/step-up.ts`'s signer, which the org session hands the link. No key, nonce or signed byte reaches the renderer.
- **The link module imports no Electron.** `src/main/machines/remote/**` and `src/main/org/{session,dev-session}.ts` run under vitest's `node` project. Wake, focus and the network watch reach them as injected probes from `src/main/machines/index.ts`. `src/main/device/step-up.ts` imports `electron` at its top, so it is injected and never imported at runtime by these files (a type-only import is fine).
- **How main imports the protocol package.** Main imports `apps/org-protocol` by its relative path with the `.ts` extension, as `src/main/device/keys.ts` does (`'../../../apps/org-protocol/src/index.ts'`), so electron-vite bundles it. Tests may import `org-protocol`. The `from 'org-protocol'` lines in Interfaces name the module, not the import path main writes.
- **The wire.** M1 adds no host command and no event, so it does not bump `WIRE_MINOR` and `wireFingerprint()` does not move. `machines.*` is main-to-renderer traffic, outside the manifest (`src/shared/ipc/wire.ts`'s header). It adds no `IpcError` code, since `IPC_ERROR_CODES` is an enum and an added member is breaking (O1). Later milestones that add host, pty-host or machine commands take P5 Decision Log 44's re-bump rule: `WIRE_MINOR` is contested, and whoever lands second re-bumps to master's minor plus one. Each of those milestones also re-runs `e2e:cross-build` on the merge tree.
- **RL2's vocabulary changes only additively and only behind a capability.** An unknown plaintext kind closes a channel (O10 Interfaces §A). An unknown message kind is ignored. A known kind with an unknown enum value is `malformed` and closes the channel (`readMessage`). So a later milestone that adds a plaintext kind, a message, or an `executor` value bumps `RL2_PROTOCOL.minor`, names a capability, and sends the new form only to a peer whose handshake listed that capability.
- **Settings.** O7 claims no settings version. Version 20 is O2's. A later milestone that needs a setting asks P5's writer first.
- **Machines and gates.**
  - Class 1a runs through `cd /tmp && W/scripts/ci-gate.sh W --gates static,unit,probes --class1a pool`.
  - Mac e2e runs with `--runner macos --lane hosted` for the groups in `.github/workflows/gate.yml`'s hosted list.
  - On this MacBook, run one focused vitest file at a time after `pnpm install --frozen-lockfile`. Run no e2e of an engine or connector scene, and nothing that touches the Keychain or raises a TCC or firewall dialog. Tests inject `excludeFromBackup` into `loadDeviceKeys` and a `confirm` into step-up, so neither `tmutil` nor Touch ID runs.
  - Before `ci-gate`, run `npx eslint` on the touched files.
- **Live tests run on staging only.** No step connects a device to the production hub. M1 needs no live hub at all: Miniflare stands in.
- **Hands off.** Never touch the owner's running MAWS, its build output under the main checkout, or its user data. Every profile is a scratch `MAWS_USER_DATA`. Never read `~/.config/claude-secrets`. Never stage `spikes/gws-onboarding/`, `.playwright-cli/`, `node_modules` or `plugin/`. Never edit the charter, P5, the remote layer, the ledgers or `docs/tech-debt-tracker.md`. Debt and residue go to this document's record and the PR body.
- **Commits.** End every commit message with `Sminos-Session: GUI AI agent workspace charter#37052769 (MAWS on macbook)` as a second `-m`, or the line the executor's own session is given. Add no other trailer. Never rebase. Merge origin/master in when a branch needs it.
- **Review.** Each milestone lands by its own PR, with doperpowers:reviewer-high before it goes to the architect. M1 is the device side of the trust boundary: it opens authenticated channels, builds and step-up-signs actions, and decides what is resealed. Later milestones are reviewed at the rung their re-plan names.

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
- **What nobody has built yet.** The app holds no org state, has no hub session and no registered device. P5 Decision Log 38 gives the app's sign-in (Access's login transfer) to O8. M1 defines the seam it consumes, `OrgSession` (Interfaces §B). Production holds a signed-out session until O8 provides one, so M1 changes nothing for the owner.

### Plan of Work

M1 runs now and lands by its own PR. M2 and M3 need O10 M10 (the endpoint inside `mawsd`), which needs O2. They do not need O3, except where M2 serves a machine with no app attached. M4–M6 need O3, and M5 also needs O5 and O4. M7 closes. Each advisory milestone is re-planned, with its own buildability review, when its dependencies land and O3's cut has fixed what crosses. The advisory text says what each needs and adds, not how.

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

### M2 — Lane B's conversation over the link *(advisory; re-plan after O3's cut)*

**What it adds.** A remote lane B session's transcript in the app.
- Subscriptions are driven by the renderer's interest: its open tabs and visible sessions.
- They become the renderer's events through the link's `onEvent`: `session.eventBatch`, `session.status`, `session.queue`, `session.brokerItems`, `session.catalogChanged`, carried with the machine.
- Lane B acts reach the router path. The adapter fills `context` from the session's last status the person saw, and `requestDigest` from the pending request shown (`src/shared/host/request-digest.ts`'s rule).
- Images go inline in `session.send`'s content within the channel's message limit, with uploads beyond it in M4.
- Lane B's capability list (RL7's per-session half; O10 M8 leaves it to O7) is derived from the session's status and catalog.
- A resume that lost a range draws `historyUnavailable` (closing the tracker row of P5 Decision Log 77).
- Two clients settle one card. Both receive the broker's settlement on their subscriptions.

**Acceptance mapping.** Item 2's stream, send, steer, interrupt, approve and deny, answer and image; item 5.

**Offer-table rows.** None beyond O10's lane B rows, unless the panel's reads of a live session need more. Candidates are `session.getContextUsage`, `session.getUsage` and the dialog reads, each `view`. Each is added with its target rule and tests.

**Needs.** O10 M10 (the endpoint inside `mawsd`, so O2). A machine with no app attached needs **O3's** per-client subscriptions, without which the stream is `paused {no-app}` (P5 Decision Log 29). Remote rows in the sidebar need the remote-rows source (P5 finding F5).

**Adds.** The e2e group `e2e:remote`, which joins the hosted list only by gate-offload's admission rule. Its scene: profile B's private `mawsd` with its endpoint (`MAWS_ENDPOINT_DIRECT=1`) enrolled in a local hub's org; profile A signed in through `MAWS_DEV_ORG`; A streams and drives B's session.

### M3 — Remote terminals and port forwarding *(advisory; re-plan after O3's cut)*

**What it adds.** The panel's terminal for a remote session is a shell in that machine's worktree from its pty host (P5 §5). A dev server on the remote machine opens in the in-app browser through a port forwarded over the link.

**Acceptance mapping.** Item 2's terminal; §5's port forwarding.

**Offer-table rows.**
- Every `pty.*` command is graded `shell` (`src/shared/ipc/grades/pty.ts`), the machine owners' or an explicit shell right, with step-up for a non-owner (OX9; O10 M5). The endpoint answers a `call` only for `list` or `view` (`src/endpoint/authorize.ts`, `act-required`), so every row is an act, `pty.attach` and `pty.list` included, `pty.list` filtered to the caller's own terminals. Rejected: re-grading `pty.list` and `pty.attach` to `view`, which would let a viewer of one session read every terminal on the machine. The alternative M3's re-plan may weigh is an authorization change that admits `shell`-graded calls, asked of O10's owner.
- `pty.spawn`, `pty.write`, `pty.resize` and `pty.kill` run under a pty-host op ledger, which lifts O10 M7's `no-ledger`. `pty.attach` and `pty.list` are reads that need no ledger entry, so M3 decides whether reads that are acts are exempt from `no-ledger`.
- Flow control and checkpoints. The pty host pauses a pty once 256 KiB are unacknowledged (`src/pty-host/flow.ts`), and O2's seam attaches the endpoint with `credit: false` and refuses its `pty.ack` and `pty.checkpoint`, because `mawsd` owns the pty's credit. M3 maps a remote viewer's RL2 stream credit onto `mawsd`'s acknowledgements, so that a slow remote viewer neither stalls the pty for a local one nor loses output (offset dedup, RL §4.8), and decides where a remote viewer's emulator checkpoint lives.
- A forward-open act, also graded `shell`. Forwarding reaches every service on the machine's loopback, which is machine-level access like a shell. Rejected: per-session `view`, under which a viewer of one session could reach every local service.

**RL2 additions,** each behind a capability and an RL2 minor bump:
- a binary plaintext kind for pty output with its offset, deduplicated by offset as RL §4.8 requires, carried over O2's binary `pty.data` frames on `mawsd`'s side (`onFrame`);
- a byte-stream kind for forwarded connections;
- a `query.executor` value for the pty host's ledger.

**Needs.** O2's pty host forked by `mawsd`, and O10 M10. **Not O3.** It closes the tracker row "`hostReady` reads the local pty host" (P5 Decision Log 88). `pty.list` was left local by O6, and M3 makes it remote.

**WIRE_MINOR.** Likely, if the pty host gains a ledger command.

### M4 — The moved namespaces: diff, files, uploads and spawn anywhere *(advisory; re-plan after O3's cut)*

**What it adds.** The panel's diff, file tree and editor for a remote session read and write through that machine's services. Ranged, inode-checked reads are §5's. Drag and drop uploads bytes into the session's attachments directory on its machine before the message is sent, so paths in a message are the machine's (§5). "+ Session" gains a machine picker that defaults to this Mac, plus the checkout and worktree of the project on that machine, and says which lane and inference route the session gets (§8; open question A5). Spawning a lane B session on another machine is a step-up act.

**Acceptance mapping.** Item 2's diff and file; item 4.

**Offer-table rows.**
- `git.*`, `files.*`, `scm.*`, and lane B reads the diff view uses, such as `session.getWorkspaceDiff`. Reads are `view` on a session and writes are `manage`, under a target rule that checks the path lies inside the named session's checkout. A path-only command names its session in an optional RL2 `session` field on `call`, which is additive.
- `fs.holders`, its answer filtered to sessions the caller holds `list` on.
- The remote spawn act, a machine `spawn` right with step-up, which builds the launch spec on the machine (O10 Interfaces §G leaves `session.launch` to O7).
- An upload act.
- `session.search` and `session.deletions.list`, which O6 left local, re-graded for a remote caller.

**Needs from O3.** C2, C3, C4, C5 and C8 below.

### M5 — Artifacts, documents and the client-bound surfaces *(advisory; re-plan after O3's cut)*

**What it adds.**
- A remote session's artifacts open and edit. Documents are Yjs over channels, in the endpoint's own channel range of O2's seam. Artifact pages come through the daemon's HTTP artifact endpoint, carried over the link (§5).
- The client-bound tools reach the attached app over the link: `show_pane`, notifications, and OX4's pick, save, confirm and reveal for a remote daemon (RL §3.1).
- O4's and O5's capabilities light up from the capability lists.

**Acceptance mapping.** Item 2's artifact open and edit (screenshot and export are O5's acceptance 10 and 4's carve-out); item 6.

**Offer-table rows.** `documents.*` (read against edit, an actor the endpoint sets: O10 M8's note); `artifacts.*` reads and edits. RL2 additions: a document-frame kind, a request and response kind for the artifact endpoint, and endpoint-to-device `client` requests for OX4. Each sits behind a capability.

**Needs.** O3 (C7, C10), O5 (the artifact endpoint, the render service's capability entries, U3's outcome for the agent's browser), O4 (capability entries for connectors, delivery and the library; consent opened on the client through C7).

### M6 — Attention across machines, and the log view *(advisory; re-plan after O3's cut)*

**What it adds.**
- Notifications, the dock badge and ⌘⇧J count and open every reachable session on every machine. P5 Decision Log 27 gives these to O3 and O7: O3's client-side mirror, O7's remote feed.
- O7's log view (P5 Decision Logs 51, 75, 80) draws the project's agent-to-agent log from OX8's log plane, with RL8 signatures, RL9 owner labels (`owned by <email>`) and O14's migration attestations by its Interfaces §D contract (`verifyHistoryAttestation(record, events, head, certificates, at, now?)`). Open question A3 asks whether this view should exist apart from O8's project channel.

**Acceptance mapping.** Item 7; P5 §8's "Overview and attention span machines".

**Needs.** O3 (C6), and O8's hub connection (OX8's log plane and listings).

### M7 — Acceptance and the remote bench *(advisory; re-plan after O3's cut)*

**What it adds.** Items 2–7 run on the MacBook against the mini and a devcloud VM after their cutovers (O14). The bench of OX7 gains a remote mode that measures item 3's numbers on each carrier. P5 acceptance 7's resume within 1 s of the network returning after wake is measured for remote lane B subscriptions too (the link's half; O9 and O13 carry theirs).

**Needs.** M2–M6, O14's cutovers of the mini and the VM, and the owner's tailnet with the listener port open from the Macs (P5 Decision Log 75 (9)).

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

## Open questions for the owner

Each is built provisionally as recommended, unless it says otherwise, and changed if the owner answers differently.

- **A1. When the owner first sees remote machines in MAWS** (scheduling; for the architect and the owner). M1 runs now, but no production app can open a channel until it is signed in to the org, which is O8's sign-in (P5 Decision Log 38). *Recommendation:* split O8's sign-in into a first milestone and dispatch it now. It needs only O6 and O11, both landed, and its production `OrgSession` turns M1 on. *Alternative:* wait for O8 as planned, which also holds O9's remote lane A.
- **A2. How the app shows a machine's path to it.** *Recommendation:* show no carrier on the machine chip. The machine row's hover says "direct (tailnet)" or "via the hub". "Hub unreachable" appears once, apart from any machine's "offline" greying, as P5 §3's "hub-offline, channel-up". A device the org removed greys that machine's rows with "This Mac is no longer allowed on `<machine>`". *Alternatives:* a small relay mark on the chip; showing nothing beyond online and offline. **[owner, 2026-10-28: as recommended; P5 Decision Log 108.]**
- **A3. Whether O7's log view exists** (for the architect first). P5 Decision Logs 51, 75 and 80 name "O7's log views" as a reader of migrated history, and P5 Decision Log 51 calls it "a project-wide view of what a person's sessions said". O8's project channel reads the same log plane. *Recommendation:* fold it into O8's channel, so the log plane has one reader and O14's B4 waits on one. *Alternative:* keep it in O7 as a per-person filter of the project's agent-to-agent traffic (M6).
- **A4. A message sent to a remote session while its machine is unreachable.** *Recommendation:* hold it for 60 s, then show "Not sent: `<machine>` is offline" with Send again. M1 builds this rule. *Alternatives:* an outbox that sends typed messages whenever the machine returns, with answers and interrupts never waiting; failing at once. **[owner, 2026-10-28: as recommended; P5 Decision Log 108.]**
- **A5. The "+ Session" machine picker** (M4; to settle before it is re-planned). *Recommendation:* a machine menu beside the project picker, defaulting to this Mac, that lists the machines where the project has a checkout, with one line under it saying the lane and the inference route. *Alternatives:* the machine folded into the project row ("maws @ mini"); a two-step dialog. **[owner, 2026-10-28: as recommended; P5 Decision Log 108.]**
- **A6. Forwarded ports** (M3). *Recommendation:* a `localhost:<port>` link in a remote session opens through a forward in the in-app browser, marked "forwarded from `<machine>`", without asking. *Alternatives:* an explicit "Forward port…" command; asking each time. **[owner, 2026-10-28: as recommended; P5 Decision Log 108.]**

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

P5 findings for its writer (things in P5 that are wrong or incomplete):

- **F1.** The edge P5 Decision Log 45 gives M1 (O6, O10 and O11 alone) is right for building, but it omits sign-in. No production device opens a channel before O8's sign-in (Decision Log 38), so O7 M1's value and O9's remote lane A both wait on O8, and O8 is blocked by O12 for its other parts. See A1.
- **F2.** The in-app proof of any remote surface, a real endpoint inside `mawsd`, waits for O10 M10, which waits for O2. The Ordering table's O7 row doesn't show O10 M10 for M2 and M3.
- **F3.** "O7's log views" (Decision Logs 51, 75, 80; O14 §D) have no place in O7's purpose or in §5, and O8's project channel reads the same log plane. See A3.
- **F4.** O7's Edges say "blocked by O3" for everything after M1, but remote terminals and port forwarding (M3) need only O2 and O10 M10, and lane B's conversation (M2) needs O3 only on a machine with no app.
- **F5.** No child owns the rows of another machine's sessions in the sidebar. The renderer snapshots a machine through main-owned reads (`session.list`, `session.projects.list`, `session.digests`, `attention.list`), which the endpoint refuses to offer because they would list private sessions (O10 M5). Rows for an RL2 machine have to come from RL6 listings: OX8's from the hub, or `endpoint.listings`. O9 needs that source first (remote lane A), O8 owns OX8's listings, and O7 needs it for lane B. Recommendation: O8's first milestone, with sign-in, since it already fetches the listings; O7 and O9 consume it.
- **F6.** P5's list of O7's offer-table rows (lane B spawn, remote terminals and documents, `git.*`, `fs.holders`) omits rows that acceptance 4 needs: `files.*` and `scm.*` (open and edit a file), uploads (§5's drag and drop), port forwarding (§5), and the lane B panel reads (`session.getWorkspaceDiff` and the like).
- **F7.** O7's Contracts line omits OX4 (the client port across the channel, for client-bound tools and consent) and OX5 (a remote viewer's interest), both of which O7's later milestones use.
- **F8.** P5 acceptance 7's resume within 1 s after wake is carried by no child's acceptance. The link carries the app's half (M1's probes; M7 measures it), O9 lane A's subscriptions ride the same link, and O13 carries the phone's.

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
