# P5-O12 — sminos under the endpoint: owners, the opId ledger and the lane B observer (2026-10-27)

> **Parent:** `docs/doperpowers/plans/2026-10-27-p5-org.md` (the P5 composite), child **O12**, §"O12: sminos under the endpoint". Parent pin: blob `a923eb6e09118cd848477322fb9d4721c9fe381f` at master `4abec20ca`. Binding on this child:
> - the remote layer `docs/doperpowers/specs/2026-10-26-remote-layer-design.md` (cited *RL §n*): RL6 (the session record), RL9 (the owner attestation), RL10 (endpoint ↔ sminos), §5.7 (who may write a person's words), §5.8 (default owners) and §6.4 (principal and inference route);
> - the desk control-surface spec `docs/doperpowers/specs/2026-10-22-desk-control-surface-design.md` (MW1–MW5: the bridge's ops, controls and the media RPC);
> - the holder design `research/desk-remote/session-holder-design.ko.md` §3.2 and §3.4 (the observer bridge and the reaping fence);
> - for phase 2: O10's execution document `docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md` (blob `8158a9ce3` at master `f05b9f17a`, and its RL10 alignment to sminos's frames on branch `p5-o10-doc-3`, `c4911a6d4` with its follow-up): its M6 (the sminos socket) and Interfaces §D (RL10's frames) bind name for name, with §G (which lane A RPCs cross), M3 (listings and `notify`) and M8 (the lane A subscription); and P5's Decision Logs 16–19, 23, 25, 26 and 45 (blob `cc929023c`, the same master), 45 giving phase 2 its duties. RL §5.7, §5.8, §6.2, §7.1 and §9 bind it as well.
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
- [x] M7a — Ticket 11's two debt fixes (the reseal's nonce, the `lane-b` recovery code). Reviewed clean by doperpowers:reviewer-medium in one round (no findings), landed as doperpowers PR #404 (`ae7e3ba9`, sminos 1.20.0), 2026-10-27.
- [x] M5 — The RL10 client and the local-only switch (item 5). Built by two executors in sequence on one branch, reviewed by doperpowers:reviewer-high over two rounds (round 1: one P1, one P2, both reproduced and fixed with regression tests; round 2 clean), landed as doperpowers PR #405 (`76cd8caf`, sminos 1.21.0), 2026-10-27. Its conformance replay lands once O10 M6's `conversation.json` exists, as a follow-up.
- [x] M6 — Members, words and the label (items 2 and 3). Built by two executors in sequence on one branch (member frames, receipts, revocation marks and the label; then the words pass and every deliverer), merged with M8 and re-bumped, reviewed by doperpowers:reviewer-high over two rounds (round 1: two P1 revocation bypasses and one P2 missing send-frame label, each reproduced and fixed with a regression test; round 2 clean), landed as doperpowers PR #407 (`15e60f18`, sminos 1.24.0), 2026-10-27.
- [x] M7 — Lane A actions with remote context (item 4's rest; Decision Log 45's fence, binding and proof). Reviewed clean by doperpowers:reviewer-high in one round (no findings), landed as doperpowers PR #408 (`00f6bfd5`, sminos 1.25.0), 2026-10-27.
- [x] M8 — To-human off the hub (item 6). Reviewed by doperpowers:reviewer-medium over three rounds (round 1: a cutover race leaving a copy in each store, and an unbounded host batch; round 2: a clock rollback stranding seqs behind the cursor, introduced by the bounded passes; each reproduced and fixed with a regression test; round 3 clean), landed as doperpowers PR #406 (`5463fe8c`, sminos 1.23.0), 2026-10-27.
- [x] M7b — RL10's three joint frames and the conformance replay (O10 M6's findings, ruled 2026-10-27). Built against O10 M6 at MAWS `a7ceac66c`; reviewed by doperpowers:reviewer-high over two rounds (round 1: three P2s, each reproduced and fixed; round 2 clean), landed as doperpowers PR #410 (`20790342`, sminos 1.26.0), 2026-10-27. O10 corrected its fixture to sminos's real frames (MAWS #238, `6d57a6160`, P5 Decision Log 68), and the follow-up refreshed the copy, dropped the amendments and made `amend` fail: every line plays as written, 99 ok (doperpowers PR #413, `96085c8d`, sminos 1.26.2, reviewer-medium clean).
- [x] M7c — What O14's B2 reads from sminos (O14's "what others must provide", P5 Decision Log 75's residue 17): `bench_scale.py`'s RL10 mode, `sminos daemon owed`, and the un-cutover branch's test. Reviewed by doperpowers:reviewer-high over three rounds (round 1: one P1 and two P2 false zeros in `daemon owed`; round 2: two P1 and two P2, the opening `have`, a conflict across a reconnect, the enrollment's inspection and a failed write stopping a resend; each reproduced and fixed with a regression test; round 3: one bounded P2, a conflict lost to a failed write and a restart, logged as T3 debt), landed as doperpowers PR #419 (`e5403891`, sminos 1.27.0), 2026-10-27. B2 step 2's bench passes on the MacBook: uplink 3.3 % of a core, words pass p95 0.051–0.061 s, longest gap 10.1–10.3 s.
- [ ] M9 — The mini (item 8). After M5–M8 and M7c, and after O14's brief cuts the mini over.

