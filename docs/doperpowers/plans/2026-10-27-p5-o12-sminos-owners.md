# P5-O12 — sminos under the endpoint: owners, the opId ledger and the lane B observer (2026-10-27)

> **Parent:** `docs/doperpowers/plans/2026-10-27-p5-org.md` (the P5 composite), child **O12**, §"O12: sminos under the endpoint". Parent pin: blob `a923eb6e09118cd848477322fb9d4721c9fe381f` at master `4abec20ca`. Binding on this child:
> - the remote layer `docs/doperpowers/specs/2026-10-26-remote-layer-design.md` (cited *RL §n*): RL6 (the session record), RL9 (the owner attestation), RL10 (endpoint ↔ sminos), §5.7 (who may write a person's words), §5.8 (default owners) and §6.4 (principal and inference route);
> - the desk control-surface spec `docs/doperpowers/specs/2026-10-22-desk-control-surface-design.md` (MW1–MW5: the bridge's ops, controls and the media RPC);
> - the holder design `research/desk-remote/session-holder-design.ko.md` §3.2 and §3.4 (the observer bridge and the reaping fence).
>
> **Owner:** desk-sminos-orchestrator. **Repositories:** doperpowers (the sminos plugin: `sminos/skills/sminos/scripts/`, `sminos/hooks/mods/`, `sminos/tests/`) and MAWS (the lane B marker). MAWS lands first whenever both change, and every new field is optional. This document is the child's standalone execution record. Residue decisions go to P5's Decision Log under O12, through the P5 writer.

## Purpose

sminos is the project family on every machine: who works where, their messages, and the delivery of a person's words into a session. Today it knows nothing about people. A session has a spawner alias at most, nothing names whose session it is, and the bridge mod controls every Claude Code session it loads in. That includes the `claude -p` sessions MAWS opens, where MAWS's own controller is the one in charge. This child gives sminos the owner model and takes it off the network:
- every session gets a durable, machine-held record of who owns it, how it started and what inference it runs on;
- the RPC ledger answers by operation id, so a reconnecting app can ask what became of an action;
- inside a MAWS lane B session the bridge only observes, so two controllers never fight over one session.

Later milestones, once O10's endpoint exists, route a person's words by who may drive the session, label agent messages with signed owners, move to-human messages off the hub, and make sminos local-only.

What someone can see after the first phase:
- `sminos list --json` shows each session's owners and origin;
- a `sminos spawn` child shows its parent's owners and the parent's session id;
- the daemon's ledger answers `query <opId>`;
- a MAWS lane B session's capabilities say "MAWS controls this session", and a `sminos steer` at it is refused rather than racing MAWS.

## Progress

Phase 1 (dispatchable now; P5's item 1, item 4, and item 7's refusals):
- [ ] M1 — The session record (item 1)
- [x] M2 — The opId ledger (item 4). Reviewed clean (doperpowers:reviewer-medium, one P2 fixed), landed as doperpowers PR #401 (`bdd39e50`, sminos 1.17.0), 2026-10-27T03:00Z.
- [ ] M3 — The lane B observer: marker and refusals (item 7, first part)

Blocked (P5's edges):
- [ ] M4 — The reaping gate (item 7, rest). Blocked by U6's measurement (in O3) and by OX10's agreement with O16's author.
- [ ] Phase 2: items 2, 3, 5, 6 and 8 (words, the label, local-only, to-human off the hub, the mini). Blocked by O10's RL10. Their milestones are written into this document when RL10's interface is fixed in O10's execution document, so they bind against its real names.

## Acceptance

P5's O12 acceptance items 1, 4 and 7 are this phase's acceptance, checked as follows (commands in Concrete Steps):
1. **The record.** In an isolated `SMINOS_HOME` and `HOME`, with one terminal-like session and one seat:
   - `sminos list --json` carries `owners` and `origin` for every member. The terminal session shows `owners: ["@machine"]` and `origin: {kind: "terminal"}`.
   - A seat spawned from inside that session shows the same `owners`, `origin: {kind: "sminos-spawn", spawnerSession: <the parent's id>}`, and the parent's `principal` and `inference`.
   - A desk-RPC spawn shows `owners: [<member>]` and `origin: {kind: "maws", requester: <member>}`.
   - The record file `$SMINOS_HOME/session-records/<session>.json` exists, mode 0600, and survives a `--bg` hand-off to the new session id. A move to another project leaves it unchanged.
   - A seat whose hook ran before its spawner learned its session id still carries its parent's owners (`source: 'launch'`).
   - A session whose log predates this change reads back as `owners: ["@machine"]`. A later `joined` without owners, written by an older daemon, doesn't erase them.
   - No `principal` or `inference` field appears in any log event.
2. **The ledger.**
   - The daemon's `query` answers by state: `done` for an op whose outcome is done, `refused` for one refused at admission, `in-progress` for a claimed or in-flight op, `expired` for one older than the replay horizon, and `not-received` for an unknown id inside it.
   - After a tombstone, a late arrival of that id is refused `tombstoned` and never runs. A tombstone is refused while the op is in flight or claimed.
   - A resealed copy of an id the ledger has pruned is refused `expired`, and one that omits `opCreated` is refused `bad-op-created`.
   - A DX6 RPC with no `opId` is keyed by its nonce, as today. Every existing ledger, spawn, reconcile and MW5 upload test passes unchanged.
3. **The observer.** With `MAWS_LANE=B` set, and the session's parent process being the `SMNS_MEMBER` pid:
   - the bridge's `capabilities.controls` reports every key `{available: false, reason: "MAWS controls this session"}`, and `ops` is empty;
   - each control op (steer, interrupt, stop, model, compact, deliver, answer, command, btw, stop-agent, tell, media) sent through the child is refused `lane-b`;
   - `sminos decide` and `sminos answer` against it are refused `lane-b` at the child's decision route;
   - no permission request is raised to the desk;
   - `turn.step` claims no media and rewrites no model or effort, while main-loop and subagent chunks still post;
   - desk Resume of such a session after it ends is refused `lane-b`;
   - the same session without the marker, or a `claude` started from its Bash (marker inherited, another parent), behaves exactly as today.

## Constraints that bind every milestone

- **RL6 is the record's contract.** The shape is in Interfaces. P5's O12 text says `credential {slot, kind, principal}`, but RL6, revised after it with the owner's co-owner ruling (RL Decision Log, 2026-10-26), splits that into `principal` and `inference`, and RL6 binds. This is recorded as residue in this document's Decision Log.
- **What stays on the machine.** `principal`, `inference`, `controller` and `source` never leave it: they appear in no log event, no hub frame and no `--org` output. `owners`, `ownersProof` and `origin` are listing material and may ride on `joined` (RL §6.2), except the token `@machine`, which never leaves the machine (RL6, remote layer Decision Log 17): owners holding it stay off the event.
- **Older readers and writers coexist.** The long-running daemon keeps running old code until it restarts, and older sminos versions on other machines read the same logs. Every field is additive. Owners are read the way `by` is read today: from the first `joined` along the lineage that carries them, never from the latest one. A later event without them never erases them.
- **No secret in a record.** `inference.settingsRef` names a file path, never inline settings content. Gateway settings carry environment, which may hold tokens. Inline `--settings` JSON is referenced by the merged launch file sminos already writes (`$SMINOS_HOME/settings/<sha16>.json`).
- **Tests run against isolated homes.** Every test sets `HOME` and `SMINOS_HOME` to temporary directories. Running a working-copy sminos against the real `~/.claude/sminos` performs a one-way import and is forbidden. The suites are `sminos/tests/run-sminos-tests.sh` (parts `core` and `suites`), `sminos/tests/test_rpcs.py`, `sminos/tests/mods/run.sh` and `tests/mods/typecheck.sh`. Verify on CI with `ci-gate` in each repository.
- **Every change bumps the sminos plugin's version** in the same commit, with `scripts/bump-version.sh --plugin sminos`. The marketplace updates by number alone.
- **Plugin documentation follows the code.** `sminos/hooks/mods/CLAUDE.md` (the bridge paragraph) and `sminos/skills/sminos/scripts/CLAUDE.md` describe the record, the ledger's `query` and the observer mode once they exist.

## Plan of Work

### M1 — The session record

**What exists at its end.** Every session sminos joins has a machine-local record, `$SMINOS_HOME/session-records/<session>.json`, written atomically at mode 0600 by `_write_record`'s rule. It holds the RL6 fields this phase fills:
- the provenance, written once: `origin`, `owners`, `ownersProof`, `principal`, `inference` and `created`;
- the current controller, which changes over the session's life: `controller {lane, since}`;
- `source`, recording how the provenance was established.

`owners` and `origin` also ride on each new `joined` event. `sminos list --json` shows `owners` and `origin` for every member, and `principal`, `inference` and `controller` for local members.

**What it touches.**
- `sminos/skills/sminos/scripts/sminos.py`:
  - `joined_fields`, `lifecycle` and every `joined` writer (`join_on_sight`, `join_seat`, `refresh_joined`, `spawn_fresh`, `move_session`, `hand_off`);
  - `record_session` (the hook path), `launch_settings`, `launch_env`;
  - `_projection`, `_member`, `Member`, `member_json` and `vacant_member`.
- `sminos/skills/sminos/scripts/sminos_rpc.py`: `spawn` passes the requester.
- Tests: `sminos/tests/run-sminos-tests.sh` (core) and a new `sminos/tests/test_records.py`.

**Interfaces.** Exposes the record (Interfaces §A) and its reader `session_record(sid)` to M3 and Phase 2. RL10's endpoint reads it in O10.

**Decisions.**
- **A spawned child's provenance is fixed before it exists.** `spawn_fresh` learns the child's session id only after `claude --bg` returns and `poll_uuid` finds it, while the child's hooks may already be running. So the provenance travels with the launch:
  - `spawn_fresh` writes `session-records/pending/<launch-id>.json` holding the child's provenance before it runs `claude --bg`;
  - it always writes the merged launch settings file, even under the default home where `launch_settings` returns the raw settings today, with `env.SMINOS_LAUNCH=<launch-id>` beside `env.SMINOS_HOME`;
  - the child's first `record_session` claims the pending file by an atomic rename to `<session>.json`, with `source: 'launch'`.

  The claim is the first thing `record_session` does on the child's SessionStart. It runs before any of its early returns (an engine registry not yet holding the session, a missing transcript) and needs only the hook's own session id. SessionStart completes before the session runs any tool. So the seat claims before anything it starts can run, and any later claimant, such as a `claude` launched directly from the seat's Bash with the inherited variable, finds the file gone. A claim is also refused unless the claiming session is new: no record for its id, and the hook's `source` is `startup`. `launch_env` drops `SMINOS_LAUNCH` from the environments sminos builds. A pending file unclaimed after a day is removed by the daemon's sweep. The spawner exiting before `poll_uuid` changes nothing, since the child claims for itself. Rejected: passing `--session-id` through `claude --bg`, which isn't measured to work for background launches.
- **What each path writes.**
  - **A `sminos spawn`** copies `owners`, `ownersProof`, `principal` and `inference` from the caller's record when the caller is a session (`CLAUDE_CODE_SESSION_ID`). Its `origin` is `{kind: 'sminos-spawn', spawnerSession}`. A seat whose `settings` are non-empty gets `inference: {kind: 'route', settingsRef: <the merged launch file's path>}` in place of the parent's.
  - **A desk-RPC spawn** (`sminos_rpc.spawn`, `SMINOS_DESK_MEMBER` set) writes `owners: [<member>]`, `principal: <member>` and `origin: {kind: 'maws', requester: <member>}`. It is the predecessor of a MAWS remote spawn on a lane-A machine (RL §3.4).
  - **The hook path, for a session nobody launched through sminos,** writes `origin.kind`:
    - `maws` when `member_mark` marks a MAWS engine;
    - otherwise `terminal`.

    For `inference` it writes a route when the session's environment shows one: `ANTHROPIC_BASE_URL` set gives `{kind: 'route', settingsRef: 'base-url:<scheme>://<host>[:<port>]'}`, with no path or query, as MAWS's gateway launches set it. Otherwise it writes `{kind: 'slot', configDir}` from `CLAUDE_CONFIG_DIR`, else the default `~/.claude`.
- **Provenance is written once, and defaults are provisional.** Initialization tries its sources in this order:
  1. a pending launch claim (`source: 'launch'`);
  2. a predecessor's record along the continuation lineage, whether that is `hand_off`'s `former` or a `retired … continued` event naming this session (`source: 'lineage'`);
  3. the first `joined` along the lineage that carries `owners` (`source: 'lineage'`);
  4. only then the defaults: `owners: ["@machine"]`, `principal: "@machine"`, origin `terminal`, the default slot (`source: 'default'`).

  A `default` record is provisional, and it stays provisional when it is inherited. A continuation or spawn that copies a provisional record keeps `source: 'default'`. Only a record whose evidence chain reaches a launch claim or the hook's own environment is final. A provisional record is replaced when such evidence appears, for instance after an older daemon's `hand_off` that copied no record. The record file wins over the log when both exist locally.
- **The controller is current state, not provenance.** RL §3.2 lets an ended lane-A conversation reopen as lane B under the same session id. So `controller {lane, since}` is updated at each launch by the bridge's verdict (M3), relayed by its child, and never copied as provenance. Desk Resume reads `controller.lane`.
- **`@machine`** stands for "this machine's owners", as RL6 now allows (remote layer Decision Log 17, PR #185). Nothing on a machine knows its owner's member id until the org state exists (O10, O11). RL10's endpoint resolves it against the current state:
  - for grades, at dispatch;
  - for attestations and listings, at the stamped `orgStateVersion`;
  - for `principal`, through the machine's binding of the record's inference slot.

  The token never leaves the machine. Late binding is deliberate: a terminal session's owners are its machine's owners by definition (RL §6.1), so a change of machine ownership should change them, and receivers check terminal sessions against the machine's current owners anyway.
- **Only final provenance is published.** A `joined` carries `owners` and `origin` only when the record is final. A provisional record publishes neither, and remote readers fall back to the same `@machine` default, so they see the same value without being bound to it. Owners that hold `@machine` are never published, final or not: the `joined` carries `origin` alone, and readers fall back to the same default.
- **The readback rule for other machines' members.** `_projection` and `_member` take `owners` and `origin` from the first `joined` along the lineage that carries them, as `by` is taken today. A member with neither reads `owners: ["@machine"]`, `origin: {kind: 'terminal'}`.
- **Moves** (`move_session`, `by="move"`) leave the record as it is.
- **`by` is not reused.** It keeps mixing aliases, member ids and `move`, and it means "who wrote this event", not "whose session".

**Not touched.** RL6's `access`, `shares` and `context` (written by `manage` actions from O8 and O10; absent means `listed` and `[]`). The hub. Any signing (O10).

**Proves.** Acceptance 1. Tests also pin:
- a child whose hook runs before `poll_uuid` returns gets the parent's owners, not the defaults;
- a parent whose first hook can't complete registration, followed by a `claude` launched directly from its Bash, leaves the parent's claim with the parent;
- a provisional join already read on another machine is corrected there once the final record publishes;
- a continuation from a predecessor whose record is still provisional stays provisional;
- a seat spawned from a seat copies the grandparent's owners;
- an older binary's `hand_off` followed by new-binary reconciliation recovers the ancestor's owners, rather than freezing defaults;
- a `joined` written by an older binary (no owners) after a new one doesn't change what `list` shows;
- inline `--settings` JSON never appears in a record, with `HOME` temporary and both `SMINOS_HOME` and `DAEMON_HOME` unset;
- a process started from a seat's Bash doesn't claim the seat's pending launch;
- the record survives the daemon's restart and a `/reload-plugins`.

### M2 — The opId ledger

**What exists at its end.** The daemon's RPC ledger (`sminos_rpc.py`'s `Ledger`) is keyed by an operation id: the RPC's `opId` when present, else its nonce, so every DX6 RPC is keyed exactly as today.
- Claiming and tombstoning are one serialized transition. A tombstoned id never runs, and a claimed one can't be tombstoned.
- The daemon's `query(opId, opCreated?)` answers `done | refused | in-progress | not-received | expired | unavailable`.
- An id older than the replay horizon is refused `expired`, so pruning the ledger never reopens an id.
- A `sminos rpc-query <opId>` verb prints the ledger's view for diagnosis. RL10 carries the daemon's `query` in Phase 2.

**What it touches.** `sminos/skills/sminos/scripts/sminos_rpc.py`:
- `receive`, `run`, `Ledger` and the controller's `flight`;
- `reconcile`, `media`, `spawn`'s stamp and `alias_for`.

`sminos_media.py`, only through the id it is handed. `sminos.py`, for the verb. Tests in `sminos/tests/test_rpcs.py`.

**Interfaces.** Exposes the controller's `query` and `tombstone` (Interfaces §B) to Phase 2's RL10 handler.

**Decisions.**
- **One key, derived once.** `receive` derives `op = rpc.get("opId") or rpc["nonce"]` and uses it everywhere the nonce is used as an identifier today:
  - the ledger and `flight`;
  - the bridge command's `rpc` field;
  - `alias_for`;
  - the `rpc_nonce` stamp;
  - MW5's upload id, and with it the media file names.

  `rpc-result` and `rpc-ack` toward the DX2/DX6 hub stay keyed by `nonce`, which the entry keeps when it differs.
- **Shape guard.** An `opId` must match `^[A-Za-z0-9_-]{16,128}$` before it becomes a file name or an alias seed. Otherwise it is refused loose with `bad-op-id`. MW5's mod accepts `^[A-Za-z0-9_-]{1,128}$`, and every opId passing this guard passes that.
- **One transition for claim and tombstone.** Both run in the daemon's controller, under one lock that covers `flight` and the ledger write:
  - an op enters `flight` only if the ledger holds no tombstone for it;
  - the claim (`Ledger.claim`, replacing today's unconditional `put`) is conditional: it refuses an id that is tombstoned or already claimed;
  - `tombstone` refuses an id that is in `flight` or claimed.

  The reconciler skips tombstones: an entry without an outcome is interrupted work only when it isn't a tombstone. `rpc-query` reads only the ledger file. It can't see `flight`, so it answers `not-received` where the daemon would answer `in-progress`, and it says so in its output. It never tombstones.
- **The id's lifetime** (remote layer Decision Log 18).
  - An RPC that carries `opId` must carry `opCreated`, which stays the same across reseals. Without it, the RPC is refused loose with `bad-op-created`.
  - An `opCreated` later than the RPC's `created` by more than `FRESH_S` is refused the same way. The ledger prunes by receipt time, so without this bound an app clock running ahead would reopen the hole.
  - Only a legacy, nonce-keyed RPC (no `opId`) uses its `created` as `opCreated`. Its nonce can never be resealed.
  - Receipt refuses an op whose `opCreated` is older than `OP_HORIZON = KEPT_S − 3600` seconds with `expired`.
  - `query` answers `expired` for such an id, given or stored, instead of `not-received`.
  - Pruning at `KEPT_S` therefore never lets a resealed copy of an old id run again. Today's `created` freshness check stays as it is.
  - Asking remote-architecture to add `opCreated` to RL4 is this document's residue.
- **What `query` answers.**
  - `done {outcome}`: the entry has an outcome other than an admission refusal.
  - `refused {outcome}`: the entry's outcome is an admission refusal.
  - `in-progress`: a claim without an outcome, or the op is in `flight`.
  - `expired`: older than the horizon.
  - `not-received`: no entry, inside the horizon. That includes a loose refusal from checks 1–2, which never enters the ledger and ran nothing.
  - `unavailable`: the ledger is unreadable. Fail-closed stays, and the answer is never `not-received` (RL4's name for it, so the app shows "outcome unknown" and asks again).

**Not touched.** The RL10 transport (Phase 2). The hub's DX6 shapes.

**Proves.** Acceptance 2. Tests also pin:
- with a worker paused between admission and claim, a tombstone call is refused while the op is in `flight`;
- an op tombstoned before admission never reaches `flight`;
- a reseal of a pruned id is refused `expired`;
- a reseal of a pruned id that omits `opCreated` is refused `bad-op-created`, never run;
- an `opCreated` more than `FRESH_S` after `created` is refused;
- a tombstone survives a daemon restart, and the reconciler doesn't answer it `interrupted`.

### M3 — The lane B observer: marker and refusals

**What exists at its end.** MAWS's engine host sets `MAWS_LANE=B` on every `claude -p` child it launches, beside `SMNS_MEMBER=<its own pid>`, which it already sets. A session is lane B when both hold: the marker is present, and `member_mark` confirms that the session's parent process is the `SMNS_MEMBER` pid (sminos's existing, tested check). A `claude` started from a lane B session's Bash inherits both variables but has a different parent, so it stays a lane A controller.

The bridge mod reads the marker at `bridgeStart` and is a provisional observer until its child's hello carries the parent check's verdict (the mod can't read a parent pid; the child can). The verdict has three states, since `member_mark` returns false both for a different parent and when the session's pid or `ps` is unavailable:
- `match`: an observer;
- `mismatch`: a full controller, but only on positive evidence that the session's parent pid is known and differs;
- `unresolved`: stays an observer. The child retries every 2 s for up to a minute, then every 30 s, and never publishes lane A. The verdict is kept in `$.state`, so a module reload keeps it, and it is relayed to the record's `controller` (M1).

In observer mode:
- every control op is refused `lane-b`, and every `capabilities.controls` key is `{available: false, reason: "MAWS controls this session"}`;
- `ops` is empty;
- no permission request or question is raised to the desk;
- `turn.step` neither claims media nor rewrites model or effort;
- chunk and step posting (the subagent deltas) continues;
- the bridge child refuses its decision route, `POST /requests/<id>/decision`, with `409 lane-b`;
- the daemon's desk Resume refuses a session whose `controller.lane` is `B`, with `lane-b`. Reopening a lane B session is MAWS's.

**What it touches.**
- MAWS: `src/engine-host/launch.ts` (`buildEnvironment`) and its test. This lands first, by PR to MAWS master.
- doperpowers:
  - `sminos/hooks/mods/bridge.tsx` (`bridgeStart`, `commandAnswer`, the request raises, `turn.step`);
  - `bridge-controls.tsx` (`controlsOf`);
  - `bridge-state.tsx` (the verdict);
  - `sminos/skills/sminos/scripts/sminos_bridge.py` (the verdict in the hello, the decision route);
  - `sminos_rpc.py` (resume);
  - `sminos.py` (`launch_env` drops `MAWS_LANE`).
- Tests: `sminos/tests/mods/bridge.test.ts`, `sminos/tests/test-bridge-control.sh`, `test-bridge-requests.sh` and `test_rpcs.py`.

**Interfaces.** Consumes the marker (Interfaces §C). Exposes the observer verdict to M4 and `controller` to M1.

**Decisions.**
- **The marker plus the existing parent check** (P5 Decision Log 16). `MAWS_LANE=B` states the lane. `SMNS_MEMBER`'s parent-pid rule, already in `member_mark`, binds it to the process the engine host launched. A session host that later sits between the engine host and `claude` sets `SMNS_MEMBER` to its own pid. Rejected: the marker alone, which leaks through every Bash child, and `CLAUDE_CODE_ENTRYPOINT=sdk-ts`, which every SDK client sets.
- **Refusal is total.** The bridge already runs as a full controller in every lane B session, and two controllers on one session is the failure this mode removes. `deliver` refused in observer mode falls back, as today, to the inbox frame, so a person's words sent through sminos to a lane B session arrive as a peer message. MAWS owns that session's input.
- **Raises stay off.** MAWS answers permission and dialog requests through `--permission-prompt-tool stdio`. A desk card would be one it can't answer.
- **The provisional window.** Between `bridgeStart` and the child's verdict, the marker's presence alone holds controls refused. A lane A session that inherited the marker is refused control for that window only.

**Not touched.** The reaping gate (M4). Where subagent deltas go in lane B: they keep going to the bridge child, and O16 decides whether the engine host takes them from the child or over OX10. The engine host (O16).

**Proves.** Acceptance 3. Tests also pin:
- a `claude` started from a lane B session's Bash, with both variables inherited and a different parent, is a full lane A controller once its child's verdict arrives;
- a marked session whose pid isn't yet in the registry, and one whose `ps` fails, each stay observers with `controller` unset, and become `match` once the check resolves;
- a module reload keeps the verdict;
- a lane-A session later reopened by MAWS as lane B (same session id) has `controller.lane: 'B'` and is refused desk Resume after it ends;
- a `sminos spawn` child of a marked session doesn't carry `MAWS_LANE`.

### M4 — The reaping gate (blocked)

**Blocked by** two things:
- U6, the measurement in O3 of whether `turn.step` holds cron-fired and task-notification turns in a `-p` process (RL §12.2);
- OX10's adoption in O16's execution document (P5 Decision Log 16).

This is the protocol O12 proposes. It is revised after the buildability review, so the host can never signal while the observer believes a turn may proceed:
- **The address.** The engine host sets `MAWS_HOLDER_SOCKET=<path>` (0600, same uid) beside the lane B marker. The observer connects at `bridgeStart`, sends `hello {protocol: 1, session, pid}`, and sends `hb` every 5 s.
- **An acknowledged fence with a lease.**
  - The host sends `arm {fence, leaseMs}`. The observer installs the fence and answers `armed {fence}`.
  - The host may send its final checks and SIGTERM only after `armed` arrives, and only while the lease is unexpired by its own clock. To go on holding past the lease, it renews with `arm` of the same fence and waits for `armed` again. It ends the fence with `disarm {fence}`.
- **A turn while armed.**
  - The observer's main-loop `turn.step`, before calling `next`, sends `turn {fence, origin: 'query' | 'cron' | 'task' | 'unknown'}` and waits.
  - On `proceed` (the reap was cancelled), it calls `next`.
  - On `stop` (the session is ending), it doesn't call `next`, and streams one text chunk: "The holder ended this session; reopening it continues the conversation."
  - With no answer, it waits until the fence's lease has expired by its own clock, plus a margin of one heartbeat, and then calls `next`. By then the host has lost permission to signal, so a turn is never lost to a dead host, and a live host never signals into a released turn.
- **What a stopped turn leaves owed.** The trigger of a stopped turn stays owed: a peer message stays undelivered in sminos and is delivered after resume (P5 Decision Log 16). This isn't buildable with the messages above alone, because today `deliver_next` settles a delivery once `push_live` hands it to the engine's inbox, before `turn.step` decides. OX10's adoption therefore also needs a correlated settlement: sminos defers settling an inbox delivery to a marked session until the observer reports the turn it started as `proceed`, carrying the delivery's id that the bridge read from the inbox row. On `stop`, it stays owed. That contract is part of M4's completion, and its producer (sminos's delivery) and settlement changes are M4's.
- **No observer connected** (the sminos plugin not loaded). Whether the session may then be released on verified-empty alone is O16's decision. M4 assumes neither answer.

M4's milestone text is completed when OX10 is adopted and U6 is measured. Its acceptance is the holder design's §9 item 6, the reap-fence race with turns from every origin. It adds delayed `arm` processing, and delayed `turn` replies across the final SIGTERM check.

## Concrete Steps

doperpowers, from a worktree of `SSFSKIM/doperpowers` cut from `origin/main`:

    SMINOS_PART=core bash sminos/tests/run-sminos-tests.sh      # the `sminos` gate; ends "all passed"
    SMINOS_PART=suites bash sminos/tests/run-sminos-tests.sh    # the `sminos-suites` gate
    python3 -B sminos/tests/test_rpcs.py                        # ledger, spawn, reconcile, MW5 uploads
    python3 -B sminos/tests/test_records.py                     # M1's record tests
    bash sminos/tests/mods/run.sh                               # the `sminos-mods` gate (claude plugin test sminos/)
    bash tests/mods/typecheck.sh                                # the `mods-types` gate
    scripts/bump-version.sh --plugin sminos <next>
    ci-gate                                                     # GREEN <run-url>

The full suites take about 9 minutes serially. While iterating, run one file; use `ci-gate` for the whole.

MAWS, for M3's marker, from a worktree cut from `origin/master`:

    pnpm vitest run src/engine-host/launch.test.ts
    npx eslint src/engine-host/launch.ts src/engine-host/launch.test.ts
    ci-gate

A live check of M3 runs zero inference against an isolated config dir: start a `claude -p` with `MAWS_LANE=B` and the sminos plugin from the branch, then read the bridge's `/status` through `sminos_bridge`'s socket. Every control is unavailable with the reason, and a `sminos steer` at it exits non-zero with `lane-b`.

## Interfaces and Dependencies

### A. The session record (M1)

`$SMINOS_HOME/session-records/<session>.json`, mode 0600. A pending launch's provenance waits at `$SMINOS_HOME/session-records/pending/<launch-id>.json` until the child claims it.

```json
{
  "session": "<uuid>",
  "source": "launch" | "lineage" | "hook" | "default",
  "origin": { "kind": "terminal" | "maws" | "sminos-spawn", "requester": "<member>"?, "spawnerSession": "<uuid>"? },
  "owners": ["@machine" | "<member id>", "..."],
  "ownersProof": [],
  "principal": "@machine" | "org" | "<member id>",
  "inference": { "kind": "slot", "configDir": "<path>" } | { "kind": "route", "settingsRef": "<path>" | "base-url:<scheme>://<host>[:<port>]" },
  "controller": { "lane": "A" | "B", "since": "<ISO 8601>" },
  "created": "<ISO 8601>",
  "former": ["<uuid>", "..."]
}
```

- `owners` has at least one entry, and is either `["@machine"]` or member ids alone: the writer refuses a mix (its wire shape is Phase 2's, with RL). `ownersProof` stays `[]` until O10 signs spawn and `manage` actions.
- `joined` events gain `owners` and `origin`, with the same shapes; owners holding `@machine` stay off them, and nothing else in the record leaves the machine.
- `source: 'hook'` is a record taken from the session's own environment by the hook path. A record is final whenever its `source` isn't `default`.
- Writer: `set_session_controller(sid, lane, since=None) -> bool` in `sminos.py` changes `controller` alone, and answers False while the session has no record yet.
- `list --json` adds `owners` and `origin` for every member, and `principal`, `inference` and `controller` for local ones.
- Reader: `session_record(sid) -> dict | None` in `sminos.py`.
- The launch handoff: `SMINOS_LAUNCH=<launch-id>` in the merged launch settings file's `env`.

### B. The ledger (M2)

In the daemon's RPC controller (`sminos_rpc.py`), which holds `flight`:

```python
query(op: str, op_created: float | None = None) -> dict
    # {"state": "done"|"refused", "outcome": ...} | {"state": "in-progress"} | {"state": "expired"}
    # | {"state": "not-received"} | {"state": "unavailable"}   (unreadable ledger; RL4's name)
tombstone(op: str) -> dict
    # {"ok": True} | {"ok": False, "state": "in-progress"|"done"|"refused"|"expired"|"unavailable"}
Ledger.claim(op: str, entry: dict) -> bool   # replaces the unconditional put; False when tombstoned or claimed
OP_HORIZON = KEPT_S - 3600
```

- CLI: `sminos rpc-query <opId>` prints the ledger file's view. It can't see `flight`, and it says so.
- RL4 carries `opCreated` on every action and in `query` (remote layer Decision Log 18). Here it is required whenever `opId` is present. A legacy nonce-keyed RPC uses its `created`.

### C. The lane B marker (M3) and OX10 (M4, proposed)

- **The lane B marker.** `MAWS_LANE=B`, together with `SMNS_MEMBER=<pid of the process that spawns claude>`, in the environment of every `claude -p` child of MAWS's engine host (`src/engine-host/launch.ts`, `buildEnvironment`). The verdict is `MAWS_LANE == "B"` and `member_mark(session)`.
- **OX10, proposed.** `MAWS_HOLDER_SOCKET` and the messages `hello`, `hb`, `arm {fence, leaseMs}`, `armed {fence}`, `disarm {fence}`, `turn {fence, origin}`, `proceed` and `stop`, with the rules in M4. It binds once O16's execution document adopts it (P5 Decision Log 16).

## Surprises & Discoveries

- Observation: the bridge already runs as a full controller in every MAWS lane B session today. The desk and `sminos steer` can drive a session MAWS is driving.
  Evidence: MAWS's engine host loads plugins from `enabledPlugins` with no `--plugin-dir` (`src/engine-host/session-start-hooks.ts` header), and `bridge.tsx` has no lane check.
- Observation: nothing on a machine knows its owner's member id.
  Evidence: `hub.json` is `{hub, org, machine, client_id, client_secret, key, former, enrolled}` (`sminos_hub.py`). The hub's `welcome` is `{org, machine, generation, heartbeat_ms, kinds}`.
- Observation: `python3 -B -I` can't run sminos's test files: `-I` drops the script's own directory from the import path, so their sibling imports fail.
  Evidence: M2's executor, 2026-10-26; Concrete Steps now say `python3 -B`.
- Observation: the hub's `RpcErrorCode` union doesn't name M2's new refusals (`bad-op-id`, `bad-op-created`, `expired`, `tombstoned`). Its `rpcResult` check accepts any string, so DX6 carries them, but the type is stale.
  Evidence: M2's executor's reading of MAWS `apps/desk-hub`, 2026-10-26.
- Observation: every spawn now writes its own merged launch settings file, since each carries a unique `SMINOS_LAUNCH`. Nothing sweeps `$SMINOS_HOME/settings/`.
  Evidence: M1's executor, 2026-10-26.
- Observation: `sminos_bridge.py` treats `rpc` and `upload` as opaque strings, so M2's re-keying needed no change there.
  Evidence: M2's executor, 2026-10-26.

## Decision Log

- Decision: Verification and review for this child. The document gets doperpowers:adversarial-reviewer's buildability review before it executes (P5 Decision Log 12). M2 gets doperpowers:reviewer-medium at its PR. M1 and M3 get doperpowers:reviewer-high: M3 because it changes who may control a session, and M1 because its ownership rules took two review rounds to settle (see the second-round entry below). Phase 1 closes with a doperpowers:review-code high pass over its range in doperpowers.
  Rationale: M3 removes a control path from every MAWS session, and a mistake there is either two controllers or a dead session.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: The record follows RL6's `principal` + `inference` split, not P5's O12 text `credential {slot, kind, principal}`.
  Rationale: RL6 was revised after O12's text, with the owner's co-owner ruling (account-managed inference later), and RL is binding.
  Date/Author: 2026-10-27, desk-sminos-orchestrator (residue for P5's Decision Log under O12).
- Decision: `@machine` as an owner and principal token, meaning "this machine's owners per the org state", resolved late by RL10's endpoint. It was confirmed as an RL6 extension in the remote layer's Decision Log 17 (PR #185), with its resolution rules: org-owned machines resolve to the org's admins, `principal` resolves through the slot binding, and the token never leaves the machine.
  Rationale: no member id for the machine owner exists on a machine before the org state does. Rejected: having the hub return the enrolling member at redemption, which would need a hub change and a re-enrollment for a value O14's re-enrollment supersedes. The buildability review asked for a one-time snapshot instead. That is dismissed, per Decision Log 17's reasoning: a terminal session's owners are its machine's owners by definition, and terminal sessions carry no proof, so receivers check them against the machine's current owners anyway.
  Date/Author: 2026-10-27, desk-sminos-orchestrator and remote-architecture.
- Decision: Lane B is `MAWS_LANE=B` plus sminos's existing `member_mark` parent check on `SMNS_MEMBER`, decided by the bridge child, with the mod a provisional observer until the child's verdict arrives.
  Rationale: the marker alone leaks through every Bash child of a lane B session. The parent check already exists and is tested, and a later session host sets `SMNS_MEMBER` to itself (P5 Decision Log 16, the MAWS architect's correction).
  Date/Author: 2026-10-27, desk-sminos-orchestrator and the MAWS architect.
- Decision: Phase 2's milestones (items 2, 3, 5, 6, 8) are written when O10 fixes RL10's interface.
  Rationale: they bind against RL10's names, and writing them first would transcribe a guess.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.

- Decision: The buildability review's findings are adopted, all but the `@machine` snapshot, which is dismissed above:
  - a spawned child's provenance travels with the launch (`SMINOS_LAUNCH`, a pending record claimed by the child);
  - provenance initialization recovers lineage before applying provisional defaults;
  - the controller lane is current state, separate from provenance;
  - claim and tombstone are one serialized transition;
  - ids have a replay horizon (`expired`, `opCreated`);
  - routes are recorded from the session's environment, and inline settings become a private file even under the default home;
  - the proposed reap fence is acknowledged and leased.
  Rationale: each was a real gap at an ownership or replay boundary (doperpowers:adversarial-reviewer, 2026-10-27).
  Date/Author: 2026-10-27, desk-sminos-orchestrator.

- Decision: The second buildability round's findings are adopted:
  - provisional ownership stays out of the published log, and stays provisional when inherited;
  - the launch claim is SessionStart's first act, and only a new session may claim;
  - the lane B verdict has three states, and `unresolved` stays an observer;
  - `opCreated` is required whenever `opId` is present, with a skew bound (also remote layer Decision Log 18);
  - M4 needs a correlated delivery settlement before OX10's adoption.

  Also: the unreadable-ledger answer is named `unavailable`, after RL4. M1 now gets doperpowers:reviewer-high, as M3 does, because its ownership rules took two review rounds to settle. The document isn't sent for a third round: the remaining risk is implementation detail, which those reviews and the pinned tests cover.
  Rationale: each finding was a real path to a wrong owner, a wrong controller or a replayed action (doperpowers:adversarial-reviewer, round 2, 2026-10-27).
  Date/Author: 2026-10-27, desk-sminos-orchestrator.

- Decision: Phase 1's execution layout. M1 and M2 are built in parallel, each on its own doperpowers branch cut from `main` (`p5-o12-m1`, `p5-o12-m2`), and each merges on its own once reviewed clean and green; the second to merge takes `main` in and re-bumps the sminos version above it. M3's doperpowers side (`p5-o12-m3`) is cut from `main` after M1 merges, since it writes M1's record (`controller`) and reads it (desk Resume). M3's MAWS marker is built and reviewed at once and lands first. The query's unreadable-ledger answer is `unavailable` everywhere: M2's opening list said `failed`, a leftover of the rename recorded in the second-round entry.
  Rationale: M2 consumes nothing M1 produces, and their one shared function (`sminos_rpc.spawn`) is a small merge. M3 consumes M1's record.
  Date/Author: 2026-10-26, O12's executor (desk-sminos-orchestrator).

- Decision: M1's gaps, settled in building it.
  - `source: 'hook'` is a fourth source, for a record the hook path takes from the session's own environment, which M1 calls final but the enum didn't name.
  - A launch claim may replace a provisional record (a reconcile that joined the child before its hook ran). It is still refused over a final record, or when the hook's `source` isn't `startup`.
  - The claim runs in the record hook before `migrate()`, since a busy migration lock would otherwise end the hook before `record_session`.
  - The spawner also claims the pending launch once `poll_uuid` returns the id. The rename settles any race with the child, and the first `joined` carries owners even if the child's hook never runs.
  - An operator's spawn (no session, no desk member) is `@machine`'s, `origin {kind: 'sminos-spawn'}` with no `spawnerSession`, `source: 'launch'`. A spawn from a session that has no record yet is provisional, and stays so.
  - `sminos_rpc.spawn` is unchanged: the requester already arrives as `SMINOS_DESK_MEMBER`.
  - A record recovered from a `joined` (initialization step 3) restores owners and origin only; its principal is the requester for a `maws` origin, else `@machine`, and its inference the default slot.
  - Under the default home the merged launch settings carry `SMINOS_LAUNCH` but not `SMINOS_HOME`. A seat's record is never built from the hook's environment.
  - `list --json` shows owners and origin as null on vacant seat rows, and principal, inference and controller as null on local rows with no record.
  - When a joined session's record turns final, it publishes one more plain `joined` carrying its provenance, once.
  Rationale: each keeps M1's rules (provenance fixed before the child exists, final evidence wins, older writers coexist) where the document was silent.
  Date/Author: 2026-10-26, M1's executor, accepted by O12's executor (desk-sminos-orchestrator).
- Decision: `@machine` is never published. A `joined` leaves off `owners` whenever they hold the token; `origin` still rides. Remote readers already default a member with no published owners to `["@machine"]`, so they read the same value.
  Rationale: M1 said final owners ride on `joined`, and RL6 with the remote layer's Decision Log 17 says the token never leaves the machine. RL binds, and the reader's default makes the omission lossless. Raised by M1's executor.
  The omission is lossless only for owners exactly `["@machine"]`, so the record writer refuses a list mixing `@machine` with member ids. Phase 1 has no path that makes one (a launch gives one or the other, and lineage inherits one or the other). The wire shape for a mixed list belongs to Phase 2's sharing work, settled with RL.
  Date/Author: 2026-10-26, O12's executor (desk-sminos-orchestrator).
- Decision: M2's gaps, settled in building it.
  - `opCreated` is an ISO 8601 UTC string, parsed as `created` is. A number is refused `bad-op-created`.
  - Check order: the `opId` and `opCreated` shape checks run right after the code check, loose. `tombstoned` and `expired` run after the ledger lookup and before freshness, also loose, so neither overwrites a tombstone or creates an entry.
  - On receipt the ledger answers before the horizon: an op it holds with an outcome is answered from it even past `OP_HORIZON`, so one id never gets two answers. `query` answers `expired` past the horizon either way.
  - The horizon applies to legacy RPCs through their `created`: a nonce the ledger doesn't hold, older than 23 h, is now refused `expired`, not `stale`.
  - A reseal of an answered op is re-armed under the reseal's nonce (the entry's `nonce` updated, `acked` reset).
  - Admission refusals (freshness, policy, shape, checks 7–8 before the claim) carry `refused: true`, which is how `query` tells `refused` from `done`. Entries an older daemon wrote read `done`.
  - `query` of a tombstoned op answers `not-received`, and tombstoning again answers `{ok: true}`. `tombstone` takes an optional `op_created`, so its `expired` state is reachable. A failed tombstone write answers `unavailable`.
  - The op lock covers the whole dispatch step (lookup, horizon, admission and its kept refusal, `flight.add`), so a tombstone can't land between the lookup and a kept refusal's write.
  - `rpc-query` reads the ledger file directly, runs before migration, and takes `--created`. DX4 `compact` and `op` bodies carry the op in `rpc`; the seat stamp keeps its name `rpc_nonce`.
  Rationale: each fills a silence in M2 or RL4 in the direction of "an id runs at most once and always has one answer".
  Date/Author: 2026-10-26, M2's executor, accepted by O12's executor (desk-sminos-orchestrator).

## Outcomes & Retrospective

Pending — written at finish.
