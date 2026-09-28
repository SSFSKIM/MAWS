# C4 — Filesystem state, index and replay

Child of the composite spec `docs/charter.md`, child id **C4**, parent pin `87f8c7881119ea670901205dae35917d3751459c` (the charter blob carrying C2's pass-2 findings, D-19, and C1's residue decisions after its review fix wave). Design lives in the charter: the C4 section in §12, §4.3 (filesystem state service), §4.4 (index scope), §4.5 (git service), contracts X1, X6 and X8 in §13, the binding grades in §11, and the Decision Log entries of §19 that amended the cut (append-only JSONL with branch anchors; holders and `--bg` behaviour; workflow disk layout). This document carries the constraints, the interfaces C4 adds for C5, C6, C8 and C10 to code against, the milestones with their gates, and the record. It codes against the X1 and X2 definitions in `docs/doperpowers/plans/2026-09-28-c1-foundations.md` (Interfaces), the interim canonical source until C1's code lands, and adopts the names its wave-2 siblings had already claimed when it was written (`2026-09-28-c3-engine-host.md`, `2026-09-28-c5-shell.md`, `2026-09-28-c6-transcript.md`; the "Cross-child reconciliation" section lists each).

## Purpose

After C4, MAWS knows everything Claude Code already wrote to disk, without Claude Code having to be asked. Open the app and, within a couple of seconds, every session the owner ever ran from a terminal is listed under its project directory with its title, the directory it ran in, and whether some other process is holding it right now (a terminal, or a `claude --bg` job). Start `claude` in a terminal and the row turns foreign-live within two seconds; quit it and the row goes idle. Open any such session and its transcript is rebuilt from the engine's own JSONL, following the leaf's parent chain so that a `/rewind` typed in the terminal shrinks the transcript in MAWS while it is being watched, and a subagent's own transcript file resolves to child events attributed to their parent tool call. The app's own state that the engine does not hold, session records, titles with provenance, pins, archive flags, project membership, attention items, composer drafts, replay fixtures, lives in one SQLite file and survives restarts. Any probe fixture or any JSONL transcript can be replayed into the same event graph at 0.25× to 50× speed or instantly, which is how the transcript (C6), the shell (C5) and the panels (C8) are built and tested before and beside a live engine. And a read-only git service answers status, branch, diff and log for a session's directory, telling the toolbar within a second when a file in the worktree changed.

