# P3 interface ledger (opened 2026-10-12)

> **Parent:** `docs/doperpowers/plans/2026-10-12-p3-co-work.md` (the P3 composite spec), §6 contracts X23 to X32 and the X9, X10, X13, X15 and X21 amendments. One writer: the architect. Children propose names in their execution documents and hand-backs; the architect records them here before a second child codes against them. A name not in this ledger is not yet shared. Version numbers stay in the P1 ledger's §4 table (X15), the repository's single allocation table; this ledger records the slots P3 reserves there.

Purpose: P3-A, P3-L, P3-B, P3-C and P3-D each extend the artifact surface and three of them code against names another owns (the token CSS names, the editor host contract, the document service). This ledger is the one interim contract they code against, reconciled before each wave's first executor starts and kept current as children land; at P3's close its content folds into the spec's §6 and the charter's §13.

## 1. X23 — the artifact entity (`src/shared/artifacts/`, `src/shared/ipc/names/artifacts.ts`, `schema/artifacts.ts`)

| Name | Owner | Consumers | State |
|---|---|---|---|
| `ArtifactKind = 'document' \| 'presentation' \| 'design' \| 'design_system' \| 'dashboard' \| 'html' \| 'file'`; `Artifact {id, kind, title, spaceId?, projectId?, createdBy: Actor, createdAt, updatedAt, lastViewedAt, pinned, designSystemId?, linkedPath?}`; `Space {id, name, linkedDir?, createdAt}`; `ArtifactSessionLink {artifactId, appSessionId, role: 'created' \| 'edited' \| 'viewed' \| 'commented', lastAt}` | A | all | reserved at approval |
| IPC `artifacts.list`, `artifacts.get`, `artifacts.create`, `artifacts.update` (title, space, pin, design system), `artifacts.delete`, `artifacts.duplicate`, `artifacts.search`, `spaces.list`, `spaces.create`, `spaces.update`, `spaces.delete`; events `artifact.changed {artifactId, kind, revision}`, `space.changed`; `artifacts.open {artifactId}` → a `MessagePort` for the document (X24) | A (main relays to the host) | L, B, C, D, E, G | reserved at approval |
| The host store `<userData>/artifacts/store.sqlite` (schema version 1, the host's own) and `<userData>/artifacts/<id>/` | A | — | reserved at approval |
| `deliverables.*` (X12) retired; `send_file` creates a File artifact; `maws-deliverable://` keeps serving File and HTML artifacts under a new name fixed by A | A, L | the viewer, the comment card | reserved at approval |

## 2. X24 — the document service

| Name | Owner | Consumers | State |
|---|---|---|---|
| Yjs v14 pinned: `@y/y` 14.0.0-rc.28, `@y/prosemirror` 2.0.0-15, one `@y/y` by pnpm override; the binding in `src/artifacts/yjs/` (one module); documents tagged with `bindingVersion` | A | B, C, D, E | fixed 2026-10-12 (S1) |
| `src/engine-host/documents/` (the service), the port provider `src/artifacts/provider/port.ts` (y-protocols sync `0` and awareness `1` frames over `MessagePort`), `DocumentStorage` and `ArtifactHost` interfaces in `src/artifacts/host.ts` | A | B, C, D, E | reserved at approval |
| The detached transport's binary channel (X13 amended): a length-prefixed frame kind `doc` beside the JSON lines | A (with S2) | main's host client | reserved at approval |
| `Actor = {kind: 'human'} \| {kind: 'session', appSessionId}`; `ArtifactVersion {seq, at, actor, kind: 'auto' \| 'turn' \| 'named' \| 'restore' \| 'import', label?, note?, summary?, designSystemRef?, assetRefs}`; provenance as Yjs v14's native attribution maps (encoded `ContentMap`s), persisted and merged by the host beside the update log, actor and time per id range surviving compaction (X29; Decision Log 25 supersedes the clock-range rows) | A | B, C, the history UI | amended 2026-10-12 (S1) |

## 3. X25 — the agent's tools (`src/shared/maws/tools.ts`)

| Name | Owner | Consumers | State |
|---|---|---|---|
| `artifact_list`, `artifact_describe_type`, `artifact_create` (kept; gains `kind`), `artifact_read`, `artifact_edit`, `artifact_publish`, `artifact_upload_asset`, `artifact_list_assets`, `artifact_comments`, `artifact_reply`, `artifact_resolve`, `artifact_screenshot` (kept), `artifact_export`; `artifact_update` retired into `artifact_publish` | A (`artifact_edit` and the document read format B; the deck publish C; the bridge H) | the engine | reserved at approval |
| The kinds' guides and format references under `src/artifacts/types/<kind>/{SKILL.md, format.md}` | A (the files per kind: B, C, D, E) | the engine | reserved at approval |

## 4. X26, X27, X28 — the schema, the dialect, the design system

| Name | Owner | Consumers | State |
|---|---|---|---|
| `src/artifacts/document/schema.ts` (the one module; `ychange`, `comment {threadId, orphan}`, block ids as `id`, chips `date`, `mention`, `dropdown`, `pending {intent}`); the `threads` map; `^id` and `<chip …/>` in the agent's markdown | B | A's test writer (schema-agnostic until B lands), E, the exporters | reserved at approval |
| `src/artifacts/slides/` (`format.md` adopted from Claude's list, the parser and canonical serializer, the Y.Map model, object anchors `{slideId, elementId}`); `deck.json` v4 keys | C | E, the exporters | reserved at approval |
| The design system directory: `DESIGN.md` (the designer skill's nine sections), `tokens.tokens.json` (DTCG), `layouts/*.html`, `components/*.html`, generated `tokens.css`; **CSS names fixed now so B can theme before D lands:** `--ds-color-bg`, `--ds-color-bg-raised`, `--ds-color-text`, `--ds-color-text-muted`, `--ds-color-accent`, `--ds-color-accent-text`, `--ds-color-border`, `--ds-color-status-{ok,warn,error,info}`, `--ds-font-display`, `--ds-font-body`, `--ds-font-mono`, `--ds-type-{title,subtitle,h1,h2,h3,body,caption,quote}-{size,line,weight}`, `--ds-space-{1..8}`, `--ds-radius-{sm,md,lg,full}`, `--ds-shadow-{sm,md,lg}`; type classes `.ds-type-<role>`; the Office extension key `dev.maws.office` | D | B, C, E, the exporters | names fixed at approval |

## 5. X30, X32 — the shell

| Name | Owner | Consumers | State |
|---|---|---|---|
| `regions` schema version 4: `panel.floating: boolean`, `floatingCard {w, h}` per tab; keymap action `panel.float`; X5's host prop reads floating as maximized; the browser pane's `reservedColumn` | G | the browser pane, the panel host | reserved at approval |
| The editor host contract `src/renderer/src/panel/editor-host.ts`: `registerEditorHost(scope: {surface: 'panel' \| 'main', tabId}, {title, breadcrumb?, saved: 'saved' \| 'saving' \| 'unsaved' \| 'reconnecting' \| 'readonly', unresolved, actions, exports, closeGuard})` returning an update handle, with `useEditorHost` and `useEditorHostScope`; the existing tools register nothing (the header falls back to the strip label); the header a 40 px row (G's document, 2026-10-12) | G | L, B, C, D, E | names fixed 2026-10-12 (G's proposal, recorded) |
| X2 additions for Mark-up: `browser.view.capture {tabId}` and `layout.captureRegion {rect}` (stills captured before drawing, composited in the renderer); optional `FocusTarget.attachFiles`; keymap `panel.float` = Cmd+Alt+B; `floatingCard` keyed by the panel tab id; the pill transient; main tab kind `artifacts` rendered through a slot `artifactsLibrary` that L fills (the tabs reader tolerant of unknown kinds, or `main.tabs` bumped through §6) | G | L, B, C | names fixed 2026-10-12 |

## 6. X15 — version slots reserved (the P1 ledger's §4 table carries the numbers)

| Slot | Child | Content |
|---|---|---|
| host artifacts store schema 1 | A | the store's own table set |
| index: next | L | the derived library rows and the FTS table |
| settings: next | D | `artifacts.defaultDesignSystem`, per-Space defaults |
| layout `regions` 4 | G | `panel.floating`, `floatingCard` |

## 7. Shared files and landing order

`src/shared/maws/tools.ts` (A first, then B, C, H append), `src/shared/ipc/names/` and `schema/` (A, then G for `panel.float`, L for the library reads), `src/renderer/src/panel/` (G's header and contract first, then L, B, C, D register), `src/renderer/src/side/card/` (B's third target after A), `src/main/hosts/detached-transport.ts` (A with S2). Landing order: G may land before A (no shared file but the panel); A before L, B, C, D, H; D's names are this ledger's, its code after A.

## 8. Record

- 2026-10-12 18:06 PDT: opened at the owner's approval; every row reserved; X28's CSS names and the X32 shape fixed so B and G can code before D and the others land.
- 2026-10-12 19:30 PDT: S1's verdict recorded: Yjs v14 pinned, provenance native, `bindingVersion` on documents.
- 2026-10-12 18:40 PDT: G's residue recorded (X32's scope argument and hooks, the Mark-up captures, the chord, the `artifacts` tab kind); P3-H's and P3-0's findings files are `.txt` (the harness refuses report-shaped `.md` from subagents; the protocol-probe convention).
