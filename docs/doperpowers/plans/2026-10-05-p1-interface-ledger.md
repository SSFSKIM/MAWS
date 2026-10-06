# P1 interface ledger (opened 2026-10-05)

> **Parent:** `docs/doperpowers/plans/2026-10-05-p1-extension.md` (the P1 composite spec), decision A-11 and contracts X9, X14, X15. One writer: the architect. Children propose names in their execution documents and hand-backs; the architect records them here before a second child codes against them. A name not in this ledger is not yet shared.

Purpose: siblings in flight extend the same contracts before any of them lands. This ledger is the one interim contract they code against, so two execution documents never disagree on a tool name, an event kind, a tab kind or a version number. It is reconciled before each wave's first executor starts and kept current as children land; at P1's close its content is folded into the spec's §10 and the charter's contracts.

## 1. X9 — tools on the `maws` server

Owner E1. The server is named `maws`; the engine exposes each tool to the model as `mcp__maws__<tool>`. Rules: snake_case tool names; every description opens with its fallback sentence for sessions that lack the tool (A-18; ToolSearch indexes descriptions); every tool's input and result schema lives in `src/shared/` beside the X1 events it emits; a child adds a tool only after its row is here.

| Tool | Owner | Consumers | State |
|---|---|---|---|
| `send_file {files: string[1..20], caption?, urgency?: 'normal'|'high'}` → `{status:'delivered', deliverables:[{id,path,name}]}`; one X12 JSON record per file at `<userData>/deliverables/<appSessionId>/<id>.json` | E1 | E2 (the record and the viewer) | landed 2026-10-06 (f3202d3e; `src/shared/maws/tools.ts`, `deliverable.ts`; the host writes the record with a temp file and a rename) |
| `ask {title?, context?, blocking? (default true), questions[1..12]: {id?, question, header?, modality: 'choice'|'text'|'file'|'folder'|'repository', options?, multi?, allowOther?, multiple?, placeholder?}}` → `{status:'answered', askId, answers:[{id, question, status:'answered'|'skipped'|'decide_for_me', value?, otherText?, name?}]}` or `{status:'asked', askId}`; async answers arrive as a `priority:'next'` steer `[MAWS ask <askId>] …` with a fenced AskResult JSON; askId = tool-use id | E1 | — | landed 2026-10-06 (f3202d3e; `ask.ts`, with `AskCancelReason 'exit'|'withdrawn'`; a pending blocking ask at exit or an MCP `notifications/cancelled` cancels it) |
| `show_pane {pane: 'diff'|'file'|'terminal'|'tasks'|'deliverable'|'browser'|'source-control', target?, line?}` → `{status:'shown', pane, opened: {kind:'panel-tool', toolId, tabId, title} | {kind:'main-tab', tabId, path, line}}`; passes `{target}` to a sibling's tool and reuses the session's Terminal tab | E1 | E2, E4, E6, E7 | landed 2026-10-06 (f3202d3e; `panes.ts`, `PANE_ANSWER_MS = 8000`; passes `{target}`: a deliverable id, a url, a task id, or none) |
| `artifact_create`, `artifact_update`, `artifact_list`, `artifact_screenshot` | E2 | — | reserved |
| `browser_tabs`, `browser_navigate`, `browser_snapshot`, `browser_act`, `browser_eval`, `browser_screenshot` | E4 (its cut may rename within the `browser_` prefix) | — | reserved |

`show_pane.pane` values: `diff`, `file`, `terminal`, `tasks` (E7), `deliverable` (E2), `browser` (E4), `source-control` (E6, added 2026-10-05 by the architect for symmetry; E1 accepts it as a name and E6 supplies the tool).

## 2. X1 — event kinds added in P1

Rule: events the tool server emits are prefixed `maws.`; side-thread events `side.`; cross-session rows `peer.`. The schema file is `src/shared/graph/events.ts`; a child appends, never reorders.