What C4 does not do: it never writes into `~/.claude` (the engine's store is read-only to MAWS, D-12 and §4.3), never launches or talks to an engine process (C3), never renders a transcript (C6) or a sidebar (C5), never creates or removes worktrees (C10), and never stages or commits (P1).

## Progress

- [ ] M1 — Store shapes, chain follower and transcript-to-X1 backfill against fixtures
- [ ] M2 — Filesystem state service, part one: watcher, discovery, sidecars, holders
- [ ] M3 — Filesystem state service, part two: tailers, following, subagents, workflows, tasks, spills
- [ ] M4 — The index in main: `node:sqlite`, stores, the `SessionSource`, projects and drafts
- [ ] M5 — Replay engine: clock, journal and transcript sources, `session.replay.*`
- [ ] M6 — Read-only git service: `git.*` and the repository watcher
- [ ] M7 — Acceptance against the owner's `~/.claude`, hardening, review

## Terms

Terms C1 defined (main process, renderer, preload, utility process, command, event, frame, journal, transcript record, event graph, token, N-API, asar) keep their C1 meaning. New here:

- **Config home**: the directory Claude Code keeps its state in, `$CLAUDE_CONFIG_DIR` if set, otherwise `~/.claude`, NFC-normalised (SPEC 35.1.1). Written `<configHome>` below. On the owner's Mac it is `/Users/new/.claude`.
- **Store**: the engine's on-disk state under the config home that C4 reads: `projects/`, `sessions/`, `jobs/`, `tasks/`. Everything else under the config home (settings, agents, skills, plugins, commands, daemon, teams, history) is out of C4's scope; C11 reads settings and palette files through the engine's control reads or its own commands.
- **Slug**: the directory name under `projects/` for a working directory: every character outside `[A-Za-z0-9]` of the realpath replaced by `-`, cut at 200 characters with a base-36 hash suffix when longer (SPEC 35.2.1). `/private/tmp/x` becomes `-private-tmp-x`; `/tmp/x` is realpathed first (§4.3, §18).
- **Sidecar directory**: `projects/<slug>/<sessionId>/`, holding `subagents/agent-<agentId>.jsonl` and `.meta.json`, `subagents/workflows/<runId>/journal.jsonl`, `tool-results/<id>.txt|json`, `workflows/<runId>.json`, `workflows/scripts/*.js`, `custom-title.json` (SPEC 35.10).
- **Chain**: the transcript the model sees: from the leaf (the last record in file order that carries a `uuid` and is not `progress`-typed), follow `parentUuid` to the root; records off that path are an abandoned branch. `currentChain` in `src/shared/wire/transcript.ts` (C1) computes it over a whole file; the **chain follower** (M1) maintains it incrementally as lines are appended.
- **Anchor**: a `last-prompt` record. It has no `uuid`, is never on the chain, and carries `leafUuid` (the leaf at that moment) and, after a rewind, `rewound: true` plus `explicit: true`, with `lastPrompt` the prompt that was rewound away (verified against the raw probe transcript, Surprises & Discoveries).
- **Holder**: a process other than MAWS that currently has a session open. Interactive `claude` writes `<configHome>/sessions/<pid>.json` at startup (`kind: "interactive"`), `claude --bg` writes one with `kind: "bg"` and a `jobId`; `-p` sessions write none (SPEC 35.27.1). A session with a live holder is shown foreign-live and read-only (D-12).
- **Tailer**: the per-file reader that keeps a byte offset at the last complete newline, reads only what was appended, and hands complete lines to the chain follower.
- **Backfill**: producing X1 events from a transcript file's chain, as opposed to from live wire frames (C3). Both produce `SessionEvent`s of the kinds listed under Interfaces.
- **Index**: the SQLite database `<userData>/index.sqlite` owned by main, holding only what the engine does not (§4.4).
- **Read model**: C5's main-process module (`SessionReadModel`, `docs/doperpowers/plans/2026-09-28-c5-shell.md`) that holds projects, session records, digests and attention items, answers `session.list` and is the only emitter of `session.changed`, `session.removed`, `session.projectChanged`, `session.projectRemoved`. A **session source** is what feeds it; C4's index is one.
- **Binding** (of ids): the pair `appSessionId ↔ sessionId` for one session. Main's index allocates app ids; the engine host learns them through `fs.bind` so the events it emits can carry `appSessionId`, the key every renderer-facing payload uses (C3 and C6 settled on that name).
- **Replay**: feeding a recorded source into the event graph at a chosen speed. Two sources (X8): a probe **journal** (rows of `{seq, direction, at, frame}`), which goes through C3's normaliser; and a **transcript** JSONL, which goes through C4's backfill.

## Constraints

Binding on every milestone, from the charter:

- §4.3, as amended by the 2026-09-28 (C2) Decision Log entry: one watcher plus append-aware tailers over the engine's own store, respecting `CLAUDE_CONFIG_DIR`; the JSONL is append-only across rewind, the current transcript is the parent chain from the latest leaf, the tailer re-anchors by uuid and never by byte offset alone; whole-file sidecars are parsed with retry; spilled results are loaded by the path the engine reports, never by a derived name; a session id maps to its files by discovery (`projects/*/<sessionId>.jsonl`) or realpath-then-slug, never from a cwd string, and the session's directory comes from the first record; live holders come from `sessions/<pid>.json`. The service never writes into engine-owned locks, mailboxes or journals; in C4 it never writes under the config home at all. (binding)
- §4.4 index scope: the index holds project list and membership, app session records (X1), attention items, drafts, replay fixtures, and nothing the engine already holds. Two items §4.4 names are persisted by siblings and not here: queued messages and grants live in C3's per-session state file (the engine host releases them and cannot reach main's database), and tab and panel layout lives in C5's `layout.json`; both are raised as `[parent-impact]` in the handback and listed under Cross-child reconciliation. (binding scope; the library is S-4, advisory, overturned below with evidence)
- §4.1 process model: the filesystem state service runs in the engine-host utility process; the index and the git service run in main; the renderer reaches either only through X2. (binding)
- §4.5: git is read-only (status, branch, diff, log, watcher) through the `git` binary; worktrees under `<repo>/.claude/worktrees/` are recognised, never created or removed here. (binding for read-only; C10 owns mutation)
- X1: C4 produces `SessionEvent`s exactly of the kinds and shapes in C1's Interfaces, with C3's additive `SessionRecord.gateway` extension (`baseUrl`, `autoModeServer`); identifiers keep their brands; nothing is flattened; a `parentUuid` that names no record is reported as a gap, never bridged (C1's `currentChain` rule). (binding)
- X2: every command and event C4 adds lives in its own namespace module under `src/shared/ipc/schema/` with an owner, input and output schema; validators never transform, default or coerce (C1 residue *Validation library*); a name a sibling already claimed is used as the sibling defined it. (binding)
- X6 participation: holder detection informs launch (C3/C10 refuse to resume a session whose holder is alive, §15). C4 exposes the holder on the session record and as an event; it does not launch anything. (binding boundary)
- X8: fixture format is the probe journal; replay feeds a journal to C3's normaliser or a JSONL to C4's backfill. (binding)
- `spikes/protocol-probe/findings-pass2.md` items 3 (workflow disk layout), 4 (rewind branching) and 10 (holder behaviour) are binding as verified; items 8 and 12 (trust, spare claiming) are C10's, read here only for `claim_session` writing a registry record.
- D-1 (no engine patches), D-11 (macOS arm64 only), D-12 (the engine's store is the store; MAWS keeps only an index). (binding)
- C1's conventions: zod 4 with `import * as z from 'zod'`; `z.looseObject` for anything the engine writes (unknown fields retained), `z.strictObject` for the app's own records; tokens only in the renderer; CommonJS for main and hosts; tests beside their source under vitest's node project; `@shared/*` alias; no attribution footers in commits.

## Grounding: the owner's store as read on 2026-09-28

Read-only survey of `/Users/new/.claude` (`CLAUDE_CONFIG_DIR` unset). These are the shapes and scales the design is built for; the SPEC chapters cited are `~/claude-code-bundle/2.1.283/SPEC/`.

- `projects/`: 704 slug directories, 3,690 `*.jsonl` transcripts (1.3 GB; median 92 KB; four over 50 MB, the largest 84 MB), 3,540 of which carry a `cwd` within the first 64 KiB. Reading the first and last 64 KiB of every file takes about one second. 321 sessions have a sidecar directory; 221 of those have `subagents/`, 191 `tool-results/`, 26 `workflows/`, 14 `custom-title.json`. No `.orphaned-` or `.superseded-` files today, but both names exist (SPEC 35.2.6, 35.23) and the scan must skip them.
- A transcript is one JSON object per `\n`-terminated line, appended with `appendFile` and no fsync; a torn tail is possible and the writer seals it by prefixing its next record with `\n`; a line that does not parse is skipped, and a run of leading NUL bytes is stripped first (SPEC 35.3.1). Record types seen in one real 2,185-line session: `attachment` (726, on the chain with `uuid`/`parentUuid`), `assistant` (410; one record per content block, `apiBlockIndex` set), `user` (309), and without uuid `queue-operation`, `mode`, `permission-mode`, `atis-latch`, `last-prompt` (99 each), `ai-title` (98), `file-history-snapshot`, `cost-state`, `file-history-delta`; `system` records with uuid: `turn_duration`, `stop_hook_summary`, `local_command`, `compact_boundary`. Records carry `sessionId` and also the wire's `session_id`, `version` (`2.1.282` in a session the 2.1.283 binary later resumed), `cwd` (the process cwd at write time), `gitBranch`, `entrypoint`.
- The raw rewound transcript from the pass-2 probe, `projects/-private-tmp-maws-probe2-FIiJVW/bdb23713-2f6c-40f3-8b18-b41a667a64e3.jsonl` (33 lines), shows the anchor semantics: `{"type":"last-prompt","lastPrompt":"Also remember the word BANANA. Reply OK.","leafUuid":"edf0f954…","explicit":true,"rewound":true}` where `edf0f954` is exactly the `precedingAssistantUuid` the wire returned; the next user record's `parentUuid` is `af765f44`, the `prompt_snapshot` attachment that followed that assistant on the old chain. The chain after the next turn is `e3b48834 → … → edf0f954 → af765f44 → a4d68c72 → 7c05f769`; `36a2aa44` and `57525d04` are the abandoned branch.
- Spilled results: the `user` record's `toolUseResult.persistedOutputPath` names the file (nine records in the session above), and the result text also carries `Output too large (29.7KB). Full output saved to: /Users/new/.claude/projects/-Users-new-Developer-GitHub-MAWS/e3ce7feb-…/tool-results/b95u0622n.txt`. The 64 files in that session's `tool-results/` are named by background-shell id (`b95u0622n.txt`), not tool-use id, which is the §4.3 reason for never deriving the name.
- `sessions/`: ten `<pid>.json` records, all with `sessionId`, `cwd`, `kind` (`interactive` or `bg`), `startedAt`, `procStart` (a `ps` start-time token for pid identity), `status` (`idle` | `busy` | `waiting`), `waitingFor`, `name`; `bg` records add `jobId` (first 8 hex of the session id). Every listed pid was alive; stale `.key` files without a `.json` remain from earlier processes. The record is written with a bare `writeFile` and patched by read-modify-write (SPEC 35.27.1), so a reader can observe a truncated or half-written file.
- `jobs/<8hex>/state.json` (mode 0600, up to 8 MiB) carries `sessionId`, `linkScanPath` (the transcript path), `state` (`working` | `done` | `stopped` | `blocked` | …), `template` (`bg`), `cwd`, `name`; beside it `timeline.jsonl` and `tmp/` (SPEC 20.15.5).
- `tasks/<listId>/<n>.json` are pretty-printed `PersistedTask` records, `listId` a session id or team name (SPEC 20.2.3). Task *output* files are `<projectDir>/<sessionId>/tasks/<taskId>.output`, and the wire's `task_notification.output_file` names them (SPEC 20.9).
- Workflows: `projects/<slug>/<sessionId>/workflows/<runId>.json` (a whole-run snapshot with `workflowProgress`, `result`, `status`, `agentCount`), `subagents/workflows/<runId>/journal.jsonl` (`launched`, `started`, `result` rows keyed by agent), `workflows/scripts/<name>-<runId>.js`; fixture copy under `spikes/protocol-probe/fixtures/pass2/workflow-disk/`.
- Subagent sidecars: `agent-<id>.meta.json` is `{"agentType","description","toolUseId","spawnDepth","requestShape","requestNonInteractive","model"}` (loosely, `AgentMeta` in C1); the agent transcript's records carry `isSidechain: true`, `agentId`, `parentUuid: null` on the first. For local agents the wire's `task_id` equals the sidecar `agentId` (C1 Surprises).
- The probe session `9a1d4262-0b43-46ad-acb9-5982f31d209c` exists as a complete parent transcript at `projects/-private-tmp-maws-probe-WmHZ2j/` (39 records, two `Agent` tool uses whose ids equal the two sidecar metas' `toolUseId`) alongside the pass-1 wire journal `fixtures/subagent.jsonl` (488 rows, same session id) and the two sidecars already under `fixtures/subagent-sidecars/`. This is the paired fixture the consistency acceptance uses.
- Electron 44.4.5 (Node 24.21.0, ABI 149) exposes `node:sqlite` with SQLite 3.53.4 and FTS5, without flags (`ELECTRON_RUN_AS_NODE=1 electron -e`, Surprises & Discoveries). better-sqlite3 13.0.3 publishes no prebuilt binaries at all, and 12.11.1's newest Electron prebuild is ABI 146.

## Architecture: where each piece runs and how they talk

Three places, fixed by §4.1:

- **Engine host** (`src/engine-host/fs/**`): the filesystem state service. One `fs.watch` over `<configHome>/projects` (recursive), one over `sessions/`, one over `jobs/` and one over `tasks/`; the discovery scan; the tailers and chain followers; sidecar, registry, job, task and workflow readers; spill reads; the transcript backfill that produces X1 events; the replay engine (clock and both sources). It registers the `fs.*` and `session.replay.control` commands it owns through C1's `runHost` registration and emits `fs.*` events, `session.eventBatch` (C3's event, the one carrier of X1 events from any producer) and `session.replay.progress`. It shares the process with C3's engine adapter because §4.1 puts both there; they share the host runtime, the bindings table (`fs.bind`), and two in-process seams: C3's `session.events` handler delegates to `FsService.eventsSnapshot` for an `appSessionId` with no live process, and C4's journal replay runner calls C3's `Normalizer`.
- **Main** (`src/main/index/**`, `src/main/git/**`): the index and the git service. Main subscribes to the engine host's `fs.*` events through a new `HostSupervisor.onEvent(name, listener)` (one addition to C1's `src/main/hosts/supervisor.ts`), folds summaries and holders into session records and projects, and feeds C5's read model as a `SessionSource` (`IndexSessionSource`), persisting the read model's three writes (visibility, mark read, pin) and its attention lists. Main answers `session.projects.*`, `session.drafts.*`, `session.replay.start`, `session.replay.fixtures` and `git.*` itself and emits `git.changed`; until C5's read model lands, main also answers C5's read-side entries (`session.list`, `session.setVisible`, `session.markRead`, `session.setPinned`) with an interim handler over the same stores, so the acceptance is observable in C4's own branch.
- **Renderer**: a diagnostics section (`src/renderer/src/app/StoreDiagnostics.tsx`) that lists discovered sessions with holder badges from `session.list` and `session.changed`, shows the followed session's chain length and last events from `fs.followState` and `session.eventBatch`, and offers replay and git controls. It exists so C4's acceptance is observable before C5 and C6 land; C5 replaces it as the user-facing surface and C4 adds no session store of its own (C5's `sessions` store is the one).

Main ↔ host traffic is C1's host protocol unchanged: main sends `req` for `fs.*` commands (owner `engine-host`), the host answers `res` and emits `evt`; every payload is validated with the X2 schemas at both ends. No new envelope kinds. The renderer never sees a path it did not get from a validated event.

Ids: the engine host discovers sessions by their engine `sessionId`; the index allocates the `appSessionId` (`AppSessionId`) when it first sees a session (discovery, or C3's `createForLaunch`) and tells the host through `fs.scan { known }` at startup and `fs.bind` afterwards. Every renderer-facing payload the host emits for a session carries `appSessionId`; a transcript the host sees before main has bound it produces only `fs.sessionChanged` (keyed by `sessionId`), and main binds before anything follows it.

The heavy-work worker §4.1 names for "transcript indexing and search" is **not forked in C4**. Discovery reads 64 KiB heads and tails, not whole files (about one second for the owner's 3,690 sessions, measured), tailing is incremental, and the index stores records, not transcript text, so nothing here is CPU-bound enough to warrant a third utility process. The worker arrives with its first real consumer (full-text search over transcripts, or the P1 replay scrubber). Advisory; recorded in Residue decisions.

`CLAUDE_CONFIG_DIR` is read by the engine host from its own `process.env` at start, exactly as the engine reads it; C1's supervisor forks hosts with main's environment, which is the login shell's when `pnpm dev` runs and the Dock-launch environment (no shell exports) when packaged. C3's login-shell capture (`shell-env.ts`) runs in the same host, so when it lands the FS service reads `CLAUDE_CONFIG_DIR` from the captured environment through the same accessor the launch contract uses; until then both see `process.env`. `fs.state` reports the resolved config home so a mismatch is visible.

## Interfaces and Dependencies

Names, shapes and signatures other children import or call. Zod schemas carry the type's name with a `Schema` suffix and every type is `z.infer` of its schema (C1's rule), so each shape is written once here as TypeScript.

### Store record shapes (`src/shared/wire/store.ts`, new)

Loose objects: the engine writes them, unknown fields are kept. C1's `TranscriptRecord`, `LastPromptAnchor` and `AgentMeta` in `src/shared/wire/transcript.ts` stay where they are and are imported.

```ts
// <configHome>/sessions/<pid>.json (SPEC 35.27.1). `pid` is taken from the file name.
export interface LiveSessionRecord { pid: number; sessionId?: string; cwd?: string; startedAt?: number; procStart?: string; version?: string;
  kind?: 'interactive' | 'bg' | 'daemon' | 'daemon-worker'; entrypoint?: string; jobId?: string; name?: string;
  status?: 'busy' | 'shell' | 'idle' | 'waiting'; waitingFor?: string; updatedAt?: number; spare?: true; parkedJobId?: string; [k: string]: unknown }
// <configHome>/jobs/<8hex>/state.json (SPEC 20.15.5); only the fields C4 reads are named.
export interface JobState { state: string; detail?: string; sessionId: string; linkScanPath?: string; template?: string; cwd?: string; name?: string;
  cliVersion?: string; updatedAt?: number; [k: string]: unknown }
// <configHome>/tasks/<listId>/<id>.json (SPEC 20.2.4)
export interface PersistedTask { id: string; subject: string; description: string; activeForm?: string; owner?: string;
  status: 'pending' | 'in_progress' | 'completed'; blocks: string[]; blockedBy: string[]; metadata?: Record<string, unknown> }
// <projectDir>/<sessionId>/workflows/<runId>.json (pass-2 item 3; fixture pass2/workflow-disk/wf_*.json)
export interface WorkflowSnapshot { runId: string; workflowName?: string; status?: string; taskId?: string; scriptPath?: string; summary?: string;
  agentCount?: number; durationMs?: number; startTime?: number; workflowProgress?: unknown[]; result?: unknown; [k: string]: unknown }
export interface WorkflowJournalRow { type: 'launched' | 'started' | 'result' | string; key?: string; agentId?: string; label?: string; phase?: string; result?: unknown; [k: string]: unknown }

// What discovery learns about a transcript from its first and last 64 KiB, without parsing the whole file.
export interface TranscriptSummary {
  sessionId: SessionId; transcriptPath: string; slug: string;
  directory: string | null;            // first `cwd` in the head; null when the head has none
  relocatedCwd: string | null;         // last `relocated` record in the tail, overrides `directory` for project membership (SPEC 35.23)
  size: number; mtimeMs: number;
  firstRecordAt: string | null; lastRecordAt: string | null;   // ISO timestamps of the first and last uuid-bearing record seen
  customTitle: string | null; aiTitle: string | null;          // last `custom-title` / `ai-title` in the tail, else `custom-title.json`, else head
  firstPrompt: string | null;          // last `last-prompt.lastPrompt` in the tail, else the first user text
  lastAssistantText: string | null;    // the last assistant text block in the tail, first 200 characters (C5's digest `lastAssistantLine` for sessions nobody opened)
  gitBranch: string | null; engineVersion: string | null; entrypoint: string | null;
  sessionKind: 'bg' | 'daemon' | 'daemon-worker' | null;
  hasMessages: boolean;                // a `"parentUuid":` marker was seen in head or tail (the engine's own `bookkeepingOnly` negation)
  leafUuid: MessageUuid | null;        // last uuid-bearing non-progress record in the tail
}
export type Holder = SessionRecord['holder'];   // from src/shared/graph/session.ts
```

### Chain follower and backfill (`src/engine-host/fs/chain-follower.ts`, `src/engine-host/fs/backfill.ts`)

The chain follower is the concurrency-shaped core, so its states and transitions are fixed here. One follower per transcript file; every method is serialised behind one promise chain per file, so a watcher event, a reconcile tick and a follow request never interleave.

```ts
export interface Skeleton { uuid: MessageUuid; parentUuid: MessageUuid | null; type: string; isProgress: boolean; timestamp: string | null; offset: number; length: number }
export interface FollowerState {
  path: string; ino: number | null; offset: number;          // offset = byte position after the last complete '\n' consumed
  partial: Buffer;                                          // bytes after the last newline, not yet a line
  skeletons: Map<MessageUuid, Skeleton>;                     // every uuid-bearing record, chain or not; payloads are not retained
  chain: MessageUuid[]; leaf: MessageUuid | null;            // root → leaf
  emitted: Set<MessageUuid>;                                 // records whose events have been delivered
  pendingRewind: { leafUuid: MessageUuid; prefillText: string | null } | null;
  skippedLines: number; gap: { parentUuid: string; childUuid: string } | null;
}
export type FollowerEvent =
  | { t: 'events'; events: SessionEvent[] }                                       // in chain order, batched
  | { t: 'facts'; facts: Partial<Pick<TranscriptSummary, 'customTitle' | 'aiTitle' | 'relocatedCwd' | 'gitBranch' | 'engineVersion' | 'leafUuid' | 'lastRecordAt'>> }
  | { t: 'state'; state: 'backfilling' | 'following' | 'reloading' | 'stopped' | 'error'; chainLength: number; leafUuid: MessageUuid | null; gap: FollowerState['gap']; skippedLines: number; message: string | null };
export class ChainFollower { constructor(reader: FileReader, sessionId: SessionId, agent: { agentId: AgentId; parentToolUseId: ParentToolUseId } | null, sink: (e: FollowerEvent) => void);
  start(): Promise<void>; poke(): Promise<void>; stop(): void; snapshot(): FollowerState; materialized(): SessionEvent[] }   // materialized: every event delivered so far, in order, for the snapshot command
export interface FileReader { stat(): Promise<{ ino: number; size: number } | null>; read(offset: number, length: number): Promise<Buffer> }   // null: the file does not exist (yet)
```

Inputs and transitions (the linearisation point is the end of one `poke()`):

| Input | Condition | Effect |
|---|---|---|
| `start` | — | `stat`; read `[0, size)` in 1 MiB pages; feed lines; state `backfilling` → `following`. A missing file waits in `following` with an empty chain until a `poke` finds it. |
| `poke` (watcher or reconcile) | `stat.ino !== ino` or `stat.size < offset` | **reload**: the file was rewritten (local GC via temp-and-rename, tombstone removal, CCR hydration, relocation set-aside; SPEC 35.3.1, 35.8, 35.9, 35.23). Rebuild skeletons and chain from byte 0 with `currentChain`; the uuids on the old chain but not the new one become one `boundary.retraction { retractedMessageUuids, reason: 'transcript_rewritten', fallbackModel: null }`; the new chain's not-yet-emitted records are re-read by offset and emitted; state passes through `reloading`. |
| `poke` | `stat.size > offset` | read `[offset, size)`, append to `partial`, split at `\n`, keep the trailing fragment in `partial`; each complete line: strip leading `\0` bytes, `JSON.parse`; on failure increment `skippedLines` and continue (a torn fragment sealed by the writer's `\n` prefix parses as garbage exactly once); on success dispatch by record. `offset` advances to the byte after the last complete newline. |
| line: record without `uuid` | `type === 'last-prompt'` and `rewound === true` | set `pendingRewind = { leafUuid, prefillText: lastPrompt ?? null }`. If `leafUuid` is on `chain`: cut `chain` after it, set `leaf = leafUuid`, emit `boundary.rewind { targetMessageUuid: <first 'user'-typed record after leafUuid on the old chain>, precedingAssistantUuid: leafUuid, prefillText }` and clear `pendingRewind` — MAWS shrinks at the anchor, before the next turn arrives. If `leafUuid` is not on the chain (an anchor written before the file was complete), keep `pendingRewind` for the branch case. Anchors with `leafUuid` and no `rewound` update the `leafUuid` fact only. |
| line: record without `uuid` | `custom-title`, `ai-title`, `relocated` | emit `facts`. `queue-operation`, `mode`, `permission-mode`, `atis-latch`, `file-history-snapshot`, `file-history-delta`, `cost-state`, `summary`, `tag`, `history-suppression`, `ended-by-model`, `continued-in`, `attribution-snapshot`, `fork-context-ref`, `observer-ref`: known, no event. Any other type: `frame.unknown { frameType: 'transcript:' + type, subtype: null }`. |
| line: record with `uuid` | `type === 'progress'` | store the skeleton with `isProgress: true`; never becomes `leaf`; no event. |
| line: record with `uuid` | `parentUuid === leaf`, or `parentUuid === null` and `chain` is empty | **extend**: push; `leaf = uuid`; emit the record's events (Backfill mapping below). |
| line: record with `uuid` | otherwise (`parentUuid` names an older chain member, an off-chain record, or nothing) | **branch**: walk `parentUuid` through `skeletons` from this record to a root or a missing parent (C1's `gap` rule: stop, report, never bridge). The walk is the new `chain`; the old chain's members not on it become `boundary.rewind` (when `pendingRewind` is set: `precedingAssistantUuid = pendingRewind.leafUuid`, `targetMessageUuid` = the first `user`-typed record after the divergence on the old chain, `prefillText`) or, with no anchor to explain it, `boundary.retraction { reason: 'transcript_branch' }` plus `notice.posted { level: 'warning', text: 'Another process wrote a sibling branch into this transcript', key: 'transcript_branch' }` — the pass-2 item 10 second-writer case. New chain members not in `emitted` are re-read by offset and emitted in chain order. `pendingRewind` is cleared. |
| any | `partial.length > 8 MiB` | a record longer than 8 MiB (the engine's own pre-flush accumulator is far larger, but a single record this size is a torn tail in practice): drop `partial`, count it as skipped, continue. |
| `stop` | — | close, state `stopped`; the skeleton is discarded. |

Events are delivered in batches: everything one `poke()` produced, split into messages of at most 500 events, in chain order (C3's batch cap). The follower never retains parsed payloads; `emitted` plus `skeletons` (about 120 bytes per record) is the memory cost of following the 84 MB transcript, plus `materialized()`'s event list, which the host keeps per followed session for the snapshot command and drops on `stop`.

**Backfill mapping**, `backfill.ts`, `recordToEvents(record, ctx): SessionEvent[]`, with `ctx = { sessionId, agentId, parentToolUseId, seenToolUses }`. `EventBase` for every event: `seq: null` (no journal row; X1 defines `seq` as the journal row and null for app-synthesised events, and a disk record is neither), `at` = the record's `timestamp` (ISO) or the previous event's, `agentId`/`parentToolUseId` from `ctx`, and a deterministic `id`: `<uuid>` for a record's first event, `<uuid>#<n>` for its n-th, `anchor:<offset>` for anchor-derived events, `session:<sessionId>:started` for the synthetic start — so the same file always yields the same ids and a consumer that receives backfill twice (a reload, or a snapshot overlapping a batch) deduplicates by `id`. Consumers cannot use `seq` as a cursor for disk-derived events; C6's `ipcSource` is asked to key its dedup on `id` (Cross-child reconciliation).

| Disk record | X1 events |
|---|---|
| first record on the chain (any type), once per follow | `session.started { cwd: <first record with cwd>.cwd, engineVersion: version ?? null, resumedFrom: null, forked: !!forkedFrom }` |
| `user` with string content, not `isMeta` | `turn.started { userMessageUuid: uuid, origin: null }` then `user.message { messageUuid: uuid, content, isReplay: false, isSynthetic: false, origin: null, bash: <from <bash-input>/<bash-stdout>… tags, else null> }` |
| `user` with string content and `isMeta: true` | `user.message { …, isSynthetic: true }`, no `turn.started` |
| `user` with array content: each `tool_result` block | `tool.result { toolUseId: block.tool_use_id, content: block.content, isError: block.is_error ?? false, structured: record.toolUseResult ?? null, spillPath: record.toolUseResult?.persistedOutputPath ?? <SPILL_MARKER match in the text> ?? null, denial: null, safeguard: 'not_evaluated', messageUuid: uuid }`. Denial kinds are not recorded on disk in a parseable form; `null` is the honest value and C6 renders a disk-backfilled error result as an error. |
| `user` with array content: non-`tool_result` blocks present | one `user.message { content: <those blocks> }` (and `turn.started` when not `isMeta`) |
| `assistant` | per content block `i` (`apiBlockIndex ?? i`): `assistant.block.complete { messageUuid: uuid, apiMessageId: message.id, blockIndex, block, model: message.model, supersedes: null, aborted: false, userMessageUuids: [] }`; for a `tool_use` block additionally `tool.use { toolUseId: block.id, toolName: block.name, input: block.input, apiMessageId, messageUuid }`; for `tool_use` of `Agent` additionally, when the sidecar `agent-<id>.meta.json` with `toolUseId === block.id` exists, `subagent.started { taskId: <agentId as TaskId>, toolUseId, description: meta.description, subagentType: meta.agentType, isBackground: meta.requestShape === 'background', spawnDepth: meta.spawnDepth ?? 1, prompt: null }` |
| `user` `tool_result` for a `toolUseId` that started a subagent | additionally `subagent.finished { taskId, status: is_error ? 'failed' : 'completed', summary: <text of the result, first 200 chars>, outputFile: null, reason: null }` |
| `system` / `compact_boundary` | `boundary.compaction { trigger: compactMetadata.trigger, preTokens: compactMetadata.preTokens ?? 0, postTokens: null, logicalParentUuid, historical: true }` |
| `system` / `turn_duration` | `turn.ended { result: 'success', isError: false, terminalReason: null, resultText: null, durationMs, numTurns: 1, costUsd: 0, usage: zeros, permissionDenials: [], errors: [], userMessageUuids: [<last turn.started>], origin: null, resultIndex: null, isEchoReceipt: false }` — accounting is not on disk per turn; `seq: null` marks it synthesised and C6 shows duration, not cost, for disk-derived turns |
| `system` / `local_command` | `notice.posted { level: 'info', text: content, key: 'local_command' }` |
| `system` / other subtype with uuid | `frame.unknown { frameType: 'transcript:system', subtype }` |
| `attachment` | on the chain, no event (context injections: `environment`, `model`, `skill_listing`, `session_context`, `prompt_snapshot`, …) |
| any other uuid-bearing type | `frame.unknown { frameType: 'transcript:' + type, subtype: null }` |
| sidecar records (`isSidechain: true`) | the same table with `ctx.agentId = record.agentId`, `ctx.parentToolUseId = meta.toolUseId`; the sidecar's first `user` record supplies `subagent.started.prompt` when the parent's mapping ran first |

```ts
export const SPILL_MARKER = /(?:Full output saved to|were saved to|was saved to):? (\/\S+?\.(?:txt|json))\b/;   // the three engine strings, SPEC 12.12 and 20.10; the structured field wins when present
export function recordToEvents(record: TranscriptRecord, ctx: BackfillContext): SessionEvent[];
export function summarize(head: Buffer, tail: Buffer, stat: { size: number; mtimeMs: number }, path: string, slug: string): TranscriptSummary;   // discovery's head/tail read
```

Denials, safeguard verdicts, stream deltas, control requests, tool progress and hook frames exist only on the wire; a disk backfill never produces `assistant.block.delta`, `tool.progress`, `permission.*`, `question.*`, `plan.*`, `dialog.*`, `elicitation.*`, `hook.*`, `tool.safeguard`, `api.retry`, `usage.sample`, `context.sample`, `process.exited`, `command.lifecycle`, `session.init`, `session.state`, `session.commands` or `tasks.snapshot`. X1 event kinds C4 produces: `session.started`, `turn.started`, `turn.ended`, `user.message`, `assistant.block.complete`, `tool.use`, `tool.result`, `subagent.started`, `subagent.finished`, `workflow.progress` (from `wf_*.json`, M3), `boundary.compaction`, `boundary.rewind`, `boundary.retraction`, `notice.posted`, `frame.unknown`.

### X2 additions

Per namespace module, merged by C1's `schema.ts`. C4 fills `fs.ts` and `git.ts`, and adds to `session.ts` beside C3's and C5's entries. Owners: `engine-host` for `fs.*` and `session.replay.control`; `main` for the rest. Shapes reuse `SessionRecordSchema` from `src/shared/graph/`, `SessionEventSchema` from `src/shared/graph/events.ts`, and C5's `ProjectRecordSchema`.

`src/shared/ipc/schema/fs.ts` (C1 ships it empty; C4 fills it; C8 adds its file-tree commands later under names not listed here):

```ts
commands = {
  'fs.state':      { input: z.void(), output: FsStateSchema, owner: 'engine-host' },        // snapshot: configHome, watching, counts, followed, holders
  'fs.scan':       { input: z.strictObject({ known: z.array(z.strictObject({ sessionId, appSessionId, size: z.number(), mtimeMs: z.number() })).optional() }),
                     output: z.strictObject({ projects: z.number().int(), sessions: z.number().int(), changed: z.number().int(), durationMs: z.number() }), owner: 'engine-host' },
  'fs.bind':       { input: z.strictObject({ bindings: z.array(z.strictObject({ sessionId, appSessionId })) }), output: z.void(), owner: 'engine-host' },   // main → host, after the index allocates or binds an app id
  'fs.unfollow':   { input: z.strictObject({ appSessionId, agentId: agentId.nullable() }), output: z.void(), owner: 'engine-host' },   // stop the follower (and, with null, its agents); following starts through session.events and fs.agentEvents
  'fs.subagents':  { input: z.strictObject({ appSessionId }), output: z.strictObject({ agents: z.array(SubagentEntrySchema) }), owner: 'engine-host' },
  'fs.agentEvents':{ input: z.strictObject({ appSessionId, agentId }), output: z.strictObject({ events: z.array(SessionEventSchema), complete: z.boolean() }), owner: 'engine-host' },   // C6's name: the child's transcript as X1 events; starts following it; later events arrive on session.eventBatch with agentId set
  'fs.workflows':  { input: z.strictObject({ appSessionId }), output: z.strictObject({ runs: z.array(WorkflowRunSchema) }), owner: 'engine-host' },   // snapshot + journal rows per run
  'fs.tasks':      { input: z.strictObject({ listId: z.string() }), output: z.strictObject({ tasks: z.array(PersistedTaskSchema) }), owner: 'engine-host' },
  'fs.readSpill':  { input: z.strictObject({ path: z.string(), offset: z.number().int().nonnegative().optional(), length: z.number().int().positive().max(8 * 1024 * 1024).optional() }),
                     output: z.strictObject({ content: z.string(), bytes: z.number().int(), offset: z.number().int(), truncated: z.boolean() }), owner: 'engine-host' },   // C6's name and fields (`bytes` = the file's total size); `offset` is additive
}
events = {
  'fs.sessionChanged': z.strictObject({ summary: TranscriptSummarySchema, appSessionId: appSessionId.nullable() }),   // discovered, or head/tail facts changed; appSessionId once bound
  'fs.sessionRemoved': z.strictObject({ sessionId, appSessionId: appSessionId.nullable() }),                          // the .jsonl vanished (retention sweep, quarantine rename)
  'fs.holderChanged':  z.strictObject({ sessionId, appSessionId: appSessionId.nullable(), holder: HolderSchema, registry: LiveSessionRecordSchema.nullable(), job: JobStateSchema.nullable() }),
  'fs.followState':    z.strictObject({ appSessionId, agentId: agentId.nullable(), state: z.enum(['backfilling','following','reloading','stopped','error']), chainLength: z.number().int(), leafUuid: messageUuid.nullable(), gap: GapSchema.nullable(), skippedLines: z.number().int(), message: z.string().nullable() }),
  'fs.subagentsChanged': z.strictObject({ appSessionId, agents: z.array(SubagentEntrySchema) }),
  'fs.workflowChanged':  z.strictObject({ appSessionId, runId: z.string() }),
  'fs.tasksChanged':     z.strictObject({ listId: z.string() }),
  'fs.scanProgress':     z.strictObject({ scanned: z.number().int(), total: z.number().int() }),
}
// SubagentEntry: { agentId, meta: AgentMetaSchema.nullable(), transcriptPath, size, mtimeMs, runId: string | null }   (runId for subagents/workflows/<runId>/agent-*.jsonl)
// FsState: { configHome, watching: boolean, projects, sessions, bound, followed: { appSessionId, agentId | null }[], holders: { sessionId, appSessionId | null, holder }[], lastScanAt: string | null }
```

`fs.readSpill` accepts only a path whose realpath lies under `<configHome>/projects/`, `<configHome>/tasks/` or `<configHome>/jobs/`; anything else fails with `IpcError.code: 'internal'` and message `path outside the engine store`. It is how spilled results (`tool.result.spillPath`), task outputs (`task.notification.outputFile`) and workflow scripts are read, lazily, on click.

`src/shared/ipc/schema/session.ts`, C4's entries (C3's lifecycle and control entries and C5's read side live in the same module; C4 adds nothing that either defines and consumes their names as written):

```ts
commands = {
  'session.projects.add':    { input: z.strictObject({ directory: z.string() }), output: ProjectRecordSchema, owner: 'main' },      // realpathed; existing directory required; origin 'user'
  'session.projects.update': { input: z.strictObject({ id: projectId, patch: z.strictObject({ name: z.string().optional(), order: z.number().int().optional() }) }), output: ProjectRecordSchema, owner: 'main' },
  'session.projects.remove': { input: z.strictObject({ id: projectId }), output: z.void(), owner: 'main' },                        // hides; rediscovery does not resurrect it
  'session.drafts.get':      { input: z.strictObject({ appSessionId }), output: DraftSchema.nullable(), owner: 'main' },
  'session.drafts.set':      { input: z.strictObject({ appSessionId, draft: DraftSchema.nullable() }), output: z.void(), owner: 'main' },
  'session.replay.start':    { input: z.strictObject({ source: ReplaySourceSchema, speed: SpeedSchema }), output: z.strictObject({ appSessionId, sessionId, totalRows: z.number().int(), spanMs: z.number() }), owner: 'main' },   // main creates the record and binds, then dispatches the host-side start
  'session.replay.control':  { input: z.strictObject({ appSessionId, action: z.enum(['pause','resume','stop']).optional(), speed: SpeedSchema.optional() }), output: z.void(), owner: 'engine-host' },
  'session.replay.fixtures': { input: z.void(), output: z.strictObject({ fixtures: z.array(ReplayFixtureSchema) }), owner: 'main' },
}
events = {
  'session.replay.progress': z.strictObject({ appSessionId, state: z.enum(['running','paused','done','stopped','error']), index: z.number().int(), total: z.number().int(), at: z.string().nullable(), speed: SpeedSchema, message: z.string().nullable() }),
}
// Consumed as siblings defined them: C3's event `session.eventBatch { appSessionId, events: SessionEvent[] }` (C4 emits it for backfill, tail and replay) and command
// `session.events { appSessionId, afterSeq, limit } → { events, lastSeq, complete }` (C3's handler; for an appSessionId with no live process it delegates to
// FsService.eventsSnapshot, which starts following and returns the materialised events with lastSeq 0 and complete = state === 'following');
// C5's `session.list`, `session.setVisible`, `session.markRead`, `session.setPinned`, `session.changed`, `session.removed`, `session.projectChanged`, `session.projectRemoved`, `ProjectRecord`.
// ReplaySource: { kind: 'journal', path } | { kind: 'transcript', path } — absolute paths; a journal is X8's format, a transcript a JSONL
// Speed: z.union([z.number().min(0.25).max(50), z.literal('instant')])
// Draft: { doc: z.unknown() (Tiptap JSON, C7's), attachments: z.array(z.strictObject({ path, kind })), updatedAt }
// ReplayFixture: { id, name, kind: 'journal' | 'transcript', path, sessionId: nullable, addedAt, lastPlayedAt: nullable }
```

`src/shared/ipc/schema/attention.ts` and `layout.ts`: no C4 entries. C3 owns `attention.list` and `attention.changed`, C5 adds `attention.request`, `attention.notified`, `attention.navigate`, `layout.get`, `layout.set`, `layout.openExternal`, `layout.action`. C4 persists attention items behind C5's read model (below) and persists no layout.

`src/shared/ipc/schema/git.ts`:

```ts
commands = {
  'git.status':   { input: z.strictObject({ directory: z.string() }), output: GitStatusSchema, owner: 'main' },
  'git.branches': { input: z.strictObject({ directory: z.string() }), output: z.strictObject({ current: z.string().nullable(), branches: z.array(z.strictObject({ name: z.string(), upstream: z.string().nullable(), isCurrent: z.boolean() })) }), owner: 'main' },
  'git.diff':     { input: z.strictObject({ directory: z.string(), scope: z.enum(['worktree','staged','all']), base: z.string().optional(), path: z.string().optional(), context: z.number().int().min(0).max(20).optional() }),
                    output: z.strictObject({ patch: z.string(), files: z.array(z.strictObject({ path: z.string(), oldPath: z.string().nullable(), insertions: z.number().int(), deletions: z.number().int(), binary: z.boolean() })) }), owner: 'main' },
  'git.log':      { input: z.strictObject({ directory: z.string(), limit: z.number().int().min(1).max(500), path: z.string().optional() }),
                    output: z.strictObject({ commits: z.array(z.strictObject({ sha: z.string(), shortSha: z.string(), author: z.string(), authoredAt: z.string(), subject: z.string(), parents: z.array(z.string()) })) }), owner: 'main' },
  'git.watch':    { input: z.strictObject({ directory: z.string() }), output: GitStatusSchema, owner: 'main' },      // idempotent; ref-counted per repoRoot
  'git.unwatch':  { input: z.strictObject({ directory: z.string() }), output: z.void(), owner: 'main' },
}
events = { 'git.changed': z.strictObject({ repoRoot: z.string(), status: GitStatusSchema, reason: z.enum(['worktree','index','head','refs','initial']) }) }
// GitStatus: { repoRoot, gitDir, commonDir, isWorktree: boolean, branch: string | null (null when detached), head: string, upstream: string | null, ahead: number, behind: number,
//              dirty: boolean, files: { path, oldPath: nullable, index: string (one char from porcelain v2), worktree: string, untracked: boolean }[], stashCount: number, checkedAt: string }
```

### Index (`src/main/index/*.ts`)

`node:sqlite` (`DatabaseSync`), one connection opened at `app.whenReady()` on `<userData>/index.sqlite` (C1's `MAWS_USER_DATA` honoured), `PRAGMA journal_mode=WAL; synchronous=NORMAL; foreign_keys=ON; busy_timeout=2000`. Migrations are an ordered array in `migrations.ts`, applied inside one transaction at open, `PRAGMA user_version` recording the last applied; v1 is the schema below. A database whose `user_version` is higher than the app knows is refused with a logged error and the app continues with the index read-only (`IpcError.internal` on writes); an unopenable file is moved aside as `index.sqlite.broken-<epoch>` and a fresh one created, never silently deleted.

```sql
CREATE TABLE projects (id TEXT PRIMARY KEY, directory TEXT NOT NULL UNIQUE, name TEXT NOT NULL, slug TEXT NOT NULL, origin TEXT NOT NULL CHECK (origin IN ('user','discovered')),
  hidden INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_activity_at TEXT);
CREATE TABLE sessions (app_id TEXT PRIMARY KEY, engine_session_id TEXT UNIQUE, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  directory TEXT NOT NULL, additional_directories TEXT NOT NULL DEFAULT '[]', worktree_path TEXT, worktree_branch TEXT, branch TEXT,
  title_text TEXT NOT NULL DEFAULT '', title_source TEXT NOT NULL DEFAULT 'none', pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  holder TEXT NOT NULL DEFAULT '{"kind":"none"}', last_seen_uuid TEXT, last_seen_at TEXT, unread INTEGER NOT NULL DEFAULT 0,
  engine_version TEXT, gateway_routed INTEGER NOT NULL DEFAULT 1, gateway_base_url TEXT, gateway_auto_mode_server TEXT NOT NULL DEFAULT 'unknown',
  model_requested TEXT, model_resolved TEXT, effort TEXT, pm_requested TEXT NOT NULL DEFAULT 'auto', pm_effective TEXT NOT NULL DEFAULT 'auto', pm_refusal TEXT,
  transcript_path TEXT, transcript_size INTEGER, transcript_mtime_ms REAL, first_record_at TEXT, last_record_at TEXT, last_assistant_text TEXT, first_prompt TEXT,
  kind TEXT NOT NULL DEFAULT 'engine' CHECK (kind IN ('engine','replay')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX sessions_project ON sessions(project_id, archived, last_record_at DESC);
CREATE TABLE attention_items (id TEXT PRIMARY KEY, app_session_id TEXT NOT NULL REFERENCES sessions(app_id) ON DELETE CASCADE, session_id TEXT, kind TEXT NOT NULL,
  request_id TEXT, tool_use_id TEXT, task_id TEXT, agent_id TEXT, summary TEXT NOT NULL, created_at TEXT NOT NULL, state TEXT NOT NULL, state_changed_at TEXT NOT NULL, expires_at TEXT);
CREATE TABLE drafts (app_session_id TEXT PRIMARY KEY REFERENCES sessions(app_id) ON DELETE CASCADE, doc TEXT NOT NULL, attachments TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);
CREATE TABLE replay_fixtures (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL UNIQUE, session_id TEXT, added_at TEXT NOT NULL, last_played_at TEXT);
```

Five tables. The X1 `SessionRecord` is the row projected: `holder` and `additionalDirectories` are JSON columns, `title` is `{ text: title_text, source: title_source }`, `gateway` is `{ routed, baseUrl, autoModeServer }` (C3's extension; discovered sessions get `null` and `'unknown'`), and so on; `transcript_*`, `last_assistant_text`, `first_prompt`, `kind` are index-only columns behind the record. C5's `ProjectRecord { id, name, directory, order, createdAt }` is the `projects` row projected with `order = sort_order`; `slug`, `origin`, `hidden`, `last_activity_at` stay behind it. Not here, by reconciliation: queued messages and grants (C3's `SessionStateStore` file per app session), layout (C5's `layout.json`).

Store API main-side code calls (C5's read model, C3's main-side glue, C10):

```ts
export class Index { constructor(path: string); readonly sessions: SessionStore; readonly projects: ProjectStore; readonly attention: AttentionStore;
  readonly drafts: DraftStore; readonly fixtures: ReplayFixtureStore; close(): void }
export interface SessionStore {
  list(opts?: { includeArchived?: boolean }): SessionRecord[]; summaries(): Map<AppSessionId, TranscriptSummary>;
  get(appId: AppSessionId): SessionRecord | null; getByEngineId(sessionId: SessionId): SessionRecord | null;
  upsertFromSummary(summary: TranscriptSummary): { record: SessionRecord; created: boolean };   // discovery; never overwrites a user title, pin, archive, lastSeen
  setHolder(sessionId: SessionId, holder: Holder): SessionRecord | null;                         // C4 from fs.holderChanged; a record whose holder is `self` is left alone
  createForLaunch(init: { directory: string; additionalDirectories: string[]; worktree: SessionRecord['worktree']; model; effort; permissionMode }): SessionRecord;   // C3/C10: a record before the engine has a session id
  bindEngineId(appId: AppSessionId, sessionId: SessionId): SessionRecord;                       // C3: first frame carrying session_id; also tells the host (fs.bind)
  applyEngineStatus(appId: AppSessionId, patch: ReturnType<typeof toSessionRecordPatch>): SessionRecord;   // C3's `toSessionRecordPatch(status)`
  markSeen(appId: AppSessionId, cursor: { messageUuid: MessageUuid | null; at: string }): SessionRecord;    // C5's onMarkRead; clears unread
  setUnread(appId: AppSessionId, unread: boolean): SessionRecord;                                // C5's read model decides from visibility; the index persists
  setPinned(appId: AppSessionId, pinned: boolean): SessionRecord;                                // C5's onSetPinned
  update(appId: AppSessionId, patch: { title?: { text: string; source: 'user' | 'generated' | 'tool' }; archived?: boolean; worktree?; branch? }): SessionRecord;   // C10's rename with provenance and archive
  createReplay(init: { appId: AppSessionId; sessionId: SessionId; title: string }): SessionRecord; remove(appId: AppSessionId): void;
  onChange(listener: (record: SessionRecord, cause: 'discovered' | 'facts' | 'holder' | 'update' | 'live' | 'replay' | 'removed') => void): () => void;
}
export interface ProjectStore { list(opts?: { includeHidden?: boolean }): ProjectRecord[]; ensureForDirectory(realpath: string, origin: 'user' | 'discovered'): ProjectRecord; update(id: ProjectId, patch): ProjectRecord; hide(id: ProjectId): void;
  resolveMembership(effectiveDirectory: string): { projectId: ProjectId | null; worktree: SessionRecord['worktree'] } }
export interface AttentionStore { list(): AttentionItem[]; replaceForSession(appId: AppSessionId, items: AttentionItem[]): void; retireForSession(appId: AppSessionId): void }   // C5's applyAttention persists through replaceForSession
export interface DraftStore { get(appId): Draft | null; set(appId, draft: Draft | null): void }
export class IndexSessionSource implements SessionSource {          // C5's port: start(writer) pushes every project and record, then every change; receives onSetVisible, onMarkRead, onSetPinned
  constructor(index: Index, host: { dispatch: HostSupervisor['dispatch']; onEvent: HostSupervisor['onEvent'] }); start(writer: ReadModelWriter): () => void }
```

`IndexSessionSource.start` subscribes to `fs.sessionChanged`, `fs.sessionRemoved` and `fs.holderChanged`, reconciles each into the index inside a transaction, calls `writer.upsertProject` / `writer.upsertSession` / `writer.removeSession`, and for a discovered session with no live process also `writer.setDigest({ appId, phase: holder is terminal or background_job ? 'foreign' : 'exited', lastAssistantLine: summary.lastAssistantText, activity: null, … })` so the sidebar describes sessions nobody has opened; it then issues `fs.scan { known }` with every `(sessionId, appSessionId, size, mtimeMs)` the index holds and `fs.bind` for every app id it allocates afterwards. `onMarkRead` → `markSeen`, `onSetPinned` → `setPinned`, `onSetVisible` → nothing persisted (visibility is transient; the read model's `unread` decision is persisted through `setUnread` when it changes).

**Project membership rule** (`projects.ts`): a session belongs to the project whose `directory` equals the realpath of the session's effective directory (`relocatedCwd ?? directory`), or whose `directory/.claude/worktrees/` contains it (then the record's `worktree` is `{ path, branch: <from the summary's gitBranch> }`). Discovery auto-creates a project (`origin: 'discovered'`, `name` = directory basename) for an effective directory that exists on disk and has at least one session with `hasMessages`; a directory that no longer exists yields `projectId: null` and the session lands in "Other sessions"; a hidden project keeps its id so rediscovery does not resurrect it. Reason: §5.1 says sessions MAWS did not start "appear under their project automatically", and the owner's 704 slugs are mostly dead `/private/tmp` probes that would otherwise become 704 groups. Advisory; C5 may change the visibility rule.

**Title rule** (`sessions.ts`): a summary's `customTitle` sets `title { source: 'user' }` only when the record's title source is `none` or `generated` (a `/rename` in the terminal wins over an AI title, never over a rename made in MAWS, which is the same text once the engine writes it); `aiTitle` sets `source: 'generated'` only over `none`; `firstPrompt` is the fallback text with `source: 'none'`. On `fs.sessionRemoved` the record is kept and marked `archived` with `transcript_path` cleared, never deleted: the owner's index outlives the engine's retention sweep, which is what "keeps only an index" permits.

### Filesystem service internals (`src/engine-host/fs/*.ts`)

```ts
export interface StorePaths { configHome: string; projects: string; sessions: string; jobs: string; tasks: string }
export function resolveStorePaths(env: NodeJS.ProcessEnv): StorePaths;      // CLAUDE_CONFIG_DIR ?? ~/.claude, NFC-normalised
export function slugOf(realpath: string): string;                            // SPEC 35.2.1, hash32 suffix past 200 chars
export class StoreWatcher { constructor(paths: StorePaths, sink: (change: StoreChange) => void); start(): void; stop(): void }
export type StoreChange =
  | { kind: 'transcript'; slug: string; sessionId: SessionId; path: string }
  | { kind: 'sidecar'; slug: string; sessionId: SessionId; rel: string }        // custom-title.json, subagents/**, workflows/**, tool-results/** (ignored), tasks/**
  | { kind: 'registry'; pid: number; path: string }                            // sessions/<pid>.json
  | { kind: 'job'; jobId: string; path: string }                               // jobs/<8hex>/state.json
  | { kind: 'taskList'; listId: string }
  | { kind: 'rescan'; root: keyof StorePaths };                                // fs.watch gave no filename or errored: readdir-diff that root
export class Discovery { scan(known: Map<SessionId, { size: number; mtimeMs: number }>): AsyncIterable<TranscriptSummary>; summarizeOne(path: string): Promise<TranscriptSummary | null> }
export function readJsonWithRetry<T>(path: string, parse: (raw: unknown) => T, accept?: (v: T) => boolean): Promise<T | null>;   // 0, 20, 50, 100, 250, 500 ms
export class HolderRegistry { constructor(paths: StorePaths, sink: (sessionId: SessionId, holder: Holder, registry: LiveSessionRecord | null, job: JobState | null) => void);
  start(): Promise<void>; refresh(): Promise<void>; stop(): void; holderOf(sessionId: SessionId): Holder }
export class Bindings { bind(sessionId: SessionId, appSessionId: AppSessionId): void; appIdOf(sessionId): AppSessionId | null; sessionIdOf(appSessionId): SessionId | null }
export class FsService { /* wires the above, owns followers and bindings, registers fs.* on the host runtime */
  eventsSnapshot(appSessionId: AppSessionId, agentId: AgentId | null): Promise<{ events: SessionEvent[]; complete: boolean }>;   // the seam C3's session.events handler calls for a non-live app session; starts following
}
```

`readJsonWithRetry` reads the whole file, `JSON.parse`s, applies `accept` (for `sessions/<pid>.json`: `sessionId` present, because the engine patches the record by read-modify-write); a failure at any step schedules the next attempt; after the sixth failure it resolves `null` and the caller keeps its previous value. A change event on the same path restarts the schedule. This is the §4.3 "parsed with retry": `custom-title.json`, `agent-*.meta.json`, `wf_*.json`, `tasks/*/*.json`, `sessions/*.json` and `jobs/*/state.json` are all written without a documented atomic rename (SPEC 35.10, 35.27.1, 20.2.4, 40.16), and `.key` files (which are atomic) are not read.

**Holder rule** (`HolderRegistry`): for each `sessions/<pid>.json` that parses with a `sessionId`: alive iff `process.kill(pid, 0)` succeeds (EPERM counts as alive) and, when `procStart` is present, `LC_ALL=C ps -o lstart= -p <pid>` prints exactly that token (pid reuse guard; one batched `ps` per refresh). `kind: 'interactive'` → `{ kind: 'terminal', pid }`; `kind: 'bg'` → `{ kind: 'background_job', pid, jobId }`; `daemon` and `daemon-worker` → `{ kind: 'background_job', pid, jobId: null }`; a record with `spare: true` or a `parkedJobId` is not a holder. A `jobs/<short>/state.json` whose `sessionId` has no live registry record contributes name and state facts but no holder: liveness is decided by pids, never by the job's `state` string. Refresh runs on every `sessions/` change event and every 2,000 ms while at least one holder is known (the record's removal is a `process.on('exit')` unlink, so a killed terminal leaves a stale file until the next `claude` start reaps it); the within-two-seconds acceptance follows from the watcher on start and the poll on exit. A session with no live record has holder `{ kind: 'none' }`; MAWS-owned sessions are `{ kind: 'self' }` set by C3 through the index, never by this registry (a `-p` process writes no registry record).

### Replay engine (`src/engine-host/fs/replay/*.ts`)

```ts
export type Speed = number | 'instant';                 // 0.25 … 50, or everything as fast as the sink accepts
export class ReplayClock {
  constructor(opts: { speed: Speed; maxGapMs: number });  // maxGapMs default 2000: a recorded pause longer than this is shortened to it (at speed 1)
  schedule(recordedAt: number, fn: () => void): void;      // fires at base + Σ min(Δt, maxGap·speed)/speed, re-based on setSpeed/resume; drift-free (absolute deadlines, not accumulated setTimeout)
  setSpeed(speed: Speed): void; pause(): void; resume(): void; stop(): void; readonly state: 'running' | 'paused' | 'stopped';
}
export interface RowNormalizer { normalize(row: JournalRow): SessionEvent[] }                 // satisfied by C3's `Normalizer` (src/engine-host/normalizer.ts, pure JournalRow → SessionEvent[])
export class ReplayRunner {
  constructor(deps: { appSessionId: AppSessionId; sessionId: SessionId; clock: ReplayClock; emit: (events: SessionEvent[]) => void; progress: (p: ReplayProgress) => void });
  runJournal(rows: JournalRow[], normalizer: RowNormalizer): Promise<void>;   // both directions, paced by `at`; every frame's session_id rewritten to the run's fresh id before normalising
  runTranscript(records: TranscriptRecord[]): Promise<void>;                  // backfill mapping over the chain, paced by record timestamp
  control(action: 'pause' | 'resume' | 'stop', speed?: Speed): void;
}
```

A replay run gets a fresh `SessionId` `rp_<uuid>` and a fresh `AppSessionId` so two replays of one fixture never collide, and every frame's or record's `session_id`/`sessionId` is rewritten to it before leaving the source; the index record for the run has `kind: 'replay'`, `holder: { kind: 'none' }`, `title` from the fixture name (`source: 'tool'`). Journal replay emits `session.eventBatch` after C3's `Normalizer`; the runner takes the normaliser as a dependency so C4's unit tests drive it with a collecting stand-in and the running app wires C3's class at registration time (`register.ts`); if C4 lands before C3, the journal runner is wired to a stand-in that emits one `frame.unknown` per `in` row so the controls and progress are real end to end, and M7 records which state was observed. `'instant'` speed emits everything in batches of 500 with a `setImmediate` between batches. C3's own `ReplayTransport` (a lockstep test seam that stands in for a process and advances when the adapter writes the recorded `out` frame) is a different thing with a different purpose and is untouched.

### Git service (`src/main/git/*.ts`)

Binary: `process.env.MAWS_GIT ?? '/usr/bin/git'` (Apple's shim to the Command Line Tools, present on the owner's Mac; C11's settings screen may add a setting). Every call is `execFile(git, ['-C', directory, …], { maxBuffer: 64 MiB, timeout: 10_000, env: { PATH, HOME, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } })`; `GIT_OPTIONAL_LOCKS=0` keeps `git status` from writing the index (the service is read-only even in side effects).

- `git.status`: `rev-parse --show-toplevel --git-dir --git-common-dir --abbrev-ref HEAD` (one call) then `status --porcelain=v2 --branch -z --untracked-files=normal`; `stash list --format=%H` for the count. Parsing: `# branch.oid/head/upstream/ab` headers; `1 <XY> …`, `2 <XY> … <path>\0<origPath>`, `? <path>`; `isWorktree` when `git-dir !== git-common-dir`.
- `git.branches`: `for-each-ref --format=%(refname:short)%00%(upstream:short)%00%(HEAD) refs/heads`.
- `git.diff`: `diff --no-color --no-ext-diff -U<context> [--cached | HEAD] [base] [-- path]` plus `diff --numstat` for the file table (`-` counts mark binaries).
- `git.log`: `log --format=%H%x00%h%x00%an%x00%aI%x00%s%x00%P -z -n <limit> [-- path]`.
- Watcher: per `repoRoot`, one `fs.watch(repoRoot, { recursive: true })` and one on `gitDir` when it lies outside the root (linked worktrees keep it under the common dir's `worktrees/<name>/`). Events are classified: paths under `.git/` count only for `HEAD`, `ORIG_HEAD`, `MERGE_HEAD`, `index`, `packed-refs`, `refs/**` (reason `head`, `index`, `refs`); everything else under the root is `worktree`; `.git/objects/**` and `*.lock` are ignored. Debounce 250 ms trailing; at most one `git status` in flight per root with a "dirty again" flag that re-runs once after it finishes; `git.changed` carries the fresh status so consumers do not round-trip. Ref-counted by `git.watch`/`git.unwatch` callers; the pinned summary (C8) and the composer strip (C7) are the expected callers.

### Test support (`test/support/store-fixture.ts`, `test/support/wire-projection.ts`, `test/fixtures/**`)

```ts
export class StoreFixture {      // a temporary CLAUDE_CONFIG_DIR tree built from fixtures, torn down after the test
  static async create(): Promise<StoreFixture>; readonly configHome: string; readonly paths: StorePaths;
  addTranscript(directory: string, sessionId: string, lines: string[] | TranscriptRecord[]): string;   // writes projects/<slugOf(directory)>/<sessionId>.jsonl; returns the path
  appendLines(path: string, lines: string[]): Promise<void>; appendBytes(path: string, bytes: Buffer): Promise<void>;   // torn-write simulation
  rewriteFile(path: string, lines: string[]): Promise<void>;                                          // temp-and-rename, the engine's GC shape
  addSidecar(sessionId: string, rel: string, content: string | object): string;                         // custom-title.json, subagents/agent-*.jsonl|.meta.json, workflows/…
  addRegistryRecord(pid: number, record: Partial<LiveSessionRecord>): string; removeRegistryRecord(pid: number): void;
  addJob(short: string, state: Partial<JobState>): string; addTask(listId: string, task: PersistedTask): string;
  dispose(): Promise<void>;
}
export function projectWire(rows: JournalRow[], scope: { parentToolUseId: ParentToolUseId | null }): CoreProjection;    // test helper, not a normaliser: user messages (uuid, text), assistant blocks (message uuid, index, type), tool uses (id, name), tool results (id, isError), compaction boundaries, from raw `in` frames
export function projectEvents(events: SessionEvent[]): CoreProjection;                                                    // the same projection over X1 events
```

Fixtures C4 adds under `test/fixtures/` (copies, never modified in place; the originals stay under `~/.claude` and `spikes/`):

- `transcripts/rewind-real.jsonl`: the 33-line probe transcript `bdb23713-…` copied from the owner's store (content is the probe's APPLE/BANANA exchange), the proof of anchor semantics and the input of the rewind-in-place test.
- `transcripts/subagent-parent.jsonl`: the 39-record parent transcript `9a1d4262-…` copied from the owner's store; with `spikes/protocol-probe/fixtures/subagent-sidecars/*` and `spikes/protocol-probe/fixtures/subagent.jsonl` it is the paired journal + JSONL + sidecars set.
- `transcripts/torn-tail.jsonl`: synthetic, twelve lines, the eleventh cut mid-object with NULs prepended to the twelfth, as SPEC 35.3.1 describes.
- The existing `test/fixtures/transcript-rewind.jsonl` (C1) stays in use for `currentChain`; C4's tests do not depend on its anchor's `leafUuid`, which the real fixture shows to be inverted (Surprises & Discoveries; C1 impact noted in the handback).

### Dependencies

No new native modules. Additions to `package.json`: none for the engine host or main beyond Node built-ins (`node:fs`, `node:fs/promises`, `node:sqlite`, `node:child_process`, `node:crypto`, `node:os`, `node:path`); `@types/node` 24 already types `node:sqlite`. Under vitest (Node 22 on the owner's machine) `node:sqlite` prints an `ExperimentalWarning`, silenced by `NODE_OPTIONS=--disable-warning=ExperimentalWarning` in the `test` script (verified locally; the flag exists since Node 21.3). better-sqlite3 is not added (Residue decisions, *SQLite binding*). chokidar is not added (*Watcher mechanism*).

## Cross-child reconciliation

What C4 adopted from the sibling documents on disk at authoring time, and what it asks of them. One line each, for the coordinator's single pass.

| Sibling asked or defined | C4's answer |
|---|---|
| C3, C6: event `session.eventBatch { appSessionId, events }` | adopted; C4 emits the same event for backfill, tail and replay, at most 500 events per batch (C3's cap); no `phase` field (the follow phase travels in `fs.followState`) |
| C3: command `session.events { appSessionId, afterSeq, limit } → { events, lastSeq, complete }`, owner engine-host | adopted as C3's; for an `appSessionId` with no live process C3's handler delegates to `FsService.eventsSnapshot`, which starts following and returns the materialised events with `lastSeq: 0`, `complete: state === 'following'` (one in-process seam in C3's `ipc.ts`) |
| C6: `ipcSource` drops batches whose `seq` is at or below the snapshot's `lastSeq` | **asked of C6**: disk-derived and replayed-transcript events carry `seq: null` (X1: `seq` is the journal row), and `null <= 0` is true in JavaScript, so that rule would drop every backfill batch; C4's event ids are deterministic (`<uuid>`, `<uuid>#<n>`, `anchor:<offset>`, `session:<id>:started`), so dedup by `id` covers the snapshot-batch overlap for every producer; C3's live events keep their `seq` for its own cursor |
| C6: `fs.readSpill { path, offset?, length? } → { content, bytes, truncated }` | adopted with C6's field names; output adds `offset` (additive) |
| C6: `fs.agentEvents { appSessionId, agentId } → { events }` | adopted; output adds `complete`; the call starts following the agent transcript and later events arrive on `session.eventBatch` with `agentId` set, which C6's child `ipcSource` already filters on |
| C3: queue and grants persisted in `<userData>/engine-host/state/<appSessionId>.json` through `SessionStateStore`; "C4's index may implement the port over SQLite later" | accepted for P0: C4 drops its `queued_messages` and `session_grants` tables and `session.queue.*`/`session.grants.*` proposals; §4.4's "queued messages" in SQLite is raised as `[parent-impact]` (handback) |
| C3: `SessionRecord.gateway` gains `baseUrl`, `autoModeServer` (additive X1 extension) | adopted; two columns; discovered sessions get `null` and `'unknown'` |
| C3: `toSessionRecordPatch(status)`, "what C4's index applies from a status" | adopted as `SessionStore.applyEngineStatus(appId, patch)`; C3's main-side glue (or C5's read model `applyEngineStatus`) calls it |
| C3: `attention.list`, `attention.changed { appSessionId, items }` | consumed, not redefined; C4 persists the per-session list through `AttentionStore.replaceForSession` from C5's `applyAttention`. Note for the coordinator: C5 writes the payload as `{ appId, items }`, C3 as `{ appSessionId, items }`; C4 uses C3's |
| C5: `ProjectRecord { id, name, directory, order, createdAt }`, `session.list`, `session.setVisible`, `session.markRead`, `session.setPinned`, `session.changed`, `session.removed`, `session.projectChanged`, `session.projectRemoved`, the read model and `SessionSource`/`ReadModelWriter` | adopted; C4's `IndexSessionSource` is the production `SessionSource` and persists `onMarkRead` and `onSetPinned`; C4 drops its own `session.list/get/update` proposals; until C5's read model lands, C4 answers C5's read-side entries with an interim handler over the same stores so its acceptance is observable (M4) |
| C5: project actions "add directory", "remove project" (no X2 entries in C5) | **proposed to C5**: `session.projects.add { directory }`, `session.projects.update { id, patch }`, `session.projects.remove { id }`, owner main, answered from the index; the read model emits the resulting `session.projectChanged`/`projectRemoved` |
| C5: `layout.get/set` over `<userData>/layout.json`, `LayoutState.panel.bySession` holding per-session panel tabs | accepted: C4 persists no layout and drops its `layout` table and `layout.*` proposals; §4.4's "tab and panel layout" in SQLite is raised as `[parent-impact]` (handback) |
| C5: digest `lastAssistantLine` for sessions nobody opened | supplied: `TranscriptSummary.lastAssistantText` (last assistant text block in the tail, 200 chars) through `writer.setDigest` for discovered, non-live sessions |
| C3: `Normalizer: JournalRow → SessionEvent[]` (pure) | consumed by C4's `ReplayRunner.runJournal` through the `RowNormalizer` interface; C3's `ReplayTransport` is a separate test seam and untouched |
| C1: `test/fixtures/transcript-rewind.jsonl` anchor | **asked of C1**: the rewound anchor should read `leafUuid: "a1"`, `lastPrompt: "Also remember BANANA."`, `explicit: true` (the preceding assistant and the rewound-away prompt), per the raw probe transcript; `currentChain` is unaffected |
| C1: `HostSupervisor` | C4 adds `onEvent(name, listener)` (main-side subscription to host events) beside `onState`; additive |

## Acceptance

C4 closes when all of the following are observed on the owner's Mac against the real `/Users/new/.claude`, read-only, in this order, from a checkout with C1 landed (`pnpm install`, `pnpm build`). Before starting, record `ls -la ~/.claude/projects | wc -l` and `find ~/.claude/projects -maxdepth 2 -name '*.jsonl' | wc -l`; after item 9, the same commands print the same numbers and `git -C ~/.claude status --short` (the owner's config home is a git repository) shows no change that MAWS made: the store is untouched.

1. `pnpm dev` opens MAWS; the Store section of the diagnostics strip reads `store · /Users/new/.claude · watching` within one second and `projects N · sessions M · scan 1.x s` within five seconds, with `M` equal to the number of `*.jsonl` files under `projects/*/` that are not `.orphaned-` or `.superseded-` and `N` the number of distinct existing directories among them. Every listed session row (from `session.list`) shows its title (custom title if any, else the AI title, else the first prompt), its directory from the first record, and a holder badge (`terminal · pid`, `bg · jobId · pid`, or none). The rows for the ten sessions listed in `~/.claude/sessions/*.json` whose pids are alive show the badge; every other row shows none.
2. In a terminal, `cd /tmp/maws-accept && claude` (a trusted scratch directory). Within two seconds of the prompt appearing, a new row appears under `/private/tmp/maws-accept` (once the first record is written) or the existing row for that session shows `terminal · <pid>`; `ps -p <pid>` lists the `claude` process. Quit the terminal session; within two seconds the badge disappears.
3. In that terminal session: type `Remember APPLE.`, wait for the reply, type `Remember BANANA.`, wait, then `/rewind` and pick the first prompt (restore conversation). In MAWS, with the row followed (its detail open), the chain length (shown as `chain N · leaf <uuid8>`) decreases before any new turn is sent, and the event log shows one `boundary.rewind` whose `precedingAssistantUuid` is the assistant reply to APPLE and whose `prefillText` is `Remember BANANA.`. Send `List every word I asked you to remember.`; the chain grows from the rewound leaf and the log shows no `boundary.retraction`.
4. `pnpm test -- src/engine-host/fs/backfill` passes and includes the suite `subagent sidecars map to the X1 graph`: both `agent-*.jsonl` files under `spikes/protocol-probe/fixtures/subagent-sidecars/` produce events whose every `agentId` equals the sidecar id and whose every `parentToolUseId` equals the `.meta.json` `toolUseId`, and the parent transcript `test/fixtures/transcripts/subagent-parent.jsonl` produces `subagent.started` and `subagent.finished` for both.
5. `pnpm test -- src/engine-host/fs/replay` passes and includes `journal replay and transcript backfill agree`: over the paired probe session, `projectWire` of the parent conversation (`parent_tool_use_id` null) from the journal at `'instant'` speed equals `projectEvents` of the backfill of `subagent-parent.jsonl`, and the same holds per child between the child-attributed journal frames and each sidecar's backfill. The journal side uses `test/support/wire-projection.ts`, not C3's normaliser (M5).
6. In the diagnostics strip, replay `spikes/protocol-probe/fixtures/pass2/workflow.jsonl` at speed 5: a new session row `replay · workflow` appears, the progress reads `running · i / total · 5×` and reaches `done`; pause, speed change to 1 and `'instant'` behave as labelled; replay of `test/fixtures/transcripts/subagent-parent.jsonl` (transcript source) emits the same events as item 5's backfill, paced.
7. From DevTools: `await window.maws.invoke('session.setPinned', { appId: '<an appId from the list>', pinned: true })`, `await window.maws.invoke('session.drafts.set', { appSessionId: '<the same>', draft: { doc: { type: 'doc' }, attachments: [], updatedAt: new Date().toISOString() } })`, `await window.maws.invoke('session.projects.add', { directory: '/Users/new/Developer/GitHub/MAWS' })`. In the terminal, `/rename C4 acceptance` inside the session of item 2. Quit MAWS (Cmd+Q) and `pnpm dev` again: the row shows a pin and the title `C4 acceptance` with source `user`, `session.drafts.get` returns the draft, the project is listed with `origin: 'user'` behind C5's `ProjectRecord`, and `sqlite3 "$HOME/Library/Application Support/MAWS/index.sqlite" 'pragma user_version; select count(*) from sessions'` prints `1` and a count equal to item 1's `M` plus the replay rows. Layout is C5's `layout.json` and is not part of this check.
8. Select the row for a session whose directory is a dirty git worktree (for instance this repository with an uncommitted edit): the Git detail reads the branch, `ahead/behind`, and `dirty · K files`. In a terminal, `touch /Users/new/Developer/GitHub/MAWS/.c4-accept && echo x >> /Users/new/Developer/GitHub/MAWS/.c4-accept`; within one second the detail shows `K+1` with `.c4-accept` listed as untracked; `rm` it and the count returns. `git.diff` for the worktree scope returns a patch containing the owner's real uncommitted change.
9. `pnpm test` passes in full, and its output includes the suites named in the milestones below; `pnpm verify` (C1's chain) exits 0; the read-only guard suite `filesystem service never imports a write API` passes.

## Plan of Work

Constraints for every milestone are in Constraints above; each milestone says what exists at its end, what it touches, what it exposes and consumes, the decisions that are its alone, its edge, and what it proves. Files are repository-relative. Working directory for every command: `/Users/new/Developer/GitHub/MAWS`.

### M1 — Store shapes, chain follower and transcript-to-X1 backfill against fixtures

At the end of M1 the pure-TypeScript core exists and is proven on fixtures with no Electron and no real store: the store record schemas, `slugOf`, the discovery summariser over a head and a tail buffer, `recordToEvents` with the mapping table, and `ChainFollower` driven by a fake `FileReader` (a `Buffer` growing in steps) through every transition in its table. `pnpm test -- src/shared/wire src/engine-host/fs` shows the suites below green.

Touches: `src/shared/wire/store.ts` (+ test), `src/engine-host/fs/paths.ts` (`resolveStorePaths`, `slugOf`), `src/engine-host/fs/summarize.ts`, `src/engine-host/fs/backfill.ts`, `src/engine-host/fs/chain-follower.ts` and their tests, `test/support/store-fixture.ts` (the transcript and sidecar parts), `test/fixtures/transcripts/{rewind-real,subagent-parent,torn-tail}.jsonl`, `test/support/fixtures.ts` (one added loader `loadTranscriptFixture(name)`; C1's file, additive).

Exposes: everything under "Store record shapes", "Chain follower and backfill" and the fixtures. Consumes: C1's `TranscriptRecord`, `parseTranscriptRecord`, `currentChain`, `LastPromptAnchor`, `AgentMeta`, the X1 event schemas and brands.

Decisions local to M1: the follower reads through the injected `FileReader` so tests drive it with an in-memory buffer and M3 supplies the `fs` one; `slugOf` implements SPEC 35.2.1 exactly (no lowercasing, `-` for every non-alphanumeric, the 200-cut with `Math.abs(hash32).toString(36)`), pinned against the owner's `-Users-new-Developer-GitHub-MAWS` and `-private-tmp-maws-probe-WmHZ2j`; `summarize` uses the engine's own head/tail rules (SPEC 35.14.2: last `customTitle`/`aiTitle`/`lastPrompt`/`relocatedCwd`/`gitBranch` in the tail, first `cwd` in the head, `hasMessages` from a `"parentUuid":` marker) and never parses more than the two 64 KiB windows; the backfill treats one disk `assistant` record as one block (the `apiBlockIndex` form the store actually uses) and folds a multi-block `content` array by index when a record carries several; `EventId`s are deterministic as Interfaces states; `spillPath` prefers `toolUseResult.persistedOutputPath` and falls back to `SPILL_MARKER`. `boundary.rewind.targetMessageUuid` is the first `user`-typed record after the cut point on the old chain; when no such record exists yet (an anchor arriving with nothing to cut), no event is emitted and `pendingRewind` waits for the branch.

Does not touch: any `fs.watch`, any Electron API, the index, IPC registries, the renderer.

Proves: acceptance item 4 (the sidecar suite) and the backfill half of item 5. Pins beyond acceptance, one line each: `rewind-real.jsonl` fed whole yields the chain `e3b48834 … edf0f954, af765f44, a4d68c72, 7c05f769` (uuid prefixes), no gap, exactly one `boundary.rewind` with `precedingAssistantUuid` `edf0f954…`, `prefillText` `"Also remember the word BANANA. Reply OK."`, `targetMessageUuid` `36a2aa44…`, and no `boundary.retraction`; the same file fed in two steps split at line 26 (after the anchor) emits the `boundary.rewind` at step one, before the branch record; fed with the anchor line removed, the branch at line 29 yields `boundary.retraction { retractedMessageUuids: [36a2aa44…, 57525d04…], reason: 'transcript_branch' }` plus a `notice.posted` warning; C1's `transcript-rewind.jsonl` yields the chain `u1, a1, u3, a3` (the follower agrees with `currentChain` whatever the anchor says); `torn-tail.jsonl` fed byte by byte in random cut sizes always ends with the same eleven records, `skippedLines === 1`, and no event emitted twice (ids unique); a growing file whose new record's parent is the leaf never triggers a re-read of older bytes (the reader mock records the ranges asked for); `slugOf('/a/b') === '-a-b'` and a 260-character path yields 200 characters, `-`, and a base-36 hash; `SPILL_MARKER` matches the three engine strings and captures the path, and a record with both `persistedOutputPath` and a marker yields the structured field's value; `summarize` over `subagent-parent.jsonl` reports `directory /private/tmp/maws-probe-WmHZ2j`, `engineVersion 2.1.283`, `hasMessages true`, an `aiTitle`, and `leafUuid` equal to `currentChain(...).leaf.uuid`; a record of an unknown type yields `frame.unknown` with `frameType 'transcript:<type>'`, and an `attachment` yields nothing; every emitted event has `seq === null`.

### M2 — Filesystem state service, part one: watcher, discovery, sidecars, holders

At the end of M2 the engine host watches the store and knows who exists and who holds what: `pnpm dev` shows the Store section with the config home, the scan counts, every session's summary row and holder badge; starting `claude` in a terminal flips a row to `terminal · pid` within two seconds and quitting flips it back; renaming a session with `/rename` in the terminal updates the title within a second (the `custom-title.json` sidecar plus the tail record). Nothing is tailed yet beyond the 64 KiB head and tail.

Touches: `src/engine-host/fs/{watcher,discovery,sidecars,holders,bindings,service,register}.ts` and tests, `src/engine-host/index.ts` (one line: `registerFs(on, emit)`; C3 edits this file too, see Cross-child reconciliation), `src/shared/ipc/schema/fs.ts` (`fs.state`, `fs.scan`, `fs.bind`, `fs.sessionChanged`, `fs.sessionRemoved`, `fs.holderChanged`, `fs.scanProgress`), `test/support/store-fixture.ts` (registry and job parts), `src/renderer/src/app/StoreDiagnostics.tsx` and `src/renderer/src/stores/store-diagnostics.ts` (a diagnostics-only store over `fs.*` events; M4 switches the row list to `session.list`), `src/renderer/src/app/Diagnostics.tsx` (mount the section).

Exposes: `StoreWatcher`, `Discovery`, `readJsonWithRetry`, `HolderRegistry`, `Bindings`, `FsService`, the commands and events named above. Consumes: M1.

Decisions local to M2 (mechanism choices are the charter-bound residue *Watcher mechanism* and *Sidecar retry*; what follows is their execution). `StoreWatcher` opens `fs.watch(paths.projects, { recursive: true })`, `fs.watch(paths.sessions)`, `fs.watch(paths.jobs, { recursive: true })`, `fs.watch(paths.tasks, { recursive: true })`; a missing directory is retried every 5 s (a fresh config home has no `jobs/`). Each event is classified by its relative path into a `StoreChange` and coalesced per key with a 50 ms trailing debounce; an event with a null filename or an `error` on the watcher becomes `{ kind: 'rescan', root }`, and a watcher error re-opens the watch after 1 s. Ignored outright: `projects/*/memory/**`, `*/tool-results/**` (spills are read on demand), `*.tmp.*`, `.session-aliases`, `*.cast`, `.fleetview-heartbeat`, `*.key*`. Discovery runs at `start` and on `fs.scan`: `readdir(projects)`, per slug `readdir`, for each `<uuid>.jsonl` not containing `.orphaned-` or `.superseded-` a `stat`; files whose `(size, mtimeMs)` match the `known` map passed by main are skipped (their `appSessionId` is recorded in `Bindings`); the rest are summarised with concurrency 16, most recently modified first, yielding `fs.sessionChanged` as they complete and `fs.scanProgress` every 100 files. A transcript change event re-summarises just that file (two 64 KiB reads) and emits `fs.sessionChanged` when any summary field changed; a `custom-title.json` change is folded into the same summary through `readJsonWithRetry`. A transcript whose `stat` fails with `ENOENT` after a change emits `fs.sessionRemoved`. `HolderRegistry` implements the Holder rule of Interfaces; the `ps` call is `execFile('/bin/ps', ['-o', 'pid=,lstart=', '-p', pids.join(',')], { env: { LC_ALL: 'C' } })` and a `ps` failure degrades to `kill(pid, 0)` alone. The `jobs/` reader parses `state.json` with `readJsonWithRetry` (cap 8 MiB; larger is treated as absent, the engine's own rule) and joins on `sessionId`. `fs.state` is the snapshot command C1's reload-survival rule asks for. Directory realpath for project membership is main's job (M4); the host reports what the records say.

Does not touch: tailing past the head and tail windows, X1 event emission, the index, git, replay.

Proves: acceptance items 1 and 2 (with the M2 diagnostics as the surface; M4 puts `session.list` behind it). Pins: over a `StoreFixture` with three transcripts, `fs.scan` reports `sessions: 3` and emits three `fs.sessionChanged` whose `directory`, `customTitle` (one from `custom-title.json`, one from a tail record, one null) and `hasMessages` are as authored; a second `fs.scan` with the returned sizes and mtimes as `known` reports `changed: 0` and later events for those sessions carry the `appSessionId` given in `known`; appending a `custom-title` line emits one `fs.sessionChanged` with the new title within 200 ms; writing `sessions/<ownPid>.json` with `kind: 'interactive'` and the fixture's session id (using the test's own pid, which is alive) emits `fs.holderChanged` with `{ kind: 'terminal', pid }` within 500 ms, and a record for a pid that does not exist (`2**22 - 1`) emits none; a record written in two steps (first without `sessionId`, then complete 60 ms later) emits exactly one `fs.holderChanged`; a record whose `procStart` does not match the process's start time emits none (pid reuse); removing the record emits `{ kind: 'none' }`; a `jobs/<short>/state.json` plus a live `bg` registry record yields `{ kind: 'background_job', pid, jobId: short }`; a `state.json` alone yields `{ kind: 'none' }`; `fs.watch` receiving `rename` with a null filename leads to a `rescan` that discovers a transcript created meanwhile; a file whose name contains `.orphaned-` is never listed; the read-only guard `filesystem service never imports a write API` fails on `writeFile`, `appendFile`, `rename`, `unlink`, `rm`, `mkdir`, `truncate`, `open(…, 'w'|'a')` under `src/engine-host/fs/**` (excluding `*.test.ts`) and passes on the milestone's sources.

### M3 — Filesystem state service, part two: tailers, following, subagents, workflows, tasks, spills

At the end of M3 a session can be followed: `FsService.eventsSnapshot` (reached through C3's `session.events` for non-live sessions, or through an interim registration of that handler when C3 has not landed) backfills its transcript into `session.eventBatch` batches of 500 and then tails it, the diagnostics detail shows `chain N · leaf <uuid8>` and the last twenty events, a `/rewind` in the terminal shrinks the chain and emits `boundary.rewind`, subagent transcripts are listed and followed with `agentId` attribution through `fs.agentEvents`, workflow runs are read from `wf_*.json` and the journal, tasks lists are read, and a spilled result is fetched by the path a `tool.result` carries.

Touches: `src/engine-host/fs/{follow,subagents,workflows,tasks,artifacts}.ts` and tests, `src/engine-host/fs/service.ts` (followers table, `eventsSnapshot`), `src/shared/ipc/schema/fs.ts` (the remaining commands and events), `src/renderer/src/app/StoreDiagnostics.tsx` (follow toggle, chain and event log detail).

Exposes: `fs.unfollow`, `fs.subagents`, `fs.agentEvents`, `fs.workflows`, `fs.tasks`, `fs.readSpill`; the `fs.followState`, `fs.subagentsChanged`, `fs.workflowChanged`, `fs.tasksChanged` events; `FsService.eventsSnapshot`; C4 emits `session.eventBatch`. Consumes: M1's follower and backfill, M2's watcher, service and bindings.

Decisions local to M3 (the tail strategy is the residue *Tail strategy*; what follows is its execution). The `fs` `FileReader` opens the file per read with `fs.open(path, 'r')`, `fstat`s, reads the range, closes; no descriptor is held between reads, so a rename-over or relocation is seen as an `ino` change at the next `poke`. A followed session is poked by the watcher's `transcript` change for its path and by a 30 s reconcile timer (FSEvents can coalesce or drop under load; the timer is the floor). Following an app session whose transcript does not exist yet (a MAWS-launched session before its first record) is allowed: the follower waits for the file to appear. `eventsSnapshot` starts the follower if needed and returns the events materialised at the moment of the call (`complete` true only once backfill finished); the rest arrives as `session.eventBatch`, and the deterministic ids make the overlap harmless. A `sidecar` change under `subagents/` re-lists agents and emits `fs.subagentsChanged`; a followed agent is a second `ChainFollower` with `agent: { agentId, parentToolUseId: meta.toolUseId }` whose events go out on `session.eventBatch` with `agentId` set. Workflow runs: `workflows/<runId>.json` through `readJsonWithRetry`, journal rows parsed leniently; a change emits `fs.workflowChanged` and, for a followed session, one `workflow.progress { taskId: snapshot.taskId, workflowName, progress: snapshot.workflowProgress }` event per snapshot change so C8's Background work tool sees the same shape the wire sends (pass-2 item 3: each progress is a whole snapshot). Tasks: `tasks/<listId>/*.json` through `readJsonWithRetry`, `metadata._internal` rows filtered as the engine does. `fs.readSpill` realpaths the requested path and refuses anything outside the three roots; reads are bounded to `length` (default 1 MiB) from `offset`. `fs.unfollow` stops the follower and, with `agentId: null`, its agents; every follower is stopped when the host stops. When C3's `ipc.ts` is not in the tree, `register.ts` registers a temporary `session.events` handler with C3's exact schema that answers only through `eventsSnapshot`; it is deleted when C3 lands (C3's handler delegates for non-live sessions).

Does not touch: the index, git, replay, any `session.*` entry other than emitting `session.eventBatch` and the temporary `session.events` handler.

Proves: acceptance item 3 and the followed half of item 1's detail. Pins: over a `StoreFixture` copy of `rewind-real.jsonl` truncated to its first 25 lines, `eventsSnapshot` emits `session.eventBatch`es covering the chain through `57525d04…` then `fs.followState { state: 'following' }`; appending line 26 (the rewound anchor) emits `boundary.rewind` in a batch within 300 ms and `fs.followState.chainLength` drops by two; appending lines 27 to 33 grows the chain to `7c05f769…` with no retraction; appending a record whose `parentUuid` is the leaf as two separate writes split mid-JSON delivers exactly one event after the second write; `rewriteFile` with the abandoned branch removed (the GC shape) emits `fs.followState { state: 'reloading' }` then `following` with the same chain and no duplicate event ids; a subagent sidecar appended under `subagents/` emits `fs.subagentsChanged` with the agent listed and `meta` parsed after a deliberately delayed `.meta.json` write (200 ms), and `fs.agentEvents` returns events all carrying `agentId` and `parentToolUseId`; the workflow-disk fixture copied under `<sessionId>/workflows/` and `subagents/workflows/<runId>/` lists one run whose snapshot has `agentCount: 2` and whose journal has five rows, and a followed session emits one `workflow.progress` whose `progress` deep-equals the snapshot's `workflowProgress`; `fs.readSpill` on `<configHome>/../outside.txt` fails with `internal` and `path outside the engine store`, on a spill path returns `truncated: true` when `length` is smaller than the file and `bytes` equal to the file size; a second `eventsSnapshot` while following returns every event once, with `complete: true`; the follower over the 84 MB transcript copied from the owner's store (`-Users-new-Developer-GitHub-designer/b6bc4470…`, run manually, not in CI) completes backfill in under 20 s with the engine-host RSS under 400 MB (recorded in Surprises & Discoveries with the measured numbers).

### M4 — The index in main: `node:sqlite`, stores, the `SessionSource`, projects and drafts

At the end of M4 main owns the index: at `app.whenReady()` it opens `<userData>/index.sqlite`, runs migrations, and `IndexSessionSource` subscribes to the engine host's `fs.*` events through `HostSupervisor.onEvent`, folds summaries and holders into session records and projects (allocating app ids and binding them into the host), and feeds C5's read model; main answers `session.projects.*` and `session.drafts.*`, and, until C5 lands, C5's read-side entries with an interim handler. Pins, marks-read, project membership, drafts and terminal renames survive a restart, and the diagnostics row list reads `session.list`.

Touches: `src/main/index/{db,migrations,index,sessions,projects,attention,drafts,replay-fixtures,source,register}.ts` and tests, `src/main/hosts/supervisor.ts` (`onEvent(name, listener)`; C1's file, additive), `src/main/index.ts` (open the index, start the source; C1's file, additive), `src/shared/ipc/schema/session.ts` (C4's entries; C5's read-side entries added with C5's exact schemas when C5 has not landed, marked for C5 to own), `src/renderer/src/app/StoreDiagnostics.tsx` (row list from `session.list` and `session.changed`), `package.json` (`test` script gains `NODE_OPTIONS=--disable-warning=ExperimentalWarning`).

Exposes: the `Index` and store classes of Interfaces, `IndexSessionSource`, `session.projects.*`, `session.drafts.*`, `HostSupervisor.onEvent`. Consumes: M2 and M3 events, C1's supervisor and router (`registerMainHandler`, `emit`), C5's `SessionSource`/`ReadModelWriter` port and `ProjectRecordSchema`.

Decisions local to M4 (the library is the residue *SQLite binding*; the schema and location are *Index schema and location*; what follows is their execution). `db.ts` wraps `DatabaseSync` in a `Db` with `exec`, `prepare` (cached by SQL text), `transaction(fn)` (`BEGIN IMMEDIATE` … `COMMIT`/`ROLLBACK`), so a swap to another driver is one file. `source.ts`: on `fs.sessionChanged`, `sessions.upsertFromSummary` inside a transaction with project resolution (realpath the effective directory; the membership rule and the title rule of Interfaces), then `writer.upsertProject`/`upsertSession`/`setDigest`; a record created here gets a fresh `AppSessionId` and one `fs.bind` per batch of new ids. On `fs.holderChanged`, `setHolder` unless the record's holder is `self` (C3 owns its own processes). On `fs.sessionRemoved`, archive-and-keep. Startup order: open the index, register handlers, start the source, then `fs.scan { known }` with the index's `(sessionId, appSessionId, size, mtimeMs)` map so an unchanged store costs one `readdir` pass; the read model's `revision` and `session.changed` emission are C5's (the interim handler emits `session.changed { record, revision }` per change with one counter and `digests: []`, coalesced per 16 ms tick during the scan so 3,690 rows do not become 3,690 IPC messages). Unread is the read model's decision from visibility (C5); the index persists `unread` through `setUnread` and the cursor through `markSeen`; the interim handler's `session.markRead` calls `markSeen` and its `session.setVisible` is a no-op. Replay records (`kind: 'replay'`) are created by `session.replay.start` (M5) and removed on `stop`. Following is explicit: C6's transcript calls `session.events` when a tab opens and `fs.unfollow` when it closes; main only ensures `fs.unfollow` for records it removes.

Does not touch: git, replay sources, the engine host beyond consuming its events, attention creation, the queue, layout.

Proves: acceptance item 7 and the record side of item 1. Pins: a fresh `Index` on a temp path has `user_version 1` and the five tables; opening it again runs no migration and keeps rows; a database at `user_version 99` opens read-only and `session.setPinned` returns `internal`; `upsertFromSummary` twice with the same summary creates one row and returns `created: false` the second time; a summary whose directory is a `.claude/worktrees/<name>` under a project's directory joins that project with `worktree.path` set; a summary whose directory does not exist on disk gets `projectId: null` and creates no project; `session.projects.remove` then a rediscovery leaves the project hidden and the session attached to it; `update` with a user title then `upsertFromSummary` with an `aiTitle` keeps the user title, and `upsertFromSummary` with a `customTitle` over a `generated` title takes it with `source: 'user'`; `setHolder` on a `self` record is a no-op; `upsertFromSummary` for 4,000 synthetic summaries inside one transaction completes under 500 ms; `attention.replaceForSession` then `list` returns the items and `retireForSession` empties them; `drafts.set(null)` deletes; a `ProjectRecord` projected from a row has exactly C5's five fields; the source calls `fs.bind` with every app id it allocated during a scan of a fixture store with three new sessions, and later `fs.sessionChanged` events for them carry those ids.

### M5 — Replay engine: clock, journal and transcript sources, `session.replay.*`

At the end of M5 any journal or transcript replays into the graph at a chosen speed with pause, resume, speed change and stop, and the diagnostics strip drives it; the consistency test over the paired probe fixture passes; the fixtures table lists the probe journals and C4's transcripts.

Touches: `src/engine-host/fs/replay/{clock,runner,journal-source,transcript-source}.ts` and tests, `src/engine-host/fs/register.ts` (`session.replay.control`, the host-side start; wiring of C3's `Normalizer` or the stand-in), `src/main/index/replay.ts` (`session.replay.start`: creates the `kind: 'replay'` record, binds, dispatches to the host, forwards `session.replay.progress` into `session.changed` causes), `src/main/index/replay-fixtures.ts` (seeded at first open with every journal under `spikes/protocol-probe/fixtures/**/*.jsonl` and `test/fixtures/transcripts/*.jsonl` that exists at that path), `src/shared/ipc/schema/session.ts` (the replay commands and event), `test/support/wire-projection.ts`, `src/renderer/src/app/StoreDiagnostics.tsx` (fixture picker, speed, pause/resume/stop, progress).

Exposes: `ReplayClock`, `RowNormalizer`, `ReplayRunner`, the `session.replay.*` commands and `session.replay.progress`. Consumes: M1's backfill, M4's records, C1's fixture loader, C3's `Normalizer` when present.

Decisions local to M5 (the clock is the residue *Replay clock and speed*; what follows is its execution). The clock keeps `t0` (first row's `at`), `base` (real time at start or last re-base) and `speed`; `schedule(at, fn)` computes `deadline = base + min(at - prevAt, maxGapMs * speed) / speed` cumulatively so long recorded pauses (a fixture that sat waiting for a human) are shortened to `maxGapMs` of real time at speed 1, and fires with one `setTimeout` per row against absolute deadlines (drift-free); `setSpeed` and `resume` re-base at the current row; `'instant'` bypasses timers. The journal runner yields `in` and `out` rows both (C3's normaliser needs the `out` control responses to close its request table), rewriting `session_id` in the frame and `sessionId` where present; the transcript runner yields backfill events paced by record `timestamp` (records without a timestamp inherit the previous). Progress is emitted every 25 rows and on every state change. `test/support/wire-projection.ts` is a test helper, not a normaliser: it reads `assistant.message.content`, `user.message.content` `tool_result` blocks and `system/compact_boundary` from raw `in` frames and attributes by `parent_tool_use_id`; `projectEvents` applies the same projection to X1 events, which makes the two sides comparable. Once C3's `Normalizer` is in the tree, a follow-up test (`replay through the normaliser agrees with backfill`) runs the same comparison with C3's output on the journal side, recorded in Progress as pending until then.

Does not touch: the git service, any change to the follower, C3's normaliser.

Proves: acceptance items 5 and 6. Pins: a clock at speed 2 over rows at 0, 1000, 3000 ms fires the second row about 500 ms after start and the third about 1500 ms (tolerance 50 ms, fake timers); `setSpeed(4)` after the second row fires the third about 500 ms later; a 60 s recorded gap fires after 2 s at speed 1; `pause` then `resume` after 300 ms shifts every remaining deadline by 300 ms; `'instant'` over 3,300 rows completes in under 200 ms and delivers batches of at most 500; two concurrent replays of the same journal produce events with two distinct `sessionId`s and two distinct `appSessionId`s, neither equal to the fixture's original; the journal runner over `pass2/rewind.jsonl` hands the normaliser exactly the fixture's `in` and `out` row counts; the paired-fixture consistency assertion of acceptance item 5 holds and fails when one `tool_use` id is altered in a copy of the parent transcript (the test proves the comparator sees); `session.replay.start` creates a `kind: 'replay'` record that `session.list` shows and `stop` removes.

### M6 — Read-only git service: `git.*` and the repository watcher

At the end of M6 main answers `git.status`, `git.branches`, `git.diff`, `git.log` for any directory inside a repository or linked worktree, watches repositories on request and emits `git.changed` with the fresh status within a second of a file change; the diagnostics strip shows the selected session's branch, ahead/behind, dirty count and file list.

Touches: `src/main/git/{service,porcelain,watcher,register}.ts` and tests, `src/shared/ipc/schema/git.ts`, `src/main/index.ts` (start the service; additive), `src/renderer/src/app/StoreDiagnostics.tsx` (git detail), `test/support/git-fixture.ts` (creates a temp repository and a linked worktree with `git init`, commits, and edits).

Exposes: the `git.*` commands and `git.changed`; `GitService.status(directory)`, `watch(directory)`, `unwatch(directory)` for main-side callers. Consumes: nothing from earlier milestones except the router.

Decisions local to M6 (the binary, parsing and debounce are the residue *Git invocation and watcher*; what follows is their execution). A directory that is not inside a repository fails with `internal` and message `not a git repository`; a repository whose `git status` exceeds 10 s fails with `timeout` and the watcher backs off to 5 s debounce for that root until a status succeeds. Porcelain v2 parsing is table-driven over the record types `#`, `1`, `2`, `u`, `?`, `!`; rename records take the two NUL-separated paths. `git.diff` with `scope: 'all'` is `diff HEAD`; `base` selects `diff <base>...HEAD`-style three-dot for branch comparisons (C8's Review "since its base"). The watcher's classification and debounce are as Interfaces states; a `git.changed` is emitted only when the status changed (deep-equal on `files`, `branch`, `head`, `upstream`, `ahead`, `behind`, `stashCount`), so a save that leaves the tree identical is silent. Worktrees under `<repo>/.claude/worktrees/` need no special case: `rev-parse` reports them as linked worktrees.

Does not touch: any write (`add`, `commit`, `stash`, `checkout`, `worktree add/remove` are C10 and P1), credentials, remotes (no `fetch`).

Proves: acceptance item 8. Pins: over a `git-fixture` repository with one commit, `git.status` reports `dirty: false`; after writing an untracked file, `dirty: true` with the file `untracked: true`; after `git add`, `index: 'A'`; `git.branches` lists `main` as current; a linked worktree created with `git worktree add .claude/worktrees/wt -b wt` reports `isWorktree: true`, `branch: 'wt'`, `commonDir` equal to the main repository's `.git`; `git.watch` then a file write emits `git.changed { reason: 'worktree' }` within 1 s and a second identical write emits nothing; `git commit` in the fixture emits `reason: 'head'`; `git.diff { scope: 'worktree' }` after editing a tracked file returns a patch with the edit and `files[0].insertions === 1`; `git.log { limit: 1 }` returns the commit with `parents: []`; `git.status` on `/tmp` fails `internal` `not a git repository`; the service invokes `/usr/bin/git` with `GIT_OPTIONAL_LOCKS=0` (asserted on the spawn mock).

### M7 — Acceptance against the owner's `~/.claude`, hardening, review

At the end of M7 the Acceptance section has been executed as written against the owner's real store, read-only, and ticked in Progress with timestamps; hardening findings from the run are fixed or recorded; the whole branch goes to the independent review the charter calls (reviewer-high).

Touches: whatever the run reveals, plus `docs/doperpowers/plans/2026-09-28-c4-filesystem-index-replay.md` (Progress, Surprises & Discoveries, Decision Log).

Consumes: everything.

Decisions local to M7: the run uses the default config home (no `CLAUDE_CONFIG_DIR`), a fresh `MAWS_USER_DATA` under `/tmp` for the first pass so the index is built from nothing, then the real `userData` for the restart check of item 7; the read-only proof is the before-and-after file count and `git -C ~/.claude status --short` (the owner's config home is under git; its `.gitignore` covers what the engine writes routinely, so any new path MAWS created would show); the 84 MB transcript is followed once by hand and its backfill time and RSS are recorded. If the terminal-started `claude` of item 2 does not appear within two seconds, the run records the observed delay and the watcher event timeline (`fs.state` twice a second) before any fix, so the Surprises entry has evidence. Item 5's journal side runs with the wire projection; if C3's normaliser has landed on master by then, the follow-up test of M5 is added and run in the same pass, and the temporary `session.events` handler of M3 is removed in favour of C3's delegation. Which of C3 and C5 have landed, and therefore which interim handlers were still in place, is recorded in Progress.

Does not touch: C3's, C5's, C6's code beyond the delegation seam; the charter (the coordinator pastes Residue decisions).

Proves: acceptance items 1 to 9 in order, then the review.

## Concrete Steps

Working directory for everything: `/Users/new/Developer/GitHub/MAWS`, in C4's worktree branched from master after C1 landed.

Core and fixtures (M1):

```
cp ~/.claude/projects/-private-tmp-maws-probe2-FIiJVW/bdb23713-2f6c-40f3-8b18-b41a667a64e3.jsonl test/fixtures/transcripts/rewind-real.jsonl
cp ~/.claude/projects/-private-tmp-maws-probe-WmHZ2j/9a1d4262-0b43-46ad-acb9-5982f31d209c.jsonl test/fixtures/transcripts/subagent-parent.jsonl
pnpm test -- src/shared/wire src/engine-host/fs
```

Expected tail:

```
 ✓ src/shared/wire/store.test.ts            store record schemas accept the owner's shapes
 ✓ src/engine-host/fs/paths.test.ts          slugOf matches the engine
 ✓ src/engine-host/fs/summarize.test.ts      head and tail summary
 ✓ src/engine-host/fs/backfill.test.ts       transcript records map to X1 events
 ✓ src/engine-host/fs/backfill.test.ts       subagent sidecars map to the X1 graph
 ✓ src/engine-host/fs/chain-follower.test.ts follows the leaf across a rewind
 ✓ src/engine-host/fs/chain-follower.test.ts survives torn tails and rewrites
```

Service (M2, M3):

```
pnpm test -- src/engine-host/fs test/support
pnpm dev
# diagnostics strip, Store section: "store · /Users/new/.claude · watching", then "projects N · sessions M · scan 1.x s"
# in a terminal: cd /tmp/maws-accept && claude   → within 2 s the row shows "terminal · <pid>"
# select the row, click Follow → "chain N · leaf xxxxxxxx", events list fills; /rewind in the terminal → chain shrinks, boundary.rewind listed
```

Index (M4):

```
pnpm test -- src/main/index
pnpm dev
# DevTools: await window.maws.invoke('session.setPinned', { appId: '<id>', pinned: true }) → row shows a pin; Cmd+Q; pnpm dev → pin persists
sqlite3 "$HOME/Library/Application Support/MAWS/index.sqlite" 'pragma user_version; select count(*) from sessions; select count(*) from projects where origin = "discovered";'
```

Replay (M5):

```
pnpm test -- src/engine-host/fs/replay test/support/wire-projection
# diagnostics: pick pass2/workflow.jsonl, speed 5, Start → "replay · workflow" row, progress to done; Pause/Resume/Instant behave
```

Git (M6):

```
pnpm test -- src/main/git
echo x >> .c4-accept        # in this repository, with MAWS showing this directory's session selected → git detail shows the file untracked within 1 s
rm .c4-accept
```

Acceptance (M7):

```
ls ~/.claude/projects | wc -l; find ~/.claude/projects -maxdepth 2 -name '*.jsonl' | wc -l; git -C ~/.claude status --short | wc -l   # record all three
MAWS_USER_DATA=/tmp/maws-c4-accept pnpm dev                                                                                          # items 1 to 6, 8
pnpm dev                                                                                                                            # item 7 (real userData), restart check
pnpm test && pnpm verify
ls ~/.claude/projects | wc -l; find ~/.claude/projects -maxdepth 2 -name '*.jsonl' | wc -l; git -C ~/.claude status --short | wc -l   # identical to the first three
```

If `pnpm dev` logs `Error: Cannot find module 'node:sqlite'` from main under Electron: the runtime is not the pinned Electron 44.4.5 (the check in Surprises & Discoveries was made against exactly that binary); confirm `pnpm ls electron`, and if a downgrade is deliberate, switch `src/main/index/db.ts` to better-sqlite3 with `electron-rebuild` per the documented fallback and record it in the Decision Log and the charter's residue.

If `fs.watch` throws `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM` for `recursive: true`: the host is not running on macOS; D-11 makes this out of scope, and the error is surfaced as `fs.state.watching === false` with the message, not as a crash.

## Residue decisions (C4, 2026-09-28)

Ready to paste under the charter's §12 C4 section as "**Residue decisions (C4, 2026-09-28):** what the design left to the child, settled here; the execution document `docs/doperpowers/plans/2026-09-28-c4-filesystem-index-replay.md` carries the milestones, the store shapes, the X2 additions, the cross-child reconciliation and the record." Grades: binding where the design binds the outcome, advisory where a later child may overturn with a dated line here.

- *Process placement*: the filesystem state service (watcher, discovery, tailers, sidecar and registry readers, spill reads, backfill, replay clock and sources) runs in the engine-host utility process; the SQLite index and the git service run in main; they talk only over C1's host protocol: the host emits validated X2 `fs.*` events and C3's `session.eventBatch`, which main consumes through a new `HostSupervisor.onEvent(name, listener)` and re-emits to the renderer, and main sends `fs.*` commands as `req`, including `fs.bind`, which tells the host the `appSessionId ↔ sessionId` pairs the index allocated so every renderer-facing payload carries `appSessionId`. The heavy-work worker §4.1 names is not forked in C4: discovery reads 64 KiB heads and tails (about one second for the owner's 3,690 transcripts), tailing is incremental and the index holds records, not text; the worker arrives with its first CPU-bound consumer (transcript search or the P1 scrubber). Alternative rejected: the index in the engine host beside the service, which would put app records behind a process C3 may restart. Binding on placement (§4.1); advisory on deferring the worker.
- *SQLite binding*: `node:sqlite` (`DatabaseSync`), built into Electron 44.4.5's Node 24.21.0 and into the Node 22 vitest runs on, replaces better-sqlite3 (S-4). Evidence: better-sqlite3 13.0.3 publishes no prebuilt binaries and 12.11.1's newest Electron prebuild is ABI 146 (Electron 41), so Electron 44 (ABI 149) would need a node-gyp rebuild plus a second build for tests; `ELECTRON_RUN_AS_NODE=1 electron@44.4.5 -e` shows `node:sqlite` present with SQLite 3.53.4 and FTS5; `node:sqlite` is Stability 1.2 (release candidate) from Node 24.15, the API is synchronous like better-sqlite3's, and the app uses only `exec`, `prepare`, `run`, `get`, `all` and transactions behind a one-file `Db` wrapper. Consequences: no `allowBuilds`, `asarUnpack` or `npmRebuild` change; `NODE_OPTIONS=--disable-warning=ExperimentalWarning` on the test script for Node 22. Documented fallback: better-sqlite3 with `electron-rebuild -f -w better-sqlite3`, C1's node-pty treatment, with a dated line here if it ever becomes the default. Advisory.
- *Watcher mechanism*: Node's `fs.watch` with `recursive: true` (FSEvents on macOS, one stream per root) over `projects/`, `jobs/`, `tasks/` and a flat watch over `sessions/`; events classified by relative path, coalesced per key with a 50 ms trailing debounce; a null filename or watcher error triggers a readdir-diff rescan of that root and re-opens the watch after 1 s; a 30 s reconcile timer stats followed files and a 2 s poll checks holder pids, as the floor under coalesced or dropped FSEvents. chokidar rejected: its add/change/unlink classification and write-finish heuristics are not needed by stat-and-offset readers, D-11 removes the cross-platform reason for it, and chokidar 5 is a second module-format question in a CommonJS host. Binding on "one watcher plus tailers" (§4.3); advisory on the API.
- *Tail strategy and partial lines*: per followed file a byte offset at the last complete `\n` and a partial-line buffer; on change, `fstat` then read `[offset, size)` only; `size < offset` or an inode change means the file was rewritten (GC, tombstone removal, hydration, relocation) and triggers a full reload with uuid re-anchoring; lines are split at `\n`, leading NULs stripped, unparseable lines skipped and counted (the engine's own reader rule), a torn fragment sealed by the writer's `\n` prefix parses as garbage exactly once; the follower keeps a uuid skeleton (parent, type, offset, length) and never the payloads, re-reading records by offset when a branch flip brings them onto the chain; a `rewound: true` anchor cuts the chain at its `leafUuid` immediately and emits `boundary.rewind`, a branch without an anchor emits `boundary.retraction { reason: 'transcript_branch' }` and a warning notice (the second-writer case of pass-2 item 10). Disk-derived events carry `seq: null` and deterministic ids (`<uuid>`, `<uuid>#<n>`, `anchor:<offset>`, `session:<id>:started`); consumers dedup by id, never by `seq`. Binding as the execution of §4.3's re-anchor rule.
- *Sidecar write-atomicity retry*: whole-file JSON sidecars (`custom-title.json`, `agent-*.meta.json`, `wf_*.json`, `tasks/*/*.json`, `sessions/*.json`, `jobs/*/state.json`) are read and parsed at 0, 20, 50, 100, 250 and 500 ms after a change until they parse and pass an acceptance predicate (`sessionId` present for registry records, which the engine patches by read-modify-write); after six failures the previous value is kept and the next change restarts the schedule. Reason: the SPEC documents bare `writeFile` for the registry and no atomic rename for the others. Binding (§4.3 "parsed with retry").
- *Holder detection*: a holder is a `sessions/<pid>.json` with a `sessionId` whose pid is alive (`kill(pid, 0)`, EPERM counts) and whose `procStart`, when present, matches `LC_ALL=C ps -o lstart=`; `interactive` maps to X1 `terminal`, `bg` to `background_job` with `jobId`, `daemon` and `daemon-worker` to `background_job` with no `jobId`; spares and parked records are not holders; `jobs/<short>/state.json` contributes name and state but never liveness; `-p` processes write no record, so a print-mode holder is undetectable (the engine has no guard there either) and MAWS's own sessions are `self` by C3's hand, not the registry's. Binding as verified (pass-2 item 10, SPEC 35.27.1).
- *Index schema and location*: `<userData>/index.sqlite` (C1's `MAWS_USER_DATA` honoured), WAL, `synchronous=NORMAL`, `foreign_keys=ON`; migrations as an ordered array with `PRAGMA user_version`, v1 the five tables `projects`, `sessions` (the X1 record plus C3's `gateway` extension and the discovery facts behind it), `attention_items`, `drafts`, `replay_fixtures`; a newer-than-known version opens read-only, an unopenable file is set aside as `index.sqlite.broken-<epoch>`. Sessions removed from disk by the engine's retention sweep stay in the index as archived records. Queued messages and grants are persisted by C3's per-session state file and tab and panel layout by C5's `layout.json`, so neither is a table here (see the `[parent-impact]` on §4.4 in the handback). Binding on the scope (§4.4 as amended); advisory on the columns.
- *Project membership*: a session joins the project whose directory equals the realpath of its effective directory (`relocatedCwd` else first `cwd`) or contains it under `.claude/worktrees/`; discovery auto-creates projects (`origin: 'discovered'`) for directories that exist and have a session with messages; a removed project is hidden, not deleted; sessions of vanished directories go to "Other sessions"; C5's `ProjectRecord` is the row projected. Advisory (C5 owns the visible grouping).
- *X2 surface*: `fs.*` (owner engine-host): `state`, `scan`, `bind`, `unfollow`, `subagents`, `agentEvents`, `workflows`, `tasks`, `readSpill` (the last two names are C6's); events `sessionChanged`, `sessionRemoved`, `holderChanged`, `followState`, `subagentsChanged`, `workflowChanged`, `tasksChanged`, `scanProgress`. `session.*` (owner main): `projects.{add,update,remove}`, `drafts.{get,set}`, `replay.{start,fixtures}`; `replay.control` (owner engine-host); event `replay.progress`. C4 emits C3's `session.eventBatch` for backfill, tail and replay, and answers C3's `session.events` for non-live app sessions through the `FsService.eventsSnapshot` seam. C5's read side (`session.list`, `setVisible`, `markRead`, `setPinned`, `changed`, `removed`, `projectChanged`, `projectRemoved`, `ProjectRecord`) is consumed through the `SessionSource` port, and answered by an interim handler only while C5 has not landed. No `attention.*` or `layout.*` entries. `git.{status,branches,diff,log,watch,unwatch}`; event `git.changed` carrying the fresh status. `fs.readSpill` refuses paths outside `projects/`, `tasks/`, `jobs/` under the config home. Binding once landed (X2); the `session.projects.*` names are a proposal to C5.
- *Git invocation and watcher*: `/usr/bin/git` (or `MAWS_GIT`) via `execFile` with `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, 10 s timeout; `status --porcelain=v2 --branch -z`, `for-each-ref`, `diff` with `--numstat`, `log --format … -z`; one recursive `fs.watch` per repository root (plus the git dir of a linked worktree), `.git/` events counted only for `HEAD`, `ORIG_HEAD`, `MERGE_HEAD`, `index`, `packed-refs`, `refs/**`, `objects/**` and `*.lock` ignored, 250 ms trailing debounce, one status in flight per root, `git.changed` only when the status differs. Binding on read-only (§4.5); advisory on mechanism.
- *Replay clock and speed*: absolute-deadline scheduling from a re-basable origin (`deadline = base + Σ min(Δt, maxGap·speed)/speed`), speeds 0.25× to 50× and `'instant'` (batches of 500), recorded gaps longer than 2 s shortened to 2 s at speed 1, pause/resume/speed change re-base at the current row, each run under a fresh `rp_<uuid>` session id and a fresh app id with the fixture's ids rewritten so concurrent replays never collide; the journal runner hands both directions to C3's `Normalizer` through a `RowNormalizer` interface (a stand-in until C3 lands), the transcript runner paces backfill events by record timestamp. C3's `ReplayTransport` is a separate lockstep test seam. Binding on the two-source rule (X8); advisory on the clock.
- *Acceptance against the real store*: the run uses the owner's `~/.claude` read-only with a throwaway `MAWS_USER_DATA` for the first pass; read-only is proved by unchanged file counts and a clean `git -C ~/.claude status` before and after, and enforced in code by a guard test that fails on any write API imported under `src/engine-host/fs/**`; unit tests run in plain Node under vitest against a temporary `CLAUDE_CONFIG_DIR` tree built by `test/support/store-fixture.ts` from copied fixtures (`test/fixtures/transcripts/{rewind-real,subagent-parent,torn-tail}.jsonl`, the probe sidecars and workflow-disk directory), never against the owner's files. Binding on read-only (§4.3, D-12); advisory on the proof mechanics.

## Surprises & Discoveries

- Observation: the `last-prompt {rewound: true}` anchor names the *preceding assistant* (the new logical leaf), not the abandoned leaf, and its `lastPrompt` is the rewound-away prompt (the prefill text); the next turn's parent is the `prompt_snapshot` attachment that followed that assistant. C1's synthetic fixture has both inverted (`leafUuid: "a2"`, the old leaf, and the *next* prompt as `lastPrompt`).
  Evidence: `~/.claude/projects/-private-tmp-maws-probe2-FIiJVW/bdb23713-….jsonl` line 26: `{"type":"last-prompt","lastPrompt":"Also remember the word BANANA. Reply OK.","leafUuid":"edf0f954-…","explicit":true,"rewound":true,…}`; `pass2/rewind.jsonl` seq for the successful `rewind_conversation` response: `precedingAssistantUuid: "edf0f954-1b18-4bca-a53f-d3212ef6dbaa"`; line 29 `user a4d68c72 parentUuid af765f44`, line 18 `attachment af765f44 parentUuid edf0f954`. The pass-2 `jsonl_snapshot` rows dropped `leafUuid`, which is why C1 could not see this.
- Observation: better-sqlite3 has no prebuilt binary for Electron 44 and its current major publishes none at all; `node:sqlite` is present in Electron 44's Node with FTS5.
  Evidence: `api.github.com/repos/WiseLibs/better-sqlite3/releases/tags/v13.0.3` → `0 assets`; `…/v12.11.1` → 138 assets, newest `better-sqlite3-v12.11.1-electron-v146-darwin-arm64.tar.gz`; node-abi registry: Electron 44 → ABI 149. `ELECTRON_RUN_AS_NODE=1 electron@44.4.5 -e …` → `{"electron":"44.4.5","node":"24.21.0","modules":"149","result":"node:sqlite OK sqlite=3.53.4 fts5=yes"}`. Local Node 22.23.2: `node:sqlite` present with `ENABLE_FTS5`, prints `ExperimentalWarning`; `--disable-warning=ExperimentalWarning` silences it.
- Observation: interactive `claude` and `claude --bg` write `sessions/<pid>.json`; `-p` sessions (MAWS's own, and the pass-2 print-mode holder) write none, which is why pass-2 item 10 saw no guard against a print-mode holder.
  Evidence: SPEC 35.27.1: the record is created by `lFt`, called from interactive startup and from `claim_session`; the owner's ten records are all `entrypoint: cli`, `kind: interactive | bg`; `findings-pass2.md` item 10.
- Observation: spilled results are named by background-shell id, not tool-use id; the disk record names the file in `toolUseResult.persistedOutputPath` and again in the result text.
  Evidence: `projects/-Users-new-Developer-GitHub-MAWS/e3ce7feb-…/tool-results/` holds `b95u0622n.txt`, …; nine records carry `"persistedOutputPath":"/Users/new/.claude/projects/…/tool-results/b95u0622n.txt"` beside `stdout`, `stderr`, `interrupted`, `isImage`, `noOutputExpected`, `persistedOutputSize`; the same JSONL carries `Output too large (29.7KB). Full output saved to: …` inside `tool_result` content.
- Observation: the owner's store is large but shallow to summarise: 3,690 transcripts, 1.3 GB, head-and-tail reads of all of them take about one second; four files exceed 50 MB (largest 84 MB).
  Evidence: read-only survey on 2026-09-28 (`sessions=3690 head_has_cwd=3540 sidecar_dirs=321 … head-read all in 1.05s; median size 92343 bytes; >50MB: 4`).
- Observation: disk `assistant` records hold one content block each (`apiBlockIndex`), and `attachment` records sit on the chain with uuids; a real session's leaf chain is mostly attachments.
  Evidence: histogram of `e3ce7feb-….jsonl`: `attachment 726 (uuid)`, `assistant 410 (uuid)`, `user 309 (uuid)`; assistant record keys include `apiBlockIndex: 0`, `content types ['thinking']`.
- Observation: the pass-1 `subagent.jsonl` journal has a complete parent transcript and both sidecars on disk, giving a real journal + JSONL + sidecar triple.
  Evidence: journal `session_id 9a1d4262-0b43-46ad-acb9-5982f31d209c`, 488 rows; `projects/-private-tmp-maws-probe-WmHZ2j/9a1d4262-….jsonl` 39 records with `tool_use` ids `toolu_01CYiK6ncgQLFUQ2iqC1b4oB`, `toolu_01A8AmiXuRTeJwjQEsaPE2DM` equal to the two sidecar metas' `toolUseId`.
- Observation: a `seq`-based snapshot cursor cannot cover disk-derived events, because X1 defines `seq` as the journal row and JavaScript orders `null <= 0` as true.
  Evidence: C1 Interfaces, `EventBase.seq: number | null // journal row the event derives from (X8); null for app-synthesised events`; C6's M5 pin "`ipcSource` ignores a batch with `seq` ≤ the snapshot's last `seq`"; `node -e "console.log(null <= 0)"` → `true`.

## Decision Log

- Decision: Verification for C4 is a task review at each milestone boundary under subagent-driven execution, with dependency-frontier reviews after M1 (the X1 production shapes and the follower's transition table, read by C6 and C8 before anything downstream consumes them), after M4 (the index API and the `SessionSource`, read by C5 and C10) and after M7, and one whole-branch independent review through `doperpowers:reviewer-high` at the end, per the charter's §19 call (reviewer-high for C3 and C4).
  Rationale: C4's outputs are consumed by four children; the chain follower is the one piece whose wrong answer corrupts every transcript view, and the index is the one file whose schema mistakes cost migrations.
  Date/Author: 2026-09-28, C4 author.
- Decision: This document is authored against parent pin `87f8c7881119ea670901205dae35917d3751459c`, the charter after C1's review fix wave, and against C1's execution document as the interim canonical source for X1 and X2. It codes against C1's names (`TranscriptRecord`, `currentChain`, `SessionRecord.holder`, `EVENT_KINDS`, the per-namespace `schema/*.ts` modules, `HostSupervisor`, `runHost`) and adds one method to C1's supervisor.
  Rationale: coordinator instructions; C1's code has not landed at authoring time.
  Date/Author: 2026-09-28, C4 author.
- Decision: `node:sqlite` replaces better-sqlite3 (charter S-4, advisory library pick).
  Rationale: the residue *SQLite binding* above; the alternative kept two native builds (Electron ABI 149 and Node 22) for a module whose current major ships no prebuilds, while the built-in has the same synchronous shape and is present in both runtimes.
  Date/Author: 2026-09-28, C4 author.
- Decision: The first draft's own `session.list/get/update`, `session.queue.*`, `session.grants.*`, `attention.*` and `layout.*` entries, its `queued_messages`, `session_grants` and `layout` tables, its `session.events` event, `fs.follow`/`fs.followSubagent`/`fs.readEngineArtifact` commands and its `FrameSource` port were replaced by the sibling names in Cross-child reconciliation (`session.eventBatch`, C3's `session.events` with delegation, C6's `fs.readSpill` and `fs.agentEvents`, C5's read side through `SessionSource`, C3's `Normalizer` through `RowNormalizer`), and `fs.bind` was added so the host can stamp `appSessionId`.
  Rationale: the coordinator relayed C6's expected names mid-authoring and C3's and C5's documents had landed; one name per surface, owned by the child that produces it, is what X2 exists for. Alternative rejected: keeping parallel names behind adapters, which would leave three children each translating the others.
  Date/Author: 2026-09-28, C4 author.

## Outcomes & Retrospective

Pending — written at finish.
