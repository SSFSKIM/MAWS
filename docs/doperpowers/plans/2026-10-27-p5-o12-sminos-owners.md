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
- [ ] M2 — The opId ledger (item 4)
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
   - A session whose log predates this change reads back as `owners: ["@machine"]`. A later `joined` without owners, written by an older daemon, doesn't erase them.
   - No `principal` or `inference` field appears in any log event.
2. **The ledger.**
   - `query` answers by state: `done` for an op whose outcome is done, `refused` for one refused at admission, `in-progress` for a claimed or in-flight op, and `not-received` for an unknown id.
   - After a tombstone, a late arrival of that id is refused `tombstoned` and never runs.
   - A DX6 RPC with no `opId` is keyed by its nonce, as today. Every existing ledger, spawn, reconcile and MW5 upload test passes unchanged.
3. **The observer.** With MAWS's marker set and a non-interactive session start:
   - the bridge's `capabilities.controls` reports every key `{available: false, reason: "MAWS controls this session"}`, and `ops` is empty;
   - each control op (steer, interrupt, stop, model, compact, deliver, answer, command, btw, stop-agent, tell, media) sent through the child is refused `lane-b`;
   - `sminos decide` and `sminos answer` against it are refused `lane-b` at the child's decision route;
   - no permission request is raised to the desk;
   - `turn.step` claims no media and rewrites no model or effort, while main-loop and subagent chunks still post;
   - the same session without the marker, or interactive with it, behaves exactly as today.

## Constraints that bind every milestone

- **RL6 is the record's contract.** The shape is in Interfaces. P5's O12 text says `credential {slot, kind, principal}`, but RL6, revised after it with the owner's co-owner ruling (RL Decision Log, 2026-10-26), splits that into `principal` and `inference`, and RL6 binds. This is recorded as residue in this document's Decision Log.
- **What stays on the machine.** `principal` and `inference` never leave it: they appear in no log event, no hub frame and no `--org` output. `owners`, `ownersProof` and `origin` are listing material and may ride on `joined` (RL §6.2).
- **Older readers and writers coexist.** The long-running daemon keeps running old code until it restarts, and older sminos versions on other machines read the same logs. Every field is additive. Owners are read the way `by` is read today: from the first `joined` along the lineage that carries them, never from the latest one. A later event without them never erases them.
- **No secret in a record.** `inference.settingsRef` names a file path, never inline settings content. Gateway settings carry environment, which may hold tokens. Inline `--settings` JSON is referenced by the merged launch file sminos already writes (`$SMINOS_HOME/settings/<sha16>.json`).
- **Tests run against isolated homes.** Every test sets `HOME` and `SMINOS_HOME` to temporary directories. Running a working-copy sminos against the real `~/.claude/sminos` performs a one-way import and is forbidden. The suites are `sminos/tests/run-sminos-tests.sh` (parts `core` and `suites`), `sminos/tests/test_rpcs.py`, `sminos/tests/mods/run.sh` and `tests/mods/typecheck.sh`. Verify on CI with `ci-gate` in each repository.
- **Every change bumps the sminos plugin's version** in the same commit, with `scripts/bump-version.sh --plugin sminos`. The marketplace updates by number alone.
- **Plugin documentation follows the code.** `sminos/hooks/mods/CLAUDE.md` (the bridge paragraph) and `sminos/skills/sminos/scripts/CLAUDE.md` describe the record, the ledger's `query` and the observer mode once they exist.

## Plan of Work

### M1 — The session record

