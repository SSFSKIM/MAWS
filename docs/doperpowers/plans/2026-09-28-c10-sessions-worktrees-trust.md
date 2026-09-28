# C10 — Sessions, worktrees and trust

Child of the composite spec `docs/charter.md`, child id **C10**, parent pin `fa064f66f862afec8b2a2e4684369f0f235a8de3`. Design lives in the charter: the C10 section in §12, §3 "Sessions", §4.1 (launch line), §4.4 (index scope as amended, grant snapshots), §4.5 (git and worktree service), §5.1 (sidebar actions and the new-session sheet), D-12, D-16, D-19, contracts X2, X5, X6 in §13, the binding grades in §11, and the Decision Log §19. Its contracts with the wave-2 children are their reviewed execution documents: C3 (`docs/doperpowers/plans/2026-09-28-c3-engine-host.md`: X6, `session.launch`, the process table, exit policy, the `SessionStateStore`), C4 (`…c4-filesystem-index-replay.md`: discovery, holders, the index and its title rule, the read-only git service), C5 (`…c5-shell.md`: the `newSession` slot, the action-handler registry, the sidebar menus, `HolderNotice`, the tab kinds), C9 (`…c9-terminal.md`: `pty.spawn` with `command`, `openTerminal`), reconciled in `docs/doperpowers/plans/2026-09-28-wave2-interface-ledger.md`. Verified engine behaviour comes from `spikes/protocol-probe/findings-pass2.md` items 8, 9, 10 and 12 with their fixtures, the SPEC bundle at `~/claude-code-bundle/2.1.283/SPEC/` (§3 trust, §20 background jobs, §23 worktree tools, §35 persistence, §45 headless protocol, §47 git), and the pass-3 probe recorded while authoring this document (`spikes/protocol-probe/fixtures/pass3/fork-worktree-{start,fork,resume-in-b}.jsonl`, scenario `scenarios/pass3/fork-worktree.mjs`, runner `run-pass3.mjs`). The taste reference is `mockups/05-sessions.html` ("Sessions: start, branch, hand off, clean up", seven vignettes: the sheet, the trust step, relay unreachable, fork paths and rename with provenance, worktree cleanup, foreign-live, archive and delete confirmations) [advisory; its sentence that the worktree fork "copies the transcript first" is superseded by Surprises]. This document carries the constraints, the interfaces C10 adds, the milestones with their gates, the residue decisions to be pasted into the charter's C10 section, and the record. It is written against the reviewed wave-2 documents while they execute; a refresh pass against the landed code precedes the executor (the items that pass must settle are marked **[refresh]**).

## Purpose

After C10, a session in MAWS has a whole life. From a project's "+" (or ⌘N) the owner opens one sheet, picks where the session runs (the project directory, a new git worktree with its branch, or one of the repository's existing worktrees), the model and effort, the permission mode, extra directories and an optional first message, and presses Start. If the directory has never been trusted, the sheet says so first and, on the owner's word, attests trust to the engine at `initialize`, so the project's settings, hooks, MCP servers and plugins load exactly as they do in the terminal; if the owner declines, the session still starts and shows the engine's own notice that project rules were ignored. A worktree MAWS creates lives where the engine's `EnterWorktree` puts its own (`<repo>/.claude/worktrees/<name>`, branch `worktree-<name>`), so the two coexist and the owner's terminal habits keep working. Any session can be resumed after the app restarts (D-16: records, drafts, queued messages and grants survive; processes do not), forked in place, or forked into a new worktree, where the new session starts with the old conversation and resumes from the terminal like any other. Sessions can be renamed (a rename reaches the engine's store when the session is live, and stays MAWS's own until it is), archived (the process stops, the record hides, the worktree is offered for cleanup), and deleted (the transcript goes to the Trash, never silently). Cleaning up a worktree distinguishes four things the owner means differently: archiving its sessions, removing a clean checkout, discarding uncommitted changes, deleting the branch. A session that a terminal or a `claude --bg` job holds opens read-only with its holder named; a background job offers "Attach in a terminal tab", which opens C9's terminal running the engine's own `claude attach <id>`, and MAWS's own resume guard refuses to become a second writer, with the engine's refusal authoritative for background jobs.

What C10 does not do: render the transcript or the composer (C6, C7), the panel host (C8), the palette widgets or the settings screens (C11), the prewarmed spare (C12; the `claim_session` trust mapping is written here, not exercised), a source-control panel (P1), or any write into `~/.claude` beyond the two this document names (the Trash move of a deleted conversation and nothing else; the fork copies no transcript, see Surprises).

## Progress

- [ ] M1 — Trust, launch mapping, X6 extensions, the models catalogue
- [ ] M2 — Worktree service and the cleanup state machine
- [ ] M3 — Session service: create, start, fork, archive, delete, rename, setup events, rollback
- [ ] M4 — The new-session sheet, session and project actions, dialogs, end-to-end over the replay transport
- [ ] M5 — Foreign-live: guards, the engine's refusal, attach in a terminal tab
- [ ] M6 — Live acceptance against the real engine and a scratch clone of the owner's repository

## Terms

