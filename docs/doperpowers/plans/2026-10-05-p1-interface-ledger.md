# P1 interface ledger (opened 2026-10-05)

> **Parent:** `docs/doperpowers/plans/2026-10-05-p1-extension.md` (the P1 composite spec), decision A-11 and contracts X9, X14, X15. One writer: the architect. Children propose names in their execution documents and hand-backs; the architect records them here before a second child codes against them. A name not in this ledger is not yet shared.

Purpose: siblings in flight extend the same contracts before any of them lands. This ledger is the one interim contract they code against, so two execution documents never disagree on a tool name, an event kind, a tab kind or a version number. It is reconciled before each wave's first executor starts and kept current as children land; at P1's close its content is folded into the spec's §10 and the charter's contracts.

## 1. X9 — tools on the `maws` server

Owner E1. The server is named `maws`; the engine exposes each tool to the model as `mcp__maws__<tool>`. Rules: snake_case tool names; every description ends with its fallback sentence for sessions that lack the tool; every tool's input and result schema lives in `src/shared/` beside the X1 events it emits; a child adds a tool only after its row is here.

| Tool | Owner | Consumers | State |
|---|---|---|---|
| `send_file` | E1 | E2 (the record and the viewer) | reserved |
| `ask` | E1 | — | reserved |
| `show_pane` | E1 | E2, E4, E6, E7 (the panes it can name) | reserved |
| `artifact_create`, `artifact_update`, `artifact_list`, `artifact_screenshot` | E2 | — | reserved |
| `browser_tabs`, `browser_navigate`, `browser_snapshot`, `browser_act`, `browser_eval`, `browser_screenshot` | E4 (its cut may rename within the `browser_` prefix) | — | reserved |

`show_pane.pane` values: `diff`, `file`, `terminal`, `tasks` (E7), `deliverable` (E2), `browser` (E4), `source-control` (E6, added 2026-10-05 by the architect for symmetry; E1 accepts it as a name and E6 supplies the tool).

## 2. X1 — event kinds added in P1

Rule: events the tool server emits are prefixed `maws.`; side-thread events `side.`; cross-session rows `peer.`. The schema file is `src/shared/graph/events.ts`; a child appends, never reorders.

| Kind | Owner | Consumers | State |
|---|---|---|---|
| `maws.ask.*` (opened, answered, cancelled) | E1 | transcript rows, the Question sheet | reserved |
| `maws.delivery.*` (file delivered, artifact version) | E1 (emit), E2 (record) | transcript rows, Deliverables | reserved |
| `maws.pane.shown` | E1 | — | reserved |
| `side.thread.*` (opened, summarised) | E3 | sidebar, transcript | reserved |
| `peer.message`, `peer.list` | E7 | transcript rows | reserved |
| `subagent.message` (declared in P0, never emitted) | E7 emits | existing row | reserved |

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
| `maws.*` (host tool server control: pending asks, answers) | E1 | reserved |
| `deliverables.*` | E2 | reserved |
| `side.*` (open thread, send to main, side question) | E3 | reserved |
| `browser.*` | E4 | reserved |
| `files.write` | E5 | reserved |
| `scm.*` (stage, unstage, discard, commit, push, pr, prState) | E6 | reserved |
| `tasks.edit` (a steer through the session, P-11) | E7 | reserved |
| `plugins.env`, `plugins.list`, `plugins.available`, `plugins.install`, `plugins.update`, `plugins.uninstall`, `plugins.enable`, `plugins.disable`, `plugins.cancel`; events `plugins.operation`, `plugins.changed`; `marketplaces.list`, `marketplaces.add`, `marketplaces.update`, `marketplaces.remove`; `session.reloadSkills` beside `session.reloadPlugins` | E8 | named 2026-10-05 (interim hand-back) |
| `voice.status`, `voice.start`, `voice.stop`, `voice.cancel`, `voice.openPrivacySettings`; event `voice.event` (main-owned) | E9 | landed 2026-10-06 (75b352d2) |
| `host.*` (supervisor connect, status, stop all) | E10 | reserved |

## 6. Shared files and landing order

Files more than one child touches: `src/shared/graph/events.ts`, `src/shared/ipc/schema/layout.ts`, `src/shared/settings/defaults.ts`, `src/shared/ipc/schema/settings.ts`, `src/renderer/src/App.tsx` (tool registration), `src/renderer/src/panel/summary/Summary.tsx`, `src/renderer/src/transcript/model/classify.ts` and `rows.ts`, `src/engine-host/session.ts` (the control `inbound()` switch), `electron-builder.yml`. Order: a child appends at the end of each list or switch; the architect merges in landing order and resolves conflicts on semantics, never by dropping a sibling's line.

## 7. Record

- 2026-10-05: opened at wave one's dispatch with the reservations above; E9 holds settings version 9 provisionally.
- 2026-10-06: E9 landed with the names below as recorded; `package.json` gains `build:helper`, `e2e:voice`, and `build:app` chained behind `build:helper`; `electron-builder.yml` gains the E9 block (extraResources, extendInfo, entitlements); `build/entitlements.mac.plist` added.
- 2026-10-05 (E9 interim): E9 names `voice.*` (§5), takes settings version 9 (§4), appends `voice` to the settings TabRef section enum (§3) and adds the keymap action `composer.dictate` with a hold flag; `App.tsx` gains one E9 block mounting the dictation keys.
- 2026-10-05 (E8 interim): E8 names its `plugins.*`, `marketplaces.*` and `session.reloadSkills` commands and events (§5) and releases settings version 10; E2, E4 and E10 renumbered to 10, 11, 12. Exception to §6's append-only rule, dated: E8 replaces two lines in place inside the C3 block of `src/shared/wire/control.ts` (`ReloadPluginsResponseSchema`, a lower-bound `Void` schema replaced by the fixture's shape) and makes `engine.shutdown` await its runner's stop; E1 edits the same file for `mcp_message`, so the architect merges the two on semantics.