**What exists at its end.** Every session sminos joins has a machine-local record, `$SMINOS_HOME/session-records/<session>.json` (mode 0600, written atomically with `_write_record`'s rule). It holds the RL6 fields this phase fills: `owners`, `ownersProof`, `origin`, `principal`, `inference`, `lane` and `created`. It is written once, by the first writer that knows the session, and copied, never re-derived, on every later join of the same session or its continuation. `owners` and `origin` also ride on each new `joined` event. `sminos list --json` shows `owners` and `origin` for every member, and `principal` and `inference` for local members.

**What it touches.** `sminos/skills/sminos/scripts/sminos.py`:
- `joined_fields` and `lifecycle`, and every `joined` writer: `join_on_sight`, `join_seat`, `refresh_joined`, `spawn_fresh`, `move_session` and `hand_off`;
- `record_session` (the hook path), `_projection`, `_member`, `Member`, `member_json` and `vacant_member`.

`sminos/skills/sminos/scripts/sminos_rpc.py`: `spawn` passes the requester. Tests in `sminos/tests/run-sminos-tests.sh` (core) and a new `sminos/tests/test_records.py`.

**Interfaces.** Exposes the record (Interfaces §A) and its reader `session_record(sid)` to M3 and Phase 2. RL10's endpoint reads it in O10.

**Decisions.**
- **Who writes first, and what.**
  - **The hook path** (`record_session`, inside the session's own environment) writes `origin.kind`:
    - `maws` when `SMNS_MEMBER` marks a MAWS engine (today's `member_mark` rule), with `lane: 'B'`;
    - otherwise `terminal`, with `lane: 'A'`.

    It writes `inference: {kind: 'slot', configDir}` from `CLAUDE_CONFIG_DIR`, else the default `~/.claude`.
  - **`spawn_fresh`** writes the child's record before `claude --bg` runs. It copies `owners`, `ownersProof`, `principal` and `inference` from the caller's record when the caller is a session (`CLAUDE_CODE_SESSION_ID`), and sets `origin: {kind: 'sminos-spawn', spawnerSession}`. A seat with non-empty `settings` gets `inference: {kind: 'route', settingsRef: <the merged launch file's path>}` instead of the parent's.
  - **A desk-RPC spawn** (`sminos_rpc.spawn`, `SMINOS_DESK_MEMBER` set) writes `owners: [<member>]`, `principal: <member>` and `origin: {kind: 'maws', requester: <member>}`. It is the predecessor of a MAWS remote spawn on a lane-A machine (RL §3.4).
  - **Daemon reconciliation** (`join_on_sight` without the session's environment) writes the defaults: `origin.kind: 'terminal'`, the default slot, `owners: ["@machine"]` and `principal: "@machine"`.
- **`@machine` stands for "this machine's owners".** Nothing on a machine knows its owner's member id today: `hub.json`, `org.json` and the hub's `welcome` carry none. A machine's owners are decided by the org state (RL5's `machines[].owners`), which arrives with O10 and O11. So the record stores the token `@machine` where RL §5.8's default applies, and RL10's endpoint resolves it against the state when it attests or lists (O10). `@machine` can't collide with a member id, which is 32 hex digits. Rejected: the hub returning the enrolling member at redemption. That means a hub change and a re-enrollment for a value the org of one never needs, and the state supersedes it at O14's re-enrollment anyway. This is an RL6 extension, recorded as residue.
- **The readback rule.** `_projection` and `_member` take `owners` and `origin` from the first `joined` along the lineage that carries them, as `by` is taken today. The record file, when present locally, wins over the log. A member with neither reads `owners: ["@machine"]`, `origin: {kind: 'terminal'}`.
- **Continuations and moves.** `hand_off` copies the old session's record to the new id, adding the old id to `former`. A move to another project (`move_session`, `by="move"`) leaves the record as it is.
- **`by` is not reused.** It keeps mixing aliases, member ids and `move`, and it means "who wrote this event", not "whose session".

**Not touched.** RL6's `access`, `shares` and `context` (written by `manage` actions from O8 and O10; absent means `listed` and `[]`). The hub. The bridge. Any signing (O10).

**Proves.** Acceptance 1. Tests also pin:
- a seat spawned from a seat copies the grandparent's owners;
- a `joined` written by an older binary (no owners) after a new one doesn't change what `list` shows;
- inline `--settings` JSON never appears in the record;
- the record survives the daemon's restart and a `/reload-plugins`.

### M2 — The opId ledger

**What exists at its end.** The daemon's RPC ledger (`sminos_rpc.py`'s `Ledger`) is keyed by an operation id: the RPC's `opId` when present, else its nonce, so every DX6 RPC is keyed exactly as today. `Ledger.query(opId)` answers `done | in-progress | refused | not-received`. `Ledger.tombstone(opId)` records a `not-received` verdict, so a late copy is refused `tombstoned`. A `sminos rpc-query <opId>` verb prints the answer for local diagnosis; RL10 carries the same call in Phase 2.

**What it touches.** `sminos/skills/sminos/scripts/sminos_rpc.py` (`receive`, `Ledger`, `run`, `media`, `spawn`'s stamp and `alias_for`), `sminos_media.py` (only through the id it is handed) and `sminos.py` (the verb). Tests in `sminos/tests/test_rpcs.py`.

**Interfaces.** Exposes `Ledger.query` and `Ledger.tombstone` (Interfaces §B) to Phase 2's RL10 handler.

**Decisions.**
- **One key, derived once.** `receive` derives `op = rpc.get("opId") or rpc["nonce"]` and uses it everywhere the nonce is used as an identifier today (the map in the record of this document's authoring):
  - the ledger and `flight`;
  - the bridge command's `rpc` field;
  - `alias_for`;
  - the `rpc_nonce` stamp;
  - MW5's upload id, and with it the media file names.

  `rpc-result` and `rpc-ack` toward the DX2/DX6 hub stay keyed by `nonce`, which the entry keeps when it differs.
- **Shape guard.** An `opId` must match `^[A-Za-z0-9_-]{16,128}$` before it becomes a file name or an alias seed. Otherwise it is refused loose with `bad-op-id`. MW5's mod accepts `^[A-Za-z0-9_-]{1,128}$`, and every opId passing this guard passes that.
- **What `query` answers.**
  - `done {outcome}`: the entry has an outcome other than a refusal at admission.
  - `refused {outcome}`: the entry's outcome is an admission refusal.
  - `in-progress`: a claim without an outcome, or the op is in `flight`.
  - `not-received`: no entry. That includes a loose refusal from checks 1–2, which never enters the ledger (RL4's "only `not-received` shows *not sent, send again*" is safe here: a loose refusal ran nothing).
- **Tombstones** are ledger entries `{tomb: true, at}`, kept for `KEPT_S` like any entry. A tombstoned id arriving later is refused `tombstoned` at check 3, and nothing runs.
- **Fail-closed stays.** `query` on an unreadable ledger answers `failed`, never `not-received`.

**Not touched.** The RL10 transport (Phase 2). The hub's DX6 shapes.

**Proves.** Acceptance 2.

### M3 — The lane B observer: marker and refusals

**What exists at its end.** MAWS's engine host sets `MAWS_LANE=B` on every `claude -p` child it launches. The bridge mod decides once, at `bridgeStart`, that it is an observer when the marker is `B` and the session start is non-interactive. It keeps the verdict in `$.state`, so a module reload keeps it. In observer mode:
- every control op is refused `lane-b`, and every `capabilities.controls` key is `{available: false, reason: "MAWS controls this session"}`;
- `ops` is empty;
- no permission request or question is raised to the desk;
- `turn.step` neither claims media nor rewrites model or effort;
- chunk and step posting (the subagent deltas) continues;
- the bridge child refuses its decision route, `POST /requests/<id>/decision`, with `409 lane-b`.

`sminos spawn` from inside a marked session drops the marker from the child's environment.

**What it touches.**
- MAWS: `src/engine-host/launch.ts` (`buildEnvironment`) and its test. This lands first, by PR to MAWS master.
- doperpowers:
  - `sminos/hooks/mods/bridge.tsx` (`bridgeStart`, `commandAnswer`, the request raises, `turn.step`);
  - `bridge-controls.tsx` (`controlsOf`);
  - `bridge-state.tsx` (the verdict);
  - `sminos/skills/sminos/scripts/sminos_bridge.py` (the decision route);
  - `sminos.py` (`launch_env` drops `MAWS_LANE`).
- Tests: `sminos/tests/mods/bridge.test.ts` (whose `session.start` fixture gains a non-interactive option), `sminos/tests/test-bridge-control.sh` and `test-bridge-requests.sh`.

**Interfaces.** Consumes the marker (Interfaces §C). Exposes the observer verdict to M4.

**Decisions.**
- **The marker is explicit.** `SMNS_MEMBER` means membership, not lane. Its parent-pid rule breaks once session hosts sit between the engine host and `claude` (RL §2.1), and the mod can't read a parent pid at all. `MAWS_NATIVE_TO_HUMAN` is conditional. A nested `claude -p` that inherits `MAWS_LANE` only makes that process refuse control, which is the safe direction. Rejected: inferring lane B from `CLAUDE_CODE_ENTRYPOINT=sdk-ts`, which every SDK client sets.
- **Refusal is total.** The bridge already runs as a full controller in every lane B session, and two controllers on one session is the failure this mode removes.
  - `deliver` refused in observer mode falls back, as today, to the inbox frame, so a person's words sent through sminos to a lane B session arrive as a peer message. MAWS owns that session's input.
  - The desk's Resume of an ended lane B session would relaunch it as lane A (`sminos_rpc.py`'s resume, `claude --bg --resume`). Resume refuses `lane-b` when the session's record says `lane: 'B'` (M1). Reopening a lane B session is MAWS's.
- **Raises stay off.** MAWS answers permission and dialog requests through `--permission-prompt-tool stdio`. A desk card would be one it can't answer.

**Not touched.** The reaping gate (M4). Where subagent deltas go in lane B: they keep going to the bridge child, and O16 decides whether the engine host takes them from the child or over OX10. The engine host (O16).

**Proves.** Acceptance 3. Tests also pin:
- a module reload keeps the verdict;
- an interactive session with the marker stays a controller (a person ran `claude` in a shell that inherited it);
- a `sminos spawn` child of a marked session doesn't carry the marker.

### M4 — The reaping gate (blocked)

**Blocked by** U6, the measurement in O3 of whether `turn.step` holds cron-fired and task-notification turns in a `-p` process (RL §12.2), and by OX10's agreement with O16's author. This is the protocol O12 proposes for the agreement:
- **The address.** The engine host sets `MAWS_HOLDER_SOCKET=<path>` (0600, same uid) beside `MAWS_LANE=B`. The observer connects at `bridgeStart`, sends `hello {protocol: 1, session, pid}`, and sends `hb` every 5 s.
- **The fence.** The host sends `arm {fence}` and `disarm {fence}`. It arms only while the observer's heartbeat is fresh, since the `turn.step` gate fails open when the hook chain fails (holder design §3.2).
- **A turn while armed.** The observer's main-loop `turn.step`, before calling `next`, sends `turn {fence, origin: 'query' | 'cron' | 'task' | 'unknown'}` and waits for one of two answers:
  - `proceed`: the reap was cancelled, and it calls `next`;
  - `stop`: the session is ending. It doesn't call `next`, and streams one text chunk: "The holder ended this session; reopening it continues the conversation."
- **No answer.** With no answer within 10 s, it calls `next` and logs it. A turn is never lost to a dead host.

M4's milestone text is completed when OX10 is agreed and U6 is measured. Its acceptance is the holder design's §9 item 6: the reap-fence race, with turns from every origin.

## Concrete Steps

doperpowers, from a worktree of `SSFSKIM/doperpowers` cut from `origin/main`:

    SMINOS_PART=core bash sminos/tests/run-sminos-tests.sh      # the `sminos` gate; ends "all passed"
    SMINOS_PART=suites bash sminos/tests/run-sminos-tests.sh    # the `sminos-suites` gate
    python3 -B -I sminos/tests/test_rpcs.py                     # ledger, spawn, reconcile, MW5 uploads
    python3 -B -I sminos/tests/test_records.py                  # M1's record tests
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

`$SMINOS_HOME/session-records/<session>.json`, mode 0600:

```json
{
  "session": "<uuid>",
  "lane": "A" | "B",
  "origin": { "kind": "terminal" | "maws" | "sminos-spawn", "requester": "<member>"?, "spawnerSession": "<uuid>"? },
  "owners": ["@machine" | "<member id>", "..."],
  "ownersProof": [],
  "principal": "@machine" | "org" | "<member id>",
  "inference": { "kind": "slot", "configDir": "<path>" } | { "kind": "route", "settingsRef": "<path>" },
  "created": "<ISO 8601>",
  "former": ["<uuid>", "..."]
}
```

- `owners` has at least one entry. `ownersProof` stays `[]` until O10 signs spawn and `manage` actions.
- `joined` events gain `owners` and `origin`, with the same shapes. `list --json` adds `owners` and `origin` for every member, and `principal` and `inference` for local ones.
- Reader: `session_record(sid) -> dict | None` in `sminos.py`.

### B. The ledger (M2)

```python
Ledger.query(op: str) -> dict   # {"state": "done"|"refused", "outcome": ...} | {"state": "in-progress"}
                                # | {"state": "not-received"} | {"state": "failed"}  (unreadable ledger)
Ledger.tombstone(op: str) -> bool   # False when an entry already exists (then query answers it)
```

CLI: `sminos rpc-query <opId>` prints the query's JSON. It is for diagnosis; Phase 2's RL10 carries the same call.

### C. The lane B marker (M3) and OX10 (M4, proposed)

- `MAWS_LANE=B` in the environment of every `claude -p` child of MAWS's engine host (`src/engine-host/launch.ts`, `buildEnvironment`).
- M4's `MAWS_HOLDER_SOCKET` and its messages are as proposed above, pending agreement.

## Surprises & Discoveries

- Observation: the bridge already runs as a full controller in every MAWS lane B session today. The desk and `sminos steer` can drive a session MAWS is driving.
  Evidence: MAWS's engine host loads plugins from `enabledPlugins` with no `--plugin-dir` (`src/engine-host/session-start-hooks.ts` header), and `bridge.tsx` has no lane check.
- Observation: nothing on a machine knows its owner's member id.
  Evidence: `hub.json` is `{hub, org, machine, client_id, client_secret, key, former, enrolled}` (`sminos_hub.py`). The hub's `welcome` is `{org, machine, generation, heartbeat_ms, kinds}`.

## Decision Log

- Decision: Verification and review for this child. The document gets doperpowers:adversarial-reviewer's buildability review before it executes (P5 Decision Log 12). M1 and M2 each get doperpowers:reviewer-medium at their PR. M3 gets doperpowers:reviewer-high, because it changes who may control a session. Phase 1 closes with a doperpowers:review-code high pass over its range in doperpowers.
  Rationale: M3 removes a control path from every MAWS session, and a mistake there is either two controllers or a dead session.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.
- Decision: The record follows RL6's `principal` + `inference` split, not P5's O12 text `credential {slot, kind, principal}`.
  Rationale: RL6 was revised after O12's text, with the owner's co-owner ruling (account-managed inference later), and RL is binding.
  Date/Author: 2026-10-27, desk-sminos-orchestrator (residue for P5's Decision Log under O12).
- Decision: `@machine` as an owner and principal token, meaning "this machine's owners per the org state", resolved by RL10's endpoint.
  Rationale: no member id for the machine owner exists on a machine before the org state does. Rejected: having the hub return the enrolling member at redemption, which would need a hub change and a re-enrollment for a value O14's re-enrollment supersedes.
  Date/Author: 2026-10-27, desk-sminos-orchestrator (residue for P5's Decision Log under O12, and an RL6 extension to confirm with remote-architecture).
- Decision: The lane B marker is a new environment variable, `MAWS_LANE=B`, set by MAWS's engine host.
  Rationale: no existing variable marks the lane reliably (see M3). Rejected: `SMNS_MEMBER`'s parent-pid rule, which breaks under session hosts and which the mod can't read.
  Date/Author: 2026-10-27, desk-sminos-orchestrator (residue for P5's Decision Log under O12).
- Decision: Phase 2's milestones (items 2, 3, 5, 6, 8) are written when O10 fixes RL10's interface.
  Rationale: they bind against RL10's names, and writing them first would transcribe a guess.
  Date/Author: 2026-10-27, desk-sminos-orchestrator.

## Outcomes & Retrospective

Pending — written at finish.