| Kind | Owner | Consumers | State |
|---|---|---|---|
| `maws.ask.opened`, `maws.ask.answered`, `maws.ask.cancelled`; `process.exited` gains optional `lostAskCount` (inline, C12's precedent) | E1 | transcript rows, the Question sheet, the exit row | landed 2026-10-06 (f3202d3e) |
| `maws.delivery.file` (E1); `maws.delivery.artifact` (E2, reserved) | E1 (emit), E2 (record) | transcript rows, Deliverables | file landed 2026-10-06 (f3202d3e) |
| `maws.pane.shown` (X1); the pane bridge is the IPC event `maws.pane.show`, not an X1 event | E1 | — | landed 2026-10-06 (f3202d3e) |
| `side.thread.*` (opened, summarised) | E3 | sidebar, transcript | reserved |
| `peer.message` (built by E7; `peer.list` released 2026-10-06: the listing draws from the `ListAgents` tool pair) | E7 | transcript rows (`agent_list` row kind, `agent_message.peer`) | named 2026-10-06 (author's document) |
| `subagent.message` (declared in P0, never emitted) | E7 emits, from `<agent-message>` frames and records at both emission sites (live and `backfill.ts`) through one shared parser | existing row, gains `peer?`/`report?` | named 2026-10-06 (author's document) |

## 3. X14 — main-tab kinds (`src/shared/ipc/schema/layout.ts`)

Existing: `session`, `agent`, `file`, `diff`, `diagnostics`, `settings` (its `section` enum gained `voice` by E9, append-only).

| Kind | Owner | Restore semantics | State |
|---|---|---|---|
| `deliverable` | E2 | restores to the record by id; a missing record shows the Deliverables list | reserved |
| `browser` | E4 | restores to the tool's empty state with the last URL shown as a suggestion, never auto-loaded | reserved |

## 4. X15 — version numbers

Settings (`src/shared/settings/defaults.ts`, `migrateSettings`): version 8 today.

| Version | Owner | What it adds | State |
|---|---|---|---|
| 9 | E9 | `voice: { locale }`; `SETTINGS_DEFAULTS_V8` renamed `V9` across importers; keymap action `composer.dictate` with `ActionSpec.hold` | landed 2026-10-06 (75b352d2) |
| 10 | E2 | deliverables and viewer preferences, if any | reserved (E8 released 10 unused on 2026-10-05; renumbered) |
| 11 | E4 | browser preferences (imported profile, default partition) | reserved |
| 12 | E10 | supervisor idle time and the keep-running default | reserved |

A child that needs no setting releases its number back here in its hand-back; the architect renumbers before the next dispatch so migrations stay contiguous.

Index (`src/main/index/migrations.ts`, `PRAGMA user_version`): versions 1 to 3 today.

| Version | Owner | What it adds | State |
|---|---|---|---|
| 4 | E3 | `lineage` on sessions (X11) | reserved |
| 5 | E2 | the deliverables table, if the record lives in the index rather than JSON files under the data directory (E2 decides and records here) | reserved |

## 5. IPC command namespaces (`src/shared/ipc/names/`, `schema/`)

| Namespace | Owner | State |
|---|---|---|
| `maws.asks.list`, `maws.ask.answer`, `maws.pane.answer`; event `maws.pane.show`; `files.reveal` added beside `files.openExternal` (main-owned; the `files.*` reservation now carries it) | E1 | landed 2026-10-06 (f3202d3e) |
| `deliverables.*` | E2 | reserved |
| `side.*` (open thread, send to main, side question) | E3 | reserved |
| `browser.*` | E4 | reserved |
| `files.write {appSessionId, path, content, expectedHash}` → `{status:'ok'|'conflict', hash}`; `files.read` gains `hash: true` and answers `hash` and `utf8` as required output fields (siblings faking `files.read` must answer them); keymap action `file.save` (⌘S, File › Save file); the X10 seam `registerCommentComposer`/`openCommentComposer` and `FileLineAnchor` in `src/renderer/src/tools/code/anchor/anchor.ts`, which E3 registers its composer into (E3 may move the type under `src/shared/`); `layout.unsavedFiles`, event `layout.saveAll`, `layout.saveAllDone`; `QuitAnswer 'save_all'`, `BusyReport.unsavedFiles` | E5 | landed 2026-10-06 (1c62bfeb) |
| `scm.status`, `scm.stage`, `scm.unstage`, `scm.discard`, `scm.commit`, `scm.push.plan`, `scm.push`, `scm.pr.plan`, `scm.pr.create`, `scm.remote.cancel`, `scm.remote.last`, `scm.pr.state` (+ `scm.pr.diff` only if E3 has landed at its M5); event `scm.remote.output` with `seq`; `scm.changed` released (C4's `git.changed` carries every change); `git.diff` scope enum gains `'untracked'` (X2 additive); `GitCommandError` gains `exitCode` and `stdout`; `gitEnv` mode `'read'|'checkout'|'mutate'`; `PARENT_SESSION_VARIABLES` moves to `src/shared/host/session-variables.ts`; `e2e/support/launch.ts` gains `prepare`; `package.json` gains `e2e:scm`; `PrLineAnchor` beside E5's `FileLineAnchor`; tool id `source-control`, `ScmParams { target? }` | E6 | named 2026-10-06 (author's document) |
| `tasks.edit` released 2026-10-06 (a task edit is `session.steer` from the renderer, no host state); X5 tool id `tasks` with `TasksParams {appSessionId?, target?}` (the target of E1's `show_pane 'tasks'`, a task id) and `open`; `BackgroundParams.view?: 'run'`; X3 `Presentation 'agent_list'`, `TurnActivity.crons`/`.listings`, `TranscriptActions.replyToPeer`; `BackgroundSection 'scheduled'`; probe scenarios `e7-peer-message`, `e7-tasks`, `e7-tasks-optin`, `e7-cron`, `e7-team` with fixtures under `fixtures/pass3/`; no settings version | E7 | named 2026-10-06 (author's document) |
| `plugins.env`, `plugins.list`, `plugins.available`, `plugins.install`, `plugins.update`, `plugins.uninstall`, `plugins.enable`, `plugins.disable`, `plugins.cancel`; events `plugins.operation`, `plugins.changed`; `marketplaces.list`, `marketplaces.add`, `marketplaces.update`, `marketplaces.remove`; `session.reloadSkills` beside `session.reloadPlugins` | E8 | landed 2026-10-06 (0eb56c11) |
| `voice.status`, `voice.start`, `voice.stop`, `voice.cancel`, `voice.openPrivacySettings`; event `voice.event` (main-owned) | E9 | landed 2026-10-06 (75b352d2) |
| `host.*` (supervisor connect, status, stop all) | E10 | reserved |

## 6. Shared files and landing order

Files more than one child touches: `src/shared/graph/events.ts`, `src/shared/ipc/schema/layout.ts`, `src/shared/settings/defaults.ts`, `src/shared/ipc/schema/settings.ts`, `src/renderer/src/App.tsx` (tool registration), `src/renderer/src/panel/summary/Summary.tsx`, `src/renderer/src/transcript/model/classify.ts` and `rows.ts`, `src/engine-host/session.ts` (the control `inbound()` switch), `electron-builder.yml`. Order: a child appends at the end of each list or switch; the architect merges in landing order and resolves conflicts on semantics, never by dropping a sibling's line.

## 7. Record

- 2026-10-05: opened at wave one's dispatch with the reservations above; E9 holds settings version 9 provisionally.
- 2026-10-06 (E5 interim 3): E5 adds `layout.unsavedFiles` (renderer → main dirty set), `layout.saveAll` (event) and `layout.saveAllDone` (answer) as `layout.*` extensions, `QuitAnswer 'save_all'`, `BusyReport.unsavedFiles`, and the e2e variable `MAWS_E2E_QUIT_ANSWER=save_all`.
- 2026-10-06: E8 landed; E6's execution document merged with its names (§5); no settings version for E6.
- 2026-10-06 (E1 interim): X9's three tools, events and IPC as built (§1, §2, §5); `files.reveal` joins `files.*`; the fallback sentence opens each description (A-18 corrected §1's earlier "ends with"); the installed engine moved to 2.1.291 during E1.
- 2026-10-06 (E5 interim): E5 names `files.write`, the `files.read` extension, `file.save` and the X10 seam (§5); adds devDependencies `@codemirror/commands` 6.11.1 and `@codemirror/merge` 6.12.2 (exact); tokens `--code-conflict-*`. E3's author reads the seam before designing the comment composer.
- 2026-10-06: E9 landed with the names below as recorded; `package.json` gains `build:helper`, `e2e:voice`, and `build:app` chained behind `build:helper`; `electron-builder.yml` gains the E9 block (extraResources, extendInfo, entitlements); `build/entitlements.mac.plist` added.
- 2026-10-05 (E9 interim): E9 names `voice.*` (§5), takes settings version 9 (§4), appends `voice` to the settings TabRef section enum (§3) and adds the keymap action `composer.dictate` with a hold flag; `App.tsx` gains one E9 block mounting the dictation keys.
- 2026-10-06: E1 landed at f3202d3e with the names above as recorded; X9 additions beyond the spec text accepted (per-tool `title` in `tools/list`, `MAWS_TOOL_ANNOTATIONS {readOnlyHint, openWorldHint:false}`, `mawsServerInfo(version)`, `TOOL_ERRORS.unknownTool`, `rpc.ts` `cancelledCallOf`, `AskCancelReason`); C3's broker confirmation rule widened to any SDK server's `tools/call`; `package.json` gains `e2e:tools` and `verify` runs it; `playwright.config.ts` ignores `maws-tools.spec.ts` outside the harness.
- 2026-10-06: E7's execution document merged at 640941f6 with its names (§2, §5); `peer.list` and `tasks.edit` released; no settings version for E7.
- 2026-10-06: E5 landed at 1c62bfeb with the names above as recorded; devDependencies `@codemirror/commands` 6.11.1 and `@codemirror/merge` 6.12.2 installed on master; `package.json`'s `e2e:code` now runs `code-tools.spec.ts` and `code-editor.spec.ts`; `e2e/support/code-product.ts` holds the shared code e2e helpers. E3 codes against the seam on master now.
- 2026-10-05 (E8 interim): E8 names its `plugins.*`, `marketplaces.*` and `session.reloadSkills` commands and events (§5) and releases settings version 10; E2, E4 and E10 renumbered to 10, 11, 12. Exception to §6's append-only rule, dated: E8 replaces two lines in place inside the C3 block of `src/shared/wire/control.ts` (`ReloadPluginsResponseSchema`, a lower-bound `Void` schema replaced by the fixture's shape) and makes `engine.shutdown` await its runner's stop; E1 edits the same file for `mcp_message`, so the architect merges the two on semantics.