M7a consumes nothing and lands first. M6 and M8 consume only M5 and may run on parallel branches cut from `main` once M5 lands; M7 is cut from `main` after M6 lands. Each re-bumps the sminos version above the one before it (phase 1's rule). The phase closes with a doperpowers:review-code high pass over its range, as phase 1 did.

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
   - `daemon run`'s probe connects to the socket, sends `hello` with the file's token and is welcomed with a complete identity, and then one RL10 uplink child runs; no process of sminos opens a TCP connection (the stand-in's hub port sees none, and the DX2 stream count stays 0); `sminos daemon status` prints `uplink: RL10 (local-only)`.
   - `daemon/identity.json` exists after the welcome, mode 0600, and `sminos hub show` prints the identity from it; `sminos hub enroll` and `sminos hub leave` exit 1 saying the enrollment is the endpoint's.
   - With `rl10.json` removed and `hub.json` still holding a DX7 credential, the child exits, no DX2 uplink starts, and `daemon status` says `cut over; the endpoint is not running`.
   - Without `rl10.json` on a machine never welcomed, behaviour is unchanged: the DX2 uplink runs against `hub_standin.py`, as the suites show.
   - `codes_parity.py`, `test-uplink.sh`, `test-hub.sh`, `test_session_plane.py`, `test_rpcs.py` and the bridge suites pass in both modes (the RL10 sections added, the DX2 ones unchanged).
   - The conformance replay (`rl10_conformance.py` over `rl10-conversation.json`, O10's `conversation.json` copied with its MAWS sha) passes every line of sminos's side.
5. **Words** (item 2). On a cut-over machine, with the stand-in scripted to answer `words?`:
   - a `human` event the stand-in answers `words` is submitted through the session's bridge as the human's words (the bridge's `deliver`), once per event;
   - one it answers `peer` arrives as an inbox frame, and one it answers `refuse` is settled `refused-words` with a `delivery` outcome up the session lane and no frame;
   - one it does not answer stays owed, is counted as a failed attempt, and is asked again at the next pass; `revoked` naming its signer (by device, member or key id) settles it `refused-revoked` at once, with no further `words?`;
   - a `legacy` signer's `human` event is never asked and arrives as a peer message labelled `unverified (legacy)`;
   - `daemon run`'s tick, `sminos say`'s fast path and both `send` paths (to a seat, and to a seatless session) push no log-backed `human` event on a cut-over machine, whatever its writer: an operator `send` records it, says `recorded; the endpoint decides its delivery`, and the uplink child delivers it after `words?` together with the writer's earlier owed events, in order; with the endpoint absent it stays owed and `sminos chat` shows it undelivered; with the endpoint refusing it settles `refused-words`. A `push_live` reached with a log-backed `human` event and no verdict on a cut-over machine raises, never decides by `owner_event`;
   - a revocation of a device whose `hub/<member>` writer also holds an earlier event from the member's other device settles the revoked event at once and leaves the earlier one owed and deliverable, whether it was unattempted or pending with a failed attempt; the settled prefix never moves past an owed event;
   - every delivery on a cut-over machine, a peer `say` included, checks the stored signer against the persisted revocation set (`daemon/revoked.json`, written whole from each `welcome` and merged from each `revoked`): an event signed by a revoked key, device or member is never delivered afterwards, across a disconnect and a daemon restart; a `legacy` signer is a peer;
   - in a project the endpoint does not relay (git-mirrored, or local): an own-writer `human` event is still asked (`words?`) and delivered on the verdict by the uplink child; a `human` event that arrived through a git mirror from another machine is never asked and is delivered as an unverified peer message by `daemon run`'s tick; nothing of either project is opened on RL10;
   - an own-writer `human` event is asked only when `projects/<id>/receipts/<writer>.jsonl` holds its `{seq, hash}` (written by the append that stored it, under the writer file's lock): a `<thisname>/human` event forged into a scratch git mirror and merged in by `integrate` has no receipt, is never asked, is delivered as an unverified peer message with a daemon.log line, and `sminos chat` shows it as `(unverified)`; an own-writer `human` event appended before phase 2 and still owed at cutover has no receipt either and goes as a peer;
   - on a machine not cut over, `human` events are delivered as today (`owner_event`).
6. **The label** (item 3). A `say` arriving with `owners: [<member>]` is pushed as `[sminos chat <project> <ref> from <alias>, owned by <member> → @you]` and prints so in `sminos chat`; one arriving with `owners: []` reads `from <alias> (owners unverified)`; a `legacy` one reads `(unverified, legacy)`. An event whose stored signer is in the revocation set, however old, prints `from <alias> (signed by a revoked key)` in `sminos chat` and never `owned by`. The owners are read from the stored line's `verified` key alone; an arriving event that carries a `verified` key of its own is refused `bad-shape` and reported `rejected`.
7. **The ledger over RL10, the fence and the proof** (item 4's rest; Decision Log 45).
   - An `rpc` down RL10 runs once, and its `rpc-result {project, opId, nonce, outcome}` goes up until `rpc-ack {opId, nonce}`; a reseal under a new `nonce` while the op is in flight, or claimed and awaiting reconciliation after a restart, is answered once, under the latest nonce, and never runs twice (ticket 11a).
   - The ledger entry holds `member`, `device`, `fingerprint` and `target`; a known `opId` with another member or fingerprint is refused `op-conflict`; `queried` and `tombstoned` carry the stored binding. The binding and the latest nonce are held from dispatch on, in the in-flight record under `op_lock`, so a reseal or a conflicting copy arriving while the worker is still inside `plan` (before its claim) is answered right: the identical reseal updates the nonce the outcome goes up under, the conflicting one is `op-conflict`, and the op runs once either way.
   - `target` is derived from the validated RPC, never read from the frame: `{kind: 'machine'}` for `spawn`, `{kind: 'session', session: args.session}` otherwise; the stand-in and the conformance replay pin it. The frame is DX2's, `{t: 'rpc', rpc: {…}}` with `args.session` and `args.digest` where DX6 has them and `machine` the welcome's name, so `on_rpc`, `shape` and the `wrong-machine` check run unchanged.
   - A remote RPC on a bridged session carries `context {lane: 'A', session, launch}`: the bridge's child refuses it `launch` when its launch differs, immediately before the mod acts, and the RPC fails `launch`; the same for a decision. A remote RPC without `context`, or whose `context.session` is not `args.session`, is `bad-shape`. A remote `steer` on a session without a bridge is refused `context` (never the supervisor or the inbox); a remote `resume`, `retire` or `stop` is refused `unsupported`.
   - A desk spawn's `proof` is in the new session's record as `ownersProof: [<proof>]`, and `list --json` shows it.
   - An observer's refusal reconciled after a daemon restart reads `lane-b`, not `failed` (ticket 11b).
   - MW5's upload id is the `opId` (M2); the conformance replay pins it end to end.
8. **To-human off the hub** (item 6). On a cut-over machine, for a hub project:
   - a `<message>` and an async ask exported by the bridge or the Stop hook land in `projects/<id>/host/<machine>.<session>.jsonl`, and in no `log/` file; the uplink's `hello` vector and every `events` frame up name no host event;
   - `sminos chat --host` prints them beside the project's older host events from the log;
   - each appended host event goes up RL10 as a session-lane `host` message with no subscription (`sub: null`), carrying its stable id `{writer, seq}`, whether or not anyone subscribes: with zero subscribers it still goes; with a cards-only subscriber it goes once and the subscriber's view carries nothing of it; with two full subscribers it goes once sub-less and once in each subscriber's own stream; after a reconnect the session's last 50 go again and the endpoint deduplicates by the id;
   - a fresh full subscription's snapshot carries the session's last 50;
   - on a machine not cut over, and in a git-mirrored project, host events go where they go today.
9. **The mini** (item 8). After O14's brief cuts the mini over: the mini's `sminos daemon status` says `uplink: RL10 (local-only)` with a sminos at or above 1.27.0 (M7c's version: the frames O10's fixture plays came at 1.26.0, and `sminos daemon owed`, which the cutover's own gate runs, at 1.27.0) and `sminos daemon owed` exiting 0 after it; its unattended seats (the journal, Telegram) show no `retired` or `gone` across the install; from the MacBook, `sminos list --org` shows the mini's sessions with their owners, and a `sminos say` to one of them arrives there labelled. Evidence goes to Outcomes; no step of this document runs `claude` on the mini.

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

### M7a — Ticket 11's two debt fixes

**What exists at its end.** Two ledger paths answer right, on DX2 and RL10 alike, with no RL10 code involved:
- a reseal of an op without an outcome, whether in flight or claimed and awaiting reconciliation after a daemon restart, is answered under its latest nonce once the outcome exists, and never runs twice (ticket 11a);
- an observer's refusal reconciled after a daemon restart keeps its `lane-b` code (ticket 11b).

**What it touches.** `sminos_rpc.py`: `dispatch` (the reseal's nonce), `Ledger.acked` (a claim's nonce), `results`, `refused_op`, `steered`, `command` (one observer-refusal reader), `trace`/`KEPT_READERS`. Tests in `test_rpcs.py`.

**Interfaces.** Exposes the nonce-on-claim rule M7's in-flight record builds on.

**Decisions.**
- **The reseal's nonce** (ticket 11a). `dispatch` today re-arms only an entry with an outcome (sminos_rpc.py:600–606); a reseal of an op in flight, or claimed and awaiting reconciliation, keeps the original nonce, and its outcome goes up under a nonce the hub no longer waits for. Now every known entry, and every op in flight, takes the copy's nonce (`Ledger.acked(op, False, nonce)` writes a claim's nonce too, and `flight` carries the current nonce until the claim exists, M7's in-flight record), so `results()` sends the outcome under the latest; the claim's conditional write and `flight` still keep it from running twice. On RL10 results are keyed by `opId` as well, so the fix matters to DX2 machines and to the ack's `nonce` alike. Rejected: running the resealed copy when the first is only claimed, which is the one thing the ledger exists to prevent.
- **One observer-refusal reader** (ticket 11b). `refused_op` and `steered` map an answer `{ok: false, code: 'lane-b'}` to `failed('lane-b', …)` as `command()` does when it sees the answer live, so a kept answer read back by `trace` (`KEPT_READERS`, sminos_rpc.py:2040–2054), `rearm` or `reconcile` yields `lane-b`, not `failed` with `lane-b:` as its message's first word. `media_held`, `agent_stopped`, `told`, `commanded` and `started` share the reader. Rejected: a second mapping in `trace` alone, which would leave `rearm`'s path reading the old code.

**Not touched.** Everything else of the ledger (M7). RL10.

**Proves.** Acceptance 7's ticket 11 bullets. Tests also pin:
- a reseal during flight: one run, one outcome, sent under the reseal's nonce; a reseal of a claim awaiting reconciliation after a restart: reconciled once, answered under the reseal's nonce;
- a kept `{ok: false, code: 'lane-b'}` answer reconciled after a restart reads `lane-b` for `steer`, `command`, `btw`, `stop-agent`, `tell` and `media`.

### M5 — The RL10 client and the local-only switch

**What exists at its end.** On a machine whose `mawsd` endpoint has written `rl10.json`, sminos's uplink child speaks RL10 to the endpoint instead of DX2 to the hub: the same frame handlers (`Link`), over a 0600 Unix socket, with no HMAC coding, taking the machine's identity, policy and org directory from the endpoint in place of `hub.json` and the hub. On a machine without it, nothing changes. In detail:
- `sminos_rl10.py` finds `rl10.json` at O2's literal paths (Interfaces §D'), connects, sends `hello` with the file's token, and runs the stream: newline-delimited frames of at most 1 MiB, DX2's `part`s for larger text, one ordered lane in place of DX2's two.
- The first `welcome` whose identity is complete (`org`, `hub`, `name`, `ref` and `enrolled`) cuts the machine over: `daemon/identity.json` is written from it; every reader of the machine's identity (`enrollment`, `machine_identity`, `enrolled_at`, `hub show`) prefers it; the supervisor never starts a DX2 uplink again.
- The log plane runs uncoded. This machine's events go up as stored, with no `mac`. An arriving event comes as `{event, signer, owners?}` and is stored verbatim with one key added, `verified: {signer, owners}`; the DX1 nonce index and `seen-nonce` leave with the codes (the endpoint's inbound index replaces them, O10 M6).
- The session lane, the requests' `raised` and `settled` and delivery's outcomes go up uncoded; `subscribe`, `unsubscribe`, `rows`, `diff`, `output` and `read` come down and are answered as today.
- `policy` frames write `daemon/policy.json`; `sminos daemon policy` sends `policy-set` up, and the endpoint's `policy` answers it.
- The `org` frame fills `daemon/org.json` as today.
- `legacy-key?` is answered from `hub.json`'s key, never logged, as often as an authenticated endpoint of this org asks while sminos still holds the key: one logical handover, retryable.
- Each `welcome` carries the endpoint's complete current revocation set, and each `revoked` frame a change; sminos keeps it whole in `daemon/revoked.json` (M6 applies it to every delivery and to `chat`).
- `rpc` frames arrive as DX2's `{t: 'rpc', rpc: {…}}` with `machine` the welcome's name, so `on_rpc`, `shape` and the `wrong-machine` check run unchanged; `receive` skips only the code check, keeps the RL10 fields on the entry (`member`, `device`, `fingerprint`, `context`, `proof`, which M7 uses) and derives `target`; `rpc-result {project, opId, nonce, outcome}` goes up until `rpc-ack {opId, nonce}`; `query` and `tombstone` reach M2's `Rpcs.query` and `Rpcs.tombstone` and answer `queried` and `tombstoned`.
- Both modes pass the existing suites. `sminos daemon status` says which runs.

**What it touches.**
- `sminos/skills/sminos/scripts/sminos_rl10.py` (new): discovery, the socket reader and writer, the hello, `identity.json`.
- `sminos_uplink.py`: `Link.__init__` takes a transport and `coded`; `Sender` gains a socket counterpart (`SocketLane`); `cmd_uplink` chooses the mode; `Here` is unchanged.
- `sminos_daemon.py`: `UplinkSupervisor.run` (the switch), `cmd_status`, `enrolled_at`.
- `sminos_hublog.py`: `seal`, `refusal`, `take`, `same_event`, `nonce_index`, `vector` (M8 excludes the host store), `presence`.
- `sminos_requests.py` (`Requests.seal`), `sminos_outcomes.py` (`message`): a draft goes as it is when there is no key.
- `sminos_rpc.py`: `Rpcs.__init__` (a `coded` flag), `receive` (the code check skipped; `target` derived), `refuse_loose` (the `opId` kept), `results`, `ack` (`opId` beside the nonce), and `entry_of` (the RL10 fields kept).
- `sminos_policy.py`: `write` from a `policy` frame; `cmd_policy` in RL10 mode.
- `sminos_hub.py`: `enroll`, `leave` and `show` on a cut-over machine; `sessions_under` reused by the welcome's rename rule.
- `sminos_rl10.py` also writes `daemon/revoked.json` from each welcome and `revoked` frame (M6 applies it).
- `sminos.py`: `enrollment`, `machine_identity`, `org_directory` (unchanged readers of `org.json`).
- Tests: `sminos/tests/endpoint_standin.py` (new), `test-uplink.sh` (an RL10 section), `test-hub.sh`, `test_rpcs.py`, and `rl10_conformance.py` with `rl10-conversation.json` (new, once O10 M6 lands).

**Interfaces.** Consumes O10's §D as aligned. Exposes to M6–M8 (Interfaces §D'): the RL10 transport (`Link` in RL10 mode, `send(frame)` and the handler table), the stored `verified` key, `identity.json` and `cutover()`, `revoked.json` and `revoked()`.

**Decisions.**
- **One child, two modes.** The RL10 client is `sminos daemon uplink` with another transport, chosen at the child's start, not a second process. `Link` keeps its handler table (`on_have`, `on_events`, `on_rpc`, …), `Here`, the plane, the requests and the RPCs, and takes a `Transport` that reads frames and writes them: DX2's `Stream` plus two `Sender`s, or RL10's socket. Rejected: a `daemon endpoint` child beside the uplink, which would put two processes on one machine's deliveries and RPCs, and split the words path (M6) from the log plane that carries the events it decides.
- **Discovery.** `rl10.json` is read at `$MAWS_USER_DATA/mawsd/endpoint/rl10.json` when `MAWS_USER_DATA` is set (tests, and O10 M11's scratch machine), else at O2's platform default (`~/Library/Application Support/MAWS/mawsd/endpoint/rl10.json` on macOS, `${XDG_CONFIG_HOME:-$HOME/.config}/MAWS/mawsd/endpoint/rl10.json` on Linux). The file must be a regular file of mode 0600 owned by this uid, with `protocol` 1, a `token` of 64 hex characters and a `socket` path; anything else is "no endpoint", said once in daemon.log. The socket is dialled with a 5 s timeout, `hello` is the first line, and a `refuse` or no `welcome` within 10 s closes it; the child backs off from 1 s to 60 s as DX2's does. `SMINOS_RL10=<path>` overrides the file's location for a test. Rejected: reading the socket's path from `mawsd`'s command line or state, which couples sminos to MAWS's layout beyond the one file O2 wrote for it.
- **Cutover is once and for good** (RL §9: "each machine cuts over once"). The first `welcome` whose identity is complete (`org`, `hub`, `name`, `ref` and `enrolled`; any other welcome, or a `refuse`, leaves the machine on DX2, with `daemon run`'s probe beside it and `daemon status` saying an endpoint is present but not enrolled; the Decision Log's guard, the second check behind O10 serving RL10 only once enrolled, its M6, since from O10's M10 a MAWS built from master runs an endpoint on the owner's machines long before O14 enrolls them) writes `daemon/identity.json` (`{org, hub, name, former, ref, enrolled, cutover: <ISO>, build}`, mode 0600, atomically), and from then on the supervisor starts the child in RL10 mode only: with `rl10.json` present it connects; without it, it waits, logging once an hour that the endpoint is not running, and `daemon status` says so. `hub.json` is never read for a credential again, even if the endpoint is gone for a day. Rejected: following the socket's presence, falling back to DX2 while `mawsd` is down. The hub keeps one generation counter per machine name across DX2 and RL1 (O10's Orientation, O11), so a DX2 stream from sminos would take the machine's generation and cut the endpoint's RL1 socket (4409) each time `mawsd` restarted, and the machine would run two uplinks under one name, which RL §2.1 forbids. The owner undoes a cutover in O14's order: `mawsd endpoint unenroll` first (it removes `rl10.json` and the socket), then `identity.json`, which `hub show` names; removed the other way round, while the endpoint still serves RL10, the supervisor's probe re-cuts the machine over within a second (O14's observation, pinned by M7c). With both gone the machine is back on DX2, local-only until a v1 hub path exists (DX2's re-enrollment with a v1 code). No verb is added, and the steps are O14's brief's.
- **Identity.** `enrollment()`, `machine_identity()` and `enrolled_at()` read `identity.json` first and `hub.json` only when there is none. `name`, `org`, `hub`, `enrolled` and `ref` come from the welcome. `former` is this machine's own: `hub.json`'s `former` is `{name: [session ids held under it]}`, which `is_self` needs to attribute a session to a former name (sminos.py:6634–6654), and the endpoint never knew which sessions a name held, so its `identity.former` can only be names. `identity.json`'s `former` is copied from `hub.json` at the first welcome and kept. A welcome whose `name` differs from the local name is a rename the endpoint made (`mawsd enroll --replace`): before the identity is replaced, the sessions held under the old name are captured by the enrollment's own rule (`sminos_hub.sessions_under(old)`: every writer file `<old>.<session>.jsonl` in a project log here, and every seat whose `host` is `old`; sminos_hub.py:293–308, 373–378) and merged into `former[old]`, and the new identity is written in one atomic replace, so `is_self(old, sid)` keeps holding for them. A name the welcome lists in `former` that `identity.json` does not hold is added with the sessions `sessions_under` finds for it now, which may be none. On every later welcome, `org`, `hub`, `ref`, `enrolled`, `build` and the welcome's name list are refreshed from it; `cutover` is kept as first written; `former`'s sessions only grow. The machine's own project id (`machine_project_id`) is unchanged: it is a function of the org and the name. `sminos hub show` prints the identity, marked `cut over` with the date; `hub enroll` and `hub leave` on a cut-over machine exit 1 with "this machine's enrollment is its endpoint's: `mawsd endpoint …`". Rejected: asking O10 to carry the sessions map, which it cannot know, and deleting `hub.json` at cutover, which would strip the legacy key before the endpoint has asked for it; its removal is O14's final brief's, with the key's.
- **One lane, written is taken.** DX2's two senders exist for HTTP's concurrency and its per-POST answer; a socket is one ordered byte stream. `SocketLane.send(frames, then)` writes the frames and runs `then({})` once they are written, so every continuation that today waits for a POST's 200 (a settlement leaving its outbox, a compaction or `op` message leaving `rpcs-owed.json`, rejections recorded as reported, the tombstone mark) runs on write. On every `welcome` the complete request set, every unacknowledged `rpc-result` and each project's `hello` go again, as after a DX2 reconnect, and a frame the endpoint refuses comes back as DX2's `refused`, handled as today. Rejected: asking O10 for a per-frame acknowledgement on RL10, which §D does not have. What a lost frame costs is bounded: the session lane stops at the endpoint (O10 M6), which re-snapshots a subscriber after its own restart and rebuilds pending counts from the complete set, so nothing of the session lane is durable past the endpoint anyway. It is recorded as an open question for O10 in case a loss shows in M11.
- **The uncoded log plane.** `HubLog` takes `coded` (True on DX2). Uncoded: `seal` returns the event as stored; `refusal` keeps the shape checks and skips the code; `take` unwraps each `{event, signer, owners?}`, refuses a wrapper whose `event` carries a `verified` key of its own (`bad-shape`: the key is the endpoint's to say, and a device could otherwise sign one in), and appends the event with `verified: {signer, owners}` added, `owners` as the endpoint sent it (`[]` when the attestation failed); `nonce_index` is not built. Events go up as stored, and sminos adds no `created`: `_append` writes `ts` (`now(ms=True)`, ISO 8601 UTC with milliseconds; sminos.py:1857, 277–283), and the endpoint derives the signed `created` from it in a deterministic upload form (verbatim when `ts` has milliseconds, `.000` added to an older whole-second one, never the upload time; an event already carrying a different `created` refused `malformed`), which its signing, ledger hash, resends, `words?` answer and echo check all use (O10 M6, the joint review's second round). `same_event` compares canonical forms with `verified` stripped from the held copy, and with `created`, `mac`, `sig` and `attest` stripped from an arriving copy of an event this machine wrote (the endpoint adds those at upload, as `mac` is added today). A returned own event keeps today's handling (`take` → `append_verbatim`, sminos_hublog.py:527–560, 161–196): the endpoint lets one through only as an exact echo of what it signed at that `(project, writer, seq)`, which reads `present` here; a different body there is `conflict`, reported `rejected`; sminos adds no own-writer rule of its own. `words?` sends the stored line without `verified`. Rejected: a sidecar file of verdicts keyed by (writer, seq), which every delivery and every `chat` would join on; one key on the line, stripped where the exact event matters, is one rule.
- **The RPC frame on RL10 is DX2's.** O10's §D, as aligned at this document's drafting (`p5-o10-doc-3`, `c4911a6d4`), nests DX6's Rpc under `rpc` (`{t: 'rpc', rpc: {rpc, project, machine, member, device, created, nonce, opId, opCreated, args, context?, fingerprint, proof?}}`), with `machine` the name this connection's welcome gave, `args.session` the target and `args.digest` a decision's digest, as DX6 has them. So `on_rpc`, `receive`'s `wrong-machine` check (sminos_rpc.py:575–576) and `shape`'s digest check (1424–1427) run unchanged; nothing is copied between a top-level field and `args`. `receive` skips the code check alone (`coded` False) and keeps `member`, `device`, `fingerprint`, `context` and `proof` on the entry for M7. A loose refusal keeps the frame's `opId` beside its nonce, so `rpc-result` carries `{project, opId, nonce, outcome}` for a loose refusal as for a kept one; `rpc-ack {opId, nonce}` settles it by the nonce as today (`Rpcs.ack`, 686–693), and by `opId` when the nonce is one the ledger no longer holds. `query {opId, opCreated}` and `tombstone {opId, opCreated?}` parse `opCreated` as `created` is parsed and call M2's methods; their answers carry M7's binding fields once M7 lands, and until then the state alone. One conversion is sminos's, pinned by the stand-in and the replay: `target`, which the frame does not carry and O10 M7 authorizes queries against, is derived from the validated RPC, never read from the frame: `{kind: 'machine'}` for `spawn`, `{kind: 'session', session: args.session}` for every other name, kept on the entry (M7's binding) and answered in `queried` and `tombstoned`. Rejected: a top-level `requestDigest` mapped into `args.digest`, which this document's first draft asked for and the alignment made unnecessary.
- **Policy.** The endpoint's policy is authoritative. A `policy {read_only, ceiling}` frame writes `daemon/policy.json` (the mirror `deliver_next` and `admit` read); `sminos daemon policy` writes the file as today and nudges the daemon, and the uplink, seeing the file differ from the last `policy` it received, sends `policy-set` with the fields that differ and waits for the endpoint's `policy`, which writes the file again. `hello.policy` carries the file as it is, which the endpoint takes only when it holds none (§D), so the first cutover inherits the machine's policy. Rejected: two policies, the endpoint's for remote actions and sminos's for delivery, which would let read-only mean two things on one machine.
- **The welcome's `capabilities` and DX2's `kinds`.** DX2's welcome lists the session kinds the hub relays (`kinds`, sminos_uplink.py:1333–1337), and `read` and `op` messages go only to a hub that lists them. §D's welcome has `capabilities` and no `kinds`. On RL10 every kind sminos has is sent: the endpoint is on this machine and relays the lane whole (O10 M8 treats it as opaque). A capability string naming a kind, if O10 defines one, is honoured the same way; none is required (open question).
- **The legacy-key handover is one logical handover, retryable.** "Once" (O10 M6: "the DX1 key is handed over once") is one logical move, not one answer: while `hub.json` still holds the key, sminos answers every `legacy-key?` from an endpoint that welcomed it for the same org, idempotently, so an endpoint that died between asking and persisting `legacy.json` asks again after its restart and gets the same key. The key goes in no log line and no other frame. This is why `hub.json` stays until O14's final brief. Rejected: a one-shot flag in `identity.json` (`legacy_handed`), under which an endpoint crash before persistence would leave both sides without the key and every machine not yet moved unable to read this one's events (RL §9).
- **The revocation set is persisted whole.** O10's `welcome` carries the endpoint's complete current `revoked {version, devices, members, keys}` and each `revoked` frame a change (O10's amendment from this document's review). sminos writes `daemon/revoked.json` (0600, atomically) from each welcome whole and merges each frame by `version`, keeping the higher; a frame or welcome with a lower version than the file is ignored and said once. Every deliverer on the machine (the uplink child, `daemon run`'s tick, the CLI's fast path) and `chat` read the file, so revocation needs no socket to apply (M6). Rejected: keeping the set only in the uplink child's memory, which a daemon restart would empty until the next welcome, a window RL §5.2 does not allow ("every delivery checks its signer against the current state").
- **The conformance replay.** `rl10_conformance.py` loads `rl10-conversation.json`, O10's `test/endpoint/rl10/conversation.json` copied verbatim with the MAWS commit it came from in its header, as `codes_parity.py` carries DX1's vectors. It stands in for the endpoint on a socket in a temporary `SMINOS_HOME`, sends each endpoint→sminos line, and checks each sminos→endpoint line against the fixture, masking the fields the fixture marks nondeterministic (times, nonces, ids). It runs in `run-sminos-tests.sh`'s `suites` part. Until O10 M6 lands, `endpoint_standin.py`, sminos's own stand-in written to §D, carries every RL10 test; the replay is added in the same milestone's PR if M6 has landed by then, else as a follow-up commit to M5 that changes no code. One case of the replay is pinned here beyond the fixture's lines: a real sminos-produced event (appended by `_append`, so carrying `ts` and no `created`, with its receipt written) goes up as stored, is resent byte-identical after a `resend`, comes back as the endpoint's echo (`created`, `sig`, `attest` added) and reads `present`, and is asked as `words?` with the stored line and answered `words`; the same with an older whole-second `ts`. A line the replay fails is either a sminos bug or an O10 amendment, and the PR says which.

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
- `legacy-key?` answered with `hub.json`'s key, never written to daemon.log; the stand-in killed between its ask and its persisting of `legacy.json`, reconnected, welcomed and asking again gets the same key; an ask from an endpoint welcomed for another org is refused;
- a welcome whose `name` differs from the local one, with two seats and a writer file under the old name: `identity.json` holds `former[old]` with those sessions, `is_self(old, sid)` holds for each, `sminos list` shows them local, and the machine project id follows the new name; a later welcome refreshes `ref`, `enrolled` and `build` and leaves `cutover` and `former`'s sessions as they were;
- `daemon/revoked.json` written whole from a welcome, merged from a `revoked` frame by version, and a lower version ignored;
- an `rpc` nested under `rpc` with the welcome's `machine` runs through `on_rpc` and `receive` unchanged, and one naming another machine is `wrong-machine`; `target` is `{kind: 'machine'}` on a spawn's entry and the session on every other; a loose refusal's `rpc-result` carries its `opId`; `rpc-result` re-sent on the next welcome until `rpc-ack {opId, nonce}`, and settled by `opId` when the nonce is unknown; a returned own event that echoes the stored one, `created` and `sig` added by the endpoint, is `present`, one with another body `conflict` and `rejected`; an own event uploaded with no `created` of its own, and a stored `ts` of whole seconds (an older event) uploaded as it is;
- `query` and `tombstone` passed through to M2's methods, with the DX2 suites unchanged.

### M6 — Members, words and the label

**What exists at its end.** On a cut-over machine the endpoint knows every session sminos holds, and a person's words reach a session only on the endpoint's verdict:
- `member` frames go up at the welcome for every session on this machine, in every project sminos knows here (relayed or not: the endpoint needs every record to decide words, and lists only the relayed projects' sessions), and on each change of the fields they carry, with `{session, gone: true}` when a member leaves.
- Before any `human` event from outside the machine, or from this machine's own operator writer, is delivered, the uplink child sends `words? {id, session, event}` with the event exactly as stored and acts on the answer: `words` submits it through the bridge (or a `--bg` job's supervisor) as the human's words; `peer` delivers it as an inbox frame; `refuse` settles it `refused-words` and reports the outcome up; no answer keeps it owed and counts an attempt. `revoked` marks every owed event of a named device, member or key `refused-revoked` at once, and nothing a revoked key signed is delivered afterwards.
- An operator `send` (recorded as a `human` event) is under the same rule: on a cut-over machine neither `send` path pushes it, the uplink child delivers it after `words?` with the writer's earlier owed events ahead of it, and `push_live` refuses to decide a log-backed `human` event by `owner_event` there.
- Every own-writer `human` event sminos appends gets a machine-private append receipt, `projects/<id>/receipts/<writer>.jsonl`, one line `{seq, hash}`; the words gate asks `words?` for an own-writer event only when its receipt matches. One with no matching receipt (a git mirror's import under this machine's name, or anything not appended here) is delivered as an unverified peer message, never asked, and logged. The writer name is not provenance.
- Every delivery on a cut-over machine, a peer `say` included, checks the stored signer (by key id, device and member) against the persisted revocation set; nothing a revoked key signed is delivered afterwards, and a revoked event is marked in the delivery record so retries stop at once while the settled prefix moves only in order. `chat` renders a revoked signer's events as `(signed by a revoked key)`, never `owned by`.
- In a project the endpoint does not relay (git-mirrored, or local), an own-writer `human` event whose receipt matches is still asked and delivered on the verdict, and a `human` event that arrived through a git mirror, under another machine's name or this one's, is an unverified peer message, never asked.
- A `legacy` signer's `human` event is never asked and arrives as a peer message marked unverified.
- A peer message carries the sender's verified owners: `from <alias>, owned by <owner>`; `(owners unverified)` when the endpoint sent `owners: []`; `(unverified, legacy)` for a legacy signer.
- A machine not cut over delivers as today.

**What it touches.**
- `sminos_uplink.py`: `Link.members(now)` (the member set and its diff, in `tick`); `on_words`, `on_revoked`; the words pass (`deliver_words`) in `tick` and `deliver_imports`, over every project known here.
- `sminos_daemon.py`: `deliver_owed` leaves words-gated writers alone on a cut-over machine and applies the revocation set to the rest.
- `sminos.py`: `deliver_next` and `push_event` take a verdict; `deliver_say`'s fast path, `send_to_member`, the seat send (`cmd_send`'s push at sminos.py:8366–8369) and `SendDelivery` on a cut-over machine; the delivery record (`delivered_load`, `_owed`, `_next_check`, `delivered_settle`, a new `delivered_revoke`); `compose_chat_frame` and `chat_line` (the label, the revoked rendering).
- `sminos_control.py`: `push_live` takes `words` instead of deciding by `owner_event`, and refuses to decide a log-backed `human` event without one on a cut-over machine.
- `sminos_outcomes.py`: `REFUSED_WORDS`, `REFUSED_REVOKED` outcomes and their reasons.
- `sminos_plane.py`: `Plane.refresh` exposes the member rows M6's frames are built from.
- `sminos_rl10.py`: `revoked()` reads `daemon/revoked.json` (M5 writes it).
- `sminos.py`: `_append` writes the receipt for an own-writer `human` event in the same append, under the writer file's lock; `receipt_of(project, writer, seq) -> hash | None` (new) reads it; `sminos_daemon.integrate` and `check_claim` are unchanged.
- Tests: `sminos/tests/test_words.py` (new, against `endpoint_standin.py` in-process), `test-uplink.sh` (member frames), `test-bridge-control.sh` (the bridge's `deliver` once per event, as today), `run-sminos-tests.sh` core (`send` on a cut-over machine, the revoked rendering in `chat`), `test-sync.sh` (the forged mirror case).

**Interfaces.** Consumes M5's transport and `verified`. Exposes `member` frames (§D) and the delivery verdict (Interfaces §E) to M7 (`launch`) and M8.

**Decisions.**
- **Members are this machine's sessions, in every project known here.** A `member` frame is sent for each `m.local and m.session` member of each project `known_projects()` returns (the plane's `members`, refreshed for every project, not only those open on RL10), never for another machine's sessions sminos knows from logs. The endpoint needs every record on this machine to answer `words?` for a session in a project it does not relay (its rule for unrelayed projects), and lists only the sessions of the projects it relays (O10 M6, as aligned). The frame's fields come from the record (`session_record`: `owners`, `ownersProof`, `origin`, `principal`, `inference`, `controller`), the member row (`alias`, `project`, `state`, `title`, `cwd`, `worktree`) and the bridge's status (`launch`, M7; absent until then). `lane` is `B` when `controller.lane` is `B`, or when the controller is unset and `origin.kind` is `maws` (a session the engine host launched, M3's verdict pending); else `A`. `session` is the engine's session id, and the frame carries no other id: the endpoint joins MAWS's `appSessionId` to it through `engine.sessions` (O10 M6). `access` and `shares` are absent until O8. A record missing (a session joined before its hook ran) sends the frame with `owners: ["@machine"]`, `origin: {kind: 'terminal'}` and no `principal` or `inference`, and sends it again once the record exists. The set is diffed against the last sent per session, like `machine_sent`, and sent whole after each welcome. `principal` and `inference` cross RL10 because the endpoint is this machine (RL6's record is machine-held), and O10's listing projection leaves them off (its M3); they still never ride a log event or `--org` output.
- **Words are decided only by the RL10 holder.** `words?` is answered on the socket the uplink child holds, and the child's main thread cannot wait for an answer inside a frame handler. So on a cut-over machine delivery of words-gated `human` events is the uplink child's, in two passes: in `tick`, for each project known here (`known_projects()`, not only the hub projects open on RL10) and each local member, the first owed event of each words-gated `human` writer not yet asked is sent as `words? {id, session, event}` and marked asked with a 10 s deadline. Words-gated writers are: `hub/<member>`; another machine's `<name>/human` that arrived with a `verified` key (over the hub); and this machine's own `<name>/human`, in every project, whether or not the endpoint relays it, for the events whose append receipt matches (below). A `<name>/human` of another machine with no `verified` key (it came through a git mirror) is not gated: it is never words, never asked, and `daemon run`'s tick delivers it as an unverified peer message (P2-6's rule); an own-writer event with no matching receipt is treated the same, by the same tick; on `words {id, verdict}` the event is delivered by `deliver_verdict(project, member, event, verdict)`, which takes the delivery lock, confirms the event is still the writer's first owed, pushes it by the verdict and settles it, recording the outcome for the uplink as `deliver_next` does. A deadline passed is a failed attempt (`delivered_fail`, counted toward `DELIVERY_ATTEMPTS`) and the event is asked again on the next pass. The daemon's tick (`deliver_owed`) and `sminos say`'s fast path (`deliver_say`) leave such writers owed on a cut-over machine and nudge the daemon, whose nudge wakes the uplink's tick; peer writers (`<name>/<session>`, `say` events) are delivered by them as today, so no writer's order is split, since each writer carries one kind. Rejected: a second RL10 connection for `daemon run` and the CLI, which §D does not define (a second `hello` would send the member set twice and the endpoint would hold two log planes), and routing the question through `daemon run` by a local pipe, which adds a channel for one question.
- **The operator path asks after the tick's upload pass, and never waits for the hub.** A `<name>/human` event of this machine (the owner's terminal `sminos say` or `send`) carries no signature locally; the endpoint signs it when the `events` frame carrying it arrives on RL10, before it reads the next frame, and keeps the signature (O10 M6, as aligned). In `tick` the upload pass runs before the words pass, so an own event that could go up has gone up on the same socket before its `words?`, and the endpoint answers from its signature ledger (the same body hash at that position) and the record. When it could not go up, because the project is not relayed, RL1 is down or its `hello` has no `have` yet (`uploads` yields nothing before `have`, sminos_hublog.py:462–463), sminos asks anyway, without waiting on `sent`, and the endpoint answers from the session's record alone (words when the session is on this machine and its owners include the machine's owner or `@machine`; O10's rule for an own-writer event its ledger does not hold). So an owner's terminal `say` into a local session is words while the hub is unreachable, which is RL §5.7's operator path. The fast path never delivers an own `human` event on a cut-over machine; the uplink does within its next pass. Rejected: waiting for the upload before asking, this document's first draft, under which an own `say` would stay owed for as long as RL1 was down.
- **The verdict replaces `owner_event` on the words path.** `push_live(peer, session, text, event, project, words=None)`: `words` True takes the bridge's `deliver` (once per key, as today), then a `--bg` job's supervisor; `words` False takes the inbox frame; `words` None decides by `owner_event` only on a machine not cut over, or for a frame no log holds. On a cut-over machine a `push_live` reached with a log-backed `human` event and `words` None raises `SendFailed("before", …)`: no path, present or later, may deliver a person's words there without the endpoint's verdict. `refuse` pushes nothing: the event settles `refused-words`, and its `delivery` outcome goes up with the reason the endpoint's verdict named. `revoked {version, devices, members, keys}` marks every owed event whose `verified.signer` names a listed device, member or key revoked in the delivery record (below), asked or not, and drops its pending `words?`; a `words` answer arriving later for it is ignored. Rejected: leaving revocation to the next `words?`, which the brief rules out ("stops retrying owed words at once") and which would keep a removed device's words in the queue for up to a minute of retries.
- **`send` is under the same rule.** An operator `send` records a `human` event and then pushes it itself: the seat path calls `push_live` with the event (sminos.py:8366–8369), the seatless path too (8555–8569), and `SendDelivery` carries the writer's earlier owed events in the same push (8516–8534). On a cut-over machine, a `human` `send` to a local session records the event, prints `recorded <ref> for <alias>; the endpoint decides its delivery`, nudges the daemon and exits 0 without pushing; the uplink child delivers it after `words?`, the writer's earlier owed events first (the two-pass rule asks the writer's first owed event, then the next). `send --wait` still waits for the reply as today. A session's `send` (a `say` event, a peer's) pushes as today. Rejected: pushing the `send` as a peer frame when the endpoint is absent, which would turn the owner's words into a peer message by availability and read differently each time.
- **A revoked event is marked, not settled out of order.** The delivery record is one settled prefix and one pending event per writer (sminos.py:1956–2003), and a member's devices share the `hub/<member>` writer, so settling a revoked seq 2 at once would move the prefix past an owed valid seq 1, or raise when seq 1 is the pending one. So `delivered_revoke(project, session, writer, seq)` adds the seq to the record's `revoked` list for that writer, clears `pending` and `attempts` when the pending seq is the revoked one, and records the event's `refused-revoked` outcome for the uplink, all under the delivery lock. `_owed` leaves a marked seq out, so no deliverer retries it; the prefix advances only through `delivered_settle`, in order, and passes a marked seq when the writer's next owed event settles. The list is pruned at each write to seqs above the prefix. Rejected: settling the revoked event through `delivered_settle`, which the reviewer reproduced dropping seq 1 and raising `ValueError`.
- **Revocation covers every delivery and the chat** (RL §5.2: "every delivery checks its signer against the current state when it is delivered"; a revoked key's past events are shown as signed by a revoked key, never verified). Every deliverer on a cut-over machine reads `daemon/revoked.json` (M5) before pushing an event that carries `verified`: the uplink child for words-gated writers, `daemon run`'s tick and the CLI's fast path for peer writers (`<name>/<session>` `say`s signed by another machine's key, and git-arrived events, which carry no `verified` and are untouched). An event whose `verified.signer` matches by `keyId`, `device` or `member` is marked revoked and never delivered, across a disconnect and a daemon restart, since the set is on disk. The arriving `signer` gains `keyId` (O10's amendment); an older `verified` without one matches by device and member alone. `chat_line` and `compose_chat_frame` render a matched signer as `from <alias> (signed by a revoked key)`, for every event in the log however old, and never `owned by`. Rejected: checking revocation only in the words pass, which leaves a stolen machine key's `say`s flowing into sessions as peer messages and its old events reading as owned.
- **Who delivers what on a cut-over machine.** Words-gated `human` writers (above): the uplink child, after `words?`, in every project known here. Git-arrived `human` events (another machine's `<name>/human` with no `verified`): `daemon run`'s tick, as an unverified peer message, never asked. Peer `say` writers of any origin: `daemon run`'s tick and the CLI's fast path, as today, each applying the revocation set to a `verified` event. Host kinds: nobody (M8's store). Nothing of a git-mirrored or local project is opened on RL10 (`hub_projects` keeps its org filter, sminos_uplink.py:1112–1127); the only thing of such a project that reaches the endpoint is a `words?` for an own-writer event, over the local socket, and the endpoint answers it from the session's record alone (words when the session is on this machine and owned by the machine's owner or `@machine`; O10's amendment). Rejected: delivering own-writer `human` events in non-relayed projects by a local rule, which is the second trust rule the operator-path decision already rejected.
- **The append receipt is the own writer's provenance; the writer name is not.** A git mirror's `integrate` merges `origin/main` into the project log under `.sync.lock` with no protection of this machine's own writer files (sminos_daemon.py:369–383), and `check_claim` checks only `machines/<name>.json` (269–289): the joint review's second round appended an unsigned `<thisname>/human` event to a scratch mirror, the merge took it, and `log_read` and `_owed` returned it as this machine's operator writer, which the gate above would have asked and an `@machine` session would have taken as words. So every own-writer `human` event `_append` stores gets a machine-private append receipt, written in the same append under the writer file's lock: `$SMINOS_HOME/projects/<id>/receipts/<writer>.jsonl`, one line `{seq, hash}`, `hash` the SHA-256 of the stored event's canonical body (the body as `_append` wrote it: `ts`, no `created`). The directory is outside `log/`, never mirrored (git syncs `log/` alone) and never uploaded (`uploads` reads `log/`). The words pass asks `words?` for an own-writer event only when `receipt_of(project, writer, seq)` equals the stored line's hash; otherwise the event is delivered by `daemon run`'s tick as an unverified peer message, never asked, with a daemon.log line naming the project, writer and seq, and `chat` shows it `(unverified)`. Receipts stay under the writer name the append used, so a rename keeps them and a former name's receipts are kept with it. Events appended before phase 2 have no receipt: an own-writer `human` event still owed at cutover goes as a peer, which is the consequence of the rule and is said in Acceptance 5. Rejected: protecting own-writer files inside `integrate` (a merge-time rule), which covers one transport and leaves the next, and which a `log/` file dropped in by hand would pass as well.
- **A legacy signer is a peer.** An event whose `verified.signer.kind` is `legacy` is delivered as an inbox frame marked `(unverified, legacy)`, never asked, never words (RL §9). On a machine not cut over, nothing of this applies.
- **The label.** `compose_chat_frame` takes the sender's owners from the event's `verified.owners`: `from <alias>, owned by <email>` (emails joined by `, `; the id where the endpoint sent `email: null`), `from <alias> (owners unverified)` for `[]`, `from <alias> (unverified, legacy)` for a legacy signer, and `from <alias>` on a machine not cut over or for an event with no `verified` (one this machine wrote, or imported before cutover). `chat_line` prints the same clause. Owners are rendered by the email the endpoint annotates from its head (O10 M6; P5 Decision Log 51), the id where it sent `email: null`; `verified.owners` keeps both. Rejected: resolving owners through aliases or `org.json`, which carries machines and projects, not members (RL6: owners are never resolved later through an alias).

**Not touched.** Which member holds `converse` (the endpoint's, O10 M5). Signing (the endpoint's). The bridge's `deliver` (unchanged). Lane B sessions: a `human` event owed to one is a peer message either way (M3's refusal falls back to the inbox).

**Proves.** Acceptance 5 and 6. Tests also pin:
- a member set sent whole at the welcome, a changed title sent alone, `gone` on leave, and nothing for a remote member;
- a session without a record sent with defaults and sent again once the record exists;
- two `human` events of one `hub/<member>` writer: only the first is asked until it settles, and the second follows in order;
- a `words` answer for an event that was settled meanwhile (a revocation) changes nothing;
- the operator path: `sminos say` from the terminal on a cut-over machine pushes nothing itself, the uplink asks after the upload, and the bridge sees one `deliver`;
- a `--bg` job with no bridge takes the supervisor's `reply` on `words` and the inbox on `peer`;
- a `revoked` naming a key, a device and a member each marks the right owed events, and `delivery` outcomes go up for them;
- an operator `send` to a live seat, to a seatless session, and to a session whose `human` writer holds two earlier owed events: each with the stand-in absent (recorded, owed, `chat` shows it undelivered, nothing pushed) and with the stand-in refusing (settled `refused-words`, nothing pushed); with it answering `words`, the earlier events and the send arrive in order through one bridge `deliver` each; a `push_live` called with a log-backed `human` event and no verdict raises;
- a `hub/<member>` writer with seq 1 from device A and seq 2 from device B, B revoked: seq 2 marked at once; with seq 1 unattempted it is asked and delivered and the prefix moves to 1 then past 2; with seq 1 pending on a failed attempt the same, with no `ValueError`; seq 1 revoked while pending clears the pending and leaves seq 2 deliverable;
- import a `say` signed by machine key K, disconnect, a welcome whose set revokes K, `daemon run` restarted, the `say` still owed: never delivered, marked, its outcome up; `sminos chat` prints K's earlier events as `(signed by a revoked key)`;
- a cut-over machine holding a hub project, a git-mirrored project and the local-only project: an operator `say` in each is asked and delivered on the verdict; a `human` event pulled through the git mirror is delivered by `daemon run` as an unverified peer with no `words?`; the stand-in sees no `hello` for the git or local project;
- a forged `<thisname>/human` event appended to a scratch git mirror of a project and merged in by `integrate` (a real `daemon tick` against a bare remote, as `test-sync.sh` runs one): no receipt, no `words?` to the stand-in, delivered by `daemon run`'s tick as an unverified peer message with a daemon.log line, `(unverified)` in `chat`; the same event appended here by `sminos say` has its receipt and is asked;
- a project with an own-writer `human` event appended by a pre-phase-2 sminos (no `receipts/` directory) and still owed at cutover: delivered as a peer, never asked;
- a receipt's writer name survives a rename (the welcome's rename rule): the old name's receipts match its old events, and the new name's appends write under the new name;
- the label in the inbox frame and in `sminos chat`, for each of the four forms;
- the DX2 suites unchanged, and `test-bridge-control.sh`'s delivery cases unchanged.

### M7 — Lane A actions with remote context

**What exists at its end.** A remote lane A action is bound to its sender and fenced to the launch it was sealed for:
- the ledger entry holds `member`, `device`, `fingerprint` and `target`, a known `opId` with another member or fingerprint is refused `op-conflict`, and `queried` and `tombstoned` carry the binding (O10 M7's query authorization reads it);
- every lane A session with a bridge has a launch id, minted by the mod when its process starts and kept across a `/reload-plugins`; the bridge's child carries it in its hello and status, the plane carries it in presence, and `member.launch` carries it to the endpoint;
- an RPC with `context {lane: 'A', session, launch}` is relayed to the bridge with `launch`, and the child refuses it `launch` immediately before the mod acts when its own launch differs; a decision takes the same check; every path that bypasses the bridge refuses a remote context; `resume`, `retire` and `stop` refuse a remote context as `unsupported` (O10 does not offer them);
- a desk spawn's `proof` is in the new session's record as `ownersProof`;
- the binding and the latest nonce are held from dispatch on, so a reseal or a conflicting copy that arrives while the worker is still inside `plan` is answered right.

It builds on M7a (the nonce-on-claim rule) and on M6 (whose `member` frames it extends with `launch`, and whose publication it proves).

**What it touches.**
- `sminos_rpc.py`: `entry_of`, `Rpcs.flight` (a dict: the in-flight record), `dispatch` (the binding check, the record), `run` and `keep` (the claim and the refusal entry taken from the record), `ledger_view` and `query`/`tombstone` (the binding in the answer), `plan` (the context's checks and the `launch` on each bridge command), `steer_without_bridge`, `spawn` (the proof).
- `sminos_bridge.py`: `serve` takes `--launch`; the hello and `/status` carry it; `do_POST`'s `/command` and `/requests/<id>/decision` check it.
- `sminos/hooks/mods/bridge.tsx` (`bridgeStart`, `startChild`), `bridge-state.tsx` (`launch` in the state and `$.state`).
- `sminos_plane.py`: `Bridges.answers`/`capabilities` carry `launch` into the presence body.
- `sminos.py`: `spawn_fresh` and `launch_env` (`SMINOS_DESK_PROOF`); `list --json` already shows `ownersProof`.
- `sminos_uplink.py`: `member.launch` (M6's frame builder reads the presence).
- Tests: `test_rpcs.py`, `test-bridge-control.sh`, `sminos/tests/mods/bridge.test.ts`, `test_records.py`, `test_session_plane.py`.

**Interfaces.** Consumes M5's `rpc` fields and M6's frames. Exposes the launch id (Interfaces §F), the ledger entry's binding (§B, extended) and `SMINOS_DESK_PROOF`.

**Decisions.**
- **The launch is the mod's.** sminos has no launch today: the mod's `generation` counts bridge children within one process, and the child's `nonce` names one hello (sminos_bridge.py:166, bridge.tsx:1413). RL §3.2's launch is the process holding the session, which is what a desk action is sealed against: a `--resume` in a new process must refuse an action sealed for the old one, and a `/reload-plugins` must not. So `bridgeStart` mints `state.launch` once per process (16 random bytes, base64url) when none is kept, keeps it in `$.state` (`sminos.launch`) beside the lane verdict so a module reload reads it back, and passes `--launch <id>` to every child it starts; the child's hello and `/status` carry it, and `Bridges.capabilities`/`answers` put `launch` in the presence body beside its `bridge` flag (on RL10 only; revised 2026-10-27 in building M7, since desk-hub refuses a non-boolean `bridge`), from which M6's `member` frame takes it. A session without a bridge has no launch, and the endpoint refuses its actions `context` before they reach sminos. Rejected: the engine's registry record (`<CLAUDE_CONFIG_DIR>/sessions/<pid>.json`, pid and start) as the launch, which the mod cannot read without a child and which a reused pid after a reboot could repeat; and the record's `controller.since`, which is a time written late by M3's relay, not an id the action can name.
- **The fence is the child's, immediately before the effect.** `Bridge.command` and `Bridge.decide` take an optional `launch` from the request body: when present and not the child's, the child answers `409 {ok: false, code: 'launch', error: …}` and posts nothing to the mod; absent, the command is a local caller's (`sminos steer`, the daemon's own `deliver`) and runs as today. The child's launch is its process's (the mod passed it), and the child dies with its process (it watches its parent), so a command the child relays under a matching launch reaches the launch it names. `command()` in `sminos_rpc.py` turns the 409 into `Refused("launch", …)` as it turns `lane-b`. `plan` adds `launch` from `context.launch` to every bridge command it builds for a remote RPC (`steer`, `interrupt`, `model`, `compact`, `command`, `btw`, `media`, `stop-agent`, `tell`, `stop`) and to the decision body (`answer`, `decide`). Rejected: checking the launch in the daemon against the presence it last read, which is a check at admission, not at the effect, and which a relaunch between the two would pass.
- **What a remote context means in sminos.** An `rpc` frame received on RL10 is remote. One that names a session must carry `context` with `lane: 'A'` and `session` equal to `args.session`, else it is refused `bad-shape` at admission (RL4: context is mandatory for an action on a session); a spawn carries none. With a remote context, `plan` never takes a path that bypasses the bridge: a `steer` on a session without a bridge is refused `context` ("the session has no bridge to fence it"), never `steer_without_bridge`'s supervisor or inbox; `resume`, `retire` and `stop` are refused `unsupported` (O10 §G does not offer them; `stop` is bridged but not offered either, and the refusal is the same). The endpoint refuses a lane A act on a member with no `launch` as `unavailable` before anything goes down (O10 M6 and M7, as aligned), so the bridgeless case reaches sminos only from an endpoint that is wrong about the member; sminos's refusal stays as defence in depth. A DX2 RPC (a machine not cut over) carries no context and runs as today. Rejected: fencing by `member.launch` at the endpoint alone (O10 M7 does that too), which leaves the window between the endpoint's check and the bridge's effect open.
- **The binding, held from dispatch on.** `flight` is a set today: `dispatch` adds the op before the worker starts, and the worker runs `plan` before it claims (sminos_rpc.py:531–532, 625–628, 733–747), while `Ledger.acked` returns at once for an op with no entry (488–495). So between dispatch and the claim there is nothing to hold a binding or a reseal's nonce against. `flight` becomes a dict, `op → {nonce, member, device, fingerprint, target}`, written in `dispatch` under `op_lock` before the worker starts. A copy arriving for an op in `flight`, or for a known entry, is compared under `op_lock` with the record's (or the entry's) `member` and `fingerprint`: a difference is refused `op-conflict`, loose, under the copy's nonce, revealing nothing of the stored one (O10 M7); an identical binding updates the record's nonce (and a claim entry's, through `Ledger.acked(op, False, nonce)`, M7a) and re-arms an answered entry as M2 does. The worker's claim and `keep`'s refusal entry are built from the record under `op_lock`: `entry_of` takes the binding and the current nonce from it, and the claim (`Ledger.claim`) or the refusal (`Ledger.put`) is written inside the same lock, so the record's fields move atomically into the entry; `flight` drops the op at `("done", op)` as today. `target` is `{kind: 'machine'}` for a spawn and `{kind: 'session', session: args.session}` otherwise, derived in `receive` (M5). `ledger_view` carries the binding, so `query` and `tombstone` answer it, and M5's `queried`/`tombstoned` frames carry it; an entry an older daemon wrote carries none, and the endpoint's authorization refuses such a query `grade`, which is the safe side. A DX2 RPC's record and entry keep `member` alone, as today. Rejected: keeping the binding only in the claim entry, which leaves the whole of `plan` (a bridge round trip, a spawn's checkout checks) as a window in which a reseal keeps nothing and a conflicting copy passes as the same op.
- **The proof travels in the environment.** `spawn()` passes the frame's `proof` to `run_verb` as `SMINOS_DESK_PROOF=<canonical JSON>` beside `SMINOS_DESK_MEMBER`; `spawn_fresh` reads it and writes `ownersProof: [proof]` into the pending record (M1's claim then carries it to the child's record); `launch_env` drops it from every environment sminos builds, as it drops `SMINOS_LAUNCH`. An unparsable or absent proof on a desk spawn writes `ownersProof: []` and a daemon.log line, never a refusal: the proof is the attestation's, not the spawn's admission (the endpoint authorized it). A `sminos spawn` from a session copies the parent's `ownersProof` as M1 does. Rejected: a file the verb reads by path, which needs a lifetime and a sweep for a few hundred bytes.
- **MW5's upload id is the opId** since M2 (`media()` hands the bridge `upload: op`). On RL10 the op is the device's `opId`, so the files under the session's working directory and the `op` messages up the lane are named by it; nothing here changes, and the conformance replay pins it when the fixture carries a `media` action.

**Not touched.** The endpoint's authorization and its own ledger (O10 M5, M7). Lane B's ledger (the engine host, O10 M7). O8's record actions. M4.

**Proves.** Acceptance 7. Tests also pin:
- with a worker paused inside `plan` (before its claim; the fake bridge holds the command): an identical reseal under a new nonce is accepted, the op runs once, and its outcome goes up under the reseal's nonce and its `opId`; a copy with another `fingerprint`, and one with another `member`, is refused `op-conflict` loose under its own nonce while the original runs once under its binding; the same with the worker paused after its claim;
- `op-conflict` for a known `opId` with another `fingerprint`, and with another `member`, revealing nothing; the same `opId` with the same binding answered from the ledger;
- the mod mints one launch per process, keeps it across a reload (`$.state`), and a new child carries it; the child's `/command` with another launch answers 409 `launch` and posts nothing; a decision with another launch likewise; absent `launch` runs;
- `plan` adds `launch` to each bridge command for a remote RPC, and the RPC fails `launch` on a mismatch; a remote `steer` on a bridgeless session is `context`; remote `resume`, `retire` and `stop` are `unsupported`; a remote RPC without `context` is `bad-shape`;
- `member.launch` follows the presence and changes on a relaunch;
- a desk spawn's proof in the child's record, absent from the launch settings' env, and a session's spawn copying it;
- `queried` and `tombstoned` carry the binding; an older entry answers without one.

### M7b — RL10's three joint frames and the conformance replay

**What exists at its end.** sminos speaks the three frames O10 M6 found RL10 needed, as O10's §D and `conversation.json` carry them on M6's PR, and replays that fixture:
- **`spent {project, writer, seq, reason}`** (endpoint → sminos): the endpoint's final verdict on an arriving event it rejected. sminos records it as a spent position exactly as it records one it refused itself in `take`: later events of that writer are no longer held behind a gap, the vector moves past it, and an own writer goes through `spend_own`. Every spent position the endpoint reports is visible here: one daemon.log line per position naming its project, writer, seq and reason, and a count of spent positions in `sminos daemon status` (per project where the layout allows). Without it a forged or replayed hub event is skipped and leaves no trace on the machine.
- **`words?` carries a required `project`** beside `id`, `session` and `event`.
- **`restated {}`** (sminos → endpoint): sent once after the whole post-welcome restatement (the session lane's presence, the member set, each project's pending set, the unacknowledged `rpc-result`s, and M8's host resend), so the endpoint knows when what it holds from the earlier connection may be replaced.
- **The conformance replay** (M5's decision, deferred until the fixture existed): `rl10_conformance.py` over `rl10-conversation.json`, O10's `test/endpoint/rl10/conversation.json` copied with its MAWS sha in the header, in `run-sminos-tests.sh`'s `suites` part, including the case M5 pins beyond the fixture (a real `_append` event through upload, resend, echo and `words?`, and the same with a whole-second `ts`). A line the replay fails is either a sminos bug or an O10 amendment, and the PR says which.

**What it touches.** `sminos_uplink.py` (`on_spent`, `ask_words`'s frame, the welcome's restatement and `restated`), `sminos_hublog.py` (the spent position, as `take` records its own), `sminos_daemon.py` (`cmd_status`'s spent count), `sminos/tests/endpoint_standin.py`, `test_rl10.py`, `test_words.py`, and the new `rl10_conformance.py` and `rl10-conversation.json`.

**Interfaces.** Consumes O10's §D as amended on its M6 PR. Changes §D' by the three frames.

**Not touched.** The DX2 path: the three frames are RL10's alone, and a machine not cut over runs as before.

**Proves.** Acceptance 4's conformance bullet. Tests also pin: a `spent` frame unblocks the writer's later events and moves the vector, an own writer's through `spend_own`, with its daemon.log line and the status count; `words?` carries `project`; `restated` follows the last restatement frame after each welcome and nothing of the restatement after it.

### M8 — To-human off the hub

**What exists at its end.** On a cut-over machine, what a session sends its person stays on the machine and reaches devices through the endpoint:
- the host events (`message`, `question`, `answered`; `HOST_KINDS`) of a hub project are appended to the host store, `projects/<id>/host/<writer>.jsonl`, by the bridge's live export and the Stop hook's export alike, and never to `log/`; the uplink's vector, uploads and `rejected` never name them;
- `sminos chat --host` reads the store and the log's older host events together, in time order, for the machine's own sessions;
- each appended host event goes up RL10 as a session-lane `host` message with no subscription, carrying its stable id `{writer, seq}`, whether or not anyone subscribes, and goes again after a reconnect; separately, every `full` subscription of the session carries it in its own stream, and a subscription's snapshot carries the session's last 50;
- a machine not cut over, and a git-mirrored project on any machine, write host events where they go today.

**What it touches.**
- `sminos.py`: `append_host` (the route), `host_read` (new), `_askers`, `chat_host`, `export_host`/`export_live` (unchanged callers), `log_read` (unchanged).
- `sminos_uplink.py`: a host pass in `tick` (`host_due`), the per-project `host_sent` cursor in `uplink.json`, the resend at each welcome.
- `sminos_plane.py`: `Subscription` tails the session's host file beside its transcript and emits `host`; `snapshot` carries `host`.
- `sminos_hublog.py`: `vector`, `writers`, `uploads` see `log/` alone (they do today; a test pins it).
- `sminos_bridge.py`: `_export_now` (unchanged; `append_host` routes).
- Tests: `test-bridge-export.sh`, `test_session_plane.py`, `test-uplink.sh` (nothing of `host/` goes up), `run-sminos-tests.sh` core (`chat --host` over both stores).

**Interfaces.** Consumes M5's cutover flag and session lane. Exposes the host store (Interfaces §G) and the `host` message kind.

**Decisions.**
- **A store beside the log, not a filter at upload.** A writer's seqs are contiguous and the hub refuses a gap for good (RL §6.2: a withheld event becomes a permanent gap), so host kinds cannot be left out of a session writer's upload; and they cannot keep going to `log/` on a cut-over machine, since `uploads` sends every own writer whole. So on a cut-over machine, for a hub project, `append_host` appends to `projects/<id>/host/<writer>.jsonl`: the same event shape, the same writer names (`writer_id(session)`; an answer under the asker's writer, as today), its own seq space, the same `(kind, src)` dedup under the same locks (`_append`'s rule, on the host directory). `host_read(project)` reads the store as `log_read` reads the log. The log's older host events (before cutover) stay where they are, already on the hub, and `chat_host` merges both by `ts`. Rejected: a host writer name inside `log/` (`<name>/<session>/host`, or a suffix), which every reader of writer names would need to learn (`writer_session`, `outside_origin`, `owner_event`, `_owed`, the vector), for the one gain of a shared reader; and filtering at upload, which RL §6.2 forbids.
- **The notification does not need a subscriber; the view does.** Host messages produced only inside a `Subscription` would reach the endpoint only while one is open (`Plane.tick` pumps `self.subs` alone, sminos_plane.py:2823–2832), and O10 M8 ends an upstream subscription after its resume window, so `notify wrote` would be lost for every session nobody is watching, which is the one the owner needs a push for. So the uplink itself sends each appended host event up RL10 as a session-lane message with no subscription, `envelope(project, machine, session, 'host', None, None, {id: {writer, seq}, event})`, as `raised` and `delivery` go today: `tick`'s host pass reads each local member's host file past the per-project `host_sent` cursor kept in `uplink.json` (as `spent` is), sends what is new, and advances the cursor on write; at each welcome the session's last 50 go again regardless of the cursor, so an endpoint crash between sminos's write and its own persistence loses nothing, and the endpoint deduplicates by the id. Separately, a `full` subscription of the session carries host events in its own stream: `Subscription` tails the host file as it tails its transcript (`read`) and emits `envelope(project, machine, session, 'host', sub, n, {id, event})`; `snapshot` adds `host: [<last 50>]` to its body. What O10 adds, precisely: (1) M3 derives `notify {kind: 'wrote'}` from the sub-less `host` messages whose `body.event.kind` is `message`, for a session with a listing, deduplicated by `body.id` (its text already says "as O12's phase 2 reports it up RL10"; this is the report); (2) M8 relays the subscribed `host` messages as it relays every other kind of a `full` subscription, never into `cards`, and ignores the sub-less ones for subscribers; (3) no new RL10 frame: both are session-lane messages of one new kind. Rejected: a dedicated RL10 frame and an endpoint-side host store served by a call, which O10 would have to build (a store, its retention, an authorized read) for what the plane already carries to the readers who may see it; and producing the notification from subscriptions alone, which the reviewer showed reaches no unwatched session. What this leaves open, for O7: a project-wide "what my sessions said" view would need an endpoint call across sessions; the per-session plane serves the sidebar's session view, which is MAWS's shape today (desk's project chat of `<message>`s moved to channels, RL §6.2).
- **Async asks are records here, cards elsewhere.** The ask itself is a `raised` request on the requests plane and a card over channels (O10 M8's `cards`); the `question` and `answered` host events are the transcript's record of it, kept and shown as the `message` kind is. Nothing of the ask's answering changes.
- **Cutover decides, per machine; the project kind decides, per project.** A git-mirrored project (a remote in `.smns`, no hub) keeps host events in its log, which git mirrors as today; RL §6.2's rule is about the hub. The machine's own project and every hub project take the store once the machine is cut over. Rejected: moving git projects too, which changes a path the cutover has no reason to touch.

**Not touched.** The to-human plugin and its mod. MAWS's own `mcp__maws__message`. The requests plane. Desk-web (O13's cards keep working: they are not the host store).

**Proves.** Acceptance 8. Tests also pin:
- the bridge's live export and the Stop hook's export of the same records append one copy, in the store, on a cut-over machine; in the log on one not cut over;
- an answer to a question another session asked goes under the asker's writer in the store;
- `chat --host` shows a pre-cutover question from the log with its post-cutover answer from the store beneath it;
- the uplink's `hello` vector and `events` frames name no host writer or event, and a `resend` for one is refused;
- a subscription made after three host events sees them in its snapshot, and a fourth as a `host` message in its stream; a `cards`-style reader (the requests plane) sees none;
- with zero subscribers, each appended host event reaches the stand-in once as a sub-less `host` message with its `{writer, seq}` id; with a cards-only subscriber, once, and nothing in that subscriber's view; with two full subscribers, once sub-less and once in each subscriber's stream, the ids equal; a reconnect resends the session's last 50 sub-less, and `host_sent` in `uplink.json` is where the next pass starts;
- a git-mirrored project on a cut-over machine writes to its log.

### M7c — What O14's B2 reads from sminos

**What exists at its end.** The three things O14's brief B2 runs against sminos on the mini (O14 at MAWS `60074ada2`, its decision on the sminos floor and its "what others must provide"; P5 Decision Log 75, residue 17 on O12's row):
- **`bench_scale.py run --rl10`.** The `run` mode against the RL10 endpoint stand-in (`endpoint_standin.py`) in place of the hub stand-in: the synthetic machine cut over by a complete `welcome`, its uplink the RL10 child, the stand-in serving the words gate so the words pass has owed words-gated events to ask about at the scale's member and chatter counts, and `--import-events N` arriving as RL10 `events` frames. It reports each process's CPU over the window as a share of one core, the words pass's per-pass wall time (count, p50, p95, max) and the longest gap between passes, and checks B2 step 2's gate: p95 per pass under 1 s, the uplink under 5 % of a core, a pass at least every 10 s in the uplink process. Exits non-zero when the gate fails. B2 step 2's command, `python3 sminos/tests/bench_scale.py run sminos/skills/sminos/scripts --rl10 --seconds 60 --warmup 30 --import-events 200`, runs as written.
- **`sminos daemon owed`.** What this machine still owes, per project: deliveries owed to a local member not yet made, words-gated events whose words are not yet settled, and what is owed upstream and not yet acknowledged (this machine's own events not yet taken by the hub or the endpoint, `sminos_owed`'s kept settlements and compaction messages, the host store's unsent messages). Bounded: one line per project with counts and the oldest item's age, at most a few references (writer/seq, recipient alias) per kind, never a message body; projects with nothing owed are not printed. Exits 0 when nothing is owed, 1 otherwise. Read-only: it takes no lock the daemon or the uplink holds for long, and it runs beside a running daemon. Events owed to a closed session (reported `recorded`, delivered if it resumes) are counted on their own line and do not make the machine owe: nothing a cutover can lose is in them.
- **The un-cutover branch's test.** Both orders, against a running supervisor: `rl10.json` and the socket removed first (as `mawsd endpoint unenroll` does), then `identity.json` — the supervisor leaves RL10, does not cut over again, and runs DX2 from `hub.json` when one is present (local-only when none is), `daemon status` saying so; `identity.json` removed while the endpoint still serves RL10 — the probe cuts the machine over again (O14's observation), pinned so the order O14's undo depends on is a tested fact.

**What it touches.** `sminos/tests/bench_scale.py`, `sminos/tests/endpoint_standin.py` (whatever the bench needs of it), `sminos_daemon.py` (`daemon owed`; the supervisor only if the test finds the first order does not hold), `sminos_uplink.py` (a daemon.log line or counter per words pass, if the bench needs one to measure), `sminos.py` (the verb's parser), the tests beside them, and the skill's reference for the new verb.

**Interfaces.** Consumes O14's B2 steps 2 and 4 and its undo order. Adds `sminos daemon owed` (exit 0: nothing owed) for O14's brief and mini-ops.

**Not touched.** The DX2 path's behaviour: `daemon owed` reads, and the bench's RL10 mode is a test harness.

**Proves.** O14's B2 preconditions on sminos. Tests pin `daemon owed`'s kinds and its exit code (one of each kind owed, then none), its bound and that no body is printed; the un-cutover branch in both orders. The bench's numbers on this Mac go to Outcomes.

### M9 — The mini

**What exists at its end.** The mini runs this sminos, at or above 1.27.0 (M7c's version, the floor for a cutover: B2's gate runs `sminos daemon owed` on the mini), installed through the mini-ops session at the owner's request near O14's cutover of the mini (RL §9 step 2: the owner's standing rule forbids driving `claude` over ssh there), and once O14's brief has cut it over, its sminos is local-only with its unattended seats intact. This milestone verifies; it builds nothing and runs nothing on the mini itself.

**What it touches.** Nothing in either repository. Its evidence goes to Outcomes & Retrospective.

**Decisions.**
- **Verification, not a procedure.** The install is mini-ops' (a session on the mini, at the owner's request); the cutover is O14's. What O12 states is what must hold afterwards, read from the MacBook over the org and from the mini's own `daemon status` as mini-ops reports it: the sminos version, `uplink: RL10 (local-only)`, no DX2 stream for the mini at the hub (the hub's machine presence, O11's `GET /api/machines`), the journal and Telegram seats neither `retired` nor `gone` across the install (`sminos list --org --json` before and after, their session ids unchanged or continued by `hand_off`), and one `sminos say` from the MacBook to a mini session arriving labelled with its owner. Before the mini is cut over, the words pass's cost is measured at the owner's scale (`sminos/tests/bench_scale.py` against an installation shaped like the mini's, with M6's words pass and M8's host pass in the uplink process): M6 left it unmeasured, and it reads the log of every known project with a local member on each nudge, import or verdict and at least every 10 s (P5's O14 carry list holds the same step). Rejected: a script that runs `claude` on the mini over ssh, which the owner's standing rule forbids, and a sminos self-update verb, which does not exist and which the plugin marketplace already provides.
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

Phase 2, doperpowers, from a worktree cut from `origin/main` (M7a first, on its own; then M5; M6 and M8 from `main` after M5 lands; M7 from `main` after M6 lands):

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

The frames are O10's §D as aligned on `p5-o10-doc-3` (`c4911a6d4`), name for name; the shapes below are that §D's, read from sminos's side. What sminos adds or keeps beside them:

    discovery   $MAWS_USER_DATA/mawsd/endpoint/rl10.json when MAWS_USER_DATA is set, else O2's platform default;
                SMINOS_RL10=<path> overrides for a test. Required: a regular 0600 file of this uid,
                { socket, pid, build, token: <64 hex>, protocol: 1 }.
    hello       { t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: [], token, sminos: { version },
                  policy: { read_only, ceiling } }      // the first line; nothing before the welcome
    up          DX2's log plane uncoded (events as stored: `ts`, no mac, no `created`; the endpoint derives the signed `created` from `ts`
                  in its deterministic upload form, and refuses an event carrying another `created` as malformed); session { message } with raised, settled and delivery
                bodies as drafts (no mac), every DX4 kind, whole again after each welcome; pending { project, raised };
                the machine presence as DX2 sends it: { t: 'session', message: { kind: 'machine', session: null, body: { online, policy, checkouts, desk } } };
                kind 'host' (M8): sub null, body { id: { writer, seq }, event }, as each to-human event is written, the last 50 again after a reconnect;
                  and in each lane A full subscription's own stream with its sub and n;
                rpc-result { t, project, opId, nonce, outcome } (a loose refusal's too; again after each welcome until rpc-ack);
                member { session, alias, project, lane, state, title?, cwd, worktree?, launch?, owners, ownersProof, origin, principal?, inference?, controller? }
                  (M6: every session on this machine in every project known here, whole after each welcome and on change; { session, gone: true } at leave;
                   no other id than session);
                words? { t, id, session, event } (M6; the stored line without `verified`: an arriving one with its sig, an own-writer one without
                  and with its `ts`, which the endpoint reads in its upload form; an own-writer one only when its append receipt matches;
                  asked after the tick's upload pass, never waiting on the hub);
                queried / tombstoned (§D's shape, M7's binding fields); policy-set; legacy-key { org, key } (retryable); rejected
    down        welcome: identity (complete: org, hub, name, ref, enrolled; else no cutover) written to daemon/identity.json (former: names only; the sessions map is sminos's); the revocation set
                  that follows it written whole to daemon/revoked.json; `capabilities` carries no kind filter: every kind is sent;
                events { project, events: [{ event, signer, owners? }] }: stored as `{...event, verified: { signer, owners } }`, an `event`
                  carrying `verified` refused bad-shape; signer { kind: 'device', member, device, keyId } | { kind: 'machine', ref, name, keyId }
                  | { kind: 'legacy' }; a returned own event: present when it echoes the stored one, else conflict (as today);
                  have, resend, refused as today; subscribe, unsubscribe, rows, diff, output, read as today;
                rpc { rpc: { rpc, project, machine, member, device, created, nonce, opId, opCreated, args, context?, fingerprint, proof? } }:
                  DX6's Rpc nested as DX2 nests it, `machine` the welcome's name, args.session and args.digest as DX6 has them; on_rpc, the
                  wrong-machine check and shape run unchanged; only the code check is skipped; target derived (M7);
                rpc-ack { opId, nonce }: settled by the nonce as today, by opId when the nonce is unknown;
                query { opId, opCreated } and tombstone { opId } → Rpcs.query / Rpcs.tombstone;
                words { id, verdict } (M6); revoked { version, devices, members, keys } (whole, after each welcome and on change; M5 persists, M6 applies);
                policy → daemon/policy.json; org → daemon/org.json; legacy-key? (answered as often as asked)
    lanes       one: a frame is taken when written; continuations run on write; every welcome resends the complete session-lane state
                (presence, member set, each project's pending set, the last 50 host events per session), each project's hello and
                every unacknowledged rpc-result.

Files (all 0600 under `$SMINOS_HOME/daemon/`, written atomically):

    identity.json   { org, hub, name, former: { <name>: [<session>...] }, ref, enrolled, cutover: <ISO 8601>, build }
                    // written at the first RL10 welcome; read before hub.json by enrollment(), machine_identity(), enrolled_at(), hub show;
                    // its presence is the cutover: the supervisor runs the child in RL10 mode only, and hub.json's credential is never used again;
                    // a welcome that renames the machine captures sessions_under(old) into former[old] before the replace (M5)
    revoked.json    { version, devices: [], members: [], keys: [] }   // whole from each welcome, merged by version from each revoked frame; read by every deliverer and chat
    policy.json     as today; written from `policy` frames on a cut-over machine

Readers: `sminos_rl10.find() -> dict | None` (the file, checked), `sminos_rl10.cutover() -> dict | None` (identity.json), `sminos_rl10.revoked() -> dict` (revoked.json; empty sets when none), `Link(cred, logs, transport=..., coded=False)`.

### E. The delivery verdict (M6)

    push_live(peer, session, text, event=None, project=None, words=None)
        # words True: the bridge's deliver (then a --bg job's supervisor); False: the inbox frame;
        # None: owner_event decides only on a machine not cut over, or for a frame no log holds; on a cut-over machine a
        #   log-backed `human` event with words None raises SendFailed("before"): nothing decides a person's words there but the verdict
    deliver_verdict(project, member, event, verdict: 'words' | 'peer' | 'refuse') -> outcome
        # under the delivery lock; the event must still be its writer's first owed; settles and records as deliver_next does
    delivered_revoke(project, session, writer, seq)
        # under the delivery lock: seq added to the record's revoked list for the writer; pending and attempts cleared when seq is the
        # pending one; the refused-revoked outcome recorded; _owed leaves marked seqs out; the settled prefix moves only in order
    outcomes.REFUSED_WORDS = 'refused-words'; outcomes.REFUSED_REVOKED = 'refused-revoked'   # delivery outcomes up the session lane

    who delivers, on a cut-over machine (in every project known here):
      words-gated writers (hub/<member>; another machine's <name>/human with `verified`; this machine's own <name>/human whose
        append receipt matches): the uplink child, after words?; words / peer / refuse as the verdict says; the endpoint decides an
        own-writer event from its signature ledger when it holds it, else from the record alone (an unrelayed project, or RL1 down)
      another machine's <name>/human with no `verified` (through a git mirror), and this machine's own <name>/human with no matching
        receipt (a mirror's import under this name, or an event appended before phase 2): daemon run's tick, as an unverified peer, never asked, logged

    projects/<id>/receipts/<writer>.jsonl   # machine-private, outside log/, never mirrored or uploaded: one `{seq, hash}` per own-writer
                                            # `human` event _append stores, hash = SHA-256 of the stored canonical body (ts, no created),
                                            # written in the same append under the writer file's lock; kept under the writer name used,
                                            # so a rename keeps a former name's receipts; receipt_of(project, writer, seq) -> hash | None
      peer `say` writers: daemon run's tick and the CLI's fast path, as today
      host kinds: nobody (the store, M8)
      every deliverer applies daemon/revoked.json to an event with `verified` before pushing it

The delivery record per (session, writer): `{ settled, pending, attempts, pushed?, revoked: [seq...] }`.

The stored line's `verified: { signer: { kind: 'device', member, device, keyId } | { kind: 'machine', ref, name, keyId } | { kind: 'legacy' }, owners: MemberId[] }` is read by delivery (the words rule, the revocation check, the label) and by `chat`. It is never sent back inside an event. A revoked signer is one whose `keyId`, `device` or `member` is in `revoked.json`.

The label: `[sminos chat <project> <ref> from <alias>, owned by <email>[, <email>] → @you]` (an owner the endpoint sent with `email: null` by its id); `from <alias> (owners unverified)` for `owners: []`; `from <alias> (unverified, legacy)` for a legacy signer; `from <alias> (signed by a revoked key)` for a revoked signer, in `chat` for every event however old; `from <alias>` with no `verified`.

### F. The launch and the binding (M7)

    bridge mod:   state.launch (16 random bytes, base64url), minted at the process's first bridgeStart, kept in $.state as `sminos.launch`;
                  the child is started `sminos bridge --launch <id>`; the hello and GET /status carry `launch`
    bridge child: POST /command and POST /requests/<id>/decision take an optional `launch` in the body;
                  a mismatch answers 409 { ok: false, code: 'launch', error } and posts nothing to the mod
    presence:     body.launch, beside the boolean body.bridge, on RL10 only; member.launch (M6) is read from the same probe
    rpc:          a remote RPC naming a session carries context { lane: 'A', session, launch }; plan() passes `launch` on every bridge command
                  and decision; a remote RPC without a bridge path is refused `context` (the endpoint refuses a launch-less member
                  `unavailable` before anything goes down; sminos's refusal is defence in depth); resume, retire, stop: `unsupported`
    in flight:    Rpcs.flight: op → { nonce, member, device, fingerprint, target }, written in dispatch under op_lock before the worker starts;
                  a copy for an op in flight or known is compared with it under op_lock: op-conflict on another member or fingerprint,
                  else the nonce updated; the claim entry (run) and the refusal entry (keep) are built from it under op_lock, atomically
    ledger entry: + member, device, fingerprint, target: { kind: 'session', session } | { kind: 'machine' }, context?, proof?
                  (a DX2 record and entry keep `member` alone, as today)
    query/tombstone answers: + member, device, fingerprint, target when the entry holds them
    op-conflict:  a known or in-flight opId whose copy names another member or fingerprint; loose, under the copy's nonce, carrying the opId
    SMINOS_DESK_PROOF=<canonical JSON of the spawn's signed action>: set by the daemon for a desk spawn's verb, read by spawn_fresh into
                  the pending record's ownersProof, dropped by launch_env

### G. The host store (M8)

    projects/<id>/host/<writer>.jsonl     # on a cut-over machine, for the machine's own project and every hub project: HOST_KINDS events,
                                          # the same shape and writer names as log/, their own seqs, (kind, src) dedup under the same locks
    host_read(project) -> [event]         # as log_read reads log/; chat --host merges it with log_read(project, kinds=HOST_KINDS) by ts
    session lane: envelope(project, machine, session, 'host', None, None, { id: { writer, seq }, event })
                                          # one per appended host event, sent by the uplink's tick outside any subscription, subscribed or not;
                                          # uplink.json's host_sent: { writer: seq } per project is the cursor; the session's last 50 again at each welcome
                  envelope(project, machine, session, 'host', sub, n, { id, event })   # the same event in each full subscription's own stream
                  snapshot body + host: [<the session's last 50 host events>]
    nothing of host/ is in the uplink's vector, uploads, resend or rejected

O10's part: `notify { kind: 'wrote' }` derived from the sub-less `host` messages whose `body.event.kind` is `message`, deduplicated by `body.id` (M3); the subscribed `host` messages ride a `full` subscription unchanged and never a `cards` one (M8).

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

Phase 2's survey of sminos 1.19.0 (`8f79b741`) against O10's M6 and Interfaces §D, 2026-10-27. Each was an amendment O10 made at this document's drafting (MAWS branch `p5-o10-doc-3`, `c4911a6d4`, and its follow-up), or a difference sminos absorbs (said which); Interfaces §D' is the aligned shape:

- Observation (amended in O10): §D's `rpc` frame carried no `nonce`, and sminos cannot take an RPC without one: `receive` reads it first, `refuse_loose` keys a loose refusal by it and drops one whose nonce is not 16 bytes, `entry_of` keeps it, and `results` sends `rpc-result` by it. §D now nests DX6's Rpc under `rpc`, nonce included.
  Evidence: `sminos_rpc.py:566`, `662–669`, `341–349`, `1281–1296`.
- Observation (amended in O10): §D had `session?` beside `args`, while DX6 and sminos read `args.session`, and `shape` checks a decision's `digest.session` against `args["session"]`. §D now carries `args.session` and `args.digest` as DX6 has them, and sminos copies nothing.
  Evidence: `sminos_rpc.py:580`, `1427`.
- Observation (amended in O10): sminos refuses an RPC whose `machine` is not its own (`wrong-machine`); §D's frame had none. It now carries the welcome's name, and the check runs unchanged.
  Evidence: `sminos_rpc.py:575–576`.
- Observation (amended in O10): `rpc-result` and `rpc-ack` are keyed by `nonce` today; §D keyed them by `opId`. §D now has `rpc-result {project, opId, nonce, outcome}` and `rpc-ack {opId, nonce}`; sminos settles by the nonce as today and by `opId` when the nonce is unknown, and a loose refusal keeps its `opId`.
  Evidence: `sminos_rpc.py:686–693`, `1281–1296`.
- Observation (amended in O10): `hub.json`'s `former` is `{name: [session ids held under that name]}`, read by `is_self` to attribute a session to a former name; the endpoint never knew which sessions a name held. §D's `identity.former` is now names only; sminos keeps the map itself (`identity.json`, M5), capturing `sessions_under(old)` at a rename as enrollment does.
  Evidence: `sminos.py:6634–6654`, `6662–6670`; `sminos_hub.py:293–308`, `373–378`.
- Observation (amended in O10): the machine presence is not a separate frame: sminos sends `{t: 'session', message: {kind: 'machine', session: null, body: {online, policy, checkouts, desk}}}`. §D now names it so.
  Evidence: `sminos_hublog.py:348–361`.
- Observation (amended in O10): `raised`, `settled` and `delivery` bodies carry a DX1 `mac` today (`Requests.seal`, `outcomes.message`); on RL10 they go as drafts without one, which §D now says.
  Evidence: `sminos_requests.py:380–385`, `sminos_outcomes.py:363–374`.
- Observation (amended in O10; M7's definition): nothing in sminos is a lane A `launch` today. The mod's `generation` counts bridge children within a process, and the child's `nonce` names one hello; neither names the process holding the session. M7 defines the launch as the mod's per-process id, carried in presence as `launch` beside `bridge`; §D's `member.launch` and `context.launch` are that id, an opaque string the endpoint compares for equality, absent for a session without a bridge, whose lane A acts the endpoint refuses `unavailable`.
  Evidence: `bridge.tsx:1413–1415`, `sminos_bridge.py:166`, `bridge-state.tsx:234–254`.
- Observation (amended in O10): DX2's welcome lists `kinds`, and `read` and `op` messages go only to a hub that lists them; §D's welcome has `capabilities` and, now by its text, no kind filter. sminos sends every kind on RL10.
  Evidence: `sminos_uplink.py:1333–1337`.
- Observation (amended in O10): O10 M6 decided `words?` by verifying the event "against the head" and checking "the inbound index holds it at that position"; the inbound index holds arriving events only. An own `<name>/human` event (the operator path, RL §5.7) carries no `sig` on sminos's disk and is in no inbound index. O10 M6 now decides an own-writer event from its signature ledger when it holds the event (the same body hash at that position) and from the session's record alone when it does not (an unrelayed project, or an event that could not go up), so sminos asks after its tick's upload pass without waiting for the hub.
  Evidence: `sminos.py:4059`, `1727–1728` (the writer); `sminos_hublog.py:457–491` (no code stored locally), `462–463` (nothing uploads before `have`).
- Observation (amended in O10): §D had no frame by which a to-human message reaches the endpoint, while O10 M3 derived `notify wrote` "as O12's phase 2 reports it up RL10". §D now has the session-lane `host` kind, sent outside any subscription with its `(writer, seq)` id, and M3 derives `wrote` from it deduplicated by that id.
  Evidence: `sminos.py:4203–4215` (HOST_KINDS, exported from the transcript, written to the project log today); `sminos_plane.py:2823–2832` (`Plane.tick` pumps subscriptions alone, so a subscription-only producer reaches no unwatched session).
- Observation (amended in O10): `member.engineSessionId` was redundant for sminos: its `session` is the engine's session id, and the endpoint joins `appSessionId` to it through `engine.sessions` (O10 M6). §D's `member` now carries no other id than `session`.
  Evidence: `sminos_plane.py:2553–2565` (members keyed by the engine's session id).
- Observation (absorbed): the arriving `events` frame's shape changes from a list of coded events to `[{event, signer, owners?}]`, the signer now naming its `keyId`; `take` unwraps and stores `verified` (M5). An event this machine wrote, returned by the hub, carries `sig` and `attest` the local copy lacks, so `same_event` strips those as it strips `mac`; the endpoint lets such an event through only as an exact echo of what it signed at that position, which reads `present` here, and sminos needs no own-writer rule.
  Evidence: `sminos_hublog.py:527–560`, `141–151`, `161–196`.
- Observation (amended in O10): DX2's per-POST answer is what the uplink's at-least-once rests on (a settlement leaves its outbox, an `op` message leaves `rpcs-owed.json`, only once the POST was answered 200 and did not refuse it). §D now says: one ordered stream, a frame written is taken, and each `welcome` restates the session-lane state whole from sminos and the revocation set whole from the endpoint.
  Evidence: `sminos_uplink.py:1204–1226` (the `Link` docstring), `sminos_owed.py:1–18`.
- Observation (for P5 and O14): the hub keeps one generation counter per machine name across DX2 and RL1, so a sminos DX2 stream and an endpoint RL1 socket under one name replace each other (4409). M5's cutover is therefore once and for good, and a cut-over machine with its `mawsd` down is off the hub until `mawsd` runs; `sminos daemon status` says so. O14's brief must install phase 2's sminos on a machine before enrolling its endpoint there.
  Evidence: O10 Orientation ("one generation counter per machine name shared DX2/RL1"); `sminos_daemon.py:1157–1200` (the supervisor restarts on `hub.json` alone today).

The adversarial review of the phase 2 draft (`64cd6c5d8`), 2026-10-27, ten findings, each adopted (the Decision Log's entry):

- Observation (P1-1): an operator `send` is recorded as a `human` event and then pushed by `push_live` directly, with no verdict, on both send paths, and `SendDelivery` carries the writer's earlier owed events in the same push; the draft's words rule did not reach it.
  Evidence: `sminos.py:8366–8369` (the seat send), `8555–8569` (the seatless send), `8516–8534` (`SendDelivery`).
- Observation (P1-2): the delivery record is one settled prefix and one pending event per writer, and a member's devices share `hub/<member>`; settling a revoked seq 2 at once drops an owed valid seq 1, and raises `ValueError` when seq 1 is the pending one. The reviewer reproduced both.
  Evidence: `sminos.py:1956–2003` (`delivered_load`, `_next_check`, `delivered_settle`).
- Observation (P1-3): RL §5.2 requires every delivery, peer `say`s included, to check its signer against the current state, and a revoked key's past events to read as signed by a revoked key; the draft checked only words. O10 now sends `signer.keyId` and the whole revocation set at each welcome.
  Evidence: RL §5.2:287–291; O10 M6 on `p5-o10-doc-3`.
- Observation (P1-4): `flight` is a set, `dispatch` adds the op before the worker starts, the worker runs `plan` before it claims, and `Ledger.acked` returns at once for an op with no entry, so the draft's binding and reseal nonce had nowhere to live between dispatch and the claim.
  Evidence: `sminos_rpc.py:531–532`, `625–628`, `733–747`, `488–495`.
- Observation (P2-5): §D's frame carries no `target`, and O10 M7 authorizes a query against the executor's stored target; sminos derives it from the validated RPC.
  Evidence: O10 M7's query bullet.
- Observation (P2-6): `hub_projects` and `Link.tick` cover the org's hub projects alone, so git-mirrored and local projects had no deliverer for `human` events after cutover in the draft.
  Evidence: `sminos_uplink.py:1112–1127`, `1767–1787`.
- Observation (P2-7): host messages produced only inside a `Subscription` reach the endpoint only while one is open, and O10 M8 ends upstream subscriptions after the resume window; the notification for an unwatched session was lost in the draft.
  Evidence: `sminos_plane.py:2823–2832`.
- Observation (P2-8): "once" for the legacy-key handover must be one logical handover: an endpoint that dies before persisting `legacy.json` asks again.
  Evidence: O10 M6's dual-coding bullet; this document's reason for keeping `hub.json`.
- Observation (P2-9): `is_self(old, sid)` needs the sid in the old name's set, so adding a replaced name with no sessions loses attribution; enrollment's rename rule captures `sessions_under(old)` before replacing the identity.
  Evidence: `sminos.py:6662–6669`; `sminos_hub.py:373–378`.
- Observation (P2-10): M7 consumes M6's `member` frames and changes its `member.launch` builder, so it depends on M6; ticket 11's two fixes depend on nothing.
  Evidence: this document's M6 and M7.

The joint review's second round (`9be0bc941`), 2026-10-27, two P1s, both reproduced and adopted:

- Observation (round 2, P1): a git mirror can impersonate this machine's operator writer. `integrate` merges `origin/main` into the project log under `.sync.lock` with no protection of own-writer files, and `check_claim` checks only `machines/<name>.json`; the reviewer appended an unsigned `<thisname>/human` event to a scratch mirror, the merge accepted it, and `log_read` and `_owed` returned it as this machine's operator writer. M6 now gates own-writer events on a machine-private append receipt; the writer name is not provenance.
  Evidence: `sminos_daemon.py:369–383`, `269–289`; `sminos.py:1817–1866` (`_append`, the one appender).
- Observation (round 2, P1): sminos's events carry `ts` (`now(ms=True)`, ISO 8601 UTC with milliseconds) and no `created`, which `signEvent` requires. O10 now derives the signed `created` from `ts` in a deterministic upload form (verbatim with milliseconds, `.000` added to a whole-second `ts`, never the upload time; a different `created` refused `malformed`), used by its signing, ledger hash, resends, `words?` and echo check; sminos sends events as stored and strips `created` beside `sig`, `attest` and `mac` in `same_event`, and the receipt hash is over the stored body.
  Evidence: `sminos.py:1857`, `277–283`; no `created` in any log event (`grep '"created"' sminos.py` finds seat records alone).

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

- Decision: Phase 2's milestones, their order and their review. M7a (ticket 11's two debt fixes) first, on its own branch, transport-independent; then M5 (the RL10 client and the local-only switch); then M6 (members, words, the label) and M8 (to-human off the hub) on parallel branches from `main`; then M7 (lane A actions with remote context) from `main` after M6; then M9 (the mini, verification only). M5, M6 and M7 get doperpowers:reviewer-high at their PRs: M5 decides when a machine stops talking to the hub and what it takes as its identity and policy, M6 decides who may write a person's words, and M7 fences every remote action and binds it to its sender. M7a and M8 get doperpowers:reviewer-medium: two ledger paths, and a store beside the log with one more plane kind. M9 has no code. Each PR runs doperpowers' `sminos`, `sminos-suites`, `sminos-mods`, `mods-types` and `repo-checks` gates through `ci-gate`; MAWS's gates are not run, since phase 2 lands no MAWS code. The phase closes with a doperpowers:review-code high pass over its range.
  Rationale: M6 and M8 consume only M5's transport and its `verified` key; M7 consumes M6's `member` frames (it adds `launch` to them and proves their publication) and M7a's nonce-on-claim rule; M7a consumes nothing. The three rungs follow phase 1's rule that a milestone changing who may control or address a session gets the frontier reviewer. Rejected: one branch for all of phase 2, which would hold the debt items and the host store, each buildable today, behind O10 M6's fixture; and M7 beside M6 (the first draft), which would have M7 editing a frame builder M6 was writing at the same time.
  Date/Author: 2026-10-27, desk-sminos-orchestrator (p5-desk-track-owner); the dependency corrected at the adversarial review (P2-10).
- Decision: The RL10 client is `sminos daemon uplink` in a second mode, chosen at the child's start from `rl10.json` and `identity.json`, keeping `Link`'s handlers, `Here`, the plane, the requests and the RPCs behind a `Transport` (M5).
  Rationale: O10 chose DX2's vocabulary so sminos keeps its handlers and swaps the transport (its M6); one process keeps every delivery and every RPC of the machine on one path, which M6's words rule needs. Rejected (strongest): a `daemon endpoint` child beside the DX2 uplink, which would be two processes delivering into one session and two owners of the ledger.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: Cutover is once and for good: the first RL10 `welcome` writes `daemon/identity.json`, after which the supervisor runs the child in RL10 mode only and `hub.json`'s credential is never used again; with the endpoint down the machine waits and says so (M5). Undoing it is removing the file, which O14's brief owns (after `mawsd endpoint unenroll`, M7c's entry).
  Rationale: RL §9 ("each machine cuts over once"), RL §2.1 ("a machine never runs two uplinks under one name"), and the hub's one generation counter per machine name across DX2 and RL1, under which a DX2 reconnect would replace the endpoint's RL1 socket at every `mawsd` restart. Rejected (strongest): following the socket's presence and falling back to DX2 while `mawsd` is down, which is the generation fight above, and which would deliver DX1-coded words again on a machine that has accepted v2's trust model.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: The machine's identity is `identity.json`, read before `hub.json`; `former` keeps sminos's own map of names to the sessions held under them, with names from the welcome added; `hub.json` stays until O14's final brief removes it with the legacy key (M5).
  Rationale: `is_self` needs the sessions a former name held, which only sminos recorded; the endpoint's `former` can be names alone. Rejected (strongest): asking O10 to carry the map, which the endpoint never knew; and deleting `hub.json` at cutover, which would answer `legacy-key?` with nothing if the endpoint ever lost `legacy.json`.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: On RL10 a frame is taken when written: DX2's two lanes become one, and the continuations that waited for a POST's 200 run on write; every welcome resends the complete session-lane state (presence, the member set, each project's pending set, each session's last 50 host events), each project's hello and every unacknowledged `rpc-result` (M5). O10 adopted the same rule in its §D at `c4911a6d4`, with the revocation set restated whole from its side.
  Rationale: §D has no per-frame acknowledgement; the session lane stops at the endpoint, which re-snapshots its subscribers after its own restart, so a lost settlement costs a subscriber's view until then and nothing durable, and an endpoint crash forces a new connection and the full resend. Rejected (strongest): asking O10 for an acknowledgement frame before any loss has shown, which adds a round trip to every session-lane frame for a case M11 can measure.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: An arriving event's verdict is stored on its line under one key, `verified: {signer, owners}`, stripped where the exact event matters (`words?`, `same_event`); an arriving `event` that carries `verified` itself is refused `bad-shape` (M5).
  Rationale: the words rule and the label read the verdict at every delivery and every `chat`, and one key on the line is one rule for writers and readers; the refusal keeps a device from signing a verdict in. Rejected (strongest): a sidecar of verdicts keyed by (writer, seq), joined on every read, and lost or stale apart from its log.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: The endpoint's policy is authoritative on a cut-over machine: `policy` frames write `daemon/policy.json`, and `sminos daemon policy` sends `policy-set` and takes the endpoint's answer (M5).
  Rationale: one read-only on one machine; `deliver_next` and `admit` keep reading the file, so the DX2 path is untouched. Rejected (strongest): two policies, the endpoint's for remote actions and sminos's for delivery, under which `read-only on` could refuse an action and still deliver.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: `member` frames describe this machine's sessions in every project known here, relayed or not, with `lane` from the controller (else `B` for a `maws` origin, else `A`), `session` the engine's id and no other, `launch` from the presence, and defaults for a session whose record is not yet written, sent again once it is (M6).
  Rationale: the endpoint attests and lists this machine's sessions in the projects it relays, and needs every record on the machine to decide `words?` for a session in a project it does not relay (O10 M6, as aligned). Rejected (strongest): every member sminos knows from logs, which would have the endpoint listing other machines' sessions under this machine's signature; and open projects only (the first draft), which left the endpoint no record for an unrelayed project's session.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: On a cut-over machine, the words-gated `human` writers (`hub/<member>`, another machine's `<name>/human` that arrived with `verified`, and this machine's own `<name>/human` for events whose append receipt matches, in every project known here) are delivered by the uplink child alone, in two passes around `words?`; the daemon's tick and the CLI's fast path leave those writers owed and deliver the rest (git-arrived `human` events as unverified peers, `say`s as today, each checked against the revocation set); `revoked` marks their owed events at once; a legacy signer is a peer marked unverified (M6).
  Rationale: the question is answered on the socket one process holds, whose main thread cannot block in a handler; writers carry one kind each, so the split keeps every writer's order, and every project keeps a deliverer. Rejected (strongest): a second RL10 connection for `daemon run` and the CLI, which §D does not define and which would send the member set and the log plane twice.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: The operator path asks `words?` after the tick's upload pass and never waits for the hub: when the event went up on the same socket the endpoint answers from its signature ledger, and when it could not (an unrelayed project, RL1 down, no `have` yet) the endpoint answers from the record alone; the fast path never delivers an own `human` event on a cut-over machine (M6). O10 M6 carries both halves of that rule at `c4911a6d4` and its follow-up.
  Rationale: the own event has no signature on disk; ordering on one socket is the guarantee that costs nothing when the upload happens, and the owner's terminal `say` into a local session must not wait on the hub (RL §5.7's operator path). Rejected (strongest): sminos keeping a local "operator words" rule (`@machine` owners pass), which decides nothing for a session owned by a member id and reintroduces a second trust rule beside the endpoint's; and waiting for the upload before asking (the first draft), under which an own `say` stayed owed as long as RL1 was down.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: The label renders each owner by the email the receiving endpoint annotates from its head: `from <alias>, owned by <email>`, the id where the endpoint sent `email: null`; `(owners unverified)` for `[]`; `(unverified, legacy)` for a legacy signer (M6). Amended 2026-10-27 by P5 Decision Log 51, which replaced the id rendering first written here; O10 annotates at the receiving endpoint rather than signing emails into the attestation.
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

- Decision: The adversarial review of phase 2's draft (`64cd6c5d8`; ten findings, all adopted) and O10's alignment of §D to sminos's frames (`p5-o10-doc-3`, `c4911a6d4`, and its follow-up) are folded in, each where it binds:
  - (P1-1) both `send` paths and `SendDelivery` are under the words rule on a cut-over machine; `push_live` refuses to decide a log-backed `human` event there without a verdict (M6);
  - (P1-2) a revoked event is marked in the delivery record (`delivered_revoke`), never settled out of order; the prefix moves only through `delivered_settle` (M6);
  - (P1-3) the revocation set is persisted whole (`daemon/revoked.json`, M5) and applied by every deliverer to every delivery, peer `say`s included, matching by `keyId`, device and member; `chat` renders a revoked signer as such (M6). O10 sends `signer.keyId` and the set whole at each welcome;
  - (P1-4) the binding and the latest nonce live in the in-flight record from dispatch on, under `op_lock`, and move atomically into the claim or the refusal entry (M7);
  - (P2-5) `target` is derived from the validated RPC and never read from the frame (M5, M7); the digest mapping the draft asked for is withdrawn, since O10's `rpc` carries `args.digest` as DX6 does;
  - (P2-6) every project known here has a deliverer for `human` events: the uplink child for words-gated writers (own-writer events in unrelayed projects asked too, answered from the record alone), `daemon run`'s tick for git-arrived ones as unverified peers (M6);
  - (P2-7) the uplink sends a sub-less `host` message per to-human event with its `(writer, seq)` id, the last 50 again after a reconnect; O10 M3 derives `wrote` from those, deduplicated; `full` subscriptions carry host events in their own streams (M8);
  - (P2-8) the legacy-key handover is one logical, retryable handover (M5);
  - (P2-9) a welcome that renames the machine captures `sessions_under(old)` into `former[old]` before the atomic replace, by enrollment's rule; later welcomes refresh the identity's other fields and never shrink `former` (M5);
  - (P2-10) M7 depends on M6; ticket 11's two fixes are M7a, landing first on their own (Progress, the layout entry).
  - The alignment: the `rpc` frame is DX2's with DX6's Rpc nested under `rpc`, `machine` the welcome's name, so `on_rpc`, the `wrong-machine` check and `shape` run unchanged; `rpc-ack {opId, nonce}`; loose refusals keep their `opId`; `member` frames go for every session on this machine in every project known here, with no id but `session`; the endpoint refuses a launch-less member's act `unavailable` before anything goes down; `words?` for an own-writer event is asked after the tick's upload pass without waiting on the hub, and the endpoint answers from its signature ledger or, failing that, the record alone; a returned own event is let through only as an exact echo, which sminos's `same_event` already reads as `present`, so no own-writer import rule is added (M5, M6, M7, Interfaces §D').
  Rationale: each finding was a path to a person's words delivered without the verdict, a valid event dropped or a revoked one retried, an action's binding lost in a window, a to-human message with no deliverer or no notification, a rename losing its sessions, or a handover that could not recover; the alignment removes every frame conversion the first draft had to invent. Rejected (strongest): the first draft's shapes where they differed, named in each milestone's Decisions.
  Date/Author: 2026-10-27, desk-sminos-orchestrator (p5-desk-track-owner), from doperpowers:adversarial-reviewer's round on the phase 2 draft and O10's author's comparison.

- Decision: The joint review's second round (`9be0bc941`; two P1s, both reproduced, both adopted as ruled):
  - An own-writer `human` event is asked `words?` only when its machine-private append receipt matches: `projects/<id>/receipts/<writer>.jsonl`, one `{seq, hash}` per event, the hash over the stored canonical body, written by `_append` in the same append under the writer file's lock, outside `log/`, never mirrored or uploaded, kept under the writer name used so a rename keeps a former name's receipts. One with no matching receipt (a mirror's import under this machine's name, or an event appended before phase 2) is delivered as an unverified peer message, never asked, and logged; owed own-writer `human` events without a receipt at cutover go as peers (M6, Acceptance 5, §E).
  - sminos sends events as stored, `ts` and no `created`; O10's endpoint derives the signed `created` from `ts` in a deterministic upload form and uses it for signing, its ledger hash, resends, `words?` and the echo check; `same_event` strips `created` beside `sig`, `attest` and `mac`, the receipt hash is over the stored body, and the conformance replay pins a real sminos-produced event through upload, resend, echo and `words?` (M5, §D').
  Rationale: the first finding was a person's words forged by writer name through a transport the words gate never saw (the merge accepted an unsigned `<thisname>/human` event, and `log_read` and `_owed` returned it as this machine's); a receipt written by the one appender is provenance that no transport can supply. The second was an upload form the endpoint could not sign, settled by deriving it from what sminos already writes. Rejected (strongest): protecting own-writer files inside `integrate`, which covers one transport (git) and leaves the next, and a `log/` file dropped in by hand; and sminos adding `created` at upload, which would make the uploaded bytes differ from the stored line that `words?` and the echo compare.
  Date/Author: 2026-10-27, desk-sminos-orchestrator (p5-desk-track-owner), the rulings the orchestrator's.
- Decision: sminos cuts over only on a `welcome` with a complete identity (`org`, `name`, `ref`, `enrolled`); anything else leaves DX2 as it was (M5). Found by M5's executor while weighing O14's order: an endpoint runs on every machine whose MAWS is built from master once O10's M10 lands, enrolled or not, and a cutover is for good. O10 serves RL10 only when enrolled (its M6); this is the second check. M5's proves add a stand-in `welcome` without `org` and `ref`: no cutover, DX2 up.
  Date/Author: 2026-10-27, p5-desk-track-owner.

- Decision: Phase 2's execution layout. Each milestone is its own doperpowers branch and PR, merged with a merge commit once its review rung is clean and `ci-gate` is GREEN; the spec's living record is kept on one MAWS branch, `p5-o12-p2-record`, landed by the architect at checkpoints. M5 is cut from M7a's head (`p5-o12-m5` at `7400df00`) while M7a's review finishes, and merges `main` in once M7a lands, as M3 was cut from M1 in phase 1. M5 is built by two executors in sequence on that one branch, the transport and the switch first (discovery, the hello and welcome, `identity.json` and cutover, the supervisor, `daemon status`, the hub verbs, `revoked.json`, the policy and the legacy key, and the endpoint stand-in), then the uncoded log plane, the session lane's drafts and the RPCs over RL10; one doperpowers:reviewer-high review and one PR cover both.
  Rationale: M5 consumes nothing of M7a's but the ledger file it also edits, and is the phase's long pole; its breadth (a new transport, a new identity source and three planes) is more than one executor's context holds well.
  Date/Author: 2026-10-27, O12's phase 2 executor (p5-desk-track-owner).
- Decision: M7a's gaps, settled in building it.
  - `Rpcs.flight` is already a dict, `op -> {"nonce"}`, written by `dispatch` before the worker starts; `Rpcs.latest(rpc)` is its one reader, so M7 adds the binding's keys and changes no structure.
  - The worker's claim (`run`) and any refusal it keeps from inside `plan` are written under `op_lock` from the in-flight record's nonce, so a reseal either updates `flight` before the claim or finds the claim after it. `keep` requires its caller to hold `op_lock`. The lock order stays `op_lock` then the ledger's lock.
  - `Ledger.acked` on an entry without an outcome changes only its nonce; it no longer writes `acked: false` onto a claim.
  - `steered` hands a `lane-b` answer to `refused_op`, the one observer-refusal reader; `command()` keeps its live raise, with the same code and message.
  Rationale: the nonce-on-claim rule needs the claim and the record read under one lock, or a reseal landing between them is lost; the rest keeps M7a to the two debt items.
  Date/Author: 2026-10-27, M7a's executor, accepted by O12's phase 2 executor.

- Decision: sminos cuts over only on a `welcome` whose identity is complete (`org`, `hub`, `name`, `ref` and `enrolled` all present; `hub` added in building M5, since a cut-over `enrollment()` reads the hub's URL from the identity; Acceptance 4, M5 and §D' revised to match, 2026-10-27). Any other `welcome`, or a `refuse`, closes the socket: no `identity.json` is written, the DX2 uplink keeps running exactly as before, `daemon status` says an endpoint is present but not enrolled, and the RL10 side backs off and tries again. Before cutover a present `rl10.json` never stops a running DX2 uplink; only a complete welcome switches the machine (M5). Pinned with a stand-in welcome carrying no `org` and no `ref`: no cutover, and the DX2 uplink stays up.
  Rationale: once O2 and O10 M10 land, the owner's own MAWS runs `mawsd` with an unenrolled endpoint on the owner's machines; if that endpoint ever wrote `rl10.json` and welcomed, an auto-updated sminos would cut the real machine over, local-only and off the desk hub, long before O14. O10 is amended so the endpoint serves RL10 only once its enrollment is org-listed; this is sminos's defence in depth. Raised by the O12 executor's O14 note, ruled by the spec's owner.
  Date/Author: 2026-10-27, p5-desk-track-owner (ruling), built by O12's phase 2 executor in M5.

- Decision: M5's first half's gaps, settled in building it.
  - **The probe.** Before cutover, `daemon run`'s supervisor keeps the DX2 child exactly as before and, whenever `rl10.json` names an endpoint, runs a short-lived `sminos daemon probe` beside it: it dials, sends `hello`, and reads the welcome. Only a whole welcome writes `identity.json` (and exits 0); anything else (an incomplete identity, a wrong token, a `refuse`, a dial failure, a timeout) writes nothing. Probes back off 1 s to 60 s and start again from 1 s when `rl10.json`'s content changes. The supervisor sees `identity.json` within its 0.2 s pass, stops the DX2 child, and only then starts the RL10 child, so two uplinks never serve at once. Acceptance 4's first bullet therefore reads: the probe's hello and welcome first, then one RL10 child. Rejected: running the RL10 child beside DX2 until its welcome, which would serve RL10 frames while DX2 is live and contend for `uplink.lock`.
  - **A whole identity includes `hub`**, beside `org`, `name`, `ref` and `enrolled`, since a cut-over `enrollment()` takes the hub's URL from the identity. The RL10 child applies the same check at every later welcome and backs off on an incomplete one.
  - **Who says what.** An absent `rl10.json` is never said (every DX2 machine's state). A present but bad one is said once, by `daemon run` alone; the probe and the RL10 child check silently.
  - **The revocation set.** The first set after each welcome replaces `revoked.json` whole; later frames are merged and raise the version; an older version is ignored and said once. A present but unreadable file raises (fail-closed for M6) until the endpoint's next set replaces it.
  - **The policy mirror.** `policy.json` keeps the endpoint's last word under an additive `endpoint` key; a local change the endpoint has not answered goes up as `policy-set` and is never overwritten by a welcome's older policy.
  - **`legacy-key?`** is answered only after a welcome, on that connection, with a 32-byte base64url key; an ask for another org is logged and not answered (§D has no refusal frame).
  - **`hub check`** is refused on a cut-over machine with `enroll` and `leave`; `project init --hub` reads the identity.
  - **`rl10.json`'s `pid` and `build`** are passed through, not required.
  Rationale: each keeps the cutover once-and-for-good and the DX2 path untouched where the document was silent; the probe is how the owner's guard keeps a machine's DX2 uplink up beside an unenrolled endpoint.
  Date/Author: 2026-10-27, M5's first executor, accepted by O12's phase 2 executor.

- Decision: M5's second half's gaps and its review round, settled in building it.
  - **The own echo.** For this machine's writers (its name and every former name), `same_uncoded` strips `created`, `mac`, `sig` and `attest` from both the held and the arriving copy, so an own event once restored from an echo stays `present` when the echo returns; `verified` is stripped from both copies for every writer.
  - **Uploads strip `verified` alone**; a stored `mac` (a DX2-era restore, the `legacy/` archive writers) goes as stored.
  - **`verified.owners` is stored only when the endpoint sent it**, as a list of `{id, email}` objects kept as sent (P5 Decision Log 51 and 52); anything else under `owners` is `bad-shape`. A refused wrapper spends its event's position and is reported by the inner `{writer, seq}`.
  - **`malformed` stops an own writer's upload on RL10**, as `conflict` does on DX2.
  - **The entry's RL10 fields are gated on the mode**: `member`, `device`, `fingerprint`, `context`, `proof` and the derived `target` (which overwrites any `target` the frame carries) are kept only on RL10, so DX2 entries are unchanged. An RL10 RPC naming no project is refused loose `bad-shape`, logged only. `rpc-result`'s `opId` is null for a nonce-keyed op; `rpc-ack` falls back to `opId` only when the ledger holds no op under the nonce. A `query` or `tombstone` whose `opId` fails the shape guard is logged and not answered.
  - **A renaming welcome keeps one owner of the RPCs and the requests** (reviewer-high, round 1, P1, reproduced as one op run twice): `Rpcs` and `Requests` are renamed in place, re-addressing what they still owe under the new name, never replaced while their workers run.
  - **Settlements a DX2 uplink left owed go as drafts on RL10** (round 1, P2): `Requests.restore` with no key strips `mac` and takes the current name.
  - **Acceptance 4's "both modes"** is met by the RL10 sections of `test_rl10.py`, `test-uplink.sh` and `test-hub.sh` beside the DX2 suites run unchanged (`test_rpcs.py`, `test_session_plane.py`, `test_policy_requests.py`, `codes_parity.py`, the bridge suites); no RL10 section is added inside `test_rpcs.py` or `test_session_plane.py`.
  Rationale: each keeps the DX2 path byte-for-byte where the mode does not turn it, and the ledger's run-once and latest-nonce guarantees across a rename.
  Date/Author: 2026-10-27, M5's second executor and doperpowers:reviewer-high, accepted by O12's phase 2 executor.

- Decision: M6's first half's gaps, settled in building it (member frames, the append receipt, revocation marks, the label).
  - **The receipt** is written before the event inside the same locked append, so an event appended here always has one (a failed event write leaves a receipt no later body can match, the last line for a seq winning). Receipts are written on every machine, not only cut-over ones, so events appended between installing phase 2 and the cutover are still asked; nothing on DX2 reads them. The hash is SHA-256 over the stored event's canonical form (RFC 8785, as DX1's codes), without `verified`. Only `_append` writes receipts: an own event restored from an endpoint echo (`append_verbatim`) has none and goes as a peer.
  - **Revocation marks.** `delivered_revoke` records the `refused-revoked` outcome itself; the settled prefix passes marked seqs directly above it, in order, never past the pending event; an event whose push was already noted is not revoked (it was delivered before the revocation); `report_one` skips marked seqs, so a closed session never reports `recorded` after `refused-revoked`. `on_revoked` arms a mark pass that `tick` runs after `members()` reads the rows, for local members; closed sessions rely on each deliverer's check before its push.
  - **The label's precedence**: legacy, then an unreadable revocation set (`(owners unverified)`: nothing reads as owned, nothing claims a revocation it cannot see), then revoked, then owners. A `verified` with no `owners` (a device-signed `hub/<member>` event) gets no clause. In `chat` lines the clause follows the alias with no "from" added, so lines on a machine not cut over are byte-identical. An own-writer `human` event without a matching receipt reads `(unverified)` in `chat` only when its `ts` is later than the machine's cutover (`identity.json`'s `cutover`); earlier history renders as it did before phase 2, with no clause (the spec owner's ruling, 2026-10-27, revising this first half's rendering, which labelled all pre-phase-2 operator history). Delivery is unchanged: words still need a receipt, and an owed own-writer event without one still goes as a peer. The known limit: a mirror-forged event backdated before the cutover shows unlabelled in `chat`, yet never becomes words, since the receipt gates delivery; the label is display, not authority. Rejected: back-filling receipts at cutover, which would retroactively bless whatever a mirror had already planted.
  - **Member frames.** `title` is the title this machine published for the session; `known_projects()` is re-listed on the member cadence, not every tick; a session in two projects' rows is sent under the first by project id; the plane's rows are `Plane.member_rows` (a first name shadowed the `rows` frame handler, caught by CI).
  Rationale: each keeps the words gate's provenance and the delivery record's order where the document was silent, and leaves the DX2 path's output unchanged.
  Date/Author: 2026-10-27, M6's first executor, accepted by O12's phase 2 executor.

- Decision: M8's gaps and its review rounds, settled in building it.
  - **Where the store applies**: a cut-over machine, for every project whose kind is not `local` (the machine's own project and every hub project, whatever its org); a git-mirrored or local project keeps host events in its log. The cutover check runs first, so a machine not cut over pays one `lexists`.
  - **One copy across the cutover** (reviewer-medium, round 1, P1, reproduced as a copy in each store): `append_host` holds the writer's log-file locks while it decides the route, checks the log for the same `(kind, src)` and appends, the store's locks taken inside the log's (`_append` gained `held=`). An exporter that chose the log under the lock before `identity.json` existed has linearized its event before the cutover, which stays in the log as every older host event does; nothing chosen after the cutover enters the log, and no `(kind, src)` is in both stores.
  - **Bounded, ordered passes** (round 1, P2; round 2, P2): the sub-less pass queues entries of at most 256 KiB and nothing while the lane holds 4 MiB unsent, the cursor advancing entry by entry; each writer's events go in seq order, writers merged by time (`host_order`), so a clock stepped back never strands a seq behind the per-writer cursor; a welcome's resend (each session's last 50, the highest seqs per writer, plus everything unsent) waits in `host_owed` under the same bound. A single host event over 16 MiB would still close the lane, left as unrealistic.
  - **Shapes.** A snapshot's `host` entries are `{id, event}`, the shape of a `host` message body, so the endpoint dedups both by one rule; only a main subscription (`agentId` null) carries host events; sminos has no `cards` view, so "a cards-only subscriber sees none" is pinned on sminos's side as nothing but the sub-less message carrying an unsubscribed event. The sub-less pass reads every own-writer file in `host/`, former names and an asker's writer included, so a member that left still has its events sent.
  Rationale: each keeps a host event's single place and its delivery to the endpoint at least once, in order, whatever the clock or the backlog.
  Date/Author: 2026-10-27, M8's executor and doperpowers:reviewer-medium, accepted by O12's phase 2 executor.

- Decision: M6's second half's gaps, settled in building it (the words pass and every deliverer).
  - **`deliver_imports` asks through the tick that follows it**, which `serve_link` runs after every batch, so an own event's `words?` always follows its upload frame on the socket.
  - **Only the CLI nudges** for a words-gated writer (`say`'s fast path and both `send` paths); `daemon run`'s tick leaves the writer owed without nudging, which would spin its own loop. The uplink's words pass also sweeps every 10 s.
  - **Unverified and legacy peers go by whichever deliverer meets them** (`daemon run`'s tick, `say`'s fast path, the uplink's import delivery): the trust model is the same either way, and restricting them to `daemon run` would split one writer's order between deliverers. Words-gated events are the only ones withheld from those callers.
  - **Fail-closed covers events that carry `verified`**: with `revoked.json` unreadable such an event waits, neither pushed nor asked; an event with no `verified` names no signer and is delivered as usual.
  - **Checks per event, in order**: a noted push, then revocation (never delivered, whatever the policy), then read-only (an outside event on a read-only machine is settled `refused-read-only` without asking), then the words gate; `deliver_verdict` rechecks both.
  - **An unanswered ask is a failed attempt**, and after `DELIVERY_ATTEMPTS` the event is settled `failed` as a failed push is; with no endpoint connected nothing is asked and nothing counts, so the event stays owed. Ask ids are random per ask; an answer to an ask no longer held (expired and re-asked, dropped by a revocation, or from an earlier connection) is ignored.
  - **"`sminos chat` shows it undelivered"** reads as: `chat` lists the recorded event while the delivery record holds it owed; no owed marker is added to chat lines, which have never rendered delivery state.
  - **The seat `send`** on a cut-over machine records and pushes nothing, reusing the concurrent-delivery branch; a stopped seat is resumed by the uplink's verdict delivery. The printed line names the seat's or member's alias.
  - DX2's call shapes are kept: `words` is passed to `push_member` and `push_live` only with a verdict, and `gated` is added to `deliver_next`'s result only on a cut-over machine.
  Rationale: each keeps one deliverer per writer's order and the endpoint's verdict as the only route to words, while leaving the DX2 path's calls and results as they were.
  Date/Author: 2026-10-27, M6's second executor, accepted by O12's phase 2 executor.

- Decision: M6's review round (doperpowers:reviewer-high, round 1, three findings, each reproduced and fixed):
  - the revocation set is read before each event of a delivery batch, never cached across it, so a revocation persisted mid-batch stops the rest (P1);
  - every event a `send` bundles (`SendDelivery`, member and seat paths) is checked against the current set; a revoked one is marked without dropping its valid predecessors, and when an earlier event cannot be cleared (an unreadable set, or a refusal that could not be recorded) the whole send stays owed and prints `recorded <ref> for <alias>; it waits behind <ref>, …`, the daemon delivering in order once the set reads (P1);
  - send frames carry the label as chat frames do, keeping the message id `send --wait` needs; on a machine not cut over they stay byte-identical (P2).
  Rationale: RL §5.2's "every delivery checks its signer against the current state when it is delivered" holds per event, for every path that pushes. Rejected: dropping a revoked event's valid predecessors from a held send, which would split the writer's order.
  Date/Author: 2026-10-27, M6's second executor and doperpowers:reviewer-high, accepted by O12's phase 2 executor.

- Decision: M7's gaps, settled in building it.
  - **The launch rides presence as `launch` beside `bridge`, on RL10 only**, not under `bridge`: desk-hub refuses a presence whose `bridge` is not a boolean (`apps/desk-hub/src/objects/project.ts:580`), and DX2 presence stays byte-identical. The endpoint reads `member.launch`, so only O10's wording ("presence `bridge.launch`") changes. §F and M7 revised to match. The mod passes `--launch=<id>` joined to its flag, since a base64url id starts with `-` one time in 64 (M3's `rpc-query` lesson). The child strips `launch` before relaying a command to the mod, so the mod's vocabulary is unchanged.
  - **Every remote RPC on a bridgeless session is refused `context`**, not `steer` alone (§F's "a remote RPC without a bridge path"), checked right after the bridge probe, before "not running". Remote `resume`, `retire` and `stop` are refused `unsupported` at the top of `plan`, before anything is probed.
  - **The context check is admission's check 6**, after `shape`, kept in the ledger as `bad-shape`; RL10 only, a spawn exempt; a `launch` that is not a non-empty string is `bad-shape`.
  - **The binding and `op-conflict` are RL10's alone.** A DX2 in-flight record and entry are unchanged ("keep `member` alone, as today" reads as "unchanged": DX2 entries never held `member`). A stored entry without a binding field is never a conflict on that field. `query` and `tombstone` take the binding from the entry, else from the in-flight record before the claim; a tombstone answering `{ok: true}` carries none.
  - **An upload's opening `read status` is fenced too**, so an upload sealed for another launch saves nothing; a `launch` refusal of the media command removes its saved files, as `lane-b` does. On the decision route the fence runs before the lane-b check.
  - **The proof** travels as sorted, compact JSON (not `sminos_codes`, which the RL10 path stays off). A DX2 desk spawn with no `SMINOS_DESK_PROOF` gets `ownersProof: []` with no log line; the daemon logs a remote spawn without a `proof`, and the verb one that does not parse.
  - **`list --json` did not show `ownersProof`** (M7's touch list said it already did); it now does on this machine's rows in the private view, beside `principal`, and not in `--org`.
  - `Link.members` probes the bridge of every local member, so `member.launch` is right for sessions of projects not open on the stream.
  Rationale: each fences a remote action at its effect and binds it to its sender while leaving the DX2 path, the bridge's local callers and the hub's presence shape as they were. Reviewed clean by doperpowers:reviewer-high in one round.
  Date/Author: 2026-10-27, M7's executor, accepted by O12's phase 2 executor.

- Decision: M7b is added for RL10's three joint frames that O10 M6 found it needed (`spent`, `words?`'s `project`, `restated`), with the conformance replay that was waiting on M6's fixture; O10 carries them in §D and `conversation.json` on M6's PR, and sminos builds its side once M6 lands. Every spent position the endpoint reports is logged and counted in `daemon status` (the architect's addition).
  Rationale: each is a gap in RL10's contract found by building the endpoint against sminos's frames; one milestone keeps the frames and the replay that pins them together. The visibility rule keeps a forged or replayed hub event the endpoint rejected from vanishing without a trace on the machine.
  Date/Author: 2026-10-27, p5-desk-track-owner (the rulings, with the architect), recorded by O12's phase 2 executor.

- Decision: Phase 2's closing review (doperpowers:review-code, high rung, over `8f79b741..00f6bfd5`: M7a, M5, M8, M6 and M7) found two cross-milestone defects on a cut-over machine, each reproduced and fixed on one branch, `p5-o12-p2-fix` (sminos 1.25.1), the pass converging in its third round:
  - **Member records precede what depends on them.** The endpoint signs each upload as its frame arrives and attests it from the record it holds from `member` frames (O10 M6), so a newly joined session's events, and an upload after a record change, could be signed without or against a stale record, which the endpoint's signature ledger keeps. Members now go first in each tick and each welcome, and each drawn upload, host or `words?` frame first publishes its own sessions' current records (`members_before`, which also refreshes the plane's row); a frame whose member cannot be queued yet is undrawn (`HubLog.undraw`) and drawn again later, its cursor unmoved. The first fix's separate pre-scan left a race with the draw (round 2), so the prerequisites come from the drawn frame itself.
  - **Every batch on the socket lane is paced.** `words?` asks and the welcome's member replay (unbounded through `ownersProof`) are queued like M8's host pass, in entries of at most 256 KiB and nothing while the lane holds 4 MiB; an ask's deadline starts once it is queued, and the tick holds hellos, uploads, host messages and `words?` until the member set is queued. A single frame over 16 MiB still closes the lane, as on DX2 (residue: truncate a raised request's `input` at the daemon).
  Rationale: the attestation is permanent once signed, so order must be guaranteed by construction, not by timing; and a batch the lane refuses whole is a reconnect loop that starves every other producer. Rejected: refreshing every known project each tick, a log read per project per tick for what the drawn frame already names.
  Date/Author: 2026-10-27, the closing review's fixer and doperpowers:reviewer-high, accepted by O12's phase 2 executor.

- Decision: M7b's gaps and its review round, settled in building it.
  - **`spent` for another machine's writer** is recorded unconditionally in `uplink.json`'s spent positions, as `take` records its own refusals: the endpoint's verdict is final for positions this machine does not allocate. **For this machine's writers, under its current name or any former one,** it goes through `spend_own` under the writer file's lock and is a logged no-op at or below the writer's last seq (reviewer-high, round 1: a former name first took the unguarded branch, and a spent then tombstoned a real echo). The status count covers every spent position, the endpoint's and `take`'s alike, and prints only on a cut-over machine, so DX2's `daemon status` is byte-identical.
  - **`restated`** follows the members, the scan, each project's pending set, the rpc-results and the host resend, in the restatement's order.
  - **RL10's ceiling `"settings"`** ("no ceiling in the file") is read and written as such both ways, so a later change to the user's `defaultMode` holds on both sides; DX2 keeps `machine_policy()`.
  - **The replay.** The fixture is copied byte for byte; its source is a sibling note (`rl10-conversation.source.json`, MAWS `a7ceac66c`, blob `2d247bdcd`) whose blob the replay recomputes. Lines where the endpoint's suite plays a misbehaving sminos are probes, never played, and the replay checks sminos never sends them. Lines sminos cannot send as written are listed with their reasons in `rl10-conversation.amendments.json` and printed `amend`, a pass labelled "(amended for O10)" until O10 corrects its fixture (the spec owner's ruling); the follow-up refreshes the copy and makes `amend` fail. The hello vectors are asserted against the staged events, never masked (round 1). One real whole-second `_append` event runs the whole round trip: upload, byte-identical resend, echo, and `words?` answered `words` through the bridge (round 1). An unstaged `words?` is answered `refuse`; WORDS_WAIT is raised inside the replay only, its re-ask still pinned in `test_words.py`.
  - **The amendments O10 takes** (fixture issues, not sminos deviations, each confirmed by the reviewer against sminos's contracts): `member` frames carry the record's `principal`, `inference` and `controller`; a fixture cwd must be a binding; a project's vector names its members' `joined`/`titled` writers; a `to: "*"` say is owed to no one and never asked; the `raised` body is DX4's draft `{session, request, tool, input}`; a decision's digest must match its request; `proof:spawn` must be bound.
  Rationale: each keeps the endpoint's final word from tombstoning an event this machine allocated, and makes the replay a real check of what crosses RL10.
  Date/Author: 2026-10-27, M7b's executor and doperpowers:reviewer-high, accepted by O12's phase 2 executor; the `amend` ruling the spec owner's.

- Decision: M7b's follow-up replays O10's corrected fixture with nothing amended. O10 took M7b's fifteen amendments into `conversation.json` (MAWS `6d57a6160`, blob `aa6d90fe1`) and moved the host resend onto the reconnect, before `restated`, where sminos sends it; sminos's copy and its source note are refreshed, the amendment list, the amendments and the next-connection deferral are removed, an `amend` line fails, and the replay takes O10's executor's diff (object keys bound, the `repo`, `checkout:Q` and `configDir` bindings, case 8's and case 11's indices re-keyed). Landed as doperpowers PR #413 (`96085c8d`, sminos 1.26.2), reviewed clean by doperpowers:reviewer-medium.
  Rationale: the replay is O10's acceptance 5 checked from sminos's side; with the fixture written to sminos's real frames, any line it cannot send as written is a defect on one side or the other, and must fail.
  Date/Author: 2026-10-27, O12's phase 2 executor, on the spec owner's instruction.

- Decision: M7c, before M9: `bench_scale.py`'s RL10 mode, `sminos daemon owed`, and a test of the un-cutover branch, for O14's B2; M9's sminos floor becomes 1.26.0, not M8's version (1.23.0) (superseded: 1.27.0, the entry below); the cutover's undo is O14's order, `mawsd endpoint unenroll` and then `identity.json`.
  Rationale: O14's document (MAWS `60074ada2`) sets its floor at the frames O10's fixture plays (1.26.0, `spent`) and gates B2 on the bench's RL10 numbers and on nothing being owed, which `daemon status` does not show; it observed that removing `identity.json` while `rl10.json` is served re-cuts over within a second, so the undo's order is load-bearing and gets a test. P5 Decision Log 75 put this on O12's row as residue 17. B2 runs `daemon owed` on the mini, so the mini needs M7c's version for that step though the cutover's floor stays 1.26.0; events owed to a closed session do not make `daemon owed` fail, since they live in the log and a cutover cannot lose them, while a gate that never passed on a machine with an old closed seat would be ignored.
  Date/Author: 2026-10-27, O12's phase 2 executor, on the spec owner's instruction.

- Decision: The floor for a machine's cutover, in M9 and Acceptance 9, is 1.27.0 (M7c's version), superseding the 1.26.0 of the entry above; one number everywhere. Events owed to a closed session stay on `daemon owed`'s own count line, outside its exit status.
  Rationale: the cutover's own gate (O14's B2 step 4, B3 step 0) runs `sminos daemon owed`, which exists from 1.27.0, while the frames came at 1.26.0; the version a machine needs before it cuts over is the later one, a second number would give the briefs two values to check, and the mini updates to the newest anyway. A closed session's events sit in the log and are delivered when it resumes, whatever the transport; counting them would keep the gate shut on any machine with an old closed seat. O14 makes the same change in its spec; the architect takes the parent impact (P5 Decision Log 75 says 1.26.0).
  Date/Author: 2026-10-27, O12's phase 2 executor, on the spec owner's ruling.

- Decision: M7c's gaps and its review rounds, settled in building it.
  - **The upload kind had no state another process could read**, so the uplink keeps `taken` in `projects/<id>/uplink-taken.json`, on DX2 too (the mini is DX2 when B2 runs `daemon owed`). It is the uplink's resume state: set both ways at an opening `have`; raised by an answered upload or a periodic `have` within per-writer bounds a refusal or `resend` sets (an upload sent before the bound gives nothing, by epoch). Rejected: moving it only on `have`, which on DX2 comes about every 900 s. No frame changes.
  - **An own writer's `conflict` has no resolution in sminos** (a reconnect re-uploads it and is refused again; `spend_own` and `rejoin_former` do not reach it), so it is kept past the stream, shown as `refused` and counted toward exit 1, cleared only by the upstream's `present` echo of this machine's event.
  - **Every state file `daemon owed` reads tells absent from uninspectable**, the enrollment files included: one present but unreadable is named (no content) and exits 1. A failed `taken` write that would lower it removes the file (fail safe, an unlink needs no room); state transitions precede every such write, so a resend survives a full disk.
  - **The words kind counts every owed words-gated event, asked or not**: asks in flight live only in the uplink's memory. Members are read from the log, not `view_of`, which writes. An `outcomes` kind (outcomes.jsonl) is counted. The host kind follows the host pass's writer rule (former names included); the upload kind the uplink's (the current name, and `legacy/` while this machine writes the archive).
  - **The bench withholds every words verdict** (the worst case), cuts over by a probe before `daemon run` starts, times a pass through `SMINOS_WORDS_TIMES` (unset: nothing timed), and checks "a pass every 10 s" as the period plus 1 s, the pass running at the next tick after its 10 s; O14 rewords B2 to read the printed gap, bounded at 11 s (the spec owner's ruling). `words_due` splits the log by addressee once, halving the pass.
  - **The un-cutover held as written** in both orders; in (b) the supervisor runs a DX2 uplink from `hub.json` for about a second before the probe's welcome, which O14's order avoids.
  Rationale: `daemon owed` is the gate an attended cutover passes only when nothing in flight can be lost, so every doubt reads as owed; the uplink's own resume state is the most it can honestly claim.
  Date/Author: 2026-10-27, M7c's executor and doperpowers:reviewer-high, accepted by O12's phase 2 executor; the gap's bound and the floor the spec owner's.

## Outcomes & Retrospective

Phase 2's code milestones, 2026-10-27 (interim; the phase closes with M7b and M9).

- **What landed.** M7a (#404, 1.20.0), M5 (#405, 1.21.0), M8 (#406, 1.23.0), M6 (#407, 1.24.0), M7 (#408, 1.25.0), and the closing review's fixes (#409, `09e85c00`, 1.25.1), all on doperpowers main. A machine without a complete RL10 welcome runs exactly as before; the owner's Macs, auto-updated through each, were never cut over.
- **Review.** Every milestone met its rung; eight findings across the milestone rounds (M5 two, M8 three, M6 three) and four in the closing pass, every one reproduced before it was fixed and pinned by a regression test. The milestone reviews caught each milestone's own defects (a rename double-running an op, revocation bypasses, a cutover race, unbounded and misordered batches); the closing pass caught what none of them could see alone: that member records must reach the endpoint before the uploads it signs from them, and that every producer on the one socket lane must be paced. Both are properties of the lane as a whole, which no single milestone owned.
- **What changed in the design while building.** The owner's guard (cut over only on a complete identity, DX2 kept up beside a probe until then), `hub` added to the identity, the chat label's `(unverified)` limited to events after the cutover, the launch carried beside `bridge` rather than under it, and M7b for RL10's three joint frames.
- **M7b** landed later the same day (#410, `20790342`, 1.26.0), its replay passing every line of O10's fixture, 15 first played as amendments for O10 and, once O10 corrected its fixture, none (#413, `96085c8d`, 1.26.2).
- **M7c** (#419, `e5403891`, 1.27.0, the cutover's floor) gives O14's B2 what it reads from sminos: `sminos daemon owed`, `bench_scale.py run --rl10` and the un-cutover pinned in both orders. B2 step 2's command, as written, on the MacBook (10 cores, shared, load 17–50), the stand-in withholding every words verdict (24 owed, re-asked each pass): uplink 3.3 % of a core (DX2 at the same scale 1.9 %), `daemon run` 2.0 %, words pass p95 0.051 / 0.059 s (0.061 s at the final code), longest gap 10.11–10.29 s, 200 imported events in 0.1 s; PASS each run. The RL10 uplink's excess over DX2 is the member set's plane reads, not the words pass: M9 measures it at the mini's scale. Review: three rounds of doperpowers:reviewer-high, nine findings fixed, one bounded P2 logged as T3 debt.
- **Open.** M9 (the mini, after O14; it measures the words pass's cost first), M4 and O8's record actions (blocked). Residue: truncating a raised request's `input` at the daemon (one frame over 16 MiB closes the lane), and the order-dependent "v2 desc became brief" (`convert_v2_nodes` walks the v2 groups with an unsorted `glob`, so a session seeded in two groups is decided by directory order; `sorted(...)` fixes it).
