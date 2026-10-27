# P5-O12 — sminos under the endpoint: owners, the opId ledger and the lane B observer (2026-10-27)

> **Parent:** `docs/doperpowers/plans/2026-10-27-p5-org.md` (the P5 composite), child **O12**, §"O12: sminos under the endpoint". Parent pin: blob `a923eb6e09118cd848477322fb9d4721c9fe381f` at master `4abec20ca`. Binding on this child:
> - the remote layer `docs/doperpowers/specs/2026-10-26-remote-layer-design.md` (cited *RL §n*): RL6 (the session record), RL9 (the owner attestation), RL10 (endpoint ↔ sminos), §5.7 (who may write a person's words), §5.8 (default owners) and §6.4 (principal and inference route);
> - the desk control-surface spec `docs/doperpowers/specs/2026-10-22-desk-control-surface-design.md` (MW1–MW5: the bridge's ops, controls and the media RPC);
> - the holder design `research/desk-remote/session-holder-design.ko.md` §3.2 and §3.4 (the observer bridge and the reaping fence);
> - for phase 2: O10's execution document `docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md` (blob `8158a9ce3` at master `f05b9f17a`): its M6 (the sminos socket) and Interfaces §D (RL10's frames) bind name for name, with §G (which lane A RPCs cross) and M3 (listings and `notify`); and P5's Decision Logs 16–19, 23, 25, 26 and 45 (blob `cc929023c`, the same master), 45 giving phase 2 its duties. RL §5.7, §5.8, §6.2, §7.1 and §9 bind it as well.
>
> **Owner:** desk-sminos-orchestrator. **Repositories:** doperpowers (the sminos plugin: `sminos/skills/sminos/scripts/`, `sminos/hooks/mods/`, `sminos/tests/`) and MAWS (the lane B marker). MAWS lands first whenever both change, and every new field is optional. This document is the child's standalone execution record. Residue decisions go to P5's Decision Log under O12, through the P5 writer.

## Purpose

sminos is the project family on every machine: who works where, their messages, and the delivery of a person's words into a session. Today it knows nothing about people. A session has a spawner alias at most, nothing names whose session it is, and the bridge mod controls every Claude Code session it loads in. That includes the `claude -p` sessions MAWS opens, where MAWS's own controller is the one in charge. This child gives sminos the owner model and takes it off the network:
- every session gets a durable, machine-held record of who owns it, how it started and what inference it runs on;
- the RPC ledger answers by operation id, so a reconnecting app can ask what became of an action;
- inside a MAWS lane B session the bridge only observes, so two controllers never fight over one session.

Phase 2, written against O10's RL10, takes sminos off the network: its uplink speaks to the endpoint module over a local socket instead of to the hub, with no codes, no enrollment and no key; a person's words reach a session only when the endpoint says who signed them may drive it; a peer message says whose session sent it; what a session says to its own person stays on the machine; and every remote lane A action carries who sent it, is fenced to the launch it was meant for, and answers by its id.

What someone can see after the first phase:
- `sminos list --json` shows each session's owners and origin;
- a `sminos spawn` child shows its parent's owners and the parent's session id;
- the daemon's ledger answers `query <opId>`;
- a MAWS lane B session's capabilities say "MAWS controls this session", and a `sminos steer` at it is refused rather than racing MAWS.

What someone can see after the second:
- `sminos daemon status` on a cut-over machine says `uplink: RL10 (local-only)` and the hub shows no DX2 stream for it, while a machine not yet cut over runs exactly as before;
- a `human` event from a member with no `converse` on the session arrives in it as a peer message, and one from a revoked device never lands as words;
- a peer message reads `from <agent>, owned by <owner>`, or `(owners unverified)`;
- a desk action on a session that was relaunched since the action was sealed is refused `launch`, and its `query` answers only its sender;
- a `<message>` from a session on a cut-over machine is in `sminos chat --host` and on the owner's device, and nowhere in the hub's project log.

## Progress

Phase 1 (dispatchable now; P5's item 1, item 4, and item 7's refusals):
- [x] M1 — The session record (item 1). Reviewed clean after three doperpowers:reviewer-high rounds (one P2 carried as an unresolved finding), landed as doperpowers PR #402 (`40cb5721`, sminos 1.18.0), 2026-10-27T03:10Z.
- [x] M2 — The opId ledger (item 4). Reviewed clean (doperpowers:reviewer-medium, one P2 fixed), landed as doperpowers PR #401 (`bdd39e50`, sminos 1.17.0), 2026-10-27T02:05Z.
- [x] M3 — The lane B observer: marker and refusals (item 7, first part). The marker landed first as MAWS PR #194 (`0de73723e`). The sminos side was reviewed by doperpowers:reviewer-high over several rounds (three found issues), every finding fixed with a regression test, and landed as doperpowers PR #403 (`8f79b741`, sminos 1.19.0), 2026-10-27. A zero-inference live check passed: a `claude -p` with the marker read `lane: match`, no ops and every control `MAWS controls this session`, and `sminos steer` at it exited 1, `lane-b`. Phase 1 is complete.

Phase 2 (written 2026-10-27 against O10's M6 and Interfaces §D, whose landing P5's Decision Log 45 records; P5's items 2, 3, 5, 6 and 8, item 4's rest, and Decision Log 45's duties):
- [ ] M5 — The RL10 client and the local-only switch (item 5). Buildable now against sminos's own endpoint stand-in; its conformance replay lands once O10 M6's `conversation.json` exists.
- [ ] M6 — Members, words and the label (items 2 and 3). After M5.
- [ ] M7 — Lane A actions with remote context (item 4's rest; Decision Log 45's fence, binding and proof; board ticket 11's two debt items). After M5. Its two debt items need nothing of RL10 and may be the branch's first commit.
- [ ] M8 — To-human off the hub (item 6). After M5. Its store needs nothing of RL10.
- [ ] M9 — The mini (item 8). After M5–M8, and after O14's brief cuts the mini over.

M6, M7 and M8 consume only M5 and may run on parallel branches cut from `main` once M5 lands, each re-bumping the sminos version above the one before it (phase 1's rule). The phase closes with a doperpowers:review-code high pass over its range, as phase 1 did.

Blocked (P5's edges):
- [ ] M4 — The reaping gate (item 7, rest). Blocked by U6's measurement (in O3) and by OX10's agreement with O16's author.
- O8's record actions (`record.owners`, `record.access`, `record.shares`: owner, access and share changes executed by sminos under its ledger, acknowledged once the record is on disk; O10's Decision Log and P5's Decision Log 45). Blocked by O8, which defines the actions and their proofs. Not a milestone here: when O8's execution document fixes them, they are written in as M10, on M7's fence and ledger binding.

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

Phase 2's acceptance is P5's O12 items 2, 3, 5, 6 and 8, and item 4's rest, checked as follows. Every check runs against an isolated `SMINOS_HOME` and `HOME`, with sminos's endpoint stand-in (`sminos/tests/endpoint_standin.py`) or, where it says so, a scratch-profile `mawsd` from O10's branch (`MAWS_USER_DATA` set; never the owner's).

4. **Local-only** (item 5). With `rl10.json` present (the stand-in's, or a scratch `mawsd`'s):
   - `daemon run` starts one uplink child, which connects to the socket, sends `hello` with the file's token and is welcomed; no process of sminos opens a TCP connection (the stand-in's hub port sees none, and the DX2 stream count stays 0); `sminos daemon status` prints `uplink: RL10 (local-only)`.
   - `daemon/identity.json` exists after the welcome, mode 0600, and `sminos hub show` prints the identity from it; `sminos hub enroll` and `sminos hub leave` exit 1 saying the enrollment is the endpoint's.
   - With `rl10.json` removed and `hub.json` still holding a DX7 credential, the child exits, no DX2 uplink starts, and `daemon status` says `cut over; the endpoint is not running`.
   - Without `rl10.json` on a machine never welcomed, behaviour is unchanged: the DX2 uplink runs against `hub_standin.py`, as the suites show.
   - `codes_parity.py`, `test-uplink.sh`, `test-hub.sh`, `test_session_plane.py`, `test_rpcs.py` and the bridge suites pass in both modes (the RL10 sections added, the DX2 ones unchanged).
   - The conformance replay (`rl10_conformance.py` over `rl10-conversation.json`, O10's `conversation.json` copied with its MAWS sha) passes every line of sminos's side.
5. **Words** (item 2). On a cut-over machine, with the stand-in scripted to answer `words?`:
   - a `human` event the stand-in answers `words` is submitted through the session's bridge as the human's words (the bridge's `deliver`), once per event;
   - one it answers `peer` arrives as an inbox frame, and one it answers `refuse` is settled `refused-words` with a `delivery` outcome up the session lane and no frame;
   - one it does not answer stays owed, is counted as a failed attempt, and is asked again at the next pass; `revoked` naming its signer settles it `refused-revoked` at once, with no further `words?`;
   - a `legacy` signer's `human` event is never asked and arrives as a peer message labelled `unverified (legacy)`;
   - `daemon run`'s tick and `sminos say`'s fast path push no `human` event from outside the machine on a cut-over machine: the event is delivered by the uplink child after `words?`;
   - on a machine not cut over, `human` events are delivered as today (`owner_event`).
6. **The label** (item 3). A `say` arriving with `owners: [<member>]` is pushed as `[sminos chat <project> <ref> from <alias>, owned by <member> → @you]` and prints so in `sminos chat`; one arriving with `owners: []` reads `from <alias> (owners unverified)`; a `legacy` one reads `(unverified, legacy)`. The owners are read from the stored line's `verified` key alone; an arriving event that carries a `verified` key of its own is refused `bad-shape` and reported `rejected`.
7. **The ledger over RL10, the fence and the proof** (item 4's rest; Decision Log 45).
   - An `rpc` down RL10 runs once, and its `rpc-result {project, opId, nonce, outcome}` goes up until `rpc-ack {opId}`; a reseal under a new `nonce` while the op is in flight, or claimed and awaiting reconciliation after a restart, is answered once, under the latest nonce, and never runs twice (ticket 11a).
   - The ledger entry holds `member`, `device`, `fingerprint` and `target`; a known `opId` with another member or fingerprint is refused `op-conflict`; `queried` and `tombstoned` carry the stored binding.
   - A remote RPC on a bridged session carries `context {lane: 'A', session, launch}`: the bridge's child refuses it `launch` when its launch differs, immediately before the mod acts, and the RPC fails `launch`; the same for a decision. A remote RPC without `context`, or whose `context.session` is not `args.session`, is `bad-shape`. A remote `steer` on a session without a bridge is refused `context` (never the supervisor or the inbox); a remote `resume`, `retire` or `stop` is refused `unsupported`.
   - A desk spawn's `proof` is in the new session's record as `ownersProof: [<proof>]`, and `list --json` shows it.
   - An observer's refusal reconciled after a daemon restart reads `lane-b`, not `failed` (ticket 11b).
   - MW5's upload id is the `opId` (M2); the conformance replay pins it end to end.
8. **To-human off the hub** (item 6). On a cut-over machine, for a hub project:
   - a `<message>` and an async ask exported by the bridge or the Stop hook land in `projects/<id>/host/<machine>.<session>.jsonl`, and in no `log/` file; the uplink's `hello` vector and every `events` frame up name no host event;
   - `sminos chat --host` prints them beside the project's older host events from the log;
   - each appended host event reaches every subscription of the session on the session lane as a `host` message, and a fresh subscription's snapshot carries the session's last 50;
   - on a machine not cut over, and in a git-mirrored project, host events go where they go today.
9. **The mini** (item 8). After O14's brief cuts the mini over: the mini's `sminos daemon status` says `uplink: RL10 (local-only)` with a sminos at or above M8's version; its unattended seats (the journal, Telegram) show no `retired` or `gone` across the install; from the MacBook, `sminos list --org` shows the mini's sessions with their owners, and a `sminos say` to one of them arrives there labelled. Evidence goes to Outcomes; no step of this document runs `claude` on the mini.

## Constraints that bind every milestone

- **RL6 is the record's contract.** The shape is in Interfaces. P5's O12 text says `credential {slot, kind, principal}`, but RL6, revised after it with the owner's co-owner ruling (RL Decision Log, 2026-10-26), splits that into `principal` and `inference`, and RL6 binds. This is recorded as residue in this document's Decision Log.
- **What stays on the machine.** `principal`, `inference`, `controller` and `source` never leave it: they appear in no log event, no hub frame and no `--org` output. `owners`, `ownersProof` and `origin` are listing material and may ride on `joined` (RL §6.2), except the token `@machine`, which never leaves the machine (RL6, remote layer Decision Log 17): owners holding it stay off the event.
- **Older readers and writers coexist.** The long-running daemon keeps running old code until it restarts, and older sminos versions on other machines read the same logs. Every field is additive. Owners are read from the latest *publishing* `joined` along the lineage (one carrying `origin` or `owners`), so a correction reaches other machines. An older writer's `joined` publishes nothing, so a later event without them never erases them. Every `joined` takes its `owners` and `origin` from the record under the writer file's lock, never from the caller, so a paused writer can't append provenance older than a publication made since.
- **No secret in a record.** `inference.settingsRef` names a file path, never inline settings content. Gateway settings carry environment, which may hold tokens. Inline `--settings` JSON is referenced by the merged launch file sminos already writes (`$SMINOS_HOME/settings/<sha16>.json`).
- **Tests run against isolated homes.** Every test sets `HOME` and `SMINOS_HOME` to temporary directories. Running a working-copy sminos against the real `~/.claude/sminos` performs a one-way import and is forbidden. The suites are `sminos/tests/run-sminos-tests.sh` (parts `core` and `suites`), `sminos/tests/test_rpcs.py`, `sminos/tests/mods/run.sh` and `tests/mods/typecheck.sh`. Verify on CI with `ci-gate` in each repository.
- **Every change bumps the sminos plugin's version** in the same commit, with `scripts/bump-version.sh --plugin sminos`. The marketplace updates by number alone.
- **Plugin documentation follows the code.** `sminos/hooks/mods/CLAUDE.md` (the bridge paragraph) and `sminos/skills/sminos/scripts/CLAUDE.md` describe the record, the ledger's `query` and the observer mode once they exist; phase 2 adds the RL10 mode, the words rule, the host store and the launch fence to them.
- **The RL10 path holds no key** (phase 2). On a cut-over machine `cred["key"]` is `None`, and nothing on that path seals, verifies, derives a nonce or indexes one: `sminos_codes` is reached only by the DX2 path and by `codes_parity.py`. A cut-over machine opens no connection to the hub, ever (M5's decision), so no test of phase 2 may need one.
- **Frames are O10's, name for name** (phase 2). Where sminos's wire today differs from O10's Interfaces §D, Surprises & Discoveries names the difference with its file and line, the amendment is O10's to make, and this document's Interfaces §D' says what sminos builds meanwhile. A phase 2 milestone does not invent a frame §D' lacks; what it needs beyond §D is asked of O10 through the P5 writer.
- **The DX2 path changes only where a mode flag turns it** (phase 2). Every phase 2 change to the uplink, the log plane, delivery or the RPCs sits behind the mode (`coded`, `cutover`), so a machine not yet cut over runs the code it runs today; the DX2 suites are the proof, run unchanged.

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

  The claim is the first thing `record_session` does on the child's SessionStart. It runs before any of its early returns (an engine registry not yet holding the session, a missing transcript) and needs only the hook's own session id. The first `startup` SessionStart that sees `SMINOS_LAUNCH` binds the launch to its own session id with a lock-free atomic create (`pending/<launch-id>.session`), before taking any lock; every later claim (a retried hook, the spawner after `poll_uuid`) is honoured only for the bound session. So a claim that fails open (a record lock past the hook's deadline) still can't be taken by a later claimant, such as a `claude` launched from the seat's Bash with the inherited variable. A claim is also refused unless the claiming session is new: no record for its id, and the hook's `source` is `startup`. `launch_env` drops `SMINOS_LAUNCH` from the environments sminos builds. A pending file unclaimed after a day is removed by the daemon's sweep. The spawner exiting before `poll_uuid` changes nothing, since the child claims for itself. Rejected: passing `--session-id` through `claude --bg`, which isn't measured to work for background launches.
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

  Replacement is strictly upward by the evidence's strength, recorded as the record's local `basis`: launch > lineage > hook > default, final over provisional at the same basis. Equal or weaker evidence never replaces a record, so two hooks or two lineage reads can't flip it. Hook evidence never replaces a launch-claimed record, provisional or not, and is held back while the session's own launch is bound and still pending. Lineage evidence comes only from predecessors, the first final record along the chain winning over provisional ones, and never from the session's own publication; a lost record falls back to predecessors, then to provisional defaults. Every change after the first `joined` republishes one more `joined`, and publication is checked on every pass, so a lost append is repaired.
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

### M5 — The RL10 client and the local-only switch

**What exists at its end.** On a machine whose `mawsd` endpoint has written `rl10.json`, sminos's uplink child speaks RL10 to the endpoint instead of DX2 to the hub: the same frame handlers (`Link`), over a 0600 Unix socket, with no HMAC coding, taking the machine's identity, policy and org directory from the endpoint in place of `hub.json` and the hub. On a machine without it, nothing changes. In detail:
- `sminos_rl10.py` finds `rl10.json` at O2's literal paths (Interfaces §D'), connects, sends `hello` with the file's token, and runs the stream: newline-delimited frames of at most 1 MiB, DX2's `part`s for larger text, one ordered lane in place of DX2's two.
- The first `welcome` cuts the machine over: `daemon/identity.json` is written from it; every reader of the machine's identity (`enrollment`, `machine_identity`, `enrolled_at`, `hub show`) prefers it; the supervisor never starts a DX2 uplink again.
- The log plane runs uncoded. This machine's events go up as stored, with no `mac`. An arriving event comes as `{event, signer, owners?}` and is stored verbatim with one key added, `verified: {signer, owners}`; the DX1 nonce index and `seen-nonce` leave with the codes (the endpoint's inbound index replaces them, O10 M6).
- The session lane, the requests' `raised` and `settled` and delivery's outcomes go up uncoded; `subscribe`, `unsubscribe`, `rows`, `diff`, `output` and `read` come down and are answered as today.
- `policy` frames write `daemon/policy.json`; `sminos daemon policy` sends `policy-set` up, and the endpoint's `policy` answers it.
- The `org` frame fills `daemon/org.json` as today.
- `legacy-key?` is answered once from `hub.json`'s key, never logged.
- `rpc` frames reach `Rpcs.receive` without a code or machine check, keeping their RL10 fields on the entry (`member`, `device`, `fingerprint`, `context`, `proof`, which M7 uses); `rpc-result {project, opId, nonce, outcome}` goes up until `rpc-ack {opId}`; `query` and `tombstone` reach M2's `Rpcs.query` and `Rpcs.tombstone` and answer `queried` and `tombstoned`.
- Both modes pass the existing suites. `sminos daemon status` says which runs.

**What it touches.**
- `sminos/skills/sminos/scripts/sminos_rl10.py` (new): discovery, the socket reader and writer, the hello, `identity.json`.
- `sminos_uplink.py`: `Link.__init__` takes a transport and `coded`; `Sender` gains a socket counterpart (`SocketLane`); `cmd_uplink` chooses the mode; `Here` is unchanged.
- `sminos_daemon.py`: `UplinkSupervisor.run` (the switch), `cmd_status`, `enrolled_at`.
- `sminos_hublog.py`: `seal`, `refusal`, `take`, `same_event`, `nonce_index`, `vector` (M8 excludes the host store), `presence`.
- `sminos_requests.py` (`Requests.seal`), `sminos_outcomes.py` (`message`): a draft goes as it is when there is no key.
- `sminos_rpc.py`: `Rpcs.__init__` (a `coded` flag), `receive` (the code and machine checks, `nonce`, `args.session`), `refuse_loose`, `results`, `ack`, and `entry_of` (the RL10 fields kept).
- `sminos_policy.py`: `write` from a `policy` frame; `cmd_policy` in RL10 mode.
- `sminos_hub.py`: `enroll`, `leave` and `show` on a cut-over machine.
- `sminos.py`: `enrollment`, `machine_identity`, `org_directory` (unchanged readers of `org.json`).
- Tests: `sminos/tests/endpoint_standin.py` (new), `test-uplink.sh` (an RL10 section), `test-hub.sh`, `test_rpcs.py`, and `rl10_conformance.py` with `rl10-conversation.json` (new, once O10 M6 lands).

**Interfaces.** Consumes O10's §D. Exposes to M6–M8 (Interfaces §D'): the RL10 transport (`Link` in RL10 mode, `send(frame)` and the handler table), the stored `verified` key, `identity.json` and `cutover()`.

**Decisions.**
- **One child, two modes.** The RL10 client is `sminos daemon uplink` with another transport, chosen at the child's start, not a second process. `Link` keeps its handler table (`on_have`, `on_events`, `on_rpc`, …), `Here`, the plane, the requests and the RPCs, and takes a `Transport` that reads frames and writes them: DX2's `Stream` plus two `Sender`s, or RL10's socket. Rejected: a `daemon endpoint` child beside the uplink, which would put two processes on one machine's deliveries and RPCs, and split the words path (M6) from the log plane that carries the events it decides.
- **Discovery.** `rl10.json` is read at `$MAWS_USER_DATA/mawsd/endpoint/rl10.json` when `MAWS_USER_DATA` is set (tests, and O10 M11's scratch machine), else at O2's platform default (`~/Library/Application Support/MAWS/mawsd/endpoint/rl10.json` on macOS, `${XDG_CONFIG_HOME:-$HOME/.config}/MAWS/mawsd/endpoint/rl10.json` on Linux). The file must be a regular file of mode 0600 owned by this uid, with `protocol` 1, a `token` of 64 hex characters and a `socket` path; anything else is "no endpoint", said once in daemon.log. The socket is dialled with a 5 s timeout, `hello` is the first line, and a `refuse` or no `welcome` within 10 s closes it; the child backs off from 1 s to 60 s as DX2's does. `SMINOS_RL10=<path>` overrides the file's location for a test. Rejected: reading the socket's path from `mawsd`'s command line or state, which couples sminos to MAWS's layout beyond the one file O2 wrote for it.
- **Cutover is once and for good** (RL §9: "each machine cuts over once"). The first `welcome` writes `daemon/identity.json` (`{org, hub, name, former, ref, enrolled, cutover: <ISO>, build}`, mode 0600, atomically), and from then on the supervisor starts the child in RL10 mode only: with `rl10.json` present it connects; without it, it waits, logging once an hour that the endpoint is not running, and `daemon status` says so. `hub.json` is never read for a credential again, even if the endpoint is gone for a day. Rejected: following the socket's presence, falling back to DX2 while `mawsd` is down. The hub keeps one generation counter per machine name across DX2 and RL1 (O10's Orientation, O11), so a DX2 stream from sminos would take the machine's generation and cut the endpoint's RL1 socket (4409) each time `mawsd` restarted, and the machine would run two uplinks under one name, which RL §2.1 forbids. The owner undoes a cutover by removing `identity.json`, which `hub show` names; no verb is added, and the step is O14's brief's.
- **Identity.** `enrollment()`, `machine_identity()` and `enrolled_at()` read `identity.json` first and `hub.json` only when there is none. `name`, `org`, `hub`, `enrolled` and `ref` come from the welcome. `former` is this machine's own: `hub.json`'s `former` is `{name: [session ids held under it]}`, which `is_self` needs to attribute a session to a former name (sminos.py:6634–6654), and the endpoint never knew which sessions a name held, so its `identity.former` can only be names. `identity.json`'s `former` is copied from `hub.json` at the first welcome and kept; a name the welcome lists that neither holds is added with no sessions, so a rename the endpoint made (`mawsd enroll --replace`) still reads as this machine's. The machine's own project id (`machine_project_id`) is unchanged: it is a function of the org and the name. `sminos hub show` prints the identity, marked `cut over` with the date; `hub enroll` and `hub leave` on a cut-over machine exit 1 with "this machine's enrollment is its endpoint's: `mawsd endpoint …`". Rejected: asking O10 to carry the sessions map, which it cannot know, and deleting `hub.json` at cutover, which would strip the legacy key before the endpoint has asked for it; its removal is O14's final brief's, with the key's.
- **One lane, written is taken.** DX2's two senders exist for HTTP's concurrency and its per-POST answer; a socket is one ordered byte stream. `SocketLane.send(frames, then)` writes the frames and runs `then({})` once they are written, so every continuation that today waits for a POST's 200 (a settlement leaving its outbox, a compaction or `op` message leaving `rpcs-owed.json`, rejections recorded as reported, the tombstone mark) runs on write. On every `welcome` the complete request set, every unacknowledged `rpc-result` and each project's `hello` go again, as after a DX2 reconnect, and a frame the endpoint refuses comes back as DX2's `refused`, handled as today. Rejected: asking O10 for a per-frame acknowledgement on RL10, which §D does not have. What a lost frame costs is bounded: the session lane stops at the endpoint (O10 M6), which re-snapshots a subscriber after its own restart and rebuilds pending counts from the complete set, so nothing of the session lane is durable past the endpoint anyway. It is recorded as an open question for O10 in case a loss shows in M11.
- **The uncoded log plane.** `HubLog` takes `coded` (True on DX2). Uncoded: `seal` returns the event as stored; `refusal` keeps the shape checks and skips the code; `take` unwraps each `{event, signer, owners?}`, refuses a wrapper whose `event` carries a `verified` key of its own (`bad-shape`: the key is the endpoint's to say, and a device could otherwise sign one in), and appends the event with `verified: {signer, owners}` added, `owners` as the endpoint sent it (`[]` when the attestation failed); `nonce_index` is not built. `same_event` compares canonical forms with `verified` stripped from the held copy, and with `mac`, `sig` and `attest` stripped from an arriving copy of an event this machine wrote (the endpoint adds those at upload, as `mac` is added today). `words?` sends the stored line without `verified`. Rejected: a sidecar file of verdicts keyed by (writer, seq), which every delivery and every `chat` would join on; one key on the line, stripped where the exact event matters, is one rule.
- **The RPC frame on RL10.** `receive` skips the code check and the `machine` check (the socket is this machine's). It requires the action's `nonce` (16 bytes, base64url) on the frame, since loose refusals, `sent_here` and the ledger's `nonce` are keyed by it; a frame without one is refused `bad-shape`, loose, keyed by its `opId`. `session` is read from `args.session` as DX6 has it, and a top-level `session` is copied into `args` when `args` lacks one, so `shape`'s digest check holds. `rpc-result` carries `opId` and the entry's current `nonce`; `rpc-ack` settles by `opId` (`Rpcs.ack` takes either). `query {opId, opCreated}` and `tombstone {opId, opCreated?}` parse `opCreated` as `created` is parsed and call M2's methods; their answers carry M7's binding fields once M7 lands, and until then the state alone. Both §D gaps (`nonce`, `args.session`) are O10 amendments (Surprises & Discoveries).
- **Policy.** The endpoint's policy is authoritative. A `policy {read_only, ceiling}` frame writes `daemon/policy.json` (the mirror `deliver_next` and `admit` read); `sminos daemon policy` writes the file as today and nudges the daemon, and the uplink, seeing the file differ from the last `policy` it received, sends `policy-set` with the fields that differ and waits for the endpoint's `policy`, which writes the file again. `hello.policy` carries the file as it is, which the endpoint takes only when it holds none (§D), so the first cutover inherits the machine's policy. Rejected: two policies, the endpoint's for remote actions and sminos's for delivery, which would let read-only mean two things on one machine.
- **The welcome's `capabilities` and DX2's `kinds`.** DX2's welcome lists the session kinds the hub relays (`kinds`, sminos_uplink.py:1333–1337), and `read` and `op` messages go only to a hub that lists them. §D's welcome has `capabilities` and no `kinds`. On RL10 every kind sminos has is sent: the endpoint is on this machine and relays the lane whole (O10 M8 treats it as opaque). A capability string naming a kind, if O10 defines one, is honoured the same way; none is required (open question).
- **The conformance replay.** `rl10_conformance.py` loads `rl10-conversation.json`, O10's `test/endpoint/rl10/conversation.json` copied verbatim with the MAWS commit it came from in its header, as `codes_parity.py` carries DX1's vectors. It stands in for the endpoint on a socket in a temporary `SMINOS_HOME`, sends each endpoint→sminos line, and checks each sminos→endpoint line against the fixture, masking the fields the fixture marks nondeterministic (times, nonces, ids). It runs in `run-sminos-tests.sh`'s `suites` part. Until O10 M6 lands, `endpoint_standin.py`, sminos's own stand-in written to §D, carries every RL10 test; the replay is added in the same milestone's PR if M6 has landed by then, else as a follow-up commit to M5 that changes no code. A line the replay fails is either a sminos bug or an O10 amendment, and the PR says which.

**Not touched.** Words and members (M6). The fence, the binding and the proof (M7). The host store (M8). The DX2 path, beyond the mode flag. `hub.json`'s removal and the legacy key's retirement (O14's final brief). RL1 and the hub.

**Proves.** Acceptance 4. Tests also pin:
- `rl10.json` of mode 0644, of another uid, with `protocol` 2, or with a token of the wrong length is "no endpoint", said once;
- a wrong token: the socket closes, the child backs off, no `identity.json` is written;
- `identity.json` written by the first welcome, 0600, and read by `sminos hub show`, `enrollment()` and `is_self` for a session held under a former name;
- after cutover, `hub.json` replaced with a fresh DX7 credential starts no DX2 uplink;
- `rl10.json` removed after cutover: the child exits, nothing dials the hub stand-in, `daemon status` says why;
- an own `human` event uploaded without a `mac`; a resend after `have` re-uploads the same bytes;
- an arriving `{event, signer, owners}` stored with `verified` and nothing else changed; one whose `event` carries `verified` refused `bad-shape` and reported `rejected`;
- `policy` written and read by `deliver_next`; `daemon policy --read-only on` sends `policy-set` and the file settles on the endpoint's answer;
- `legacy-key?` answered once with `hub.json`'s key, never written to daemon.log, and not answered again on a second welcome;
- an `rpc` without `nonce` refused `bad-shape` under its `opId`; one with a top-level `session` runs; `rpc-result` keyed by `opId`, re-sent on the next welcome until `rpc-ack {opId}`;
- `query` and `tombstone` passed through to M2's methods, with the DX2 suites unchanged.

### M6 — Members, words and the label

**What exists at its end.** On a cut-over machine the endpoint knows every session sminos holds, and a person's words reach a session only on the endpoint's verdict:
- `member` frames go up at the welcome for every local member of every open project, and on each change of the fields they carry, with `{session, gone: true}` when a member leaves.
- Before any `human` event from outside the machine, or from this machine's own operator writer, is delivered, the uplink child sends `words? {id, session, event}` with the event exactly as stored and acts on the answer: `words` submits it through the bridge (or a `--bg` job's supervisor) as the human's words; `peer` delivers it as an inbox frame; `refuse` settles it `refused-words` and reports the outcome up; no answer keeps it owed and counts an attempt. `revoked` settles every owed `human` event of a named device, member or key `refused-revoked` at once.
- A `legacy` signer's `human` event is never asked and arrives as a peer message marked unverified.
- A peer message carries the sender's verified owners: `from <alias>, owned by <owner>`; `(owners unverified)` when the endpoint sent `owners: []`; `(unverified, legacy)` for a legacy signer.
- A machine not cut over delivers as today.

**What it touches.**
- `sminos_uplink.py`: `Link.members(now)` (the member set and its diff, in `tick`); `on_words`, `on_revoked`; the words pass (`deliver_words`) in `tick` and `deliver_imports`.
- `sminos_daemon.py`: `deliver_owed` leaves outside-origin `human` writers alone on a cut-over machine.
- `sminos.py`: `deliver_next` and `push_event` take a verdict; `deliver_say`'s fast path on a cut-over machine; `compose_chat_frame` and `chat_line` (the label); `_owed` unchanged.
- `sminos_control.py`: `push_live` takes `words` instead of deciding by `owner_event`.
- `sminos_outcomes.py`: `REFUSED_WORDS`, `REFUSED_REVOKED` outcomes and their reasons.
- `sminos_plane.py`: `Plane.refresh` exposes the member rows M6's frames are built from.
- Tests: `sminos/tests/test_words.py` (new, against `endpoint_standin.py` in-process), `test-uplink.sh` (member frames), `test-bridge-control.sh` (the bridge's `deliver` once per event, as today).

**Interfaces.** Consumes M5's transport and `verified`. Exposes `member` frames (§D) and the delivery verdict (Interfaces §E) to M7 (`launch`) and M8.

**Decisions.**
- **Members are local members.** A `member` frame is sent for each `m.local and m.session` member of each open project (the plane's `members`), never for another machine's sessions sminos knows from logs: the endpoint attests and lists this machine's sessions (O10 M3, M6). The frame's fields come from the record (`session_record`: `owners`, `ownersProof`, `origin`, `principal`, `inference`, `controller`), the member row (`alias`, `project`, `state`, `title`, `cwd`, `worktree`) and the bridge's status (`launch`, M7; absent until then). `lane` is `B` when `controller.lane` is `B`, or when the controller is unset and `origin.kind` is `maws` (a session the engine host launched, M3's verdict pending); else `A`. `engineSessionId` is sent equal to `session`: sminos's session id is the engine's, and the endpoint joins MAWS's `appSessionId` to it through `engine.sessions` (O10 M6); the field is redundant for sminos and is noted for O10. `access` and `shares` are absent until O8. A record missing (a session joined before its hook ran) sends the frame with `owners: ["@machine"]`, `origin: {kind: 'terminal'}` and no `principal` or `inference`, and sends it again once the record exists. The set is diffed against the last sent per session, like `machine_sent`, and sent whole after each welcome. `principal` and `inference` cross RL10 because the endpoint is this machine (RL6's record is machine-held), and O10's listing projection leaves them off (its M3); they still never ride a log event or `--org` output.
- **Words are decided only by the RL10 holder.** `words?` is answered on the socket the uplink child holds, and the child's main thread cannot wait for an answer inside a frame handler. So on a cut-over machine delivery of `human` events is the uplink child's, in two passes: in `tick`, for each open project and each local member, the first owed event of each outside-origin `human` writer (`hub/<member>`, another machine's `<name>/human`) and of this machine's own `<name>/human` writer not yet asked is sent as `words? {id, session, event}` and marked asked with a 10 s deadline; on `words {id, verdict}` the event is delivered by `deliver_verdict(project, member, event, verdict)`, which takes the delivery lock, confirms the event is still the writer's first owed, pushes it by the verdict and settles it, recording the outcome for the uplink as `deliver_next` does. A deadline passed is a failed attempt (`delivered_fail`, counted toward `DELIVERY_ATTEMPTS`) and the event is asked again on the next pass. The daemon's tick (`deliver_owed`) and `sminos say`'s fast path (`deliver_say`) leave such writers owed on a cut-over machine and nudge the daemon, whose nudge wakes the uplink's tick; peer writers (`<name>/<session>`, `say` events) are delivered by them as today, so no writer's order is split, since each writer carries one kind. Rejected: a second RL10 connection for `daemon run` and the CLI, which §D does not define (a second `hello` would send the member set twice and the endpoint would hold two log planes), and routing the question through `daemon run` by a local pipe, which adds a channel for one question.
- **The operator path asks after the upload.** A `<name>/human` event of this machine (the owner's terminal `sminos say`) carries no signature locally; the endpoint signs it when the `events` frame carrying it goes up and keeps the signature (O10 M6). sminos sends its `words?` only after `took` has moved the writer's `sent` past the event's seq, on the same socket, so the endpoint reads the `events` frame first. The fast path therefore never delivers an own `human` event on a cut-over machine; the uplink does within its next pass. O10 M6 as written decides `words?` by its inbound index, which holds only arriving events; the own-writer case is an amendment (Surprises & Discoveries).
- **The verdict replaces `owner_event` on the words path.** `push_live(peer, session, text, event, project, words=None)`: `words` True takes the bridge's `deliver` (once per key, as today), then a `--bg` job's supervisor; `words` False takes the inbox frame; `words` None (a machine not cut over, or a frame no log holds) decides by `owner_event` as today. `refuse` pushes nothing: the event settles `refused-words`, and its `delivery` outcome goes up with the reason the endpoint's verdict named. `revoked {version, devices, members, keys}` settles every owed `human` event whose `verified.signer` names a listed device, member or key `refused-revoked` under the delivery lock, asked or not, and drops its pending `words?`; a `words` answer arriving later for it is ignored. Rejected: leaving revocation to the next `words?`, which the brief rules out ("stops retrying owed words at once") and which would keep a removed device's words in the queue for up to a minute of retries.
- **A legacy signer is a peer.** An event whose `verified.signer.kind` is `legacy` is delivered as an inbox frame marked `(unverified, legacy)`, never asked, never words (RL §9). On a machine not cut over, nothing of this applies.
- **The label.** `compose_chat_frame` takes the sender's owners from the event's `verified.owners`: `from <alias>, owned by <id>` (ids joined by `, `), `from <alias> (owners unverified)` for `[]`, `from <alias> (unverified, legacy)` for a legacy signer, and `from <alias>` on a machine not cut over or for an event with no `verified` (one this machine wrote, or imported before cutover). `chat_line` prints the same clause. Member ids are rendered as the endpoint sends them (32 hex); whether the endpoint should annotate display names is an open question for O10 and O7. Rejected: resolving owners through aliases or `org.json`, which carries machines and projects, not members (RL6: owners are never resolved later through an alias).

**Not touched.** Which member holds `converse` (the endpoint's, O10 M5). Signing (the endpoint's). The bridge's `deliver` (unchanged). Lane B sessions: a `human` event owed to one is a peer message either way (M3's refusal falls back to the inbox).

**Proves.** Acceptance 5 and 6. Tests also pin:
- a member set sent whole at the welcome, a changed title sent alone, `gone` on leave, and nothing for a remote member;
- a session without a record sent with defaults and sent again once the record exists;
- two `human` events of one `hub/<member>` writer: only the first is asked until it settles, and the second follows in order;
- a `words` answer for an event that was settled meanwhile (a revocation) changes nothing;
- the operator path: `sminos say` from the terminal on a cut-over machine pushes nothing itself, the uplink asks after the upload, and the bridge sees one `deliver`;
- a `--bg` job with no bridge takes the supervisor's `reply` on `words` and the inbox on `peer`;
- a `revoked` naming a key, a device and a member each settles the right owed events, and `delivery` outcomes go up for them;
- the label in the inbox frame and in `sminos chat`, for each of the three forms;
- the DX2 suites unchanged, and `test-bridge-control.sh`'s delivery cases unchanged.

### M7 — Lane A actions with remote context

**What exists at its end.** A remote lane A action is bound to its sender and fenced to the launch it was sealed for:
- the ledger entry holds `member`, `device`, `fingerprint` and `target`, a known `opId` with another member or fingerprint is refused `op-conflict`, and `queried` and `tombstoned` carry the binding (O10 M7's query authorization reads it);
- every lane A session with a bridge has a launch id, minted by the mod when its process starts and kept across a `/reload-plugins`; the bridge's child carries it in its hello and status, the plane carries it in presence, and `member.launch` carries it to the endpoint;
- an RPC with `context {lane: 'A', session, launch}` is relayed to the bridge with `launch`, and the child refuses it `launch` immediately before the mod acts when its own launch differs; a decision takes the same check; every path that bypasses the bridge refuses a remote context; `resume`, `retire` and `stop` refuse a remote context as `unsupported` (O10 does not offer them);
- a desk spawn's `proof` is in the new session's record as `ownersProof`;
- a reseal of an op without an outcome is answered under its latest nonce once the outcome exists, and never runs twice (ticket 11a); an observer's refusal reconciled after a restart keeps its `lane-b` code (ticket 11b).

**What it touches.**
- `sminos_rpc.py`: `entry_of`, `dispatch` (the binding check and the reseal's nonce), `ledger_view` and `query`/`tombstone` (the binding in the answer), `plan` (the context's checks and the `launch` on each bridge command), `steer_without_bridge`, `spawn` (the proof), `refused_op`, `steered` and `command` (one observer-refusal reader), `trace`/`KEPT_READERS`.
- `sminos_bridge.py`: `serve` takes `--launch`; the hello and `/status` carry it; `do_POST`'s `/command` and `/requests/<id>/decision` check it.
- `sminos/hooks/mods/bridge.tsx` (`bridgeStart`, `startChild`), `bridge-state.tsx` (`launch` in the state and `$.state`).
- `sminos_plane.py`: `Bridges.answers`/`capabilities` carry `launch` into the presence body.
- `sminos.py`: `spawn_fresh` and `launch_env` (`SMINOS_DESK_PROOF`); `list --json` already shows `ownersProof`.
- `sminos_uplink.py`: `member.launch` (M6's frame builder reads the presence).
- Tests: `test_rpcs.py`, `test-bridge-control.sh`, `sminos/tests/mods/bridge.test.ts`, `test_records.py`, `test_session_plane.py`.

**Interfaces.** Consumes M5's `rpc` fields and M6's frames. Exposes the launch id (Interfaces §F), the ledger entry's binding (§B, extended) and `SMINOS_DESK_PROOF`.

**Decisions.**
- **The launch is the mod's.** sminos has no launch today: the mod's `generation` counts bridge children within one process, and the child's `nonce` names one hello (sminos_bridge.py:166, bridge.tsx:1413). RL §3.2's launch is the process holding the session, which is what a desk action is sealed against: a `--resume` in a new process must refuse an action sealed for the old one, and a `/reload-plugins` must not. So `bridgeStart` mints `state.launch` once per process (16 random bytes, base64url) when none is kept, keeps it in `$.state` (`sminos.launch`) beside the lane verdict so a module reload reads it back, and passes `--launch <id>` to every child it starts; the child's hello and `/status` carry it, and `Bridges.capabilities`/`answers` put `launch` in the presence body's `bridge` field, from which M6's `member` frame takes it. A session without a bridge has no launch, and the endpoint refuses its actions `context` before they reach sminos. Rejected: the engine's registry record (`<CLAUDE_CONFIG_DIR>/sessions/<pid>.json`, pid and start) as the launch, which the mod cannot read without a child and which a reused pid after a reboot could repeat; and the record's `controller.since`, which is a time written late by M3's relay, not an id the action can name.
- **The fence is the child's, immediately before the effect.** `Bridge.command` and `Bridge.decide` take an optional `launch` from the request body: when present and not the child's, the child answers `409 {ok: false, code: 'launch', error: …}` and posts nothing to the mod; absent, the command is a local caller's (`sminos steer`, the daemon's own `deliver`) and runs as today. The child's launch is its process's (the mod passed it), and the child dies with its process (it watches its parent), so a command the child relays under a matching launch reaches the launch it names. `command()` in `sminos_rpc.py` turns the 409 into `Refused("launch", …)` as it turns `lane-b`. `plan` adds `launch` from `context.launch` to every bridge command it builds for a remote RPC (`steer`, `interrupt`, `model`, `compact`, `command`, `btw`, `media`, `stop-agent`, `tell`, `stop`) and to the decision body (`answer`, `decide`). Rejected: checking the launch in the daemon against the presence it last read, which is a check at admission, not at the effect, and which a relaunch between the two would pass.
- **What a remote context means in sminos.** An `rpc` frame received on RL10 is remote. One that names a session must carry `context` with `lane: 'A'` and `session` equal to `args.session`, else it is refused `bad-shape` at admission (RL4: context is mandatory for an action on a session); a spawn carries none. With a remote context, `plan` never takes a path that bypasses the bridge: a `steer` on a session without a bridge is refused `context` ("the session has no bridge to fence it"), never `steer_without_bridge`'s supervisor or inbox; `resume`, `retire` and `stop` are refused `unsupported` (O10 §G does not offer them; `stop` is bridged but not offered either, and the refusal is the same). A DX2 RPC (a machine not cut over) carries no context and runs as today. Rejected: fencing by `member.launch` at the endpoint alone (O10 M7 does that too), which leaves the window between the endpoint's check and the bridge's effect open.
- **The binding.** `entry_of` keeps `member`, `device`, `fingerprint` and `target` from the frame (`target` is `{kind: 'session', session}` or `{kind: 'machine'}` for a spawn); `dispatch`, on a known entry or an op in flight, compares the frame's `member` and `fingerprint` with the entry's before re-arming the answer, and refuses `op-conflict` loose under the copy's nonce when either differs, revealing nothing of the stored one (O10 M7). `ledger_view` carries the binding, so `query` and `tombstone` answer it, and M5's `queried`/`tombstoned` frames carry it; an entry an older daemon wrote carries none, and the endpoint's authorization refuses such a query `grade`, which is the safe side. A DX2 RPC's entry keeps `member` alone, as today.
- **The reseal's nonce** (ticket 11a). `dispatch` today re-arms only an entry with an outcome (sminos_rpc.py:600–606); a reseal of an op in flight, or claimed and awaiting reconciliation, keeps the original nonce, and its outcome goes up under a nonce the hub no longer waits for. Now every known entry, and every op in flight, takes the copy's nonce (`Ledger.acked(op, False, nonce)` on a claim too, writing only the nonce), so `results()` sends the outcome under the latest; the claim's conditional write and `flight` still keep it from running twice. On RL10 results are keyed by `opId` as well, so the fix matters to DX2 machines and to the ack's `nonce` alike.
- **One observer-refusal reader** (ticket 11b). `refused_op` and `steered` map an answer `{ok: false, code: 'lane-b'}` to `failed('lane-b', …)` as `command()` does when it sees the answer live, so a kept answer read back by `trace` (`KEPT_READERS`), `rearm` or `reconcile` yields `lane-b`, not `failed` with `lane-b:` as its message's first word. `media_held`, `agent_stopped`, `told`, `commanded` and `started` share the reader.
- **The proof travels in the environment.** `spawn()` passes the frame's `proof` to `run_verb` as `SMINOS_DESK_PROOF=<canonical JSON>` beside `SMINOS_DESK_MEMBER`; `spawn_fresh` reads it and writes `ownersProof: [proof]` into the pending record (M1's claim then carries it to the child's record); `launch_env` drops it from every environment sminos builds, as it drops `SMINOS_LAUNCH`. An unparsable or absent proof on a desk spawn writes `ownersProof: []` and a daemon.log line, never a refusal: the proof is the attestation's, not the spawn's admission (the endpoint authorized it). A `sminos spawn` from a session copies the parent's `ownersProof` as M1 does. Rejected: a file the verb reads by path, which needs a lifetime and a sweep for a few hundred bytes.
- **MW5's upload id is the opId** since M2 (`media()` hands the bridge `upload: op`). On RL10 the op is the device's `opId`, so the files under the session's working directory and the `op` messages up the lane are named by it; nothing here changes, and the conformance replay pins it when the fixture carries a `media` action.

**Not touched.** The endpoint's authorization and its own ledger (O10 M5, M7). Lane B's ledger (the engine host, O10 M7). O8's record actions. M4.

**Proves.** Acceptance 7. Tests also pin:
- a reseal during flight: one run, one outcome, sent under the reseal's nonce (DX2) and under its `opId` (RL10); a reseal of a claim awaiting reconciliation after a restart: reconciled once, answered under the reseal's nonce;
- a kept `{ok: false, code: 'lane-b'}` answer reconciled after a restart reads `lane-b` for `steer`, `command`, `btw`, `stop-agent`, `tell` and `media`;
- `op-conflict` for a known `opId` with another `fingerprint`, and with another `member`, revealing nothing; the same `opId` with the same binding answered from the ledger;
- the mod mints one launch per process, keeps it across a reload (`$.state`), and a new child carries it; the child's `/command` with another launch answers 409 `launch` and posts nothing; a decision with another launch likewise; absent `launch` runs;
- `plan` adds `launch` to each bridge command for a remote RPC, and the RPC fails `launch` on a mismatch; a remote `steer` on a bridgeless session is `context`; remote `resume`, `retire` and `stop` are `unsupported`; a remote RPC without `context` is `bad-shape`;
- `member.launch` follows the presence and changes on a relaunch;
- a desk spawn's proof in the child's record, absent from the launch settings' env, and a session's spawn copying it;
- `queried` and `tombstoned` carry the binding; an older entry answers without one.

### M8 — To-human off the hub

**What exists at its end.** On a cut-over machine, what a session sends its person stays on the machine and reaches devices through the endpoint:
- the host events (`message`, `question`, `answered`; `HOST_KINDS`) of a hub project are appended to the host store, `projects/<id>/host/<writer>.jsonl`, by the bridge's live export and the Stop hook's export alike, and never to `log/`; the uplink's vector, uploads and `rejected` never name them;
- `sminos chat --host` reads the store and the log's older host events together, in time order, for the machine's own sessions;
- each appended host event is a `host` message on every subscription of its session on the session lane, and a subscription's snapshot carries the session's last 50;
- a machine not cut over, and a git-mirrored project on any machine, write host events where they go today.

**What it touches.**
- `sminos.py`: `append_host` (the route), `host_read` (new), `_askers`, `chat_host`, `export_host`/`export_live` (unchanged callers), `log_read` (unchanged).
- `sminos_plane.py`: `Subscription` tails the session's host file beside its transcript and emits `host`; `snapshot` carries `host`.
- `sminos_hublog.py`: `vector`, `writers`, `uploads` see `log/` alone (they do today; a test pins it).
- `sminos_bridge.py`: `_export_now` (unchanged; `append_host` routes).
- Tests: `test-bridge-export.sh`, `test_session_plane.py`, `test-uplink.sh` (nothing of `host/` goes up), `run-sminos-tests.sh` core (`chat --host` over both stores).

**Interfaces.** Consumes M5's cutover flag and session lane. Exposes the host store (Interfaces §G) and the `host` message kind.

**Decisions.**
- **A store beside the log, not a filter at upload.** A writer's seqs are contiguous and the hub refuses a gap for good (RL §6.2: a withheld event becomes a permanent gap), so host kinds cannot be left out of a session writer's upload; and they cannot keep going to `log/` on a cut-over machine, since `uploads` sends every own writer whole. So on a cut-over machine, for a hub project, `append_host` appends to `projects/<id>/host/<writer>.jsonl`: the same event shape, the same writer names (`writer_id(session)`; an answer under the asker's writer, as today), its own seq space, the same `(kind, src)` dedup under the same locks (`_append`'s rule, on the host directory). `host_read(project)` reads the store as `log_read` reads the log. The log's older host events (before cutover) stay where they are, already on the hub, and `chat_host` merges both by `ts`. Rejected: a host writer name inside `log/` (`<name>/<session>/host`, or a suffix), which every reader of writer names would need to learn (`writer_session`, `outside_origin`, `owner_event`, `_owed`, the vector), for the one gain of a shared reader; and filtering at upload, which RL §6.2 forbids.
- **The store reaches devices on the session's own plane.** A device that may see a session sees what it said to its person: that is the session's `full` subscription (O10 M8, lane A: one upstream sminos subscription per remote one, message-opaque, with a ring). `Subscription` tails the session's host file as it tails its transcript (`read`), and emits each new host event as `envelope(project, machine, session, 'host', sub, n, {event})`; `snapshot` adds `host: [<last 50>]` to its body. The endpoint relays both unchanged. `notify wrote` (O10 M3) is derived at the endpoint from a `host` message whose `body.event.kind` is `message`, for a session with a listing. What O10 adds, precisely: (1) M3 derives `wrote` from the `host` kind on the session lane (its text already says "as O12's phase 2 reports it up RL10"; this is the report); (2) M8 needs nothing, since the lane is opaque to it, and `host` is one more kind in a `full` subscription, never in `cards`; (3) no new RL10 frame. Rejected: a dedicated RL10 frame (`host {project, session, event}`) and an endpoint-side host store served by a call, which O10 would have to build (a store, its retention, a read with authorization) for what the plane already carries to the readers who may see it. What this leaves open, for O7: a project-wide "what my sessions said" view would need an endpoint call across sessions; the per-session plane serves the sidebar's session view, which is MAWS's shape today (desk's project chat of `<message>`s moved to channels, RL §6.2).
- **Async asks are records here, cards elsewhere.** The ask itself is a `raised` request on the requests plane and a card over channels (O10 M8's `cards`); the `question` and `answered` host events are the transcript's record of it, kept and shown as the `message` kind is. Nothing of the ask's answering changes.
- **Cutover decides, per machine; the project kind decides, per project.** A git-mirrored project (a remote in `.smns`, no hub) keeps host events in its log, which git mirrors as today; RL §6.2's rule is about the hub. The machine's own project and every hub project take the store once the machine is cut over. Rejected: moving git projects too, which changes a path the cutover has no reason to touch.

**Not touched.** The to-human plugin and its mod. MAWS's own `mcp__maws__message`. The requests plane. Desk-web (O13's cards keep working: they are not the host store).

**Proves.** Acceptance 8. Tests also pin:
- the bridge's live export and the Stop hook's export of the same records append one copy, in the store, on a cut-over machine; in the log on one not cut over;
- an answer to a question another session asked goes under the asker's writer in the store;
- `chat --host` shows a pre-cutover question from the log with its post-cutover answer from the store beneath it;
- the uplink's `hello` vector and `events` frames name no host writer or event, and a `resend` for one is refused;
- a subscription made after three host events sees them in its snapshot, and a fourth as a `host` message; a `cards`-style reader (the requests plane) sees none;
- a git-mirrored project on a cut-over machine writes to its log.

### M9 — The mini

**What exists at its end.** The mini runs this sminos, at or above M8's version, installed through the mini-ops session at the owner's request near O14's cutover of the mini (RL §9 step 2: the owner's standing rule forbids driving `claude` over ssh there), and once O14's brief has cut it over, its sminos is local-only with its unattended seats intact. This milestone verifies; it builds nothing and runs nothing on the mini itself.

**What it touches.** Nothing in either repository. Its evidence goes to Outcomes & Retrospective.

**Decisions.**
- **Verification, not a procedure.** The install is mini-ops' (a session on the mini, at the owner's request); the cutover is O14's. What O12 states is what must hold afterwards, read from the MacBook over the org and from the mini's own `daemon status` as mini-ops reports it: the sminos version, `uplink: RL10 (local-only)`, no DX2 stream for the mini at the hub (the hub's machine presence, O11's `GET /api/machines`), the journal and Telegram seats neither `retired` nor `gone` across the install (`sminos list --org --json` before and after, their session ids unchanged or continued by `hand_off`), and one `sminos say` from the MacBook to a mini session arriving labelled with its owner. Rejected: a script that runs `claude` on the mini over ssh, which the owner's standing rule forbids, and a sminos self-update verb, which does not exist and which the plugin marketplace already provides.
- **Order against O14.** sminos at phase 2 must be installed on the mini before O14's brief enrolls the mini's endpoint, since the first RL10 welcome is what cuts sminos over (M5): an endpoint enrolled against an older sminos would run beside a DX2 uplink under one name. O14's brief checks the mini's sminos version first; this is a parent impact for O14.

**Not touched.** O14's brief. The mini's seats.

**Proves.** Acceptance 9, by the checks above, recorded with their outputs.

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

Phase 2, doperpowers, from a worktree cut from `origin/main` (M5 first; M6, M7 and M8 from `main` after M5 lands):

    SMINOS_PART=core bash sminos/tests/run-sminos-tests.sh      # the `sminos` gate: M8's chat --host cases join it
    SMINOS_PART=suites bash sminos/tests/run-sminos-tests.sh    # the `sminos-suites` gate: test-uplink.sh's RL10 section, test-hub.sh, test_rpcs.py, test_words.py, rl10_conformance.py
    bash sminos/tests/test-uplink.sh                            # while iterating on M5: DX2 then RL10 sections, each against its stand-in
    python3 -B sminos/tests/test_rpcs.py                        # M7: the binding, the fence, the two debt items
    python3 -B sminos/tests/test_words.py                       # M6: words?, revoked, the label, against endpoint_standin.py in-process
    python3 -B sminos/tests/rl10_conformance.py sminos/skills/sminos/scripts sminos/tests/rl10-conversation.json   # M5, once O10 M6's fixture is copied
    bash sminos/tests/mods/run.sh                               # the `sminos-mods` gate: M7's launch in bridge.test.ts
    bash tests/mods/typecheck.sh                                # the `mods-types` gate
    scripts/bump-version.sh --plugin sminos <next>
    ci-gate                                                     # GREEN <run-url>; every phase 2 PR runs sminos, sminos-suites, sminos-mods, mods-types and repo-checks

Copying the conformance fixture (M5), by path, with its source pinned in the file's first line:

    git -C <MAWS worktree> rev-parse HEAD                                             # the sha the header names
    cp <MAWS worktree>/test/endpoint/rl10/conversation.json sminos/tests/rl10-conversation.json

A live check of M5 runs with no inference and no owner data: `MAWS_USER_DATA=$(mktemp -d)/profile`, a scratch-profile `mawsd` built from O10's branch (`node out/main/mawsd.js run --private --dir "$MAWS_USER_DATA/mawsd"`, enrolled against the local hub as O10 M10's test does), `SMINOS_HOME` and `HOME` temporary, `sminos daemon run` in the foreground; then `sminos daemon status` reads `uplink: RL10 (local-only)`, `daemon/identity.json` exists, and the local hub's machine presence shows the machine on RL1 alone. The same scene, without the `mawsd`, shows the DX2 uplink against `hub_standin.py` as today.

MAWS: phase 2 lands no MAWS code. What it asks of O10 is in Surprises & Discoveries and the Decision Log, relayed through the P5 writer; the fixture copy is a read.

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
  "former": ["<uuid>", "..."],
  "basis": "launch" | "lineage" | "hook" | "default"
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

### D'. sminos's side of RL10 (M5), against O10's Interfaces §D

The frames are O10's §D, name for name. What sminos adds, reads differently, or keeps beside them:

    discovery   $MAWS_USER_DATA/mawsd/endpoint/rl10.json when MAWS_USER_DATA is set, else O2's platform default;
                SMINOS_RL10=<path> overrides for a test. Required: a regular 0600 file of this uid,
                { socket, pid, build, token: <64 hex>, protocol: 1 }.
    hello       { t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: ['kinds:all'], token, sminos: { version },
                  policy: { read_only, ceiling } }      // the first line; nothing before the welcome
    up          DX2's log plane uncoded (events as stored, no mac); session { message } with raised, settled and delivery
                bodies uncoded; the machine presence as DX2 sends it: { t: 'session', message: { kind: 'machine', body: { online, policy, checkouts, desk } } };
                rpc-result { t, project, opId, nonce, outcome }; member (M6, §D's shape, engineSessionId = session);
                words? { t, id, session, event } (M6; the stored line without `verified`); queried / tombstoned (§D's shape, M7's binding fields);
                policy-set; legacy-key { org, key }; rejected
    down        welcome: identity written to daemon/identity.json; `capabilities` read for kind names, every kind sent when none;
                events { project, events: [{ event, signer, owners? }] }: stored as `{...event, verified: { signer, owners } }`, an `event`
                carrying `verified` refused bad-shape; have, resend, refused as today; subscribe, unsubscribe, rows, diff, output, read as today;
                rpc: §D's fields, plus `nonce` (required, the action's) and `session` read from args (a top-level one copied in);
                rpc-ack { opId } (a `nonce` also accepted); query { opId, opCreated } and tombstone { opId, opCreated? } → Rpcs.query / Rpcs.tombstone;
                words { id, verdict } (M6); revoked { version, devices, members, keys } (M6); policy → daemon/policy.json; org → daemon/org.json; legacy-key?
    lanes       one: a frame is taken when written; continuations run on write; every welcome resends the complete request
                set, each project's hello and every unacknowledged rpc-result.

Files (all 0600 under `$SMINOS_HOME/daemon/`, written atomically):

    identity.json   { org, hub, name, former: { <name>: [<session>...] }, ref, enrolled, cutover: <ISO 8601>, build }
                    // written at the first RL10 welcome; read before hub.json by enrollment(), machine_identity(), enrolled_at(), hub show;
                    // its presence is the cutover: the supervisor runs the child in RL10 mode only, and hub.json's credential is never used again
    policy.json     as today; written from `policy` frames on a cut-over machine

Readers: `sminos_rl10.find() -> dict | None` (the file, checked), `sminos_rl10.cutover() -> dict | None` (identity.json), `Link(cred, logs, transport=..., coded=False)`.

### E. The delivery verdict (M6)

    push_live(peer, session, text, event=None, project=None, words=None)
        # words True: the bridge's deliver (then a --bg job's supervisor); False: the inbox frame; None: owner_event decides (DX2, or no event)
    deliver_verdict(project, member, event, verdict: 'words' | 'peer' | 'refuse') -> outcome
        # under the delivery lock; the event must still be its writer's first owed; settles and records as deliver_next does
    outcomes.REFUSED_WORDS = 'refused-words'; outcomes.REFUSED_REVOKED = 'refused-revoked'   # delivery outcomes up the session lane

The stored line's `verified: { signer: { kind: 'device', member, device } | { kind: 'machine', ref, name } | { kind: 'legacy' }, owners: MemberId[] }` is read by delivery (the words rule, the label) and by `chat`. It is never sent back inside an event.

The label: `[sminos chat <project> <ref> from <alias>, owned by <id>[, <id>] → @you]`; `from <alias> (owners unverified)` for `owners: []`; `from <alias> (unverified, legacy)` for a legacy signer; `from <alias>` with no `verified`.

### F. The launch and the binding (M7)

    bridge mod:   state.launch (16 random bytes, base64url), minted at the process's first bridgeStart, kept in $.state as `sminos.launch`;
                  the child is started `sminos bridge --launch <id>`; the hello and GET /status carry `launch`
    bridge child: POST /command and POST /requests/<id>/decision take an optional `launch` in the body;
                  a mismatch answers 409 { ok: false, code: 'launch', error } and posts nothing to the mod
    presence:     body.bridge carries `launch`; member.launch (M6) is read from it
    rpc:          a remote RPC naming a session carries context { lane: 'A', session, launch }; plan() passes `launch` on every bridge command
                  and decision; a remote RPC without a bridge path is refused `context`; resume, retire, stop: `unsupported`
    ledger entry: + member, device, fingerprint, target: { kind: 'session', session } | { kind: 'machine' }, context?, proof?
                  (a DX2 entry keeps `member` alone, as today)
    query/tombstone answers: + member, device, fingerprint, target when the entry holds them
    op-conflict:  a known opId whose frame names another member or fingerprint; loose, under the copy's nonce
    SMINOS_DESK_PROOF=<canonical JSON of the spawn's signed action>: set by the daemon for a desk spawn's verb, read by spawn_fresh into
                  the pending record's ownersProof, dropped by launch_env

### G. The host store (M8)

    projects/<id>/host/<writer>.jsonl     # on a cut-over machine, for the machine's own project and every hub project: HOST_KINDS events,
                                          # the same shape and writer names as log/, their own seqs, (kind, src) dedup under the same locks
    host_read(project) -> [event]         # as log_read reads log/; chat --host merges it with log_read(project, kinds=HOST_KINDS) by ts
    session lane: envelope(project, machine, session, 'host', sub, n, { event })   # one per appended host event, on every subscription of the session
                  snapshot body + host: [<the session's last 50 host events>]
    nothing of host/ is in the uplink's vector, uploads, resend or rejected

O10's part: `notify { kind: 'wrote' }` derived from a `host` message whose `body.event.kind` is `message` (M3); `host` rides a `full` subscription unchanged and never a `cards` one (M8).

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
- Observation: a `claude -p` (stream-json in and out) writes its registry record, `<CLAUDE_CONFIG_DIR>/sessions/<pid>.json`, naming its session. The bridge child's parent is the claude process itself, and the hook records a marked session as `origin: {kind: maws}`, `source: hook`.
  Evidence: M3's live check, 2026-10-27 (claude 2.1.311; the child's ppid was claude's pid).
- Observation: a session outside any sminos project gets no record, so no controller is ever written for it, and desk Resume has nothing to refuse it by. A desk Resume needs the session joined anyway.
  Evidence: M3's first live run, in a bare directory: `session record: absent`.
- Observation: on this machine `claude` on PATH is the cmux shim, and a minimal PATH that puts `/usr/bin` first gives Python 3.9, which sminos refuses, so neither the CLI nor the bridge child runs. A live check runs the native binary (`~/.local/bin/claude`) with a 3.10+ interpreter first on PATH.
  Evidence: M3's first live attempt, 2026-10-27.
- Observation: MAWS's hub `RpcErrorCode` union doesn't name `lane-b` either. DX6 carries any string, so nothing breaks, but the type is stale (the architect tracks it).
  Evidence: M3's executor, 2026-10-27.
- Observation: in a shell test on Linux, `sleep 600 & pid=$!; kill $pid; wait $pid` can stall for the sleep's whole 600 s: the kill lands right after the fork, before the exec, and doesn't end it. That held `test-bridge-control.sh` for 10 minutes and cancelled `sminos-suites` at its job limit. macOS didn't show it. A test now uses a process that exits on its own for a gone pid, and kills and reaps each process it starts in the case that started it.
  Evidence: doperpowers CI run 40448721720, 04:16:18 → 04:26:21 on one case.

Phase 2's survey of sminos 1.19.0 (`8f79b741`) against O10's M6 and Interfaces §D, 2026-10-27. Each is an amendment O10 makes, or a difference sminos absorbs (said which), relayed through the P5 writer:

- Observation (O10 amendment): §D's `rpc` frame carries no `nonce`, and sminos cannot take an RPC without one: `receive` reads it first, `refuse_loose` keys a loose refusal by it and drops one whose nonce is not 16 bytes, `entry_of` keeps it, and `results` sends `rpc-result` by it. The action has a nonce (RL4; O10 M7 checks it), so the frame should carry it.
  Evidence: `sminos_rpc.py:566`, `662–669`, `341–349`, `1281–1296`.
- Observation (O10 amendment): §D's `rpc` has `session?` beside `args`, while DX6 and sminos read `args.session`, and `shape` checks a decision's `digest.session` against `args["session"]`. sminos copies a top-level `session` into `args`; §D should say the session is `args.session`, or name both.
  Evidence: `sminos_rpc.py:580`, `1427`.
- Observation (absorbed): sminos refuses an RPC whose `machine` is not its own (`wrong-machine`); §D's frame has none. On RL10 the socket is this machine's, so the check is skipped in that mode.
  Evidence: `sminos_rpc.py:575–576`.
- Observation (O10 amendment): `rpc-result` and `rpc-ack` are keyed by `nonce` today; §D keys them by `opId`. sminos sends both (`{project, opId, nonce, outcome}`) and acknowledges by either; §D's `rpc-result` should admit `nonce`, so the endpoint can match a reseal's copy as the hub does.
  Evidence: `sminos_rpc.py:686–693`, `1281–1296`.
- Observation (O10 amendment): `hub.json`'s `former` is `{name: [session ids held under that name]}`, read by `is_self` to attribute a session to a former name; §D's `identity.former`, "every other name `machineNames` binds to this ref", can only be a list of names. sminos keeps the map itself (`identity.json`, M5) and takes names from the welcome; §D should say `former` is names.
  Evidence: `sminos.py:6634–6654`, `6662–6670`.
- Observation (O10 amendment): the machine presence is not a separate frame: sminos sends `{t: 'session', message: {kind: 'machine', session: null, body: {online, policy, checkouts, desk}}}`. §D's `machine { online, policy, checkouts, desk }` beside `session { message }` reads as two frames; it should name the `session` frame with `kind: 'machine'`, unless O10 means a new top-level frame, in which case sminos adds it.
  Evidence: `sminos_hublog.py:348–361`.
- Observation (O10 amendment): `raised`, `settled` and `delivery` bodies carry a DX1 `mac` today (`Requests.seal`, `outcomes.message`); on RL10 they go as drafts without one. §D says the session lane is uncoded, and O10 M6's reader of those bodies must not look for `mac`.
  Evidence: `sminos_requests.py:380–385`, `sminos_outcomes.py:363–374`.
- Observation (O10 amendment, and M7's definition): nothing in sminos is a lane A `launch` today. The mod's `generation` counts bridge children within a process, and the child's `nonce` names one hello; neither names the process holding the session. M7 defines the launch as the mod's per-process id, carried in presence as `bridge.launch`; §D's `member.launch` and `context.launch` are that id, an opaque string, absent for a session without a bridge.
  Evidence: `bridge.tsx:1413–1415`, `sminos_bridge.py:166`, `bridge-state.tsx:234–254`.
- Observation (absorbed; open question): DX2's welcome lists `kinds`, and `read` and `op` messages go only to a hub that lists them; §D's welcome has `capabilities` and no `kinds`. sminos sends every kind on RL10, and reads a capability naming kinds if O10 defines one.
  Evidence: `sminos_uplink.py:1333–1337`.
- Observation (O10 amendment): O10 M6 decides `words?` by verifying the event "against the head" and checking "the inbound index holds it at that position"; the inbound index holds arriving events only. An own `<name>/human` event (the operator path, RL §5.7) carries no `sig` on sminos's disk and is in no inbound index; the endpoint holds its signature in the signature ledger once the `events` frame carrying it has gone up. sminos asks after that frame, on the same socket (M6); O10's `words?` must take the own-writer case from its signature ledger and the record.
  Evidence: `sminos.py:4059`, `1726–1728` (the writer); `sminos_hublog.py:457–491` (no code stored locally).
- Observation (O10 amendment): §D has no frame by which a to-human message reaches the endpoint, while O10 M3 derives `notify wrote` "as O12's phase 2 reports it up RL10". M8 reports it as a `host` message on the session lane (Interfaces §G); O10 M3 derives `wrote` from it.
  Evidence: O10 M3's text; `sminos.py:4203–4215` (HOST_KINDS, exported from the transcript, written to the project log today).
- Observation (absorbed; noted for O10): `member.engineSessionId` is redundant for sminos: its `session` is the engine's session id, and the endpoint joins `appSessionId` to it through `engine.sessions` (O10 M6). sminos sends it equal to `session`.
  Evidence: O10 M6 "joins it to sminos's member by `engineSessionId`"; `sminos_plane.py:2553–2565` (members keyed by the engine's session id).
- Observation (absorbed): the arriving `events` frame's shape changes from a list of coded events to `[{event, signer, owners?}]`; `take` unwraps and stores `verified` (M5). An event this machine wrote, returned by the hub, carries `sig` and `attest` the local copy lacks, so `same_event` strips those as it strips `mac`.
  Evidence: `sminos_hublog.py:527–560`, `141–151`.
- Observation (open question for O10): DX2's per-POST answer is what the uplink's at-least-once rests on (a settlement leaves its outbox, an `op` message leaves `rpcs-owed.json`, only once the POST was answered 200 and did not refuse it). §D has no per-frame acknowledgement, so on RL10 a frame is taken when written (M5's decision), and a loss at an endpoint crash between sminos's write and the endpoint's relay is recovered only by the complete set at the next welcome.
  Evidence: `sminos_uplink.py:1204–1226` (the `Link` docstring), `sminos_owed.py:1–18`.
- Observation (for P5 and O14): the hub keeps one generation counter per machine name across DX2 and RL1, so a sminos DX2 stream and an endpoint RL1 socket under one name replace each other (4409). M5's cutover is therefore once and for good, and a cut-over machine with its `mawsd` down is off the hub until `mawsd` runs; `sminos daemon status` says so. O14's brief must install phase 2's sminos on a machine before enrolling its endpoint there.
  Evidence: O10 Orientation ("one generation counter per machine name shared DX2/RL1"); `sminos_daemon.py:1157–1200` (the supervisor restarts on `hub.json` alone today).

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

- Decision: M3's sminos side is cut from M1's branch (`p5-o12-m3` at `72e67f77`) while M1's review finishes, rather than from `main` after M1 lands, and merges `main` in once M1 does. Its MAWS marker landed first, as MAWS PR #194 (`0de73723e`, P5 Decision Log 26).
  Rationale: M3 consumes only M1's reader and controller writer, whose shape the review rounds don't move; most of M3 is the bridge mod, which M1 doesn't touch.
  Date/Author: 2026-10-27, O12's executor (desk-sminos-orchestrator).

- Decision: M1's review rounds (doperpowers:reviewer-high, three rounds) revised the record's model, as stated in M1's Decisions and the Constraints:
  - the launch is bound to the first startup SessionStart's id by a lock-free atomic create, replacing the ordering argument that SessionStart runs before tools;
  - evidence precedence is launch > lineage > hook > default, strictly upward, with every change republished (the orchestrator's three conditions: republish per change, never equal or weaker, nothing local caches authority from a first `joined` — none was found);
  - readers take the latest publishing `joined`, and `lifecycle` writes every `joined`'s provenance from the record under the writer file's lock;
  - lineage evidence comes only from predecessors, never a record's own publication;
  - `list --org --json` carries no `principal`, `inference` or `controller` (`--machine`, `--project` and `--here` still show them on local rows);
  - the publication check runs from a one-pass log index.
  Rationale: each round found a path to a wrong owner or a regressed publication. Round 3 found no P1; its one P2 (a machine rename mid-write in a git-mirrored project can append a stale publication under the former writer name, repaired at the next publication pass) is carried as an unresolved review finding.
  Date/Author: 2026-10-27, O12's executor (desk-sminos-orchestrator), the orchestrator ruling on the binding and the precedence.

- Decision: M3's gaps and its review rounds, settled in building it.
  - **The verdict** is the bridge child's, made on one observation of the session's parent (the child's own parent, whose registry record must name the session):
    - `match` when that parent is the SMNS_MEMBER pid;
    - `mismatch` only on positive evidence of another spawner: no valid mark at all, or the mark's process running (alive, and not a zombie, Z or X), started in an earlier whole second than the session, and not its parent (a `claude` a lane B session's Bash started);
    - `unresolved` for everything else: no registry record yet, `ps` failing, an unreadable state or start time, a host started in the session's own second, a dead host (the engine re-parented to PID 1 or a subreaper), or a mark pid reused by a younger process.
    The strict earlier-second rule loses no real case. A Bash-started `claude` exists only after the host spawned the engine, the engine booted, ran a model turn and called Bash, which is seconds at least. If one ever were that quick, it would be held an observer, the safe side.
  - **The verdict is the process's and sticky.** The mod adopts one only while none is resolved, keeps it in `$.state` (`sminos.lane`) for a reload, and passes it to every later child it starts (`sminos bridge --lane <verdict>`). That child uses it for its decision route and its controller relay, so a replacement child after the host exited can't recompute `mismatch`.
  - **The child's lines are its own.** A verdict resolved after the hello arrives as `{op: "lane", lane}` with no command id. The child's `/command` refuses `hello` and `lane` from a client, and the mod ignores a `lane` line that carries an id. A change of observing pushes a resync, which carries the new capabilities.
  - **The observer.** Every control op is refused `{code: lane-b}`, while `ping` and `read` still answer. `ops` is `[]` and `reads` stays advertised. Nothing is raised, and `turn.step` claims nothing and rewrites nothing. An upload's wake is never submitted.
  - **The controller relay.** Each launch's child writes its lane to the record: B for `match`, A for `mismatch` or an unmarked session, nothing while unresolved. It retries until the record exists, and keeps `since` when the lane hasn't changed.
  - **The daemon answers `lane-b` itself.** A bridged control RPC the bridge refuses `lane-b`, and the decision route's 409 `lane-b`, are answered with that code, not a generic `failed`. A `lane-b` upload's saved files are removed, as for any definite refusal.
  - **Desk Resume's order.** The record's `controller.lane == "B"` check runs in `plan`, before `session-live` and before the claim.
  - **Test environments.** `MAWS_LANE` is scrubbed from the hermetic test environments (the bridge, core and session-plane suites), and `launch_env` drops it from every `claude --bg` launch.
  - **An M2 follow-up.** `sminos rpc-query` takes the op id after `--` (`sminos rpc-query [--created T] -- <opId>`), since a base64url id starts with `-` one time in 64. M2's tests pass ids that way, which ends their ~5% flake, and a fixed `-`-leading id is pinned.
  Rationale: where evidence is ambiguous the answer is `unresolved`, which keeps the session an observer. Two controllers on one MAWS session is the failure M3 removes. Each review round that found issues (doperpowers:reviewer-high, three of them) found a path back to it, and each was closed with a regression test.
  Date/Author: 2026-10-27, M3's executor, the rulings the orchestrator's (p5-desk-track-owner).

- Decision: Phase 2's milestones, their order and their review. M5 (the RL10 client and the local-only switch), then M6 (members, words, the label), M7 (lane A actions with remote context, and ticket 11's two debt items) and M8 (to-human off the hub) on parallel branches from `main`, then M9 (the mini, verification only). M5, M6 and M7 get doperpowers:reviewer-high at their PRs: M5 decides when a machine stops talking to the hub and what it takes as its identity and policy, M6 decides who may write a person's words, and M7 fences every remote action and binds it to its sender. M8 gets doperpowers:reviewer-medium: a store beside the log and one more plane kind. M9 has no code. Each PR runs doperpowers' `sminos`, `sminos-suites`, `sminos-mods`, `mods-types` and `repo-checks` gates through `ci-gate`; MAWS's gates are not run, since phase 2 lands no MAWS code. The phase closes with a doperpowers:review-code high pass over its range.
  Rationale: M6, M7 and M8 consume only M5's transport and its `verified` key, and nothing of each other; the three rungs follow phase 1's rule that a milestone changing who may control or address a session gets the frontier reviewer. Rejected: one branch for all of phase 2, which would hold the debt items and the host store, each buildable today, behind O10 M6's fixture.
  Date/Author: 2026-10-27, desk-sminos-orchestrator (p5-desk-track-owner).
- Decision: The RL10 client is `sminos daemon uplink` in a second mode, chosen at the child's start from `rl10.json` and `identity.json`, keeping `Link`'s handlers, `Here`, the plane, the requests and the RPCs behind a `Transport` (M5).
  Rationale: O10 chose DX2's vocabulary so sminos keeps its handlers and swaps the transport (its M6); one process keeps every delivery and every RPC of the machine on one path, which M6's words rule needs. Rejected (strongest): a `daemon endpoint` child beside the DX2 uplink, which would be two processes delivering into one session and two owners of the ledger.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: Cutover is once and for good: the first RL10 `welcome` writes `daemon/identity.json`, after which the supervisor runs the child in RL10 mode only and `hub.json`'s credential is never used again; with the endpoint down the machine waits and says so (M5). Undoing it is removing the file, which O14's brief owns.
  Rationale: RL §9 ("each machine cuts over once"), RL §2.1 ("a machine never runs two uplinks under one name"), and the hub's one generation counter per machine name across DX2 and RL1, under which a DX2 reconnect would replace the endpoint's RL1 socket at every `mawsd` restart. Rejected (strongest): following the socket's presence and falling back to DX2 while `mawsd` is down, which is the generation fight above, and which would deliver DX1-coded words again on a machine that has accepted v2's trust model.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: The machine's identity is `identity.json`, read before `hub.json`; `former` keeps sminos's own map of names to the sessions held under them, with names from the welcome added; `hub.json` stays until O14's final brief removes it with the legacy key (M5).
  Rationale: `is_self` needs the sessions a former name held, which only sminos recorded; the endpoint's `former` can be names alone. Rejected (strongest): asking O10 to carry the map, which the endpoint never knew; and deleting `hub.json` at cutover, which would answer `legacy-key?` with nothing if the endpoint ever lost `legacy.json`.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: On RL10 a frame is taken when written: DX2's two lanes become one, and the continuations that waited for a POST's 200 run on write; every welcome resends the complete request set, each project's hello and every unacknowledged `rpc-result` (M5). Recorded as an open question for O10.
  Rationale: §D has no per-frame acknowledgement; the session lane stops at the endpoint, which re-snapshots its subscribers after its own restart, so a lost settlement costs a subscriber's view until then and nothing durable. Rejected (strongest): asking O10 for an acknowledgement frame before any loss has shown, which adds a round trip to every session-lane frame for a case M11 can measure.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: An arriving event's verdict is stored on its line under one key, `verified: {signer, owners}`, stripped where the exact event matters (`words?`, `same_event`); an arriving `event` that carries `verified` itself is refused `bad-shape` (M5).
  Rationale: the words rule and the label read the verdict at every delivery and every `chat`, and one key on the line is one rule for writers and readers; the refusal keeps a device from signing a verdict in. Rejected (strongest): a sidecar of verdicts keyed by (writer, seq), joined on every read, and lost or stale apart from its log.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: The endpoint's policy is authoritative on a cut-over machine: `policy` frames write `daemon/policy.json`, and `sminos daemon policy` sends `policy-set` and takes the endpoint's answer (M5).
  Rationale: one read-only on one machine; `deliver_next` and `admit` keep reading the file, so the DX2 path is untouched. Rejected (strongest): two policies, the endpoint's for remote actions and sminos's for delivery, under which `read-only on` could refuse an action and still deliver.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: `member` frames describe local members only, with `lane` from the controller (else `B` for a `maws` origin, else `A`), `engineSessionId` equal to `session`, `launch` from the presence, and defaults for a session whose record is not yet written, sent again once it is (M6).
  Rationale: the endpoint attests and lists this machine's sessions, and its `RecordSource` wants every one of them. Rejected (strongest): every member sminos knows from logs, which would have the endpoint listing other machines' sessions under this machine's signature.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: On a cut-over machine, `human` events from outside the machine and from its own operator writer are delivered by the uplink child alone, in two passes around `words?`; the daemon's tick and the CLI's fast path leave those writers owed; `revoked` settles their owed events at once; a legacy signer is a peer marked unverified (M6).
  Rationale: the question is answered on the socket one process holds, whose main thread cannot block in a handler; writers carry one kind each, so the split keeps every writer's order. Rejected (strongest): a second RL10 connection for `daemon run` and the CLI, which §D does not define and which would send the member set and the log plane twice.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: The operator path asks `words?` only after the event's `events` frame has gone up, on the same socket, so the endpoint can answer from its signature ledger; the fast path never delivers an own `human` event on a cut-over machine (M6). O10's `words?` decision for an own-writer event is an amendment.
  Rationale: the own event has no signature on disk; ordering on one socket is the guarantee that costs nothing. Rejected (strongest): sminos keeping a local "operator words" rule (`@machine` owners pass), which decides nothing for a session owned by a member id and reintroduces a second trust rule beside the endpoint's.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: The label renders member ids as the endpoint sends them: `from <alias>, owned by <id>`; `(owners unverified)` for `[]`; `(unverified, legacy)` for a legacy signer (M6). Display names are an open question for O10 and O7.
  Rationale: owners are never resolved through an alias (RL6), and sminos holds no member directory. Rejected (strongest): resolving names through `org.json`, which carries machines and projects, not members.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: The lane A launch is an id the bridge mod mints once per process and keeps across a reload, carried by its child, the presence and `member.launch`; the fence is the child's, at its `/command` and decision routes, immediately before the mod acts (M7).
  Rationale: a desk action is sealed against the process holding the session; the child is that process's and dies with it. Rejected (strongest): the engine's registry record (pid and start) as the launch, which the mod cannot read without its child and which a reused pid could repeat; and a daemon-side check against the last presence, which is admission, not the effect.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: A remote RPC naming a session must carry `context {lane: 'A', session == args.session, launch}` (`bad-shape` otherwise); with a remote context, no path bypasses the bridge: a bridgeless `steer` is `context`, and `resume`, `retire` and `stop` are `unsupported` (M7).
  Rationale: P5 Decision Log 45 and O10 M6: fence at the effect, or refuse. Rejected (strongest): letting a remote `steer` fall back to the supervisor's `reply` or the inbox when the bridge is gone, which is exactly an unfenced effect.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: The ledger entry binds the op to `member`, `device`, `fingerprint` and `target`; a known op under another member or fingerprint is `op-conflict`, loose, revealing nothing; `query` and `tombstone` answer the binding (M7).
  Rationale: O10 M7 authorizes a query against the binding the executor returns. Rejected (strongest): answering a query without the binding and leaving the check to the endpoint's memory, which O10 M7 rules out (the endpoint keeps no ledger for others' actions).
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: Ticket 11's two debt items are M7's: every entry without an outcome, and every op in flight, takes a reseal's nonce so the outcome goes up under the latest; and one observer-refusal reader gives `lane-b` to a kept answer read back after a restart as `command()` gives it live (M7).
  Rationale: both are ledger paths M7 reworks anyway, and each is a wrong answer to a right action. Rejected (strongest): running the resealed copy when the first is only claimed, which is the one thing the ledger exists to prevent.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: A desk spawn's proof reaches the pending record through `SMINOS_DESK_PROOF`, beside `SMINOS_DESK_MEMBER`, dropped by `launch_env`; a missing or unparsable proof writes `[]` and a log line (M7).
  Rationale: the proof is the attestation's evidence, and the endpoint already authorized the spawn. Rejected (strongest): a proof file handed by path, which needs a lifetime and a sweep for a few hundred bytes.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: On a cut-over machine, host events of the machine's own project and every hub project go to a store beside the log, `projects/<id>/host/`, and reach devices as a `host` message on the session's own plane subscription, with the last 50 in the snapshot; O10 M3 derives `notify wrote` from it, and nothing else of O10 changes (M8).
  Rationale: a writer's seqs are contiguous and a withheld event is a permanent gap (RL §6.2), so host kinds cannot stay in a session writer's file and be left out of its upload; the session's `full` subscription already reaches exactly the readers who may see the session, through a lane O10 M8 relays opaquely. Rejected (strongest): a dedicated RL10 frame and an endpoint-side host store served by a call, which O10 would have to build (storage, retention, an authorized read) for readers the plane already serves.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: The conformance replay copies O10's `conversation.json` into `sminos/tests/rl10-conversation.json` with its MAWS sha in the header, as `codes_parity.py` carries DX1's vectors; until O10 M6 lands, sminos's own `endpoint_standin.py`, written to §D, carries every RL10 test; a replay line that fails is either a sminos bug or an O10 amendment, and the PR says which (M5).
  Rationale: the fixture is O10's acceptance 5 made checkable from this side, and the stand-in lets M5 build before it exists. Rejected (strongest): waiting for the fixture before building M5, which puts O10's acceptance 2–5 (which run with this client) behind this document's own dependency.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: M9 verifies the mini and runs nothing on it: the install is mini-ops' at the owner's request, the cutover O14's, and the checks are read from the MacBook over the org and from the mini's `daemon status` as mini-ops reports it. O14's brief installs phase 2's sminos on a machine before enrolling its endpoint there (a parent impact for O14).
  Rationale: the owner's standing rule forbids driving `claude` over ssh on the mini (RL §9 step 2); the first RL10 welcome is what cuts sminos over, so the order is forced. Rejected (strongest): a script that performs the install over ssh.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: O8's record actions (`record.owners`, `record.access`, `record.shares`, executed by sminos under its ledger with an acknowledgement once the record is on disk) are not a phase 2 milestone; they are written in as M10 on M7's fence and binding once O8's execution document fixes the actions and their proofs.
  Rationale: nothing of their shape exists yet (O10's Decision Log dropped RL10's `record-set` in their favour), and writing them now would transcribe a guess, as phase 2 was held for RL10. Rejected (strongest): a placeholder milestone with an invented frame.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.

## Outcomes & Retrospective

Pending — written at finish.