- **Trust key**: the path under which the engine records trust for a directory in `~/.claude.json` (`projects[<key>].hasTrustDialogAccepted`): the root of the git repository's main worktree when the directory is inside a repository (linked worktrees share it), else the directory's own NFC-normalised realpath (SPEC §3 15.1–15.4; verified by the pass-3 probe, Surprises). **Attestation**: telling the engine the human accepted trust, through `initialize.workspaceTrust { accepted: true, directory: <trust key> }` (X6), or `claim_session.workspace_trust` for a prewarmed spare (P1). MAWS reads the trust store and never writes it.
- **Trust gates**: what the engine withholds in an untrusted directory: project and local `permissions.allow` and `permissions.additionalDirectories`, hooks, `settings.env`, `.mcp.json` servers, project plugins and marketplaces (SPEC §3 15.5). The **trust notice** is the engine's stderr line `Ignoring N permissions.allow entries from .claude/settings.json: this workspace has not been trusted. …` (fixture `pass2/trust-no-attestation.jsonl` seq 5). It is printed at settings load, before `initialize` is read, so it appears on attested launches too and means "ignored" only when the attestation did not record trust.
- **Managed worktree**: a git linked worktree under `<repoRoot>/.claude/worktrees/<name>` on branch `worktree-<name>`, the engine's own convention (SPEC §47 11.1) and MAWS's. **Repository root**: the main worktree's root (`dirname` of `git rev-parse --git-common-dir`), which is where managed worktrees are created whichever worktree the owner started from.
- **Cleanup ladder**: the four distinct operations on a worktree: archive its sessions, remove a clean checkout, discard uncommitted changes (then remove), delete the branch. Each has its own guard (Interfaces, Cleanup state machine).
- **Session service**: C10's main-process module (`src/main/sessions/service.ts`) that owns the lifecycle commands. **Setup**: the run of one `session.create`, `session.start` or `session.fork` from the command to `ready` or `failed`, reported as `session.setup` events. **Rollback**: undoing what a failed setup created (a worktree, a record), never what existed before.
- **Fork in place** / **fork to a new worktree**: `--resume <id> --fork-session` launched in the source's directory, or in a worktree created for it; the engine finds the source transcript in any project directory and writes the new session under the launch directory's slug (Surprises).
- **Holder**: C4's `SessionRecord.holder`: `self` (a process C3 owns), `terminal` (an interactive `claude` with a live registry record), `background_job` (a `claude --bg` job, `jobId` its eight-hex short id), `none`. **Foreign-live**: holder `terminal` or `background_job`. **Attach**: the engine's `claude attach <short>` run in a C9 terminal tab.
- **Catalogue**: the engine's model list (`list_models` / the `initialize` response's `models`), each entry with `value`, `displayName`, `supportsAutoMode`, `supportsFastMode` (fixture `reads.jsonl`). A **gateway model** is an entry whose `value` starts with `claude/` (the relay's aliases for non-Anthropic providers: `claude/astra|sol|luna|terra`, `claude/<vendor>/…`); auto mode on it runs the classifier locally on Sonnet 5 and counts as usage (§19).
- **Sheet**: the new-session dialog C5 renders through its `newSession` slot; C10 fills it. **Store file**: C3's per-session state file (`<userData>/engine-host/state/<appSessionId>.json`: queue, grant snapshot, last launch spec).

## Constraints

Binding on every milestone, from the charter and the sibling contracts:

- §3 "Sessions" and the C10 section of §12: every path listed there exists and works against the real engine; the sheet's fields are §5.1's (location with recent projects, new or existing worktree with branch, model and effort, permission mode, additional directories, optional first message). One departure is recorded as a `[parent-impact]` in the Decision Log: the fork to a new worktree copies no transcript, because the engine resolves the source session itself and a copy would make that resolution ambiguous (Surprises). (binding, with the departure recorded)
- §4.1 and X6: launches go through C3's `session.launch` with a `LaunchSpec` and nothing else; C10 never spawns the binary. C10's X6 extensions are additive fields on `LaunchSpec` and `EngineSessionStatus` (Interfaces) and are flagged to the coordinator. (binding)
- §4.5: worktrees are ordinary trusted `git worktree add` under `<repo>/.claude/worktrees/`; C4's git service stays read-only, and every git mutation C10 makes is one of the commands listed under `git.worktree.*` in Interfaces, implemented in C10's own module. (binding)
- §4.3, §4.4 and D-12: the engine's store is the store. C10 writes into `~/.claude` only to move a deleted conversation's files to the Trash (Interfaces, Delete) and never writes `~/.claude.json`, registry records, jobs or journals. The index keeps its five tables; C10 adds no table (an additive store method is allowed, Interfaces). (binding)
- D-16: no session outlives the app; at start C10 clears every stale `self` holder and never auto-resumes. Records, drafts (C4), queue and grants (C3's store file) survive. (binding)
- D-19: `gateway` defaults to `'gateway'`; the sheet offers Direct per session and on `relay_unreachable`; the relay check is C3's. (binding)
- `spikes/protocol-probe/findings-pass2.md` items 8, 9, 10, 12 as verified, plus the pass-3 fork-worktree probe: attestation at `initialize` records trust and loads rules at once; grants are re-applied by C3 from the store file on resume; a print-mode holder has no engine guard and a `--bg` holder is refused with the attach message; the engine finds a session id across project directories and writes a fork under the launch directory's slug. (binding as verified)
- X2 as C1 defined it: entries only in `src/shared/ipc/schema/{session,git,engine}.ts` as delimited C10 blocks; strict objects; owner `main` unless stated; a main-owned command answers synchronously only what is fast, and everything that can take seconds streams through `session.setup`. (binding)
- X5 as C9 wrote it (`src/renderer/src/panel/tool.ts`) and C8 owns: C10 calls `openTerminal` from C9's tool and touches no panel internals. (binding)
- C5's slot and action contracts: the `newSession` slot props `{ projectId, open, onClose }`, `actionHandlers` for `session.new`, and the per-session menu entries C5 renders disabled until C10 registers their handlers. (binding on the slot names and props)
- C1's conventions: zod 4, validators never transform, `Schema` suffix, unit tests beside sources, `@shared/*`, CommonJS in main and the hosts, no colour literals in the renderer, tokens only. No attribution footers in commits. (binding by inheritance)
- Acceptance never runs against the owner's live checkouts: it clones one owner repository into `/private/tmp` and creates worktrees only inside that clone. (binding)

## Repository map

Files C10 creates or touches. Every wave-2 child has landed on master when C10 executes, so touching a landed file is an ordinary edit; each is listed so the ledger can reconcile.

```
src/shared/sessions/                       (new; shared by main and renderer)
  request.ts        NewSessionRequestSchema, LocationSchema, StartOptionsSchema, ForkTargetSchema
  setup.ts          SetupEventSchema, StartOutcomeSchema, SETUP_PHASES
  trust.ts          TrustStateSchema, TRUST_GATES (copy), isHomeDirectory()
  worktree.ts       WorktreeInfoSchema, WorktreeStatusSchema, CleanupChoiceSchema, CleanupResultSchema,
                    worktreeDirName(), defaultBranchName(), validateWorktreeName(), cleanupState() (pure)
  models.ts         ModelCatalogueSchema, isGatewayModel(), autoModeNote()
src/shared/ipc/schema/session.ts           C10 block: session.create/start/fork/archive/delete/rename/trust.check/pickDirectory/revealPath (main), session.forget (engine-host); event session.setup
src/shared/ipc/schema/git.ts               C10 block: git.worktree.list/status/add/remove (main)
src/shared/ipc/schema/engine.ts            C10 block: engine.models (engine-host)
src/shared/engine/launch-spec.ts           touched: LaunchSpec.inheritGrantsFrom (additive, X6)
src/shared/engine/status.ts                touched: EngineSessionStatus.trust (additive, X6)
src/shared/keymap/actions.ts               touched: C10 action ids (session.resume, session.rename, session.fork, session.forkToWorktree, session.archive, session.delete, session.removeWorktree, session.attach, project.add, project.remove, project.archiveSessions, project.reveal, project.archived, gateway.openClaudeUsage)
src/engine-host/
  models-cache.ts   (new) the catalogue cache behind engine.models
  session.ts        touched, three delimited lines: trust → status; inheritGrantsFrom seeds the snapshot before re-application; catalogue update from the initialize response
  normalizer.ts     touched, one delimited rule: the trust notice (stderr row + initialize meta row → notice.posted)
  ipc.ts            touched: handlers for engine.models and session.forget; catalogue update from list_models
src/main/sessions/                         (C5's directory; new files, C5's untouched)
  service.ts        the session service: the lifecycle commands, the setup runner, the D-16 reset, the SetupSource digest
  setup.ts          the setup state machine (pure transitions) and the watchdog
  trust.ts          trustKeyOf(), readTrustStore(), trustStateOf()
  launch-mapping.ts toLaunchSpec(): NewSessionRequest | record → LaunchSpec
  attach.ts         attachCommand(jobId), the refusal matcher
src/main/git/worktrees.ts                  (new) git.worktree.* and the cleanup ladder over C4's git runner
src/main/index/sessions.ts                 touched: SessionStore.resetSelfHolders() (additive)   [refresh]
src/main/index.ts                          C10 block: start the session service after C4's index and C5's read model
src/renderer/src/sessions/                 (new)
  NewSessionSheet.tsx, LocationField.tsx, WorktreeFields.tsx, ModelFields.tsx, DirectoriesField.tsx,
  TrustStep.tsx, RelayDownPanel.tsx, SetupProgress.tsx, sheet-state.ts (reducer), validate.ts,
  RenameDialog.tsx, ForkDialog.tsx, ArchiveDialog.tsx, CleanupDialog.tsx, DeleteDialog.tsx,
  ArchivedSessionsDialog.tsx, HolderActions.tsx, actions.ts (registers into C5), store.ts (sheet open state, setup progress)
src/renderer/src/App.tsx                   touched: registerSlot('newSession', NewSessionSheet); registerSessionActions()
src/renderer/src/session/HolderNotice.tsx  touched (C5's): renders <HolderActions/> under the notice
src/renderer/src/sidebar/menus.tsx         touched (C5's): binds the per-session and per-project entries to C10's handlers   [refresh]
src/renderer/src/stores/layout.ts          touched (C5's) only if no setter opens the newSession slot   [refresh]
test/support/scratch-repo.ts               (new) a temp git repository with commits, a .claude/settings.json rule and worktrees, for unit tests and e2e
test/support/trust-store.ts                (new) writes a temp <configHome>/.claude.json for tests
e2e/sessions.spec.ts                       (new) the C10 Playwright spec over the replay transport
spikes/protocol-probe/{run-pass3.mjs, scenarios/pass3/fork-worktree.mjs, fixtures/pass3/fork-worktree-*.jsonl}   recorded at authoring (uncommitted at hand-off; M1 commits them)
```

Not touched: `src/engine-host/fs/**` (C4's read-only service), `src/main/git/*.ts` other than the new `worktrees.ts`, `src/renderer/src/{transcript,terminal,tools,panel}/**`, `src/pty-host/**`, `docs/charter.md`.

## Interfaces and Dependencies

Code below is code that is itself a decision: shapes, names, state tables and the exact strings siblings and the acceptance depend on. Zod schemas carry the type's name with a `Schema` suffix; types are `z.infer`. Every per-session payload names the session `appSessionId` (ledger ruling 1).

### Shared shapes (`src/shared/sessions/*.ts`)

```ts
// request.ts
export const BranchChoiceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('new'), name: z.string(), base: z.string() }),   // base: 'HEAD', a local branch, or a typed ref; resolved by `git.worktree.add`
  z.strictObject({ kind: z.literal('existing'), name: z.string() }),
]);
export const LocationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('directory'), path: z.string() }),                                   // realpathed by the service
  z.strictObject({ kind: z.literal('newWorktree'), repoRoot: z.string(), name: z.string(), branch: BranchChoiceSchema }),
  z.strictObject({ kind: z.literal('existingWorktree'), repoRoot: z.string(), path: z.string() }),
]);
export const StartOptionsSchema = z.strictObject({
  gateway: z.enum(['gateway', 'direct']),                       // D-19 default 'gateway'
  trust: z.strictObject({ accepted: z.literal(true) }).nullable(),   // the human's answer to the trust step; the service supplies the directory (trust key)
});
export const NewSessionRequestSchema = StartOptionsSchema.extend({
  projectId: ProjectIdSchema.nullable(),                        // the "+" the sheet opened from; null from ⌘N or the empty state
  location: LocationSchema,
  additionalDirectories: z.array(z.string()),
  model: z.string().nullable(), effort: EffortSchema.nullable(), permissionMode: PermissionModeSchema.nullable(),   // null = engine default / settings
  firstMessage: z.string().nullable(),
});
export const ForkTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('inPlace') }),
  z.strictObject({ kind: z.literal('newWorktree'), name: z.string(), branch: BranchChoiceSchema }),
]);

// setup.ts
export const SETUP_PHASES = ['worktree', 'launching', 'ready', 'failed'] as const;
export const StartOutcomeSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('launching'), appSessionId: AppSessionIdSchema }),
  z.strictObject({ status: z.literal('needs_trust'), appSessionId: AppSessionIdSchema.nullable(), trust: TrustStateSchema }),
  z.strictObject({ status: z.literal('held'), appSessionId: AppSessionIdSchema, holder: SessionHolderSchema, attach: z.strictObject({ jobId: z.string(), command: z.string() }).nullable() }),
  z.strictObject({ status: z.literal('already_live'), appSessionId: AppSessionIdSchema }),
  z.strictObject({ status: z.literal('archived'), appSessionId: AppSessionIdSchema }),
  z.strictObject({ status: z.literal('missing_directory'), appSessionId: AppSessionIdSchema.nullable(), directory: z.string() }),
  z.strictObject({ status: z.literal('invalid'), field: z.string(), message: z.string() }),
  z.strictObject({ status: z.literal('relay_unreachable'), appSessionId: AppSessionIdSchema, health: RelayHealthSchema }),
  z.strictObject({ status: z.literal('refused'), appSessionId: AppSessionIdSchema, reason: z.string(), message: z.string() }),   // C3's refusal reasons verbatim
]);
export const SetupEventSchema = z.strictObject({
  appSessionId: AppSessionIdSchema, phase: z.enum(SETUP_PHASES), detail: z.string().nullable(),
  outcome: z.discriminatedUnion('kind', [ z.strictObject({ kind: z.literal('ready'), engineSessionId: SessionIdSchema }),
    z.strictObject({ kind: z.literal('relay_unreachable'), health: RelayHealthSchema }),
    z.strictObject({ kind: z.literal('held'), holder: SessionHolderSchema, attach: z.strictObject({ jobId: z.string(), command: z.string() }).nullable() }),
    z.strictObject({ kind: z.literal('error'), message: z.string(), rolledBack: z.boolean() }) ]).nullable(),
});

// trust.ts
export const TrustStateSchema = z.strictObject({
  directory: z.string(),                                        // the realpath the session would run in
  trustKey: z.string(), keyKind: z.enum(['repo', 'directory']),
  trusted: z.boolean(), source: z.enum(['trustKey', 'directory']).nullable(),   // which entry said true
  isHome: z.boolean(),                                          // $HOME: the engine keeps trust for it per session only (SPEC §3 15.3)
  found: z.array(z.strictObject({ file: z.string(), summary: z.string() })),   // what trust would load, read from the directory itself (mockup 05 vignette 02): `.claude/settings.json` ("4 allow rules, 1 hook, 2 env keys"), `.claude/settings.local.json`, `.mcp.json` ("2 MCP servers: a, b"), `enabledPlugins` in either settings file; empty when nothing gated exists
});
export const TRUST_GATES = ['Project permission rules (permissions.allow, additionalDirectories)', 'Hooks', 'Environment from settings', 'MCP servers from .mcp.json', 'Project plugins'] as const;   // the generic list, shown when `found` is empty

// worktree.ts
export const WorktreeInfoSchema = z.strictObject({ path: z.string(), branch: z.string().nullable(), head: z.string(), isMain: z.boolean(), locked: z.boolean(), prunable: z.boolean(), managed: z.boolean() });   // managed: under <repoRoot>/.claude/worktrees/
export const WorktreeStatusSchema = WorktreeInfoSchema.extend({
  exists: z.boolean(),                                          // the directory is on disk and listed
  dirty: z.strictObject({ tracked: z.number().int(), untracked: z.number().int() }),
  base: z.string(), ahead: z.number().int(), merged: z.boolean(),   // base: the main worktree's branch (else 'HEAD'); ahead: rev-list --count base..HEAD
  sessions: z.strictObject({ live: z.number().int(), foreign: z.number().int(), idle: z.number().int(), archived: z.number().int() }),
  state: z.enum(['busy', 'dirty', 'clean', 'detached', 'gone']),
});
export const CleanupChoiceSchema = z.strictObject({ archiveSessions: z.boolean(), remove: z.boolean(), discard: z.boolean(), deleteBranch: z.boolean() });
export const CleanupResultSchema = z.strictObject({ archived: z.number().int(), removed: z.boolean(), branchDeleted: z.boolean(), error: z.string().nullable(), stoppedAt: z.enum(['archive', 'remove', 'branch']).nullable() });
export function worktreeDirName(name: string): string;          // name with every '/' replaced by '+' (SPEC §47 11.1)
export function defaultBranchName(name: string): string;        // 'worktree-' + worktreeDirName(name)
export function validateWorktreeName(name: string): string | null;   // null when valid, else the message: 1–100 characters, no leading '-', no '..' segment, no whitespace at the ends, no NUL, no '\\'
export function cleanupState(s: Omit<WorktreeStatus, 'state'>): WorktreeStatus['state'];   // the table below

// models.ts
export const ModelCatalogueEntrySchema = z.looseObject({ value: z.string(), displayName: z.string(), supportsAutoMode: z.boolean().optional(), supportsFastMode: z.boolean().optional() });
export const ModelCatalogueSchema = z.strictObject({ models: z.array(ModelCatalogueEntrySchema), source: z.enum(['live', 'cached', 'builtin']), at: z.string().nullable() });
export function isGatewayModel(value: string): boolean;          // value.startsWith('claude/')
export function autoModeNote(entry, permissionMode): string | null;   // Haiku-style: 'This model cannot hold auto mode; the engine will run in default.' when supportsAutoMode !== true and the mode is auto; gateway: 'Auto-mode reviews for this model run locally on Sonnet 5 and count against your usage.' when isGatewayModel and the mode is auto or null
```

### X6 extensions (`src/shared/engine/launch-spec.ts`, `src/shared/engine/status.ts`; C3's files, additive, flagged to the coordinator)

`LaunchSpecSchema` gains `inheritGrantsFrom: AppSessionIdSchema.nullable()`: when set and the new session's own snapshot is empty, `EngineSession.start()` loads `store.loadGrants(inheritGrantsFrom)`, saves it as the new session's snapshot, and re-applies it in the same rung where C3 re-applies on resume (spawn → `initialize` → `get_status` → grants → `ready`). This is the grant snapshot hook the charter assigns to C10: a fork carries the grants the human issued for the conversation it copies, without the human answering twice, and nothing else copies a snapshot. `EngineSessionStatusSchema` gains `trust: z.strictObject({ attested: z.boolean(), recorded: z.boolean().nullable() })`: `attested` iff the spec carried `trust`, `recorded` the `initialize` response's `workspace_trust_recorded` (null when absent). C3's `session.ts` fills it beside the `initialize` meta row it already writes; `toSessionRecordPatch` is unchanged (the record does not carry trust; the notice does).

The **trust notice** rule in C3's normaliser (one delimited case): a `stderr` row whose text starts with `Ignoring ` and contains `this workspace has not been trusted` is held per launch; at the `meta initialize` row, if `workspace_trust_recorded !== true`, the held text is emitted as `notice.posted { level: 'warning', key: 'trust:ignored', text: <the stderr line, trimmed> }` with that row's `seq`; if trust was recorded, nothing is emitted, because the line precedes the attestation and the rules then load (fixture `pass2/trust-attested.jsonl` seq 5 then 7, and `pass3/fork-worktree-fork.jsonl` seq 5 then the `list_permission_rules` answer with the project rule). A journal rebuild reproduces the event because both rows are journaled.

**Catalogue cache** (`src/engine-host/models-cache.ts`, command `engine.models`): the engine host keeps the latest catalogue at `<userData>/engine-host/models.json` (`{ at, models }`, temp-then-rename), updated from every `initialize` response's `models` and every `list_models` answer; `engine.models { refresh: boolean }` answers `{ models, source: 'live', at }` when `refresh` is true and a `ready` session exists to ask (`list_models` on the most recently launched one), else `{ …cached, source: 'cached' }`, else the built-in list (`default`, `opus`, `fable`, `sonnet`, `haiku`, with `supportsAutoMode: false` on `haiku` only, from `reads.jsonl`) as `source: 'builtin'`. Reason: the sheet runs before any session exists, and X6 only lets a live session answer `list_models`; the cache is what the terminal's own `/model` shows after one launch.

### Trust (`src/main/sessions/trust.ts`)

```ts
export function configFilePath(env: NodeJS.ProcessEnv): string;        // `${CLAUDE_CONFIG_DIR}/.claude.json` when set, else `${homedir}/.claude.json` (SPEC §3 16.1; the legacy <config>/.config.json is not read)
export async function trustKeyOf(directory: string, git: GitRunner): Promise<{ trustKey: string; keyKind: 'repo' | 'directory'; directory: string }>;
export async function readTrustStore(path: string): Promise<Record<string, { hasTrustDialogAccepted?: boolean }>>;   // the `projects` map, {} when the file is missing or unparseable (logged)
export async function trustStateOf(directory: string, deps): Promise<TrustState>;
```

`trustKeyOf`: `directory` becomes `realpath` then NFC. If `git -C <directory> rev-parse --show-toplevel --git-common-dir` succeeds, the common dir is resolved against the toplevel; when its basename is `.git`, the trust key is the NFC realpath of its parent (the main worktree's root: linked worktrees share it, SPEC §3 15.2, verified by the pass-3 probe where attesting the repository root from a worktree cwd recorded `projects[<root>]` and loaded the project rule); otherwise (a submodule's `.git/modules/<name>`, a bare layout) the key is the toplevel's realpath, and the acceptance records which. Without a repository the key is the directory itself. `trusted` is true when `projects[trustKey].hasTrustDialogAccepted === true` (source `trustKey`) or, failing that, `projects[directory]` (source `directory`; older engines wrote per-worktree entries and the owner's store has some). `isHome` is `directory === realpath(homedir())`. The store is read on demand (sheet open, `session.start`), never watched: the engine rewrites the whole file by read-modify-write and polls it itself. MAWS never writes it: trust is recorded only through attestation, so `~/.claude.json` says exactly what the engine did.

Attestation mapping (`launch-mapping.ts`): `spec.trust = request.trust ? { accepted: true, directory: trustKey } : null`. The directory attested is the trust key, not the session's cwd, because the engine persists trust only when `directory` matches the cwd's trust key (SPEC §45 18.2) and a worktree's key is the repository root. The `claim_session` mapping for C12's spare is the same object under `workspace_trust` (X6 lists the field; its nested shape is unstated in the SPEC and unexercised by `pass2/prewarm.jsonl`, so C12 verifies it and records the shape). When the trust step is declined the spec carries `trust: null`, the launch proceeds, and the trust notice becomes the session's warning.

### Worktrees (`src/main/git/worktrees.ts`, X2 `git.worktree.*`, owner `main`)

Every git call goes through C4's runner (`/usr/bin/git` or `MAWS_GIT`, `execFile`, `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, 10 s; **[refresh]** the exported helper's name in `src/main/git/`), without `GIT_OPTIONAL_LOCKS=0` for mutations. No network: no fetch, ever; a base that is a remote-tracking ref is used as it stands.

| Command | Input | Output | Invocation and guards |
|---|---|---|---|
| `git.worktree.list` | `{ repoRoot }` | `{ repoRoot, commonDir, worktrees: WorktreeInfo[] }` | `rev-parse --show-toplevel --git-common-dir` (repoRoot is normalised to the main root), `worktree list --porcelain` (`worktree`, `HEAD`, `branch`, `locked`, `prunable` stanzas); `managed` iff the path is under `<repoRoot>/.claude/worktrees/` |
| `git.worktree.status` | `{ path }` | `WorktreeStatus` | the list entry, plus `status --porcelain=v2 --branch -z --untracked-files=normal --ignore-submodules=dirty` in the worktree (C4's parser; the engine's own cleanliness probe, SPEC §23 3.2), `base` = the main worktree's `symbolic-ref --short HEAD` (else `HEAD`), `ahead` = `rev-list --count <base>..<head>`, `merged` = `ahead === 0`, `sessions` from the index (records whose `worktree.path` or `directory` equals the path: `live` counts C3's live statuses, `foreign` holders `terminal`/`background_job`, the rest `idle`/`archived`), `state` from `cleanupState()` |
| `git.worktree.add` | `{ repoRoot, name, branch }` | `WorktreeInfo` | path `<repoRoot>/.claude/worktrees/<worktreeDirName(name)>`; refused `IpcError internal` with a named message when: the repository has no commit (`rev-parse --verify HEAD` fails: `repository has no commits`), the path exists (`worktree path exists`), the branch exists for `kind: 'new'` (`branch exists`), the branch does not exist or is checked out elsewhere for `kind: 'existing'` (`branch missing` / `branch checked out at <path>`), `validateWorktreeName` fails, or `check-ref-format --branch <branch>` fails. Then `worktree add --no-track -b <branch> <path> <base>` (new; `-b`, not the engine's `-B`, because the sheet promised not to reset a branch the owner has) or `worktree add <path> <branch>` (existing). `info/exclude` is left to the engine, which appends `**/.claude/worktrees/` under its `# claude-code-runtime` marker once per process (SPEC §47 18.4); the acceptance checks the main checkout's `git status` after the first session ran |
| `git.worktree.remove` | `{ path, discard, deleteBranch }` | `CleanupResult` | the ladder below; `worktree remove [--force] <path>`, then `worktree prune`, then `branch -D <branch>` when asked; refused `busy`/`dirty`/`locked` by the state table, never by git's own error first |

**Cleanup state machine.** The state is derived by `cleanupState()` from a fresh `git.worktree.status` immediately before any step, never cached: the owner's terminal may have changed the worktree since the dialog opened.

| State | Definition | Archive sessions | Remove checkout | Discard changes and remove | Delete branch |
|---|---|---|---|---|---|
| `busy` | `sessions.live + sessions.foreign > 0`, or `locked` | allowed (never stops a process) | refused `busy: N sessions are live here` | refused | refused |
| `dirty` | not busy; `dirty.tracked + dirty.untracked > 0` | allowed | refused `dirty: N changes` | allowed with `discard: true` (the dialog's explicit acknowledgement names the count) | after removal only |
| `clean` | not busy; no changes | allowed | allowed | not offered | after removal only |
| `detached` | `exists` false but the branch exists | allowed | nothing to remove | nothing | allowed; `merged` false shows `N commits not on <base>` and needs the acknowledgement |
| `gone` | neither directory nor branch | allowed | — | — | — |

Linearisation of one `git.worktree.remove` (and of `session.archive`'s worktree choice, which calls it): (1) archive the worktree's non-archived sessions through the index when `archiveSessions` (`session.update { archived: true }` semantics, tabs closed by the renderer on `session.changed`); (2) re-derive the state; (3) `remove` when allowed (`--force` iff `discard`); (4) `prune`; (5) `branch -D` when `deleteBranch` and no worktree has the branch checked out. A failure stops the ladder at its step (`stoppedAt`) with git's message in `error`; nothing already done is undone, because a removed checkout cannot be restored and an archived session can be unarchived. Reason for the four distinctions: they are what §4.5 binds and what the owner means by "clean up": a worktree whose sessions are archived is still a checkout the terminal can use; a removed checkout still has a branch to open a PR from; discarding is the only step that loses work, and deleting an unmerged branch is the only one that loses commits, so those two carry the acknowledgement.

### Session service (`src/main/sessions/service.ts`, `setup.ts`, `launch-mapping.ts`, `attach.ts`)

```ts
export class SessionService {
  constructor(deps: { index: Index; host: { dispatch: HostSupervisor['dispatch']; onEvent: HostSupervisor['onEvent'] }; readModel: SessionReadModel; git: GitRunner; worktrees: WorktreeService; env: NodeJS.ProcessEnv; emit: EmitFn });
  start(): void;                                     // registers the X2 handlers, subscribes to session.status and process events, runs the D-16 reset, registers the SetupSource
  create(req: NewSessionRequest): Promise<StartOutcome>;
  startSession(appSessionId, opts: StartOptions): Promise<StartOutcome>;
  fork(appSessionId, target: ForkTarget, opts: StartOptions): Promise<StartOutcome>;
  archive(appSessionId, worktree: CleanupChoice | null): Promise<{ archived: true; worktree: CleanupResult | null }>;
  remove(appSessionId, stopIfLive: boolean): Promise<{ status: 'deleted'; trashed: string[] } | { status: 'held'; holder } | { status: 'live' }>;
  rename(appSessionId, title: string): Promise<{ record: SessionRecord; via: 'engine' | 'override' }>;
}
export function toLaunchSpec(input: { appSessionId; cwd; additionalDirectories; model; effort; permissionMode; gateway; trust: { accepted: true; directory } | null; resume: { sessionId; fork } | null; inheritGrantsFrom: AppSessionId | null; replay: string | null }): LaunchSpec;   // subagentModel, mcpConfig, extraSettings, maxBudgetUsd null; sessionId null (C3 mints)
export function attachCommand(binaryPath: string, jobId: string): string;   // `${shellQuote(binaryPath)} attach ${jobId}`
export const BG_REFUSAL = /is running as a background session(?: \(([0-9a-f]{8})\))?/;   // SPEC §35 27.1; fixture pass2/resume-live-bg.jsonl seq 5
```

**Setup state machine** (one per `appSessionId` in flight; the event list, states and transitions are fixed here so the service is a table, not a chain of callbacks):

| State | Event | Next | Effects |
|---|---|---|---|
| — | `create` valid | `created` | `sessions.createForLaunch(...)` (C4) → record; the `SetupSource` digest `{ phase: 'starting', activity: 'Preparing' }`. **Answer timing:** when the location creates a worktree the command answers `{ status: 'launching', appSessionId }` here and everything after arrives as `session.setup`; otherwise the command awaits C3's `session.launch` (immediate: it answers at spawn) and returns its outcome (`launching`, `relay_unreachable`, `refused`) synchronously, the same `session.setup` events following in both cases |
| `created` | location is `newWorktree` | `worktree` | emit `session.setup { phase: 'worktree', detail: 'Creating worktree <name>' }`; `git.worktree.add` |
| `worktree` | add ok | `launching` | record `worktree { path, branch }` and `directory = path` (`sessions.update`) |
| `worktree` | add failed | `failed` | rollback (below); emit `failed { error, rolledBack: true }` |
| `created` / `worktree` ok | — | `launching` | `session.launch { spec }` (C3) |
| `launching` | C3 answers `relay_unreachable` | `idle` | answer it (no worktree) or emit `setup { phase: 'failed', outcome: relay_unreachable }` (worktree path); the record and worktree stay (the sheet retries with `session.start { gateway: 'direct' }`) |
| `launching` | C3 answers `refused` | `failed` | rollback when this setup created the record; emit `failed { error: reason + message, rolledBack }` |
| `launching` | `session.status` with `process: 'ready'` | `ready` | send `firstMessage` through `session.send` when set; emit `setup { phase: 'ready', outcome: { engineSessionId } }` |
| `launching` | `process.exited` before ready, or `session.status.exit` set | `failed` | match `BG_REFUSAL` in C3's `error.raised { scope: 'process' }` text → outcome `held` with `attach`; else `error`; rollback when this setup created the record |
| `launching` | 150 s without either | `failed` | `session.stop { reason: 'stop' }`; outcome `error: 'no answer from the engine host'` (C3's own `initialize` deadline is 120 s, so this never fires first) |

Rollback (for a setup that created the record in this call): `git.worktree.remove { path, discard: false, deleteBranch: <the branch was created here> }` when this setup created the worktree (it is clean: no process ran), `session.forget` (C3's store file and journal), `sessions.remove(appId)` (emits `session.removed`, cascades drafts and attention). A `session.start` of an existing record rolls nothing back; a `session.fork` rolls back the fork's record and worktree and never touches the source.

**`session.start`** (resume or first launch of a record): in order, the guards answer synchronously: `archived` (unarchive first), `already_live` (C3's `engine.sessions` lists it with `process` not `exited`), `held` when `record.holder.kind` is `terminal` or `background_job` (the attach object filled for a job with a `jobId`: `attachCommand(binaryInfo.path, jobId)`), `missing_directory` when `record.directory` is not a directory on disk, `needs_trust` when `trustStateOf(record.directory).trusted` is false and `opts.trust` is null. Then `toLaunchSpec` with `resume: { sessionId: record.engineSessionId, fork: false }` when the record has an engine id (else a fresh session), `cwd: record.directory`, `additionalDirectories: record.additionalDirectories` (the SPEC marks `--add-dir` not persisted, so they are re-passed from the record; discovered sessions have `[]`), `model: record.model.requested`, `effort: record.effort` when it is an `EffortSchema` value (else null), `permissionMode: record.permissionMode.requested`, `inheritGrantsFrom: null` (C3 re-applies the session's own snapshot by app id). **[refresh]** if C4's `SessionRecord.directory` keeps the original cwd of a relocated session and the effective directory is index-only, C10 asks C4 for an additive `SessionRecord.effectiveDirectory` and launches there.

**`session.fork`**: refused `no_engine_session` for a record without an engine id and `busy` while the source has a turn open in MAWS (C3's `session.status.turn !== null`: a copy taken mid-turn would hold a half-written turn). Creates the new record with the source's directory (or the new worktree's path), `additionalDirectories`, model, effort and permission mode, then the setup above with `resume: { sessionId: source.engineSessionId, fork: true }` and `inheritGrantsFrom: source.appId`. No transcript is copied: the engine finds the source transcript in the current project directory, then every git worktree's project directory, then all of `projects/*` (SPEC §35 12.5, 17.1), and writes the fork under the launch directory's slug with the history re-written under the new id (Surprises; `pass3/fork-worktree-fork.jsonl`). Once `ready`, when the source record's title has `source: 'user'`, the fork is renamed through `session.renameSession { title: '<source title> (fork)' }` so both rows are told apart and the engine's own store carries the name (the engine inherits the source's custom title otherwise, SPEC §35 16.6); an AI-titled source is left to the engine.

**`session.archive`**: `session.stop { reason: 'archive' }` when live (C3 runs the termination ladder and deletes the journal; the store file with queue and grants is kept, so an unarchived session resumes with them), `sessions.update({ archived: true })`, the renderer closes its tabs on `session.changed`, then the worktree choice through `git.worktree.remove` when given. The dialog offers the worktree ladder only when the session is the last non-archived session of a managed worktree. Unarchive is `session.update { archived: false }` (C4's command) from the Archived sessions dialog.

**`session.delete`** (delete conversation): refused `held` for a foreign holder and `live` for a MAWS-live session unless `stopIfLive` (then `session.stop { reason: 'archive' }` first). Then, in this order: `shell.trashItem` on `<projects>/<slug>/<sessionId>.jsonl`, the sidecar directory `<projects>/<slug>/<sessionId>/`, and every `<projects>/<slug>/<sessionId>.*` sibling (`.precompact.json`, `.ccr-tip.json`, `-<ts>.cast`; SPEC §35), where `<projects>` is C4's `resolveStorePaths(env).projects` and `<slug>` comes from the record's transcript path (**[refresh]** `transcript_path` is an index-only column; C10 reads it through the store, not the record); `session.forget` (C3: store file, journal); `sessions.remove(appId)`. The Trash rather than `unlink`: the owner's mental model, reversible from Finder, no bespoke tombstone; the engine's own quarantine name (`<id>.orphaned-<ms>-<hex>.jsonl`) is its mechanism for unreadable transcripts, not a user deletion, and `claude project purge` is per project. `fs.sessionRemoved` from C4's watcher for an app id already removed is ignored by C4 (null binding).

**`session.rename`**: live (C3 lists a non-exited process) → `session.renameSession { title }` (the engine writes the `custom-title` record and sidecar; C4's index picks it up as the engine's fact and keeps the override consistent, its title rule); not live → `session.update { title: { text, source: 'user' } }` (C4's override). A later `/rename` in the terminal wins over the override by C4's rule, which is the provenance the charter asks for: the record's `title.source` says whose act named it. No write-through on the next resume: it would append a duplicate `custom-title` record to every resumed session with a user title, discovered ones included.

**D-16 reset** at `start()`: every record with `holder.kind === 'self'` is reset to `none` through `SessionStore.resetSelfHolders()` (C10's additive method on C4's store; C3 owns no process at app start, so every `self` is stale), before the read model publishes. Guards never read `self`: "live in MAWS" is C3's `engine.sessions`, "foreign" is C4's holder.

**`SetupSource`**: a `SessionSource` registered with C5's read model whose `start(writer)` keeps the writer; the service calls `writer.setDigest({ appSessionId, phase: 'starting', activity: 'Creating worktree' | 'Starting' , … })` during setup so the sidebar row reads `starting` from the first millisecond instead of `exited` until C3's first status, which then takes over through `applyEngineStatus`.

**Attach**: `attachCommand(path, jobId)` where `path` is `engine.binaryInfo.path` (the pinned binary; the owner's login shell may resolve `claude` to a wrapper), shell-quoted with single quotes; the command reaches C9's `pty.spawn.command`, which the PTY host writes after spawn followed by `\n`. The job's `cliVersion` (C4's `JobState`) is shown beside the affordance when it differs from the pinned version; the attach still uses the pinned binary. The affordance appears for `holder.kind === 'background_job'` with a `jobId`, in the session pane's `HolderNotice` and in the row's context menu; never on the Overview card (§5.2: foreign-live cards show the holder and no controls).

### X2 additions

Owner `main` unless stated. Inputs and outputs are `z.strictObject`.

| Name | Kind | Input | Output |
|---|---|---|---|
| `session.create` | command | `{ request: NewSessionRequest }` | `StartOutcome` (`launching` with the new `appSessionId`, answered before the worktree step when one is needed and at C3's spawn otherwise; `invalid` names the field; `needs_trust` when `request.trust` is null and the directory is untrusted; the rest as C3 answers) |
| `session.start` | command | `{ appSessionId, options: StartOptions }` | `StartOutcome` |
| `session.fork` | command | `{ appSessionId, target: ForkTarget, options: StartOptions }` | `StartOutcome` (`appSessionId` is the fork's) or `{ status: 'refused', reason: 'no_engine_session' \| 'busy' }` |
| `session.archive` | command | `{ appSessionId, worktree: CleanupChoice \| null }` | `{ archived: true, worktree: CleanupResult \| null }` |
| `session.delete` | command | `{ appSessionId, stopIfLive: boolean }` | `{ status: 'deleted', trashed: string[] } \| { status: 'held', holder } \| { status: 'live' }` |
| `session.rename` | command | `{ appSessionId, title: string }` (1–200 characters, trimmed, non-empty) | `{ record: SessionRecord, via: 'engine' \| 'override' }` |
| `session.trust.check` | command | `{ directory }` | `TrustState` |
| `session.pickDirectory` | command | `{ defaultPath: string \| null, multiple: boolean, title: string }` | `{ paths: string[] }` (`[]` when cancelled; `dialog.showOpenDialog` with `openDirectory`, `createDirectory`, `multiSelections` when asked; realpaths) |
| `session.revealPath` | command | `{ path }` | void; `shell.showItemInFolder`; refused unless the path is a project directory, a session directory or worktree, or under the store's `projects/` |
| `session.forget` | command, owner `engine-host` | `{ appSessionId }` | void; `SessionStateStore.forget` and the journal directory; refused `already_live` while a process is reserved |
| `engine.models` | command, owner `engine-host` | `{ refresh: boolean }` | `ModelCatalogue` |
| `git.worktree.list` / `status` / `add` / `remove` | commands | as the worktree table | as the worktree table |
| `session.setup` | event | — | `SetupEvent` |

Consumed as siblings defined them: C3's `session.launch`, `session.status` (command and event), `session.stop`, `session.send`, `session.renameSession`, `engine.sessions`, `engine.binaryInfo`, `engine.relayHealth`, the events `process.exited` and `error.raised` inside `session.eventBatch` (through `HostSupervisor.onEvent`), `notice.posted` (the trust notice, rendered by C5's notices store); C4's `session.list` (with `includeArchived` for the Archived dialog), `session.get`, `session.update` (archive, unarchive, title override), `session.projects.{list,add,remove}`, `session.changed`, `session.removed`, `git.status`, `git.branches`, and the store API `sessions.createForLaunch`, `sessions.update`, `sessions.remove`, `sessions.list`, `projects.ensureForDirectory`; C5's `actionHandlers`, `runAction`, the layout store actions `openTab`/`closeTab`, the `notices` store, the `newSession` slot, `SessionReadModel.register` (the `SetupSource`); C9's `openTerminal({ appSessionId, cwd, command })`.

### The sheet (`src/renderer/src/sessions/NewSessionSheet.tsx` and its fields)

The slot: `registerSlot('newSession', NewSessionSheet)` with C5's props `{ projectId, open, onClose }`. C10 keeps a small store (`sessions/store.ts`: `mode: 'new' | 'fork'`, `sourceAppSessionId`, `prefill`, the current setup's `appSessionId` and last `SetupEvent`); the `session.new` handler and the fork entries open the sheet through the setter C5 exposes for the slot's `open` (**[refresh]** its name; if C5's "+" holds the state locally, C10 adds `openNewSession(projectId)` to `stores/layout.ts` as a delimited block and the "+" calls it). The sheet is a Radix `Dialog` (C5's `radix-ui`), 560 px, tokens only, Esc closes while idle, ⌘Enter submits.

Field model and validation (the renderer validates before invoking; the service validates again and answers `invalid` with the field):

| Field | Source | Default | Validation and notes |
|---|---|---|---|
| Location kind | radio: This directory · New worktree · Existing worktree | This directory | the worktree kinds are enabled only when `session.trust.check` reports `keyKind: 'repo'` |
| Directory | the project's directory; recent projects (`session.projects.list`, most recent activity first, up to 8); Choose… (`session.pickDirectory`) | the project's directory, else the last used | must exist and be a directory (`invalid: directory`); shown as its realpath; `isHome` shows "Claude Code keeps trust for your home folder per session; you will be asked each launch" |
| Worktree name | text | `<yyyy-mm-dd>-<4 base32>` | `validateWorktreeName`; the resulting path `<repoRoot>/.claude/worktrees/<name+>` must not exist (checked through `git.worktree.list`) |
| Branch | New (text, default `worktree-<name+>`) · Existing (picker from `git.branches`, current marked) | New | new: `check-ref-format` shape, not in `git.branches`; existing: not checked out elsewhere (`git.worktree.list`) |
| Start from | combobox: HEAD (current) · local branches (`git.branches`) · a typed ref | HEAD | shown only for a new branch; a typed ref is resolved by `git.worktree.add` (`base not found` fails the worktree step) |
| Existing worktree | list from `git.worktree.list` (path, branch, dirty count, session counts) | none | must be listed; `busy` and `dirty` are shown, never refused (a second session in a worktree is allowed) |
| Model | `engine.models` (`displayName`, `value`), plus "Default" | Default (null) | `autoModeNote` under the field; the catalogue's `source` shows "from your last session" for `cached` and "built-in list" for `builtin` with a Refresh control (`refresh: true`) |
| Effort | Default · low · medium · high · xhigh · max | Default | — |
| Permission mode | Default (settings) · default · acceptEdits · plan · auto · bypassPermissions · dontAsk | Default | with a Haiku-class model and `auto`: the note; the effective mode is C3's to report after launch (§5.4) |
| Additional directories | list; Add… (`pickDirectory` multiple); remove | `[]` | each must exist; deduplicated by realpath; the session directory itself is dropped with a note; no trust step (they are `--add-dir` permission roots, not settings sources, SPEC §24 12.1) |
| Inference | Advanced disclosure: Through ClaudeUsage's relay (default) · Direct (the engine's own login) | gateway | `engine.relayHealth` renders a status dot; Direct shows "Uses the engine's own login; the relay's accounts are not used" |
| First message | textarea | empty | trimmed; empty means none; sent by the service after `ready` |
| Trust step | `session.trust.check` on the effective directory (the worktree's repository root when creating one) | — | the trust block replaces the fields on Start when `trusted` is false (mockup 05 vignette 02): the directory, the trust key when it differs, the `found` list of files trust would load (else `TRUST_GATES`), "Trust and start" (`trust: { accepted: true }`, the default button), "Start without trusting" (`trust: null`; the session will show the engine's notice), Cancel |

Sheet state machine (`sheet-state.ts`, a reducer with these states): `loading` (trust check, catalogue, worktree list and branches in parallel; fields render with skeletons) → `editing` → on Start: `trust` when untrusted and no answer yet, else `submitting` (`session.create` / `session.fork` / `session.start`; the store subscribes to `session.setup` before invoking, C1's ordering rule) → `worktree` → `launching` → `done` (close the sheet; `openTab({ kind: 'session', appSessionId }, { pane: 'focused', activate: true })`) | `relay` (`relay_unreachable`, mockup 05 vignette 03: the health line with "checked N s ago" and Retry; two choices, "Open ClaudeUsage, then start" (runs C5's action `gateway.openClaudeUsage`, which C11 registers and which renders disabled until then; while this page is open the sheet polls `engine.relayHealth { force: true }` every 5 s and, once `ok`, re-invokes `session.start { gateway: 'gateway' }` on the same record by itself) and "Run direct" (re-invokes `session.start { gateway: 'direct' }`), Cancel) | `failed` (the error and whether the worktree was removed; Retry re-submits the same request, Back returns to `editing` with every field intact). Validation errors return to `editing` with the field marked.

### Actions registered into C5 (`src/renderer/src/sessions/actions.ts`)

`registerSessionActions()` at composition: `actionHandlers.set('session.new', …)` (⌘N: opens the sheet for the focused session's project, else the first project, else no project); the per-session entries `session.resume` (→ `session.start`; on `needs_trust` the sheet opens on its trust page in `mode: 'resume'`; on `held` a toast with the holder and, for a job, "Attach"), `session.rename` (`RenameDialog`, mockup 05 vignette 04: the field, the current title's provenance in words from `record.title.source` ("Generated by the engine from the first prompt", "Named in MAWS", "Named in the terminal", "Named by a tool"), and, for a live session, "Regenerate" through C3's `session.generateTitle { persist: true }` operation with the result arriving on `session.operation`), `session.fork` (`ForkDialog`: In place · New worktree, the latter opening the sheet prefilled in `mode: 'fork'` with the setup steps listed as they run and "Rolled back" named on failure), `session.archive` (`ArchiveDialog`, mockup 05 vignette 07: what archive does, the running background tasks and workflows from C3's `session.status.backgroundTasks` named by count and description because §4.4 binds that exit never silently discards background work, and the worktree ladder when applicable), `session.delete` (`DeleteDialog`: title, directory, the subagent transcript count, "Move the transcript to the Trash"; "Stop and delete" for a live session), `session.removeWorktree` (`CleanupDialog` over `git.worktree.status`, mockup 05 vignette 05: the diff summary, one checkbox per ladder step with its guard's reason when disabled, the acknowledgement checkboxes on discard and on an unmerged branch delete, and a confirm button whose label names exactly what is checked, e.g. "Archive, remove and delete branch"), `session.attach`; the per-project entries `project.add` (`pickDirectory` → `session.projects.add`), `project.remove` (`session.projects.remove` after a confirm naming the session count), `project.archiveSessions` (every non-archived session of the project through `session.archive` with no worktree choice), `project.reveal` (`session.revealPath`), `project.archived` (`ArchivedSessionsDialog`: `session.list { includeArchived: true }` filtered to the project, Unarchive and Delete per row, and "Remove worktree…" on rows whose record has a managed `worktree`, opening `CleanupDialog`). The entries are added to C5's `ACTIONS` table (chord null, sink `renderer`, menu null, scope `app`) so the palette lists them and tooltips resolve; the per-session ones need a session argument, which `runAction(id, arg)` cannot carry, so C5's sidebar menus call C10's `sessionActions.run(id, appSessionId)` **[refresh]** through the per-session handler registry C5 landed in `sidebar/menus.tsx` (or one C10 adds there as a delimited block). `HolderActions` (rendered by C5's `HolderNotice`) offers "Attach in a terminal tab" (job holders) and "Fork a copy" (any holder), and `session.resume` on a foreign-live row is disabled with the holder as its tooltip.

### Dependencies

No new packages. Electron's `dialog`, `shell.trashItem`, `shell.showItemInFolder` in main; C5's `radix-ui`; Node built-ins. The pinned engine at C3's `ENGINE_BIN`; git through C4's runner.

## Acceptance

C10 closes when every item below is observed on the owner's Mac, in order, from a checkout with C3, C4, C5, C9 (and C8 for item 12) on master, ClaudeUsage's relay running (`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8641/api/hello` prints `200`), the real `~/.claude` and `~/.claude.json`, a throwaway `MAWS_USER_DATA`, and a scratch clone. Nothing runs in the owner's live checkouts.

**Setup** (working directory `/private/tmp`):

```
export C10=/private/tmp/maws-c10-accept && mkdir -p $C10
git clone --no-hardlinks /Users/new/Developer/GitHub/MAWS $C10/maws          # the owner's repository, cloned; untrusted: no ~/.claude.json entry for it
mkdir -p $C10/plain/.claude && printf '{"permissions":{"allow":["Bash(echo C10_PLAIN:*)"]}}' > $C10/plain/.claude/settings.json && echo '# plain' > $C10/plain/CLAUDE.md
python3 -c "import json,os;p=json.load(open(os.path.expanduser('~/.claude.json')))['projects'];print([k for k in p if k.startswith('$C10')])"   # expected: []
cd /Users/new/Developer/GitHub/MAWS && MAWS_USER_DATA=$C10/userData pnpm dev
```

1. **Add project and trust.** In the empty "+"/"Add project" flow, pick `$C10/maws`; it appears under Projects. Its "+" opens the sheet with Location = This directory; Start shows the trust page naming `/private/tmp/maws-c10-accept/maws` and the five gates. "Trust and start" → within three seconds the row reads working or idle and the session tab opens. `grep -h '"initialize"' $C10/userData/engine-host/journal/*/*.jsonl | head -1` shows `"workspaceTrust":{"accepted":true,"directory":"/private/tmp/maws-c10-accept/maws"}`, and the same file's `meta initialize` row has `"workspace_trust_recorded":true`. `python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.claude.json')))['projects']['$C10/maws']['hasTrustDialogAccepted'])"` prints `True`. **Compared by the init frame:** in a terminal, `cd $C10/maws && claude -p --output-format stream-json --verbose --setting-sources user,project,local 'Reply OK' | head -1 | python3 -c "import sys,json;f=json.loads(sys.stdin.readline());print(sorted(m['name']+':'+m['status'] for m in f['mcp_servers']),sorted(f['slash_commands'])[:5],len(f['agents']))"` and the same extraction over the MAWS session's first `system/init` frame in its journal print the same MCP names and statuses, the same slash commands and the same agent count. A second session from the same "+" shows no trust page.
2. **Start without trusting.** Add `$C10/plain` as a project; "+" → the trust page → "Start without trusting" → the session starts; its notice reads the engine's line beginning `Ignoring 1 permissions.allow entry from .claude/settings.json: this workspace has not been trusted.`; from DevTools `await window.maws.invoke('session.listPermissionRules', { appSessionId })` lists no `projectSettings` rule; `~/.claude.json` has no entry for `$C10/plain`. Archive it; "+" again → "Trust and start" → the notice is absent and the rule `Bash(echo C10_PLAIN:*)` is listed.
3. **New worktree.** From `$C10/maws`'s "+": New worktree, name `accept-one`, branch left at `worktree-accept-one`, Start from HEAD. No trust page (the repository root is trusted since item 1). `git -C $C10/maws worktree list` shows `$C10/maws/.claude/worktrees/accept-one … [worktree-accept-one]`; the session's `system/init.cwd` (journal) is that path; the row sits under `maws` with the branch chip `worktree-accept-one`; `ls ~/.claude/projects/ | grep -- '-private-tmp-maws-c10-accept-maws--claude-worktrees-accept-one'` lists the slug. After one turn, `git -C $C10/maws status --short` does not list `.claude/worktrees/` (the engine's exclude; if it does, Surprises records it and M2's `info/exclude` decision is revisited).
4. **Existing worktree.** "+" → Existing worktree → `accept-one` (shown with its branch and `1 session`) → a second session runs there (`system/init.cwd` equal). Its context menu's "Remove worktree…" shows state `busy · 2 sessions are live here` with every destructive control disabled.
5. **Fork in place.** In the item-1 session send `Remember the word MANGO. Reply OK.`; after the reply, Fork → In place. A new row appears under `maws` titled like the source with ` (fork)` when the source had a user title; its transcript begins with the MANGO turn; sending `What word did I ask you to remember? Reply with just that word.` answers `MANGO`. The source's transcript file has the same size and mtime as before (`stat -f '%z %m'`), and its row is unchanged.
6. **Fork to a new worktree.** On the same source: Fork → New worktree, name `accept-fork`. The worktree exists in `git worktree list`; the fork's `system/init.cwd` is `$C10/maws/.claude/worktrees/accept-fork`; the fork answers `MANGO`; `ls ~/.claude/projects/-private-tmp-maws-c10-accept-maws--claude-worktrees-accept-fork/` shows exactly one `.jsonl`, whose first user record's `sessionId` equals the fork's engine id. **Resumes from the terminal:** `cd $C10/maws/.claude/worktrees/accept-fork && claude --resume <fork engine id>` opens the conversation with the MANGO history; ask the word again; `MANGO`; `/exit`. Within two seconds of the terminal session starting the MAWS row showed `terminal · <pid>` and its composer was replaced by the holder notice; after `/exit` the row is exited again.
7. **Fork rollback.** Fork → New worktree with name `accept-fork` again: refused before anything is created (`worktree path exists`), the sheet keeps the fields. Then a new worktree whose "Start from" is typed as a ref that does not exist (`no-such-branch`, entered through the branch picker's free text): the sheet shows `Creating worktree` then `failed`, "worktree removed"; `git worktree list` is unchanged; no new row remains in the sidebar; `sqlite3 $C10/userData/index.sqlite 'select count(*) from sessions where directory like "%no-such%"'` prints `0`.
8. **Rename with provenance.** Rename the live item-1 session to `C10 live rename`: the row follows within a second, and `cat ~/.claude/projects/-private-tmp-maws-c10-accept-maws/<id>/custom-title.json` prints `{"customTitle":"C10 live rename"}`. Archive it, unarchive it from "Archived sessions…", and while exited rename it to `C10 override`: the row shows it (source user), `custom-title.json` still says `C10 live rename`. In a terminal, `cd $C10/maws && claude --resume <id>`, `/rename Terminal wins`, `/exit`: the row reads `Terminal wins` within two seconds.
9. **Archive and grants.** In a fresh session in `$C10/maws` (permission mode `default` chosen in the sheet so a prompt occurs), ask `Run: touch c10-granted.txt`; approve with scope "this session"; ask again for `touch c10-granted-2.txt`: no prompt. Archive the session: `ps -p <pid>` (the pid from `session.status`) exits non-zero within eight seconds, the row leaves the sidebar, "Archived sessions…" lists it. Unarchive and Resume: the row is live again, and asking `Run: touch c10-granted-3.txt` runs without a prompt (the grant snapshot re-applied by C3 from the store file C10 kept).
10. **Cleanup ladder.** Archive both `accept-one` sessions (project menu → the sessions' Archive). In a terminal `touch $C10/maws/.claude/worktrees/accept-one/dirty.txt`. "Remove worktree…" on `accept-one` (from one of its rows in the Archived sessions dialog): state `dirty · 1 change`; "Remove checkout" disabled; "Discard changes and remove" with the acknowledgement → the directory is gone, `git worktree list` no longer lists it, `git branch --list worktree-accept-one` still prints the branch, and the dialog now offers "Delete branch" as `merged` (no commits ahead): confirm → the branch is gone. For `accept-fork`: in a terminal commit a file on its branch, archive its session, "Remove checkout" (clean) succeeds, "Delete branch" shows `1 commit not on master` and needs the acknowledgement; confirm → gone.
11. **Delete conversation.** On an exited session of `$C10/plain`: Delete → the dialog names the transcript; confirm → `ls ~/.Trash | grep <id>` lists the `.jsonl` (and the sidecar directory when one existed), the row is gone, `sqlite3 $C10/userData/index.sqlite "select count(*) from sessions where engine_session_id='<id>'"` prints `0`, and `$C10/userData/engine-host/state/<appSessionId>.json` is absent.
12. **Foreign-live and attach.** In a terminal `cd $C10/maws && claude --bg 'Wait; I will attach.'` prints a short id. Within two seconds the sidebar shows the session foreign-live with `bg · <short>`; opening it shows the transcript read-only, the holder notice in place of the composer, and "Attach in a terminal tab". Resume from its menu is disabled with the holder as tooltip; from DevTools `session.start` answers `{ status: 'held', holder: { kind: 'background_job', … }, attach: { jobId: '<short>', command: "'/Users/new/.local/share/claude/versions/2.1.283' attach <short>" } }`. Click Attach: a Terminal tab opens in the right panel and shows the background session's TUI; leave it with the key the TUI names. In the terminal `claude stop <short>`; within two seconds the row loses its holder and Resume is enabled; Resume → the session runs in MAWS. `claude rm <short>`. Then `cd $C10/maws && claude` interactively: within two seconds its row shows `terminal · <pid>`; `session.start` from DevTools answers `held` with `attach: null`; "Fork a copy" produces a running fork; `/exit` in the terminal.
13. **The engine's refusal is authoritative.** With another `claude --bg` job started and MAWS's holder view made stale (`kill -STOP` C4's poll is not possible; instead invoke `session.start` from DevTools within the same second the job starts, before the registry record is seen): the outcome is `failed` with `held` and the same attach command, derived from the stderr line `is running as a background session`; the row shows the holder once C4's poll catches up; `claude stop`/`rm` the job.
14. **D-16.** With one session live, ⌘Q → C5's "1 session mid-turn" dialog if a turn runs (Quit) → `pnpm dev` again: the session's row is exited with no holder, the draft set through `session.drafts.set` before quitting is returned by `session.drafts.get`, Resume brings it back with its history and its queued message (typed while the turn ran) still listed by `session.queue.list`.
15. **Tests and the mockup.** `pnpm test` passes and includes the suites named in the milestones; `pnpm verify` exits 0; `pnpm exec playwright test e2e/sessions.spec.ts` passes; every vignette of `mockups/05-sessions.html` (sheet, trust step, relay unreachable, fork and rename, cleanup, foreign-live, archive and delete confirmations) has rendered during items 1 to 14, tokens only, in the light theme and once in the dark theme.

**Teardown:** in MAWS, delete the acceptance sessions of `$C10/maws` and `$C10/plain` (item 11's path, once more each); `claude project purge $C10/maws` and `claude project purge $C10/plain` (the engine's own removal of the project's state and its `~/.claude.json` entries; the executor reads `claude project purge --help` first and records the flags used); `rm -rf $C10`; confirm `python3 -c "…projects…startswith('$C10')…"` prints `[]` again. Cost: about a dozen short turns through the relay, under two dollars; the executor records the sum from `session.getSessionCost`.

## Plan of Work

Six milestones, each runnable by a fresh executor from this document and the code, each with an observable gate; M6 is the acceptance above. Every milestone reads the whole document; entries below point.

### M1 — Trust, launch mapping, X6 extensions, the models catalogue

At the end of M1 main can say whether a directory is trusted and build the exact `LaunchSpec` a session needs, the engine host reports trust and carries a grant snapshot across a fork, the trust notice is an event, and the sheet's catalogue exists before any session does.

Touches: `src/shared/sessions/{request,setup,trust,models}.ts`, `src/main/sessions/{trust,launch-mapping,attach}.ts`, `src/shared/engine/{launch-spec,status}.ts`, `src/engine-host/{session,normalizer,ipc}.ts` (delimited), `src/engine-host/models-cache.ts`, `src/shared/ipc/schema/{session,engine}.ts` (the `session.trust.check`, `session.forget`, `engine.models` entries; the rest of the C10 block lands in M3), `test/support/{scratch-repo,trust-store}.ts`, `spikes/protocol-probe/{run-pass3.mjs,scenarios/pass3/fork-worktree.mjs,fixtures/pass3/fork-worktree-*.jsonl}` (committed as recorded; C3's `listJournals('pass3')` picks them up and its conformance suite must stay green over them).

Exposes: `trustKeyOf`, `trustStateOf`, `toLaunchSpec`, `attachCommand`, `BG_REFUSAL`, the X6 fields, `engine.models`, `session.forget`, `session.trust.check`. Consumes: C3's `LaunchSpecSchema`, `EngineSessionStatusSchema`, `EngineSession.start()` order, `Normalizer`, `SessionStateStore`; C4's git runner and `resolveStorePaths`.

Decisions local to M1: the trust and attestation rules and the catalogue cache under Interfaces; in addition, `readTrustStore` tolerates a torn read (the engine rewrites the file whole) by retrying once after 50 ms and answering `{}` with a logged warning; `trustKeyOf` never throws for a missing directory (the caller answers `missing_directory` first); the built-in catalogue is a constant with the five entries of `reads.jsonl` and no `claude/*` alias (aliases exist only through the relay and arrive with the first routed launch).

Does not touch: `src/main/git/`, the renderer, C4's index, the sheet.

Proves: acceptance items 1 and 2's journal and event evidence (trust attested and recorded; the notice when not). Pins, one line each: `trustKeyOf` on a temp repo, on a linked worktree of it (`git worktree add`), on a plain directory and on a symlinked path returns the repository root, the same root, the directory and the realpath respectively; `trustStateOf` reads `hasTrustDialogAccepted` under the key and under the directory, and `false` for a missing file; `toLaunchSpec` emits one `additionalDirectories` entry per directory, `trust.directory` equal to the trust key, `resume` and `inheritGrantsFrom` as given, `sessionId: null`; the normaliser over `pass2/trust-no-attestation.jsonl` emits one `notice.posted { key: 'trust:ignored' }` and over `pass2/trust-attested.jsonl` and `pass3/fork-worktree-fork.jsonl` none; `EngineSession.start()` with `inheritGrantsFrom` seeds the snapshot from the source's store file and writes `apply_flag_settings` with those rules (replay over `pass2/grant-reapply-resume.jsonl`, whose seq 7 is the expected frame); `engine.models` answers `builtin` with no cache, `cached` after an `initialize` response was observed, and `live` after `refresh` against a ready replay session; `session.forget` removes the state file and the journal directory and refuses `already_live`.

### M2 — Worktree service and the cleanup state machine

At the end of M2 MAWS creates, lists, inspects and removes managed worktrees the way the engine does, and the ladder's guards hold on real repositories.

Touches: `src/shared/sessions/worktree.ts`, `src/main/git/worktrees.ts`, `src/shared/ipc/schema/git.ts` (C10 block), `test/support/scratch-repo.ts` (worktree helpers).

Exposes: `git.worktree.*`, `cleanupState`, `WorktreeService` (the class behind the commands, taken by M3's service). Consumes: C4's git runner and porcelain-v2 parser, `SessionStore.list` for the session counts.

Decisions local to M2: the invocation table and the state machine under Interfaces; in addition, `git.worktree.status` for a path the index never saw counts sessions as zero (a worktree the owner made by hand is cleanable); `add` refuses a `base` that `rev-parse --verify` cannot resolve with `base not found: <ref>` before creating anything; `remove` on a `prunable` entry (directory already gone) skips to `prune` and reports `removed: true`; the service never runs `git gc` or touches `info/exclude`.

Does not touch: the session service, the renderer, `src/main/git/*.ts` other than the new file.

Proves: acceptance items 3, 4, 7 (the worktree half) and 10's git effects. Pins: over a scratch repository, `add` creates `<root>/.claude/worktrees/feat+login` on branch `worktree-feat+login` from `HEAD` and refuses a second add with `worktree path exists`, an existing branch name with `branch exists`, a repository without commits with `repository has no commits`, and a bad name with `validateWorktreeName`'s message; `add` from a linked worktree's path creates the sibling under the main root; `status` reports `clean`, then `dirty · 1 untracked` after a touch, `busy` when the injected session counter says one live, `detached` after `remove`, `gone` after the branch delete; `remove` refuses `dirty` without `discard`, removes with it, refuses `busy`, refuses a `locked` worktree, and `deleteBranch` on an unmerged branch reports `ahead` correctly (one commit in the worktree) and deletes it only when asked.

### M3 — Session service: create, start, fork, archive, delete, rename, setup events, rollback

At the end of M3 every lifecycle command answers from DevTools without a sheet: a session can be created in a directory or a new worktree, resumed, forked in place and to a worktree, archived, deleted and renamed, with `session.setup` telling the story and rollback holding on failure.

Touches: `src/main/sessions/{service,setup}.ts`, `src/shared/ipc/schema/session.ts` (the rest of the C10 block), `src/main/index/sessions.ts` (`resetSelfHolders`), `src/main/index.ts` (C10 block), `src/main/sessions/launch-mapping.ts` (record → spec).

Exposes: the X2 commands `session.create/start/fork/archive/delete/rename/pickDirectory/revealPath`, the event `session.setup`, `SessionService`. Consumes: M1, M2, C3's `session.launch`/`status`/`stop`/`send`/`renameSession`/`engine.sessions`/`engine.binaryInfo`, C4's store API and `session.update`, C5's `SessionReadModel.register`.

Decisions local to M3: the state table, guards, rollback and the per-command semantics under Interfaces; in addition, the service treats C3's `session.launch` answer of `launching` as the linearisation point after which the record is C3's to report (every later state comes from `session.status`), and the setup runner is one `async` function per setup driven by a promise that resolves on the status or exit event, with the table as its shape; two concurrent setups for one record are refused `already_live` by C3's reservation, and the service refuses a second `create` whose `newWorktree` path equals one in flight; `session.delete` runs the Trash moves before `session.forget` so a failed move leaves everything (the record included) in place and reports which path failed; `session.pickDirectory` is `main`-owned because the renderer cannot open native dialogs. Under `MAWS_E2E=1` with `MAWS_E2E_REPLAY_FIXTURE=<path>` set, every spec carries `replay: <path>` (C3's transport, `MAWS_ENGINE_REPLAY=1`), the e2e seam.

Does not touch: the renderer, C4's discovery or tailers, C3's broker or queue.

Proves: acceptance items 5, 6, 7, 8, 9, 11 and 14's data effects, driven from DevTools. Pins (vitest node with a fake host answering C3's commands from scripts, the real index on a temp file, a scratch repository): `create` in a directory produces a record, `session.setup { phase: 'launching' }`, then `ready` when the fake host emits `session.status { process: 'ready' }`, and sends the first message once; `create` with `newWorktree` emits `worktree` then `launching`, and when the fake host answers `refused` the worktree, its branch and the record are gone and `failed { rolledBack: true }` was emitted; `create` with a failing `add` never calls `session.launch`; `start` answers `archived`, `already_live`, `held` (with the attach command for a job holder and `null` for a terminal), `missing_directory`, `needs_trust` in that order of precedence; `start` passes `resume: { fork: false }`, the record's directories and model, and `trust.directory` equal to the trust key when the option is given; `fork` copies no file (the temp store's `projects/` has the same file list before and after), passes `resume: { fork: true }` and `inheritGrantsFrom: source`, refuses `busy` while the source's status has a turn, and rolls back on refusal without touching the source; `archive` calls `session.stop { reason: 'archive' }` only for a live session, sets `archived`, keeps the store file, and runs the ladder only when asked; `delete` refuses `held` and `live`, moves exactly the transcript, sidecar directory and siblings (a fake `trashItem` records paths), then forgets, then removes; `rename` routes to `renameSession` for a live session and to `session.update { title }` otherwise; `resetSelfHolders` at start clears every `self`; the `BG_REFUSAL` match on C3's `error.raised` text yields `held` with the short id.

### M4 — The new-session sheet, session and project actions, dialogs, end-to-end over the replay transport

At the end of M4 the owner's path exists: "+" and ⌘N open the sheet, every field validates, the trust page appears for an untrusted directory, the relay-down page offers Direct, progress shows the worktree and launch phases, the tab opens on ready, and every §5.1 session and project action is live in the sidebar menus and the palette.

Touches: `src/renderer/src/sessions/**`, `src/renderer/src/App.tsx`, `src/shared/keymap/actions.ts`, `src/renderer/src/sidebar/menus.tsx` **[refresh]**, `src/renderer/src/stores/layout.ts` **[refresh]**, `e2e/sessions.spec.ts`, `test/support/trust-store.ts`.

Exposes: the `newSession` slot filled, `registerSessionActions`, the dialogs. Consumes: M3's commands and event, C5's slot, `actionHandlers`, `runAction`, layout store, notices store, `radix-ui`; C4's `session.projects.*`, `session.list { includeArchived }`, `git.branches`; M2's `git.worktree.list/status`.

Decisions local to M4: the field table, the sheet state machine and the action list under Interfaces, with `mockups/05-sessions.html` as the layout and copy reference (advisory; the light rendering is the reference, the fork vignette's "copies the transcript" line is not followed); in addition, the sheet's `loading` state runs its four reads in parallel and renders after all settle (a failed catalogue read shows the built-in list with a note; a failed trust check disables Start with the error); the worktree name field is prefilled but not selected, so typing replaces nothing by accident; the trust page's default button is "Trust and start" (§3's intent: sessions load project settings as the terminal does); `ArchivedSessionsDialog` is a Radix `Dialog` list, not a sidebar section (C5 hides archived rows and this document adds no sidebar section); every dialog is tokens-only and keyboard-operable (Enter confirms the non-destructive default, destructive confirmations need the acknowledgement checkbox before Enter works). The e2e launches the built app with `MAWS_E2E=1`, `MAWS_ENGINE_REPLAY=1`, `MAWS_E2E_REPLAY_FIXTURE=spikes/protocol-probe/fixtures/pass2/auto-routed.jsonl`, a temp `CLAUDE_CONFIG_DIR` built by C4's `store-fixture` plus `trust-store.ts` (one trusted repository, one untrusted), a throwaway `MAWS_USER_DATA`, and two scratch repositories; the first message is left empty in every e2e launch because the replay transport ends the run on any `user` frame the fixture did not record (C3's `replay_mismatch`); readiness is the fixture's `initialize` answered from C3's handshake prelude.

Does not touch: `HolderNotice`, the attach path (M5), C6/C7 surfaces.

Proves: acceptance items 1 to 11's renderer half and item 15's e2e. Pins (happy-dom, Testing Library): validation marks a missing directory, a bad worktree name, a branch that exists, a duplicate additional directory; the auto-mode notes appear for a `supportsAutoMode: false` model with `auto` and for a `claude/*` model; the trust page appears only when `trusted` is false and sends `trust: { accepted: true }` or `null` as pressed; the relay page's "Run direct" re-invokes `session.start` with `gateway: 'direct'` on the same `appSessionId`; the reducer's transitions match the state machine (table test). Playwright: the sheet from "+" on the untrusted repository shows the trust page, "Trust and start" launches, the tab opens, and the journal's `initialize` row carries `workspaceTrust` with the repository root; the trusted repository shows no trust page and its row carries no `workspaceTrust`; New worktree `e2e-one` creates the git worktree and the session's spec `cwd` is its path (journal `spawn` row); Fork → In place opens a second tab whose spec has `resume.fork: true`; Archive removes the row and `session.list { includeArchived: true }` has it; the Archived dialog unarchives; Delete moves the fixture-store transcript to the Trash (asserted by absence, since the Trash is per user) and removes the row; Rename on an exited session sets the override; `pnpm verify` stays green.

### M5 — Foreign-live: guards, the engine's refusal, attach in a terminal tab

At the end of M5 a session held elsewhere is read-only with its holder named, MAWS refuses to become a second writer, the engine's own refusal is mapped to the same outcome, and a background job attaches in a terminal tab.

Touches: `src/renderer/src/sessions/HolderActions.tsx`, `src/renderer/src/session/HolderNotice.tsx` (C5's, one render line), `src/renderer/src/sessions/actions.ts` (`session.attach`), `e2e/sessions.spec.ts` (the foreign-live cases).

Exposes: nothing new. Consumes: M3's `held` outcome, C4's holders, C9's `openTerminal`, C8's panel host (**[refresh]** if C8 has not landed when M5 runs, `openTerminal` targets C9's harness-equivalent seam and the executor records it; the charter's edge "C8 blocks C10's attach affordance" is honoured by re-running item 12 after C8 lands).

Decisions local to M5: under Interfaces, Attach; in addition, the terminal opened for attach uses the job's `cwd` from C4's `JobState` when known (a job may run in a worktree), else the record's directory; the affordance disables itself while a terminal tab for the same `(appSessionId, 'attach:<jobId>')` label is alive (`pty.list`), so a second click focuses it instead of spawning twice; "Fork a copy" on a held row calls `session.fork { target: { kind: 'inPlace' } }`, which the engine allows for background holders (its own message suggests it, `pass2/resume-live-bg.jsonl` seq 5) and which reads a print-mode or interactive holder's file as a snapshot.

Does not touch: C4's holder detection, C9's tool, the panel host.

Proves: acceptance items 12 and 13. Pins: with a synthetic `sessions/<pid>.json` (`kind: 'bg'`, `jobId`, `pid` of the test runner, `procStart` from `ps -o lstart=` under `LC_ALL=C TZ=UTC`, C4's own fixture recipe) the row is foreign-live within two seconds, the pane shows the notice with Attach, `session.start` answers `held` with the attach command naming the pinned binary, and clicking Attach invokes `pty.spawn` with `command` equal to it and `cwd` the job's; a `kind: 'interactive'` record yields `held` with `attach: null` and no Attach control; a fake host answering `error.raised` with the refusal text after a `launching` answer yields `failed` with `held` and the same command.

### M6 — Live acceptance against the real engine and a scratch clone

At the end of M6 the Acceptance section has run as written on the owner's Mac, every item ticked in Progress with its evidence, the Surprises and Decision Log carrying what the real engine did, the scratch clone and its `~/.claude.json` entries removed by the teardown, and the branch ready for its review.

Touches: this document's Progress, Surprises & Discoveries and Decision Log; `test/support/scratch-repo.ts` if the acceptance found a gap; no source change unless an item fails, in which case the fix lands under the milestone that owns it and the item reruns.

Decisions local to M6: item 13 needs the registry poll to lose the race once; if three attempts all see the holder first, the item is satisfied by the M5 fake-host pin plus one manual `claude --resume` of the job's id in a terminal, whose stderr line is recorded verbatim; item 12's attach TUI detach key is recorded as observed; `claude project purge`'s flags are recorded before it runs. Cost is reported.

Does not touch: anything under `src/` except by a failing item's fix.

Proves: acceptance items 1 to 15 in order.

## Concrete Steps

Working directory for everything: the C10 worktree (`git worktree add ../MAWS-c10 -b c10-sessions master` once C3, C4, C5 and C9 are on master), shown as `/Users/new/Developer/GitHub/MAWS-c10`.

```
cd /Users/new/Developer/GitHub/MAWS-c10 && pnpm install && pnpm test
```
Expected before M1: every existing suite green (C1 through C9), and `listJournals('pass3')` lists C3's two pass-3 fixtures.

M1:
```
pnpm test -- src/main/sessions src/engine-host/models-cache src/engine-host/normalizer src/shared/sessions
```
Expected: suites `trust key and trust store`, `launch mapping`, `trust notice from stderr and initialize`, `inherit grants on fork`, `models catalogue cache`, `session.forget` pass; C3's `normaliser replays every probe fixture` now counts the three `pass3/fork-worktree-*` journals and stays green.
```
pnpm dev   # then in DevTools:
await window.maws.invoke('session.trust.check', { directory: '/Users/new/Developer/GitHub/MAWS' })
await window.maws.invoke('engine.models', { refresh: false })
```
Expected: `{ ok: true, value: { trustKey: '/Users/new/Developer/GitHub/MAWS', keyKind: 'repo', trusted: true, source: 'trustKey', isHome: false, … } }`; a catalogue with `source: 'builtin'` on a cold profile and `cached` after any session launched.

M2:
```
pnpm test -- src/main/git/worktrees src/shared/sessions/worktree
```
Expected: `worktree add, list, status`, `cleanup state machine` pass. Then in DevTools against a scratch clone (`git clone --no-hardlinks /Users/new/Developer/GitHub/MAWS /private/tmp/c10-m2`):
```
await window.maws.invoke('git.worktree.add', { repoRoot: '/private/tmp/c10-m2', name: 'm2', branch: { kind: 'new', name: 'worktree-m2', base: 'HEAD' } })
await window.maws.invoke('git.worktree.status', { path: '/private/tmp/c10-m2/.claude/worktrees/m2' })
await window.maws.invoke('git.worktree.remove', { path: '/private/tmp/c10-m2/.claude/worktrees/m2', discard: false, deleteBranch: true })
```
Expected: `git -C /private/tmp/c10-m2 worktree list` shows then no longer shows the worktree; `status.state` is `clean`; the result `{ removed: true, branchDeleted: true, error: null }`.

M3:
```
pnpm test -- src/main/sessions
```
Expected: `session service setup table`, `rollback`, `start guards`, `fork without a copy`, `archive`, `delete to trash`, `rename routing`, `D-16 reset` pass. Then `pnpm dev` and from DevTools, with the relay up:
```
const r = await window.maws.invoke('session.create', { request: { projectId: null, location: { kind: 'directory', path: '/private/tmp/c10-m3' }, additionalDirectories: [], model: 'sonnet', effort: null, permissionMode: null, gateway: 'gateway', trust: { accepted: true }, firstMessage: 'Reply with exactly OK' } })
```
Expected: `{ ok: true, value: { status: 'launching', appSessionId } }`, then `session.setup` events `launching` and `ready` in the Diagnostics event log, a sidebar row that reads `starting` then working then idle, and `OK` in the transcript; a second `session.start` on it answers `already_live`.

M4:
```
pnpm test -- src/renderer/src/sessions
pnpm build && MAWS_E2E=1 MAWS_ENGINE_REPLAY=1 pnpm exec playwright test e2e/sessions.spec.ts
```
Expected: the happy-dom suites `sheet validation`, `sheet reducer`, `trust page`, `relay page`, `dialogs` pass; the Playwright spec's cases `trust page and attestation`, `new worktree`, `fork in place`, `archive and unarchive`, `delete`, `rename` pass.

M5:
```
pnpm test -- src/renderer/src/sessions/HolderActions src/main/sessions/attach
MAWS_E2E=1 MAWS_ENGINE_REPLAY=1 pnpm exec playwright test e2e/sessions.spec.ts -g foreign
```
Expected: `held outcomes and the attach command` and the Playwright `foreign-live` cases pass.

M6: the Acceptance section verbatim, then `pnpm verify` (exit 0).

## Residue decisions (C10, 2026-09-28)

What the design left to the child, settled here; the execution document `docs/doperpowers/plans/2026-09-28-c10-sessions-worktrees-trust.md` carries the interfaces, state tables, milestones and gates. Grades: binding where the design binds the outcome or a sibling codes against the name, advisory where a later child may overturn with a dated line here.

- *Lifecycle commands and the setup event*: C10 adds, owner main, `session.create { request }`, `session.start { appSessionId, options }` (resume or first launch of a record, with the guards `archived`, `already_live`, `held`, `missing_directory`, `needs_trust` in that precedence), `session.fork { appSessionId, target, options }`, `session.archive { appSessionId, worktree }`, `session.delete { appSessionId, stopIfLive }`, `session.rename { appSessionId, title }`, `session.trust.check { directory }`, `session.pickDirectory`, `session.revealPath`; owner engine-host, `session.forget { appSessionId }` and `engine.models { refresh }`; the event `session.setup { appSessionId, phase: worktree | launching | ready | failed, detail, outcome }`. `create` and `fork` answer `launching` with the app id before the worktree step when one is needed (worktree creation can take seconds and a main-owned command should not hold a click), and otherwise return C3's own launch outcome, which answers at spawn; every later phase streams as `session.setup`. Every launch goes through C3's `session.launch`; the sheet, the sidebar menus and C7's send-on-exited path call these and never C3's launch directly. Binding (C7 and C11 code against the names).
- *Trust*: the trust key is the git repository's main-worktree root (linked worktrees share it; SPEC §3 15.2, verified by the pass-3 probe) or the directory's NFC realpath; MAWS reads `projects[<key>].hasTrustDialogAccepted` from `${CLAUDE_CONFIG_DIR ?? ~}/.claude.json` on demand and never writes the file; attestation is `initialize.workspaceTrust { accepted: true, directory: <trust key> }` (the same object under `claim_session.workspace_trust` for C12's spare, unverified there); the sheet shows the trust step only when the key is untrusted, with "Trust and start" and "Start without trusting"; additional directories are never trust-gated (`--add-dir` roots are not settings sources). The engine's stderr notice is emitted by C3's normaliser as `notice.posted { key: 'trust:ignored' }` only when the `initialize` response did not record trust, because the line is printed before the attestation is read and appears on attested launches too (`pass2/trust-attested.jsonl` seq 5 and 7). `EngineSessionStatus.trust { attested, recorded }` is C10's additive X6 field. Binding as verified.
- *Fork*: no transcript is copied. The engine resolves `--resume <id>` across the current project directory, every worktree's project directory and all of `projects/*` (SPEC §35 12.5, 17.1), declines an ambiguous duplicate, and writes `--fork-session`'s new session under the launch directory's slug with the history re-written under the new id (pass-3 `fork-worktree-fork.jsonl`: the fork launched in `<repo>/.claude/worktrees/probe` answered from the source's history and wrote only `<slug of the worktree>/<new id>.jsonl`; the source file's size and mtime were unchanged). Fork in place and fork to a worktree therefore differ only in the `cwd` of the launch; rollback removes the worktree and record the fork created and never touches the source; a fork is refused while the source has a turn open in MAWS; the fork inherits the source's grants through `LaunchSpec.inheritGrantsFrom` (C10's additive X6 field, seeded before C3's re-application) and, when the source had a user title, is renamed `<title> (fork)` through the engine. The charter's "by copying the transcript under the new project slug" is withdrawn on this evidence (`[parent-impact]`, Decision Log): a copy would create the duplicate the engine's resolver declines. Binding.
- *Worktree convention and invocation*: `<repoRoot>/.claude/worktrees/<name with / as +>` on branch `worktree-<name+>` by default (the engine's `EnterWorktree` convention, SPEC §47 11.1); created from the main root whichever worktree the owner started in, so C4's membership rule keeps it under the same project; `git worktree add --no-track -b <branch> <path> <base>` for a new branch (`-b`, where the engine uses `-B`, because the sheet promised not to reset an existing branch), `git worktree add <path> <branch>` for an existing one; base defaults to `HEAD` and is never fetched; `info/exclude` is left to the engine, which appends `**/.claude/worktrees/` under its own marker once per process. Binding on the convention (§4.5), advisory on mechanism.
- *`git.worktree.*` beside C4's read-only service*: `git.worktree.list`, `status`, `add`, `remove` (owner main) in `src/main/git/worktrees.ts` over C4's runner, the only git mutations in P0; C4's service and its read-only guard are untouched; `status` derives the cleanup state from git and the index on every call and never caches it. Binding on the names and the read-only split, advisory on mechanism.
- *Cleanup state machine*: states `busy` (a live or foreign session in it, or locked), `dirty`, `clean`, `detached` (branch only), `gone`; archive sessions is always allowed and never stops a process; remove needs `clean`; discard-and-remove needs the acknowledgement naming the change count; delete branch runs only after removal and, unmerged into the main worktree's branch, needs the acknowledgement naming the commit count; the ladder stops at the first failure and undoes nothing. Binding on the four distinctions and the guards (§3, §4.5), advisory on copy.
- *Archive, unarchive, delete*: archive is `session.stop { reason: 'archive' }` when live, `archived: true`, tabs closed, the dialog naming the session's running background tasks and workflows before the human confirms (§4.4: exit never silently discards background work), the worktree ladder offered only for the last session of a managed worktree, the store file kept so an unarchived session resumes with its queue and grants; unarchive is C4's `session.update { archived: false }` from a per-project "Archived sessions" dialog (C5's sidebar hides archived rows and gains no section); delete conversation is refused for a foreign holder and for a MAWS-live session unless "Stop and delete", then moves the transcript, its sidecar directory and its siblings to the Trash (`shell.trashItem`), forgets the store file and journal, and removes the record; this Trash move is the only write C10 makes under `~/.claude`. Binding on the refusals and on "never silently" (D-12), advisory on the Trash and the dialog.
- *Rename with provenance*: a live session is renamed through C3's `session.renameSession`, so the engine's store carries it and C4's index reads it back as the engine's fact; a session with no live process gets C4's override (`session.update { title }`), which a later terminal `/rename` supersedes under C4's title rule; no write-through on the next resume (it would append duplicate `custom-title` records to every resumed session). Binding (C4's rule), advisory on the omission.
- *Foreign-live and attach*: "live in MAWS" is C3's `engine.sessions`, "foreign" is C4's holder, and `self` is never a guard input; at app start every stale `self` is reset (D-16); `session.start` answers `held` for `terminal` and `background_job` holders (MAWS's own guard, since the engine has none for interactive or print-mode holders, pass-2 item 10) and the engine's refusal for a `--bg` holder (`is running as a background session (<short>)`, `pass2/resume-live-bg.jsonl` seq 5) is mapped to the same outcome when MAWS's view was stale; "Attach in a terminal tab" opens C9's terminal with `command` = the pinned binary path, single-quoted, plus ` attach <short>`, in the job's cwd, from the session pane's holder notice and the row menu, never from the Overview card; "Fork a copy" is the escape hatch for any holder. A print-mode holder from another SDK client stays undetectable (C4's finding) and is accepted under D-12. Binding as verified.
- *Grant snapshot hook*: resume keeps the snapshot by app id (C3 re-applies it), a fork inherits the source's through `inheritGrantsFrom`, archive keeps the store file, delete forgets it; nothing else copies or edits a snapshot. Binding (X6 additive).
- *Sheet field model*: location (This directory with recent projects and a native chooser · New worktree with name, branch new or existing, and start-from · Existing worktree from `git.worktree.list`), model from `engine.models` (a host-side catalogue cached across launches, built-in before the first, with the "cannot hold auto mode" note where `supportsAutoMode` is false and the local-lane note on `claude/*` gateway models), effort, permission mode, additional directories (one `--add-dir` each, realpathed, re-passed on resume from the record), inference (relay default, Direct per session), optional first message sent by main after `ready`; validation as tabled; the trust block lists the files trust would load, read from the directory itself; on `relay_unreachable` the sheet offers "Open ClaudeUsage, then start" (C5 action `gateway.openClaudeUsage`, registered by C11, disabled until then; the sheet polls the relay and starts by itself once it answers) and "Run direct" (`session.start { gateway: 'direct' }` on the same record); the record exists from the first millisecond and reads `starting` through a `SetupSource` digest; `mockups/05-sessions.html` is the layout and copy reference. Binding on the fields and the two auto-mode notes (§5.1, §19), advisory on layout, copy and the mockup.
- *Additional directories and resume*: `--add-dir` is not persisted by the engine (SPEC §24 9), so the record's `additionalDirectories` is the source of truth and is re-passed on every resume; discovered sessions have none. Binding as verified.
- *Acceptance mechanics*: one scratch clone of the owner's MAWS repository plus a plain directory under `/private/tmp`, the real `~/.claude` and `~/.claude.json` (trust must be compared with the terminal's own init frame), a throwaway `MAWS_USER_DATA`; teardown deletes the sessions through MAWS and runs the engine's `claude project purge` on the scratch paths so the trust entries the acceptance created leave with it. Binding on never touching the owner's live checkouts, advisory on mechanics.
- *Testing*: vitest node for trust, launch mapping, the models cache, the worktree service and the cleanup table over scratch repositories, and the session service over a scripted fake host and a temp index; vitest happy-dom for the sheet's validation, reducer and dialogs; Playwright over the built app with C3's replay transport (`MAWS_E2E_REPLAY_FIXTURE`), a temp config home with a synthetic `.claude.json`, and scratch repositories; the live layer is the acceptance itself. Advisory.

## Surprises & Discoveries

- Observation: the engine resolves a `--resume` id across all project directories and writes a `--fork-session` fork under the launch directory's slug, re-writing the history under the new id; no app-side transcript copy is needed, and a copy would create the duplicate-UUID ambiguity the SPEC says the scan declines.
  Evidence: `spikes/protocol-probe/fixtures/pass3/fork-worktree-fork.jsonl` seq 6–10 (initialize from `<repo>/.claude/worktrees/probe` with `--resume <X> --fork-session`), seq 14 (`system/init` with the new id and the worktree cwd), seq 83 (the answer `MANGO` from the source's history), seq 88–89 (on disk: only `<slug of the worktree>/<Y>.jsonl`, 30 records all under Y, the source file's size and mtime unchanged). SPEC §35 16.6: "There is no bulk copy of the parent file and no pointer record — the loaded messages are re-written as the new session proceeds."
- Observation: attesting trust with the repository root as `directory` from a worktree cwd records `projects[<root>]` and loads the project's allow rule in the worktree; the trust key is shared by linked worktrees.
  Evidence: `fork-worktree-fork.jsonl` seq 6 (`workspaceTrust.directory` = the root), the initialize response's `workspace_trust_recorded: true`, `list_permission_rules` listing `Bash(echo MAWS_C10_PROBE:*)` from `projectSettings`, seq 90 (`~/.claude.json` after: root `true`, worktree path absent).
- Observation: the trust notice on stderr appears on attested launches too, before the `initialize` request is processed; it is a warning only when trust was not recorded.
  Evidence: `pass2/trust-attested.jsonl` seq 5 (the notice) then seq 7 (`workspace_trust_recorded: true`) and seq 9 (the rule present); `pass3/fork-worktree-fork.jsonl` seq 5 then the rule present.
- Observation: `/tmp` paths are canonicalised to `/private/tmp` by the engine (the slug and the trust key use the realpath); the fork's first JSONL record carries `cwd: null` (a metadata record), so "cwd from the first record" must skip it.
  Evidence: `fork-worktree-start.jsonl` seq 369, 374–375 (the literal `/tmp` slug absent, the `/private/tmp` slug present); `fork-worktree-fork.jsonl` seq 89 (first record `cwd` null, first user record's cwd the worktree). C4's discovery already reads the first `cwd` in the head rather than the first record.
- Observation: the owner's `~/.claude.json` holds per-worktree `projects` entries from older engines, so the trust reader accepts the directory's own entry as a fallback.
  Evidence: keys such as `/Users/new/Downloads/claude-code-main/.claude/worktrees/priceless-shannon-d7fa54` in the owner's store (read 2026-09-28; values not recorded).

## Decision Log

- 2026-09-28: Verification call for this child: per-milestone reviews at the astra rung through `doperpowers:subagent-driven-execution` (reviewer-medium; M3's service and M2's worktree mutations at reviewer-high, because they write to disk and to the owner's git repositories), the whole-branch review at reviewer-high, and the acceptance run as M6 before the review. Author.
- 2026-09-28: `[parent-impact]` §3 "Sessions" and the C10 section describe fork to a new worktree as "copying the transcript under the new project slug and launching with the fork flag, with rollback". On the pass-3 evidence above the copy is withdrawn: the engine finds the source across project directories and writes the fork under the new slug itself; a copy would leave a second file with the source's id under the worktree's slug, which is the duplicate the engine's resolver declines and which C4's `engine_session_id UNIQUE` cannot index. The intent (fork into a fresh worktree, roll back on failure) is kept: rollback removes the worktree and the record. The coordinator records a dated amendment in the charter's Decision Log; this document does not edit the charter.
- 2026-09-28: Decision: the trust reader lives in main and reads `~/.claude.json` directly rather than through C4's filesystem service. Rationale: the file is the engine's global config beside the store, not part of the transcript store C4 watches; the read is on demand (two moments), and putting it in the engine host would add a host round trip for a 200 KB JSON parse. Alternative rejected: an `fs.trust` command in C4's host service, which would widen the read-only guard's surface for no gain.
- 2026-09-28: Decision: worktree mutations live in a new main module with their own X2 sub-namespace `git.worktree.*` instead of extending C4's git service. Rationale: §4.5 binds the service read-only and C4's acceptance proves it with a static guard; a separate module keeps that proof intact and makes every mutation greppable. Alternative rejected: a `session.worktree.*` namespace, because the operations are git operations a later source-control panel (P1) will reuse.
- 2026-09-28: Decision: `session.delete` moves files to the Trash instead of unlinking or using the engine's `.orphaned-` quarantine name. Rationale: reversible from Finder, matches the owner's mental model, and the engine's quarantine is its mechanism for unreadable transcripts, not a user deletion. Alternative rejected: `claude project purge`, which is per project.
- 2026-09-28: Decision: the pass-3 probe (`scenarios/pass3/fork-worktree.mjs`, three fixtures) was recorded during authoring to settle the fork mechanism and the trust key empirically, per the charter's rule that wire claims are verified against a fixture or a new probe. The files are uncommitted at hand-off; M1 commits them. Cost: three Haiku turns through the relay.

## Outcomes & Retrospective

Pending — written at finish.
