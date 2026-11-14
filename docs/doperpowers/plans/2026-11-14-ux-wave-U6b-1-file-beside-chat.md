# UX wave · U6, the first landing of U6b (U6b-1): a file opens beside the chat

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6 (`docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, cited below as *the child's file*), the first of the five landings U6b is cut into (**U6b-1**). **Parent pin:** master `c6a22fe89722dcbed4f5ff1e5f290a7fdaeb2933`, the commit every statement about the code below was checked against; the root and the child's file are read at that commit.
>
> **The design** is the child's file: its item "l5-code-11 (with the remainder of l5-code-13) · a file opens beside the chat, as a tab of the side column", with acceptance A1 and A2. From U8's file (`…/U8-card-column-working-folder.md`, item O-36) it also takes what that item leaves to U6: the drags of a side tab (onto the lower part of the column, between the two groups, to the main area) and the selected tab kept in view. This document carries the constraints, the decisions the child's file leaves to the design, the milestones and the interfaces.
>
> **The cut** of U6b into five landings, the item-by-item list of what is on master, and the sections of the four later landings are in `docs/doperpowers/plans/2026-11-14-ux-wave-U6b-cut.md`, cited below as *the cut*.
>
> **Branch:** `ux-wave/U6b`, from master `c6a22fe89`. **Board:** ticket 592, under epic 573. **Not in this landing:** everything the cut gives to U6b-2 to U6b-5.

## Purpose

Today every place that opens a file (a path in the transcript, Review's Open, a row of Files' tree, the agent's `show_pane`) opens a tab in the main area and selects it, so the conversation leaves the screen at the moment the person wants to read a file beside it.

After this landing a file opens beside the chat: as a tab of the side column, among Review's and the terminals' tabs, with Files' tree at its left. The transcript keeps its place and the main tab strip gains nothing. A single click shows the file in the session's one preview tab, whose title is in italics and which the next single click reuses; a double-click, an edit or a move keeps the tab. The file moves to the main area only when the person asks: by dragging its tab onto the main strip, by "Move to main area" in the tab's menu or in the file's bar, or by ⌘-click on a path link or a tree row. It moves back the same ways. A move keeps the scroll position, what was typed and its undo history, and asks nothing. After a relaunch the files beside the chat and the one in the main area are where they were. A side tab can also be dragged between the column's two groups, and a strip with more tabs than fit keeps its selected tab in view.

How to see it working: in a session, click a file path in the transcript: the file shows at the right of the chat with the tree at its left, the transcript has not moved, and the main strip holds the same tabs as before. Click another row of the tree: the same tab now shows that file. Double-click its tab: the title is no longer italic. Type in the file, then drag its tab onto the main tab strip: the file is a main tab with the text typed, and ⌘Z undoes it. Choose "Move to side surface" in that tab's menu: it is back beside the chat. Quit and relaunch: it is still there.

## Progress

- [x] (2026-11-14) Document written against master `c6a22fe89`: the item grounded in the code at that head and in build F (`f1852de3a`); the documents of U6a, U6c, U8b, U13a, U7 and U8c read on master; the check on build F the child's file asks for made by reading F's source (Decisions 4, Interfaces §A).
- [ ] The adversarial review of this document, and the architect's rulings on "Reported to the architect".
- [ ] M1 — The stored form, and where an open goes.
- [ ] M2 — An editable file beside the chat: close, save, comment, and a session that goes.
- [ ] M3 — The tree at the file's left.
- [ ] M4 — Moving a file, the strip's drags, and the selected tab kept in view.
- [ ] M5 — The scenes, the cross-build row, the record, and the acceptance run.
- [ ] The proof an executor does not run: the scenes and their groups on a Mac, the cross-build run with build F, class 1a, the branch's panel review, the owner's look, the pull request.

## The landing's edge

**In.**

- Where a file opens: beside the chat, as a tab of the side column, from every opener that knows a session; in the main area when no session is known, when a main tab already shows the file, and on ⌘-click.
- The preview tab and the kept tab.
- A file's side tab as an editor: its title, its unsaved mark, its close question, ⌘S and "Comment on this line", and what happens to an unsaved file when its session goes.
- Files' tree at the left of every Files tab, with one state per session that is restored after a relaunch.
- The moves between the side column and the main area: the menu items, the bar's button, the two View-menu actions, the drags; and from U8's O-36 the drags of any side tab between the column's groups, and the selected tab kept in view (l5-code-13's remainder).
- After a relaunch: the open files, the one in view, the tree's state.
- The record: the charter's three sentences on l5-code-11, one dated line at X9, the cross-build coverage table's row ("The pull request").

**Not in, and a later landing of U6b** (the cut names each): Files' Changed group, the marks, the dimmed ignored entries and Go to file, ⌘P (U6b-3); PDF, HTML and media drawn in the file's tab (U6b-2); the refusal in plain words, `file://` and relative links, the localhost link, "Open in" (U6b-4); Back and Forward, zoom, the palette's Recent, "Attach selection to chat", the keyboard returned to the composer when a surface hides (U6b-5). This landing changes no word of any notice: a refusal still reads "Refused: " and the service's sentence, and a PDF still shows its row.

**Not in, and nobody's.**

- Reordering tabs inside one strip by a drag: no child's file asks for it.
- A main-tab form for Review, a terminal or a panel (U8's file: they "have no main-tab form and show no target there").
- Preview tabs as a setting, and a limit that closes the oldest tab (the child's file: law 3).
- A file with no session: it opens as a main tab, as today, and offers no move.
- Rounder tabs (O-04), filling the window with a side surface, popping it out (l7-shell-10).
- The spec's files, the register and the board, which are the architect's.

## Reported to the architect

Each is a place where the code or a sibling's document differs from the child's file, or where a choice shows on screen beyond the child's words. Each has a default that is built unless ruled otherwise, and one named place a ruling changes.

| # | The point | Evidence | The default built | The one place a ruling changes |
|---|---|---|---|---|
| R1 | **A tab that holds a file cannot be pinned, and a pinned Files tab is never taken by a file.** The child's file does not say. | A pinned side tab is one tab shown under every session (`panelPinned`; a pinned tab's session "changes under a pinned tab", `PanelToolContext` in `panel/tool.ts`). A file belongs to one session's folders: under another session the same tab would be read under that session's rule and mostly refused. | No pin glyph on a tab that holds a file. An open never uses a pinned Files tab; it adds a tab. The pinned Files tab keeps showing the tree alone under every session, as today. | `pinnableTab` in `tools/code/files/tabs.ts` (Interfaces §B) |
| R2 | **`show_pane` for a file answers the `panel-tool` arm.** The child's file says "its answer names the side surface"; the frozen result (X9, root UC-15) has two arms and neither changes shape. | `ShowPaneOpenedSchema` in `src/shared/maws/tools.ts`: `{ kind: 'panel-tool', toolId, tabId, title }` or `{ kind: 'main-tab', tabId, path, line }`. The transcript's row words either arm (`paneLabel`, `transcript/model/cells.ts`). | For a file opened beside the chat: `{ kind: 'panel-tool', toolId: 'files', tabId, title: <the file's name> }`, so the row still reads "Opened <name>". For a file shown in a main tab that already held it: the `main-tab` arm, as today. One dated line at X9 says which arm a `file` call answers. No schema changes; build F's engine host parses both arms. | `showPane` in `tools/maws/panes/connect.ts` |
| R3 | **No second header row.** U8b's document (Interfaces §C.3) describes a file's tab with "its header row an X32 registration"; U8's file says the row under the strip is "the tool's own header where the tool registers one (a file's breadcrumb, saved state and actions, as today)". | Today a file's path, saved state and controls are the file viewer's own bar (`FileBody`, `tools/code/viewer/FileViewer.tsx`); a file registers nothing with the editor host (`panel/editor-host.ts`). | The file viewer's bar is the one row under the strip, the same component in a side tab and in a main tab; nothing is registered with the editor host, which would draw a second row with the same path (law 3). | none: a registration is an addition in `FilesTool.tsx` if it is wanted |
| R4 | **What ⌘S and "Comment on this line" act on.** Today: the focused pane's tab when it is a file (`saveFocusedFile`, `tools/code/editor/register.ts`). With a file beside the chat the focused pane's tab is the session's. | `tabOnScreen(state)` is the only target today. | In this order: the file whose viewer holds the keyboard, in the side column or in a main tab; else the main tab on screen when it is a file; else the file in view in the side column when exactly one is in view. | `focusedFile` in `tools/code/editor/register.ts` (Interfaces §B) |
| R5 | **An unsaved file whose session goes becomes a main tab.** Today a file tab leaves the layout only by a close that asked (the viewer store's header: "a session's removal and hydration keep file tabs"); a session's side tabs go with the session, unasked (`reconcile` in `panel/host.ts` disposes them without `beforeClose`). | `dropSession` in `stores/layout.ts`; `reconcile` in `panel/host.ts`. | When a side tab that holds a file with unsaved edits, or with a save under way, leaves every list without having been closed through its own close, the file is opened as a main tab in the same step, not in front. Nothing is asked and nothing typed is lost; what a main file tab of a gone session shows is today's. | `keepUnsaved` in `tools/code/files/tabs.ts` |
| R6 | **⌘-click goes to the main area from a path link and a tree row only.** The child's file names those two. The file chips of a read's and an edit's detail and the chip of an anchored comment open through the same action and could take ⌘ too. | `cells/ReadDetail.tsx`, `cells/EditDetail.tsx`, `rows/User.tsx` call `actions.openFile(path, line, session)` with no event. | The two the child's file names. A chip opens beside the chat whatever key is held. | the three chips' `onClick`, which would pass the fourth argument of Interfaces §B |
| R7 | **The charter's sentence, as the child's file words it, says "a tab inside the Files side surface".** Since the owner's answer on O-36 the tab is the side column's, and Files has no strip of its own. | The child's "Rulings reversed", l5-code-11; its own l5-code-11, "Where a file opens". | The amendment recorded at the three places reads: "Amended 2026-11-12 (the owner's mark on l5-code-11: option b, and 'allow user to drag the side panel's tab to move it to main'): a file opens as a tab of the side column, beside the chat, with Files' tree at its left; the main area holds a file only when the person moves it there." | "The pull request" |
| R8 | **The tree when the tab is too narrow for both.** The child's file: "the tree column folds away and a button in the file's bar brings it back". It does not say what "back" is where there is no room. | The side column can be 280 px wide (`shellGeometry`, `app/shell-geometry.ts`). | Too narrow (Interfaces §C gives the number): the tree is not drawn and the button shows the tree in the file's place; choosing a file, or the button again, shows the file. Wide enough: the button folds and unfolds the tree column, and that choice is stored. **A drawn example is recommended before M3 is built** ("Proof that an executor does not run", 7). | `treePlace` in `tools/code/files/tree-state.ts` |
| R9 | **The check on build F the child's file asks for "before this is built" was made by reading.** | Interfaces §A, "What build F does". | The stored form stands as the child's file prefers it (each open file a tab of the session's list). The run that proves it is the cross-build scene, which needs only M1's stored form: the architect is asked to run it when M1 is pushed, not at the end. If it fails, M2 does not start and the child's fallback (the open files under this child's own key, one Files tab in the list) is the architect's call. | Interfaces §A |

Not a point for a ruling, but said so that nobody is surprised: U6d's second milestone (not yet built on `origin/ux-wave/U6d`) rewrites the link element in `transcript/view/markdown/Link.tsx`; this landing inserts one argument at the path link's click in the same file. Whichever lands second merges master first (root UC-8).

## What the code holds today

Read at `c6a22fe89`. Paths are under `src/renderer/src/` unless they begin with `src/`.

1. **One opener.** `openFile(appSessionId, path, line)` in `tools/code/open-file.ts` calls the layout store's `openTab` with a `file` tab and then `revisit` on the viewer store (U6c). Its callers: the transcript's path link, read and edit chips and anchor chip (through `codeTranscriptActions.openFile`); `review/ReviewShell.tsx`; `tools/scm/ScmShell.tsx` and `ScmDiff.tsx`; `files/FilesTool.tsx`; `viewer/MarkdownView.tsx`; `tools/maws/ask/AskSheetTool.tsx` and `HoverAsk.tsx`; `request-card/variants/Plan.tsx`; `tools/artifacts/viewers/ByteViewer.tsx` ("Open as file"); `tools/agents/actions.ts`; `tools/maws/panes/connect.ts` (`show_pane`, inside `quietly`). Three places open a file tab without it: `panel/summary/Sources.tsx` (the Sources card's file row), `side/ThreadView.tsx` (a side thread's anchored file) and `transcript/shell.tsx` (`openFileInTab`, with no session).
2. **A main file tab** is `{ kind: 'file', path, line, appSessionId, machine }`, one per machine and path whatever its session (`tabId` in `src/shared/ipc/schema/layout.ts`: `file:<machine>:<path>`); opening it again takes the line and the session of that open (`openIn`, `stores/layout-model.ts`).
3. **The viewer** (`viewer/viewer-store.ts`) keeps one entry per key, the main tab's id, with the file's text, its load and its editing state, and beside it what a code view leaves behind when it unmounts (`viewState(key)`: CodeMirror's state with its undo history, the scroll offsets). `FileBody` (`viewer/FileViewer.tsx`) draws an entry by its key; the File artifact's view mounts the same component under a key of its own. The store drops an entry that no main tab holds and no view has mounted (`prune`). An entry with unsaved edits survives a mount under another session (`mount`, "unsaved edits survive the tab's move to another session").
4. **A code view** (`viewer/CodeView.tsx`) makes its editor in a passive effect from `viewState(key).editor` and writes its state back in that effect's cleanup. Within one React commit the cleanup of a view that goes runs before the effect of a view that comes.
5. **The side column** (U8b). A tab is a `PanelTabRef { id, toolId, pinned }` in the session's list (`panel.<session>`) or among the pins; what a tool keeps of a tab is `panelParams[tabId]`, stored under `panelTools.params` (`setPanelParams`). `panelHost.addTool` (`panel/host.ts`) adds a tab or, for a tool that is not `multiInstance`, re-targets its one tab. `sideGroups`, `groupForOpen`, `showSurfaceTab`, `moveSurfaceTab` (`panel/surface-model.ts`, `stores/layout.ts`) hold the two groups. The strip is `panel/TabStrip.tsx`; a tab's label is the tool's title and an optional suffix (`useTabLabel`). An instance whose ref leaves every list is disposed without its `beforeClose` (`reconcile`).
6. **Files** (`files/FilesTool.tsx`) is one tool, `files`, pinnable, not `multiInstance`; its body is the tree alone; its state (which folders are open, the selection, the scroll) is the instance's, per session, in memory. `params { path?, line? }` asks it to reveal a path and then open it; nothing in the window passes them.
7. **Only an artifact moves** between the column and the main area (`panelTabMoves`, `moveArtifactToTab`, `moveArtifactToPanel` in `shell/transfer.ts`); the drag state's panel form carries an artifact id (`dragging` in `stores/layout.ts`). The side strip scrolls only once every tab is cut to its least width (`fitTabs`), and nothing scrolls its selected tab into view: the shared focus helper of F6 passes `preventScroll: true` (`keymap/shell-navigation.ts`).
8. **The editor's registrations** (`tools/code/editor/register.ts`): the close question for a main `file` tab (`guardFileClose`), `file.save` and `file.commentLine` on the tab on screen, and the verdict that keeps a dirty file tab from being replaced. The quit question's "Save all" walks the viewer's entries, not the tabs (`saveAll`, `viewer-store.ts`).
9. **`show_pane` for a file** answers `{ kind: 'main-tab', tabId, path, line }` (`tools/maws/panes/connect.ts`), and `PANES.file` is `{ mainTab: 'file' }` (`src/shared/maws/panes.ts`).

Tests that pin today's behaviour and change: `tools/code/files/files.test.tsx` (a row click opens a main tab; the reveal), `tools/code/viewer/viewer.test.tsx` (the prune), `tools/code/editor/register.test.tsx` and `unsaved.test.tsx`, `tools/code/named-links.test.tsx` and `transcript/view/markdown/links.test.tsx` (the path link's click), `tools/maws/panes/connect.test.ts` (the `main-tab` answer), `shell/transfer.test.ts`, `panel/TabStrip.test.tsx`, `panel/panel.test.tsx`, `keymap/shell-navigation.test.tsx`, `side/` and `panel/summary/` tests of the two direct openers. E2e: Interfaces §G.

## Decisions settled at authoring

Each is a means the child's file leaves open, decided here with its reason and what it beat.

1. **A file's side tab is a tab of the Files tool.** `files` becomes `multiInstance`; a tab of it either holds a file or is the tree alone. That is what U8b built for (its §C.3: "a ref of U6's tool in the session's list, its path among that tab's params"): `groupForOpen` already sends an open to the group that holds a tab of the tool, and the Files icon and ⇧⌘F already show the tool's tab last in view. Lost: a second tool for a file. Build F would draw it as a tab of a tool it does not know, and "the first file opened takes that tab" would be a close and an open across two tools, which the store does not read as a replacement.
2. **What a tab stores** is `{ file, line, preview? }` under `panelTools.params` (Interfaces §A). The key is `file`, not `path`: build F's Files tool reads `params.path` as a path to reveal and then open as a main tab, so under `path` a stay on F would open a main tab for every Files tab it showed. Under `file` F ignores it.
3. **One document per file in the window.** The viewer's key for a file beside the chat is the id its main tab would have (`fileKey`, Interfaces §B). So a move changes no key: the entry, the unsaved text and what the code view left behind are the same objects before and after, and "a move keeps the scroll position, unsaved edits and the undo history" holds by construction. Lost: a key per side tab with a re-keying at each move, which would have to move seven maps of the viewer store in step. What follows from one key: the main area and the side column never both hold a file (rule 3 of Interfaces §B), because two views of one key under two sessions would take the entry from each other at every render.
4. **Build F reads what this stores** (Interfaces §A): answered by reading F's source, proven by the cross-build scene (R9).
5. **The open rule is one pure function** (`placeOpen`, Interfaces §B) and `openFile` is its only caller, so every opener behaves alike and the rule is tested as a table.
6. **Preview and kept.** A tab opened by one click is the preview tab; the session has at most one. It becomes kept by a double-click on its tree row or on the tab, by the first edit, by a move (to the main area, or to the other group), and for an opener that says so (`keep`). A kept tab is never reused for another file. This is the child's file's rule; what is decided here is where it lives: `preview: true` in the tab's params, absent once kept, so a relaunch keeps the difference.
7. **Closing the last file's tab closes the tab.** No tree-only tab is left behind; the Files icon and ⇧⌘F add one when the session has no Files tab, as today. "+ ▸ Files" shows the session's tree-only tab when it has one and adds one otherwise, never a second.
8. **The tree marks, and does not follow.** The row of the file in view is marked as selected when it is listed; the tree does not open folders by itself to reach it. The Files tool's `params { path }` reveal, which nothing in the window uses, is removed with its two waiting states. Lost: opening the file's folders at every open, which would move the tree under the person each time the agent or a link opens a file.
9. **A person's open leaves a page; an agent's does not** (root UC-12). `openFile` closes an open destination before it opens beside the chat, as a side-surface key does; with `asked: 'agent'` (the `show_pane` call) it does not, and the open is carried to the panel host with that mark.
10. **An open made before the layout is read waits for it.** The open rule reads the session's list, which is empty until hydration; an open decided on an empty list would add a second tab for a file a restored tab already holds. So `openFile` before `hydrated` is kept and decided at the moment the layout is read, in call order.
11. **The two direct openers go through `openFile`** (the Sources card's row, a side thread's anchored file): one call each, in U8's and U5's files (Interfaces §F). `transcript/shell.tsx` knows no session and stays.
12. **The two View-menu actions** keep their ids and titles (`artifact.moveToTab`, `artifact.moveToPanel`: rebindable rows build F knows) and act on a file as on an artifact (the child's file).
13. **Where a moved file lands.** To the main area: the end of the focused pane's strip, or the place a drag chose; in front; kept. To the side column: the list of the session the main tab was last opened under, in `groupForOpen`'s group, in view, with that session's tab brought to the front in the main area, as an artifact's move does. Neither leaves an entry for Reopen closed tab.
14. **The drag's payload names the tab, not its content.** The panel form of the drag state loses its need for an artifact id (it becomes optional), and every side tab can be dragged: any tab onto the other group's strip or the lower part of a one-group column, and a tab that has a main-tab form (an artifact's record, a file) onto the main area's targets.
15. **Nothing is sent and no wire minor is taken.** Every command used exists; `layout.get` and `layout.set` are main's own and outside the wire's manifest (`src/shared/ipc/wire-manifest.json` holds no `layout.` entry).

## Acceptance

Behaviour a person can check in the wave's build, each with the test that holds it. A1 and A2 are the child's file's; the L items are this landing's own, where the child's two do not reach.

- **A1** (the child's file; all three routes). In a session, click a file path in the transcript, then open a file from Review, then click a row of Files' tree. Each opens beside the transcript as a tab of the side column, with Files' tree at its left; the transcript keeps its place and the main tab strip gains nothing. For a session on another machine the file is read on that machine, as today. Held by: M1's table of the open rule, and the scene "a file opens beside the chat" (Interfaces §G).
- **A2** (the child's file). Type in a file open beside the chat, without saving. Drag its tab onto the main tab strip, or choose "Move to main area" from the tab's menu, or press the button in the file's bar: the file is a main tab with the same scroll position, the unsaved edit and its undo history. "Move to side surface" brings it back the same way. Quit and relaunch: the files beside the chat and the one in the main area are where they were. Held by: M4's suite (a move in each direction by each of its ways, then an undo), M1's restore case, and the scene "a file moves to the main area and back".
- **L1** (the preview tab). A second single click on another file reuses the italic tab. A double-click on the row or on the tab, the first edit, and a move each make it a kept tab; the next single click then opens a second tab. Held by M1's and M2's suites.
- **L2** (one view of a file). With a file open as a main tab, every opener selects that tab and adds nothing beside the chat. Moving a file to the main area leaves no side tab of it in any session's list. Held by M1's table and M4's suite.
- **L3** (⌘-click). ⌘-click on a path link or on a tree row opens the file as a main tab. Held by M1 and M3.
- **L4** (an editor beside the chat). A side tab with unsaved edits shows a dot; closing it asks, and Cancel keeps it; ⌘S with the keyboard in it saves it; quitting asks about it as about a main file tab. Held by M2's suite and the scenes of `e2e/code-editor.spec.ts`.
- **L5** (nothing typed is lost unasked). Archive or delete a session while a file beside its chat has unsaved edits: the file is a main tab with the edits. Held by M2's suite.
- **L6** (the tree). In every Files tab the tree is at the left of the file, the same tree with the same folders open; its width, its fold and its open folders are there after a relaunch; in a tab too narrow for both, the button shows the tree in the file's place. Held by M3's suite.
- **L7** (the strip). A side tab dragged onto the other group's strip joins that group; dragged onto the lower part of a one-group column that has another tab, it makes the second group. In a strip that scrolls, the tab that is selected by a click, by an opener or by F6 is scrolled into view. Held by M4's suite.
- **L8** (two builds; no visible face on this build). A layout this build stored with three files beside a chat, one of them the preview tab, is drawn by build F as its one Files surface with the tree, with no tab lost and no layout value refused; after F's own write this build restores the three tabs, the preview among them, and the tree's state. Held by the cross-build scene (Interfaces §A and §G).
- **L9** (the gates). On the build VM `pnpm typecheck`, `pnpm lint` and `pnpm test` pass on the final head, apart from the files the build brief lists as failing on master there.

## Constraints that bind every milestone

1. **Where work and checks happen** (root UC-10; `~/.local/share/maws-ux-wave/briefs/build-common.md`, which binds as written). On the MacBook: edit, commit, push; no `pnpm install`, typecheck, eslint, vitest, build or Electron. Every check runs on the wave's build VM in a checkout of the pushed head, through `vmcheck.sh` (Concrete Steps). An executor starts no Electron e2e, runs no `scripts/ci-gate.sh` and opens no pull request. Every commit message ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.
2. **The owner's words bind.** On l5-code-11: files open beside the chat, and "allow user to drag the side panel's tab to move it to main if they want to view it in bigger screen". On O-36 (2026-11-12): the tools beside the chat are tabs of one strip, so Files has no strip of its own. `keep` on l7-shell-12: a relaunch restores everything. Law 3: no setting, no limit that closes a tab. Law 7: today's tokens and shapes; the italic title is the one new look, and it is the child's file's.
3. **What is stored, build F can still read** (root UC-14). No field is added to a stored tab, to `main.tabs`, to `regions` or to the stored side surfaces, and no version moves. What this landing stores is Interfaces §A, key by key, with what F does with each. Neither settings file is touched. Nothing is sent to another process or another machine that is not sent today (Decision 15).
4. **Files other children own** (root UC-8). Interfaces §F lists every insertion with its owner. An executor that finds it must edit another file of another child's stops and reports.
5. **Three routes, one behaviour** (law 5; root UC-7). A session MAWS runs and a terminal session on this Mac: the same. A session on another machine: the same, with the file and the tree read on that machine by the commands it is asked today (`files.read`, `files.list`), neither with a new key; a file it refuses shows today's refusal in the tab. No act is added, so no offer and no capability. A scene of the remote group asserts that a file of another machine's session opens beside the chat and is read there (Interfaces §G).
6. **The repository is public** (root UC-11). Tests, fixtures and scenes use invented paths under a temporary folder and invented text. No fault is reproduced by reading a session, a file, a setting or a folder of the owner's: structure and counts only, and none of it enters the repository.
7. **Guards that read source text.** In renderer source and its tests a ticket or item number is written in words; the tokens guard (`test/support/tokens-guard.test.ts`) reads `#` and three to eight hex digits as a colour. Run that guard with every milestone, since each adds renderer source. Components use tokens only; the scene of both themes in `e2e/code-tools.spec.ts` ("the Files tree and the viewer use tokens only in both themes") covers the new elements.
8. **The base.** The branch takes master by merge, never by rebase or force-push.
9. **The level of proof.** A move is asserted on the editor's own state (the document's text and one undo), not on a flag. "Nothing is lost" is asserted with the edit typed immediately before the act. A rule about two builds is asserted in the cross-build scene, and a skipped scene is not evidence.
10. **Disk.** If any command fails with "No space left on device": stop, report, delete nothing.

## The sequences that must hold

Each act below awaits something or spans more than one write. For each: what happens when the person acts in between, what happens when the awaited thing fails or never comes, and the test that holds the sequence open (not only the final state).

1. **A move is one step.** The move's writes (the main tab opened and the side tab's ref removed, or the reverse) are made in one synchronous run with no `await` between them, so that React commits both in one pass and the code view that goes writes its state back (What the code holds, 4) before the one that comes reads it. The side tab is removed by a write of the list (`updatePanelTabs`), which the panel host answers by disposing the instance without its close question; `panelHost.closeTab` is not used for a move, because it awaits. *Test:* type, move, type again in the new place, undo twice: the text is the one before the first typing; in both directions; with the list write and the tab write observed to land before any microtask runs.
2. **A close that asks.** Closing a side tab whose file has unsaved edits awaits the person's answer. *In between,* the person can move the tab to the main area, switch session, type more, or save with ⌘S. *After the answer:* "Don't save" and "Save" act only if the same side tab still exists and still holds the same file; if it does not, the answer changes nothing (the main tab that now holds the file keeps its edits). "Save" closes only when the save answered `ok` and left the entry clean, as `guardFileClose` does today; a save that fails or conflicts keeps the tab with its message. A dialog never answered keeps the tab. *Test:* the dialog held open while the tab is moved; then "Don't save": the main tab still holds the edit.
3. **A preview replaced while its file loads.** The preview tab's file changes from one to another while the first read is in flight. The first file's entry goes with the prune; its late answer lands nowhere. *Test:* the first read's promise held, the second click made, the first answered: the tab shows the second file and the store holds no entry of the first.
4. **An open before the layout is read** (Decision 10). *Test:* an `openFile` made before `hydrated` for a file a stored tab holds selects that tab after hydration; two such opens are decided in call order; an open for a session the hydration does not keep is dropped.
5. **A restored tab whose file is gone or refused.** The tab is restored and shows the viewer's refusal or "not found", as any open does; it is not removed. A restored tab whose params this build cannot read is the tree alone. *Test:* both.
6. **A session that goes** (R5). The viewer's prune and this rule must not race: an entry whose tab is not mounted (another tab is in view) would be dropped by a prune that ran first. So one subscriber does both, in order: when the side tabs change it first opens a main tab for each file that left unasked with unsaved edits or a save under way, and only then runs the prune. The viewer store gets no second subscriber of its own on the side tabs. *Test:* a dirty entry whose tab is not in view, `dropSession`: the entry and its text stand, under a main tab that is not in front; the same with the file's tab in view.
7. **A drag whose source changes.** A tab closed, moved or replaced while it is dragged ends its drag (`endDragFrom`, as today); a drop that arrives for a tab no list holds does nothing. *Test:* the tab removed mid-drag, then the drop.
8. **A stay on build F** (L8). On the way back, a side tab whose file a main tab now holds (F opens files in the main area) is dropped at the read, the main tab kept: rule 3 of Interfaces §B is applied once after hydration. *Test:* a stored layout with both; and the cross-build scene.

## Plan of Work

Five milestones. Each stands on this document and the code, has its own proof and leaves the tree green. Sizes are estimates of changed lines, tests included.

### M1 — The stored form, and where an open goes

**What exists at its end.** Every opener that knows a session opens the file as a tab of the side column: a tab of the Files tool that holds the file and draws the file viewer (the tree column comes in M3; until then a tab that holds a file draws the file alone and a tab that holds none draws the tree, as today). The preview tab is reused by the next open and its title is italic; a tab's title is the file's name. With a main tab of the file, the open selects it. ⌘-click on a path link opens a main tab. The tabs and the one in view are there after a relaunch. `show_pane` for a file answers as R2 says.

**What it touches.** `tools/code/files/tabs.ts` (new: the stored form, `fileKey`, `placeOpen`, `pinnableTab`, the after-hydration repair); `tools/code/open-file.ts` (the opener, its options, the wait for hydration); `tools/code/files/FilesTool.tsx` (`multiInstance`, the two bodies, the reveal removed); `tools/code/viewer/viewer-store.ts` (the prune learns side tabs); `panel/TabStrip.tsx` (a file tab's title, its italics, no pin glyph, "+ ▸ Files"); `tools/maws/panes/connect.ts` (R2; `src/shared/maws/panes.ts` is not edited: `PANES.file` keeps meaning "a file's tab", wherever it is drawn); the insertions of Interfaces §F that belong to opening (`Link.tsx`, `view/context.tsx`, `Sources.tsx`, `ThreadView.tsx`); `e2e/cross-build.spec.ts` (the scene of L8 and its row, written now so that the architect can run it before M2 starts: R9); the unit tests beside each.

**Interfaces.** Exposes §A and §B to every later milestone and to the siblings named in §E. Consumes U8b's §C.3 (`panelHost.addTool` with `group`, `panelHost.selectTab`, `setPanelParams`, `groupForOpen`) and U7b's `asked` on the panel host.

**Decisions.** 1 to 11, R1, R2, R6, R9. Pitfalls seen in the code: `panelHost.addTool` on a `multiInstance` tool always adds, so the choice between "select", "reuse" and "add" is `placeOpen`'s and is made before the host is called; a tab's file is read from `panelParams` (one source), so the strip, the body and the prune agree without a second store, and reusing the preview tab is one `setPanelParams`; the host passes a restored tab its params as `init.params` with `restored: true`, and a tab opened now gets them from the call, so the tool reads the layout store in both cases and not `init`; the prune's reading of the side tabs is driven by `tabs.ts` (sequence 6), not by a subscriber inside the viewer store; `openFile` keeps calling `revisit` (U6c's decision 15) with the file's key; the differential test `tools/code/named-links.test.tsx` holds the link's click to U6c's rule and must stay green with the click's new argument.

**What it does not touch.** The tree's place and state (M3). The close question, ⌘S, the unsaved mark (M2). Any move (M4). `e2e/` but for the cross-build scene (M5). The viewer's kinds, its notices, `ExternalRow` (U6b-2, U6b-4). `src/services/`, `src/main/`, `src/endpoint/`.

**What it proves.** A1 as far as a unit test reaches; L1 (reuse and italics), L2 (first half), L3 (the link). Tests named by the behaviour they assert: the open rule as a table over (a main tab of the file or none; a side tab of the file or none; a preview tab or none; a tree-only tab, pinned or not, or none; one group or two; `main`, `keep`, `asked`); a stored list with two preview tabs reads the later as kept; params this build cannot read give the tree alone; sequences 3, 4, 5 and 8's unit half; the prune keeps the entry of a file a side tab holds and drops it when the tab goes; `show_pane` answers each arm; a file tab shows no pin glyph and an open adds beside a pinned Files tab; the remote case: an open for a session on another machine goes to that session's list and the read carries no `named` key (as today).

**Size.** About 450 lines of source and 700 of tests, over about 18 files.

### M2 — An editable file beside the chat: close, save, comment, and a session that goes

**What exists at its end.** A side tab whose file has unsaved edits shows the dot a main file tab shows, and is kept (no longer the preview). Closing it asks what a main file tab's close asks. ⌘S and "Comment on this line" act on the file R4 names. The quit question lists and saves a file beside the chat. A session that goes leaves no unsaved file behind unasked (R5).

**What it touches.** `tools/code/files/FilesTool.tsx` (`beforeClose`); `tools/code/editor/register.ts` (the close question shared by key, `focusedFile`); `tools/code/files/tabs.ts` (`keepUnsaved`, kept at the first edit); `panel/TabStrip.tsx` (the dot, `data-dirty`); their tests (`editor/register.test.tsx`, `editor/unsaved.test.tsx`, `files/files.test.tsx`, `panel/TabStrip.test.tsx`).

**Interfaces.** Consumes §A and §B. Exposes `focusedFile` and `closeGuardOf(key)` (§B) to M4, whose moves must not ask.

**Decisions.** R4, R5; sequence 2 and 6. The close question is today's `guardFileClose` made to work on a key, not on a main tab's ref, so the two surfaces ask in the same words; a file in the merge view vetoes its close and comes into view, as today. `fileReplaceVerdict` (a dirty main file tab is not replaced by a session opening in its place) has no counterpart beside the chat: a preview tab is never dirty (the first edit keeps it), so nothing replaces an unsaved file there, and a test says so. Pitfall: "Save all" and the quit list read the viewer's entries, so they cover a side file with no change, but each is pinned for a side tab by a test, because the prune now decides what an entry outlives.

**What it does not touch.** The move (M4). The comment gutter and the anchor code (U5's `tools/code/anchor/`): a comment on a line of a file beside the chat goes through them unchanged, keyed by the file's key.

**What it proves.** L1 (the first edit), L4, L5. Tests: sequence 2 held open; sequence 6; ⌘S in each of R4's three cases and in none of them (a session tab in front, two files in view, the keyboard in the composer: nothing is saved); behind a page nothing is saved (U7b's rule, `tabOnScreen`, kept for the side column by the body's `visible`); the quit list names a side file once.

**Size.** About 250 lines of source and 450 of tests, over about 9 files.

### M3 — The tree at the file's left

**What exists at its end.** Every Files tab shows the tree in a column at the left of its file; a tab with no file shows the tree alone. The tree is the session's: the same folders open, the same width and fold in every tab of that session, and after a relaunch. A row's single click opens the file in the preview tab, a double-click keeps it, ⌘-click opens a main tab. The row of the file in view is marked. In a tab too narrow for both, the tree gives way as R8 says. The file's bar has the button that folds the tree.

**What it touches.** `tools/code/files/tree-state.ts` (new: the session's tree state and its layout key); `src/shared/ipc/schema/layout.ts` (the key `files.tree` and its schema, with `schema/layout.test.ts`); `tools/code/files/FilesTool.tsx` (the column, the divider, the row's clicks); `tools/code/viewer/FileViewer.tsx` (one optional slot at the bar's start for the tree's button); `tools/code/copy.ts`; `e2e/cross-build.spec.ts` (the scene of L8 gains the key `files.tree`); their tests.

**Interfaces.** Exposes §C. Consumes §B.

**Decisions.** 8, R8; §C's numbers. The tree's state moves out of the tool's instance, where it is per tab, into one store per session, so that two Files tabs of a session cannot disagree; the instance keeps nothing. The store reads its key once through `layout.get` and writes through `layout.set` after a pause, as `stores/people.ts` does for `sidebar.people`, so `stores/layout.ts` (U13's file) gains no slice. The folders open are stored as paths, at most 200 per session (the newest opened kept), and a session the window no longer knows is dropped at a write. The divider is the app's `Resizer` (`app/Resizer.tsx`), as between the column's groups. The watches follow the tree that is drawn: two Files tabs of one session in two groups draw the tree twice and hold their watches through the same counts (`files/store.ts`), which is what those counts are for.

**What it does not touch.** What the tree lists and how (the Changed group, the marks, the filter: U6b-3). `files.list` and its schema. The side column's own width (`panelTools.widths`, U8's).

**What it proves.** L3 (the row), L6, L1 (the double-click). Tests: two tabs of one session show one state; a relaunch (the store read from a stored value) restores width, fold and open folders; a stored value of another version or shape is ignored and the defaults stand; the 200-path bound; the narrow rule at the widths either side of §C's threshold; the marked row.

**Size.** About 450 lines of source and 500 of tests, over about 10 files.

**Before it is built:** the owner's look at a drawn example, if the architect arranges one (R8).

### M4 — Moving a file, the strip's drags, and the selected tab kept in view

**What exists at its end.** A file's side tab moves to the main area by its menu's "Move to main area", by the button in its bar, by View ▸ Move to tab, and by a drag onto a main strip, a pane's body or the right edge. A main file tab moves beside the chat by its menu's "Move to side surface", by View ▸ Move to side surface, and by a drag onto the side column. Any side tab can be dragged onto the other group's strip, or onto the lower part of a one-group column. The selected tab of a scrolled side strip is in view.

**What it touches.** `shell/transfer.ts` (the file's two moves, the refusal and the drop targets made to take a file; the drag between groups); `panel/TabStrip.tsx` (every tab draggable, the menu's item for a file, the strip as a drop target, the reveal); `main/Tab.tsx` (the menu item on a file tab); `tools/code/viewer/FileViewer.tsx` (the bar's button, in a side tab only); the insertions of Interfaces §F that belong to moving (`stores/layout.ts`'s drag type, `panel/PanelHost.tsx`'s lower drop target, `tools/artifacts/copy.ts`'s words); their tests (`shell/transfer.test.ts`, `panel/TabStrip.test.tsx`, `panel/panel.test.tsx`, `keymap/shell-navigation.test.tsx`).

**Interfaces.** Exposes §D. Consumes §B (`fileKey`, rule 3, `keep`), M2's `closeGuardOf` (never asked by a move), U8b's `moveSurfaceTab` and markers, U13a's `openTab`, `moveTab` and `closeTab(id, { remember: false })`.

**Decisions.** 12, 13, 14; sequences 1 and 7. A file's move asks nothing and awaits nothing, unlike an artifact's, which may ask the guard of what it displaces: the two share the refusal's words, the drop targets and the drag state, and not the move itself. The refusals of a file's move, each a sentence the menu item shows disabled and the action says in a notice: a main file tab with no session, or whose session the window does not know ("Open this file from a session to show it beside the chat"); a tab that is closing. Moving to the main area a file that other sessions' lists also hold drops those tabs in the same step (rule 3). The reveal (U8b's §C.3, "What U6b's reveal must cover"): the selected tab is scrolled into view, the nearest way, when it becomes selected by the host (`panelHost.selectTab`, an opener's `addTool`), by a click, and when the F6 stop lands on a group's strip; it is done by the strip on its selected tab's change and on focus arriving at a tab, so no caller has to ask. The drop target on the lower part of a one-group column is shown only while a drag of a side tab is under way and the group has another tab (`moveSurfaceTab` refuses a group's only tab); while a drag is on, the browser's cover is held as for an artifact's drag (`holdCover`, already tied to the drag state).

**What it does not touch.** An artifact's move, beyond sharing its entry points. The groups' model (`panel/surface-model.ts`). The main strip's own reorder.

**What it proves.** A2, L1 (a move keeps), L2 (second half), L7. Tests: sequence 1 in each direction and by each way; sequence 7; a move leaves nothing for Reopen closed tab; a moved file is in front in the main area, and a file moved beside the chat is in view with its session's tab in front; each refusal with its sentence; a drag onto the other group's strip and onto the lower part, and no lower target for a group's only tab; the reveal in each of its three cases, on a strip narrowed until it scrolls.

**Size.** About 450 lines of source and 600 of tests, over about 14 files.

### M5 — The scenes, the cross-build row, the record, and the acceptance run

**What exists at its end.** The e2e scenes that opened a file in the main area open it beside the chat, and say so; new scenes hold A1, A2 and L8. The record is written. The whole unit suite passes.

**What it touches.** The spec files and helpers of Interfaces §G; `e2e/cross-build.spec.ts` (the scene and the row of M1 and M3, read again against the final code); `docs/charter.md` (three amendments and one line at X9); `docs/tech-debt-tracker.md` (what the milestones' reviews left); this document's Progress and record.

**Interfaces.** Consumes everything above. Exposes nothing.

**Decisions.** A scene is changed by reading and typechecked (`tsconfig.e2e.json`): an executor runs no Electron. A scene that asserted "a file tab of the main strip" for an open by a click now asserts a side tab and an unchanged main strip; a scene whose subject is a main file tab (a stored main tab restored, the compact main tabs of `e2e/ux2-shell.spec.ts`, the upgrade of `e2e/shell.spec.ts`) keeps its main tab, which a stored layout still gives. Before handing back a head whose diff touches `e2e/`, run the gate's script tests on the VM (Concrete Steps): they pin the count of spec files and each group's list. No spec file is added: every new scene joins an existing file, so no group list moves.

**What it does not touch.** `package.json`, `.github/`, `scripts/`. The spec's files.

**What it proves.** L8's scene as written, L9, and Acceptance as a whole against the runs named in Concrete Steps.

**Size.** About 650 lines of scenes and 40 of documents, over about 13 files.

## Concrete Steps

Working directory for every command: the branch's worktree (the controller's brief names it). The VM sees only what is pushed. `vmcheck.sh` prints `vmcheck: ux-wave/U6b at <short sha>`, then the command's own output, and exits with the command's status; the first call for the branch installs dependencies and takes a few minutes. The VM is shared: a check that is slow or times out is read against its load first. Every command there runs under a time limit (`timeout <seconds> …`) sized to what it should take.

1. **Before each milestone:**

       git fetch origin master && git merge origin/master
       git push origin ux-wave/U6b

   A merge, never a rebase or a force-push. After a merge that brought changes, run the previous milestone's proof again (the same set, not the whole suite).

2. **The tests before the modules** (each milestone). Commit the suite of the milestone's "What it proves" with the modules' exports naming nothing; push; run it; the cases that assert the new behaviour fail and the ones that assert what stays pass. Then build.

3. **While building**, after each push (the renderer is the web project; `src/shared/` is compiled by both):

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6b -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6b -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6b -- 'timeout 600 pnpm exec eslint <the paths changed>'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6b -- 'timeout 900 pnpm exec vitest run <the test files touched>'

   The node project is needed only by M3 (the layout schema) and by any milestone that edits `src/shared/`.

4. **Each milestone's proof** is the typecheck of the projects it changed, eslint on its changed files, and vitest over the folders it touched and those that import what it changed, with the tokens guard:

   - M1: `src/renderer/src/tools/code src/renderer/src/tools/maws src/renderer/src/tools/scm src/renderer/src/tools/agents src/renderer/src/tools/artifacts src/renderer/src/panel src/renderer/src/side src/renderer/src/request-card src/renderer/src/transcript/view src/renderer/src/harness test/support/tokens-guard.test.ts`
   - M2: `src/renderer/src/tools/code src/renderer/src/panel src/renderer/src/keymap src/renderer/src/app test/support/tokens-guard.test.ts`
   - M3: `src/renderer/src/tools/code src/renderer/src/panel src/shared/ipc src/main/layout test/layout test/support/tokens-guard.test.ts`
   - M4: `src/renderer/src/shell src/renderer/src/panel src/renderer/src/main src/renderer/src/keymap src/renderer/src/tools/code src/renderer/src/tools/artifacts src/renderer/src/app test/support/tokens-guard.test.ts`

   as `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6b -- 'timeout 1800 pnpm exec vitest run <the list>'`. Expected: every file passes but the ones the build brief lists as failing on master on the VM too; `src/renderer/src/sidebar/Sidebar.test.tsx` is not in these lists.

5. **A scene is typechecked, not run** (M1's and M3's cross-build scene, M5's scenes):

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6b -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6b -- 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'

   The second is the gate's own script tests, text guards over the scene files and the group lists: they read an `expect(<a time>).toBeLessThan(<a number>)` in a scene as a raw time bound, so a scene waits with `expect.poll` and asserts no duration.

6. **When M1 is pushed and its proof is green: stop and tell the controller**, who tells the architect that the cross-build scene can run (R9). M2 starts on the architect's word.

7. **The acceptance run** (M5's last step), on the pushed head, after a last merge of master:

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6b -- 'timeout 2400 pnpm typecheck'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6b -- 'timeout 1800 pnpm lint'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6b -- 'timeout 3600 pnpm test'

   Expected: each exits 0, apart from the files the build brief lists as failing on master on the VM too; vitest's summary names no other failed file. No fixture file is added; if one is, also run `node --test .github/scripts/maws-app-scan.test.mjs` there. The whole unit suite runs this once, by M5's executor, and by no earlier milestone. Acceptance against these runs: A1, A2 and L1 to L7 are the milestones' suites as each "What it proves" names them; L9 is the three commands; the scenes and L8 are the architect's.

8. **Stop and hand back.** M5's executor writes into Progress what ran and what is left, pushes, and stops. Class 1a (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6b-1`), the branch review, the e2e runs and the pull request are the architect's.

## Interfaces and Dependencies

### §A. What is stored, and what build F does with it (M1, M3)

Build F is `f1852de3a`. Nothing is added to a stored tab, to `main.tabs`, to `regions` or to the stored side surfaces; no version moves; neither settings file is touched; nothing is sent.

| key | what this landing writes | what build F does with it (read at `f1852de3a`) | what this build does with F's write | this build, then F, then this build |
|---|---|---|---|---|
| `panel.<session>` (`tabs`) | several refs `{ id, toolId: 'files', pinned: false }`, one per Files tab | The ref's shape is F's own (`PanelTabRefSchema`). F's column shows one surface per tool (`normalizeSurfaceStack` keeps the first id of each tool), so it draws one Files surface; its Files tool is single-instance and draws its tree. F never removes a ref it did not close and writes the list back whole | reads the same refs | every tab kept |
| `panelTools.params[<tab id>]` | `{ file, line, preview? }` for a tab that holds a file; nothing for a tree-only tab | `PanelParamsSchema` is a record of unknown values: it parses. F keeps the entries of live tab ids (`hydrate`) and hands a tab's entry to its Files tool as `init.params`, which reads only `path` (to reveal and open a main tab): with no `path` it does nothing. F writes the entries back | reads them; an entry it cannot read is a tree-only tab | every tab holds its file; the preview tab is still the preview |
| `panelTools.surfaces` (`stacks`) | the ids in view, two when both groups show a Files tab | F shows the first Files id of the stack and ignores the second of the same tool | U8b's reading rule | what U8b's rows say: the arrangement in two groups is not kept by a stay on F |
| `main.tabs` | a file moved to the main area is a `file` tab as F knows it, with no new field | draws it as its file tab | a file F opened is a main tab; a side tab of the same file is dropped at the read (sequence 8) | a moved file stays a main tab |
| `files.tree` (new, M3) | `{ version: 1, sessions: { <session>: { width, folded, expanded } } }` | F's renderer does not name the key and F's layout file store keeps every key it finds through its own writes (the precedent of `sidebar.hidden`, `destination` and `library.exportFolder`, each with a cross-build scene) | F writes nothing there | read back whole |

**The coverage table** (`e2e/cross-build.spec.ts`, the comment block U13a's M5 began) gains one row, "U6b-1: files beside the chat (`panel.<session>` with several Files tabs, their `panelTools.params`, `files.tree`)", and one scene, **"(files beside the chat, both ways)"**: this build opens three files beside a session's chat (one the preview tab, one kept, one with the tree's width changed and a folder opened) and quits; the peer launches on the profile, shows its Files surface with its tree, refuses no layout value (the scene's existing `INVALID_LAYOUT` check), opens one of the three files (a main tab there), changes any layout value so that it writes, and quits; this build reads the three tabs back with the preview still the preview, the file the peer opened as a main tab and not also beside the chat, and the tree's width and open folder as stored. The scene skips unless the peer is build F's shape, and a skipped scene is not evidence: the run of record uses `--peer-exact f1852de3a`.

**No rehearsal over the owner's layout files is owed:** the reader of the stored layout does not change, and a layout written before this landing holds no Files tab with a file.

### §B. The model and the open rule (M1, M2; `tools/code/files/tabs.ts`, `tools/code/open-file.ts`, `tools/code/editor/register.ts`)

    // tools/code/files/tabs.ts
    export interface FilesTabParams { file: string; line: number | null; preview?: true }   // `file`: absolute, lexically normal
    export function fileOfTab(params: unknown): FilesTabParams | null;      // null: a tree-only tab (no params, or params this build cannot read)
    export function fileKey(machine: MachineRef, path: string): string;     // the id a main tab of the file has: `file:<machine>:<path>`
    export function pinnableTab(params: unknown): boolean;                  // false for a tab that holds a file (R1)
    export function keep(tabId: string): void;                              // the preview tab becomes a kept tab; no-op otherwise
    export function showFiles(appSessionId: AppSessionId): string;          // the session's Files tab last in view brought into view, else a tree-only tab added; its id

    export interface OpenRequest { appSessionId: AppSessionId | null; path: string; main: boolean; keep: boolean }
    export type Placement =
      | { to: 'main' }
      | { to: 'side'; tabId: string; how: 'select' | 'reuse' }
      | { to: 'side'; tabId: null; group: 'upper' | 'lower' };
    export function placeOpen(state: LayoutState, request: OpenRequest): Placement;   // pure

    // tools/code/open-file.ts
    export interface OpenFileOptions { main?: boolean; keep?: boolean; asked?: 'agent' }
    export type Opened = { surface: 'main' | 'side'; tabId: string };
    export function openFile(appSessionId: AppSessionId | null, path: string, line?: number | null, options?: OpenFileOptions): Opened | null;
    // null: the layout is not read yet; the open is kept and made when it is (Decision 10)

    // tools/code/editor/register.ts
    export function focusedFile(): string | null;                           // the key of the file ⌘S and "Comment on this line" act on (R4); null behind a page
    export function closeGuardOf(key: string): Promise<boolean>;            // today's close question, by key

**`placeOpen`, in order.** (1) No session, or `main`: the main area. (2) A main tab has the file's key: the main area (the tab is selected and takes the line and the session, as today). (3) The session's own list holds a tab of this file: that tab, `select`. (4) The list holds the preview tab: that tab, `reuse`. (5) The list holds a tree-only tab: that tab, `reuse` (a pinned Files tab is among the pins, not in the session's own list, so it is never taken: R1). (6) Otherwise a new tab, in the group `groupForOpen` names for the tool.

**After the placement.** A new or reused tab is the preview tab unless `keep`; a selected tab becomes kept with `keep` and is otherwise left as it is. The tab comes into view in its group and the column is shown, through the panel host (`asked` passed on); a session not on screen is brought to the front by the host, as for any tool. A person's open first leaves an open page (Decision 9). The file is read again when its last read failed or no watch keeps it current (`revisit`, U6c).

**The three rules of one document** (Decision 3). 1: a session's own list holds at most one tab per file. 2: the main area holds at most one tab per file (today's rule). 3: the main area and the side column never both hold a file: an open selects the main tab when there is one; a move to the main area, and a ⌘-click, drop every side tab of the file in every session's list in the same step; and once after hydration every side tab whose file a main tab holds is dropped. Two sessions' lists may each hold the same file: only one side column is on screen, and the entry follows the session that mounts it, with unsaved edits standing (What the code holds, 3).

**The markers** the scenes and the siblings read: a Files tab's body is `[data-files-tab]` with `data-file` (the path, or empty); the file viewer inside it is today's `[data-file-viewer][data-path]`; in the strip, a tab's `[data-tab-id]` element gains `data-preview` and `data-dirty`.

### §C. The tree at the file's left (M3; `tools/code/files/tree-state.ts`)

    // src/shared/ipc/schema/layout.ts — key `files.tree`
    export const FILES_TREE_EXPANDED_MAX = 200;
    export const FilesTreeSchema = z.strictObject({
      version: z.literal(1),
      sessions: z.record(z.string(), z.strictObject({ width: z.number().int().nullable(), folded: z.boolean(), expanded: z.array(z.string()).max(FILES_TREE_EXPANDED_MAX) })),
    });

    // tools/code/files/tree-state.ts
    export const TREE_WIDTH_DEFAULT = 220;   // px, while `width` is null
    export const TREE_WIDTH_MIN = 160;
    export const FILE_WIDTH_MIN = 320;       // what the file keeps beside the tree
    export type TreePlace = 'alone' | 'beside' | 'folded' | 'instead';
    export function treePlace(input: { holdsFile: boolean; tabWidth: number; treeWidth: number; folded: boolean; shown: boolean }): TreePlace;

`alone`: the tab holds no file. With a file: when `tabWidth >= treeWidth + FILE_WIDTH_MIN`, `beside` unless `folded` (the stored choice), then `folded`; when it is narrower, `folded` unless `shown` (the button pressed in this tab, not stored), then `instead`: the tree in the file's place, until a file is chosen or the button is pressed again. The tree's width is dragged between `TREE_WIDTH_MIN` and `tabWidth - FILE_WIDTH_MIN`; a double-click on the divider returns it to the default (`width: null`). The session keys of `sessions` are the sessions' addresses; the scroll offset and the selection are not stored.

Markers: the tree column is `[data-files-tree]` (with `data-place`); the button is `[data-files-tree-toggle]`, named "Hide files" while the tree is drawn beside or instead and "Show files" otherwise.

### §D. The moves (M4; `shell/transfer.ts`)

    export function moveToMain(panelTabId: string, at?: TabPlace): boolean | Promise<boolean>;   // a side tab that has a main-tab form: an artifact's record (today's `moveArtifactToTab`) or a file
    export function moveToPanel(mainTabId: string): boolean | Promise<boolean>;                   // a main tab that has a side form: an artifact's (today's `moveArtifactToPanel`) or a file's
    export function moveFileToMain(panelTabId: string, at?: TabPlace): boolean;                   // synchronous (sequence 1); false: refused, nothing changed
    export function moveFileToSide(mainTabId: string): boolean;
    export const panelTabMoves: (tab: PanelTabRef) => boolean;                                    // an Artifacts tab, or a Files tab that holds a file
    // `transferRefusal`, `dragAccepted`, `coverState`, `dropPanelRecord`: each takes a file as it takes an artifact

The drag state's panel form becomes `{ source: 'panel'; tabId: string; toolId: string; artifactId?: string }`. A drop of a side tab on the other group's strip, or on the lower target of a one-group column, calls `moveSurfaceTab` and `keep`. The bar's button is `[data-move-to-main]`, named "Move to main area"; the menus' items read "Move to main area" on a side tab and "Move to side surface" on a main tab, the words an artifact's items have.

### §E. What the later landings and the siblings consume

- **U6b-2 (PDF, HTML and media by a path) and the Office previews after it:** `FileBody` in `tools/code/viewer/FileViewer.tsx`, the one component that draws a file's body in a side tab, in a main tab and in the File artifact's view, with its `Body` switch on the entry's kind (the tab's host element); `kindOf` and `externalKindOf` in `tools/code/viewer/kinds.ts` (the place a format is recognised), which this landing does not edit; the viewer store's entry and its reads, which this landing does not edit beyond the prune.
- **U6b-3 (Files):** the tree column (§C's markers and store), where the Changed group and the filter go; `showFiles` to bring Files into view for ⌘P; `openFile(…, { keep: true })` for the filter's Enter.
- **U6b-4 (links, "Open in"):** `openFile` and its options; the bar of `FileBody` (its `controls` slot) for "Open in"; `Refused` in `FileViewer.tsx`, untouched here.
- **U6b-5 (the keyboard):** a file beside the chat is not a place of Back and Forward, and a file moved to the main area is a main tab like any other; `focusedFile` for a key that acts on "the file".
- **U5:** a comment on a line of a file beside the chat is keyed by `fileKey`, which is the id its code keys by today.
- **U6d** (parallel, `origin/ux-wave/U6d`): nothing consumed. Both edit `tools/maws/panes/connect.ts` (U6d the artifact pane, this landing the `file` branch) and, with U6d's second milestone, `transcript/view/markdown/Link.tsx`; the second to land merges master first.

Consumed, by the name each exposes: from U8b (on master) `panelHost.addTool` with `group` and `asked`, `panelHost.selectTab`, `setPanelParams`, `updatePanelTabs`, `sideGroups`, `groupOf`, `groupForOpen`, `showSurfaceTab`, `moveSurfaceTab`, the markers `[data-surface-stack]`, `section[data-side-group]`, `[data-side-strip]`; from U13a (on master) `openTab`, `moveTab`, `closeTab(id, { remember: false })`, `tabOnScreen`; from U7b (on master) `pageOpen`, `closeDestination`, `quietly`; from U6c (on master) `revisit` and the `named` key the viewer store already sends; from U8c-2 (on master) nothing new (the tree's roots and first root are as it left them); from U3a nothing.

### §F. Files other children own, or no child owns (UC-8)

| file | owner | the insertion | milestone |
|---|---|---|---|
| `transcript/view/markdown/Link.tsx` | UC-3, the wave's architect | the path link's click passes `{ main: event.metaKey }` as the action's fourth argument | M1 |
| `transcript/view/context.tsx` | UC-3 | `TranscriptActions.openFile` gains an optional fourth parameter, `options?: { main?: boolean }` | M1 |
| `panel/summary/Sources.tsx` | U8 | the file row calls `openFile` (one call) | M1 |
| `side/ThreadView.tsx` | U5 | the anchored file's button calls `openFile` (one call) | M1 |
| `tools/maws/panes/connect.ts` | no child (U7b and U6d inserted) | the `file` branch's answer (R2) | M1 |
| `e2e/cross-build.spec.ts` | the P5 work; the table is U13a's | one scene and one row (§A) | M1, M3 |
| `src/shared/ipc/schema/layout.ts` | by key | the key `files.tree`: its schema and its literal in `LayoutKeySchema` | M3 |
| `stores/layout.ts` | U13 | the drag state's panel form: `artifactId` optional (one type line) | M4 |
| `panel/PanelRegion.tsx` | U8 | the column's drop calls `moveToPanel` (one call) | M4 |
| `panel/PanelHost.tsx` | U8 | the lower drop target of a one-group column, mounted only while a side tab is dragged (one element) | M4 |
| `main/Tab.tsx` | U13 | "Move to side surface" on a file tab, beside the artifact's item | M4 |
| `tools/artifacts/copy.ts` | no child | `TRANSFER_COPY.notArtifact` says "Only an artifact or a file moves beside the chat"; the new refusal's sentence | M4 |
| `harness/code/CodeHarnessBlock.tsx`, `harness/code/codeProbes.ts` | no child (the e2e harness) | only if a harness scene needs the file beside the harness's chat; read in M5 | M5 |

`main/TabStrip.tsx`, `main/Pane.tsx` and `main/DropEdge.tsx` (U13's) call `dropPanelRecord` and are not edited. `panel/host.ts`, `panel/tool.ts` and `panel/surface-model.ts` (U8's) are not edited: a move removes a ref through the store, and the host's own reconciliation disposes the instance.

### §G. The e2e groups whose scenes cross this change

By the group's name in `package.json`; `e2e` is the default group (the specs no script lists).

| group | spec | scenes that change, or are added |
|---|---|---|
| `e2e` | `e2e/sessions.spec.ts` | U6c's scene of a linked file outside the folders: the text file and the PDF's row are beside the chat and the main strip is as it was |
| `e2e` | `e2e/layout-transfer.spec.ts` | added: "a file moves to the main area and back by its menu and by a drag: the edit typed just before each move is there once and one undo removes it"; added: "a relaunch brings back the files beside the chat, the preview tab and the tree's state"; added: "a side tab dragged onto the other group's strip joins it" |
| `e2e` | `e2e/c12-prerun.spec.ts` | the viewer piece: the file is beside the chat, so the piece after it finds the composer without returning to the session's tab |
| `e2e:code` | `e2e/code-tools.spec.ts` | added: "a file opens beside the chat: from a path link, from Review and from the tree; the preview tab is reused, a double-click keeps it, ⌘-click opens a main tab" (A1, L1, L3). Changed: "an inline edit discloses its diff and opens the changed file"; "Files lists one node per root and opens the viewer"; "Open file lands at the first changed line and a second Open moves the line" (one side tab, Review's tab still in its strip, no main file tab); every viewer scene that opens by a tree click finds the viewer by `[data-file-viewer][data-path]`, which holds, and changes only where it selects or closes the file's tab by the main strip; "the Files tree and the viewer use tokens only in both themes" gains the tree column and the italic tab |
| `e2e:code` | `e2e/code-editor.spec.ts`, `e2e/support/code-product.ts` | every scene opens its file through the helper and finds its tab by role and name: the tab is the side strip's. "asks before closing a dirty tab", the two quit scenes and "a basename wider than the bar ends in an ellipsis" are read again against the side tab |
| `e2e:panel` | `e2e/panel.spec.ts` | the Sources card's file row ("a file row opens a file tab for A through C5's openTab"): a side tab |
| `e2e:side` | `e2e/side.spec.ts` | the step that opens a side thread's anchored file |
| `e2e:remote` | `e2e/remote.spec.ts` | the steps that open a file of the other machine's checkout: beside the chat, read there; added assertion: the main strip unchanged, and the request carries no `named` key |
| `e2e:layout` | `e2e/ux2-shell.spec.ts`, `e2e/shell.spec.ts` | their file tabs are stored main tabs and stay; "overflowing tabs remain reachable and F6 visits cards and surface content" gains the reveal (the selected side tab in view after F6) |
| `e2e:cross-build` | `e2e/cross-build.spec.ts` | added: "(files beside the chat, both ways)" (§A) |
| `e2e:deliverables`, `e2e:library` | `e2e/deliverables.spec.ts`, `e2e/library.spec.ts` | "Open as file" from a File artifact's view, where a scene presses it: beside the chat |
| `e2e:tools` | `e2e/maws-tools.spec.ts` | a replayed `show_pane` for a file, where a scene has one: the answer's arm (R2) |

Read by M5's executor and reported, not changed without the architect: `e2e/code-tools-live.spec.ts`, `e2e/p1-live.spec.ts` and `e2e/maws-tools-live.spec.ts` (paid live scenes that open a file by a click or by `show_pane`); whether a paid group runs is the architect's (root UC-10, "Paid live groups").

## Proof that an executor does not run

Each is a step for the architect, with what it needs.

1. **The cross-build scene, early** (R9): `e2e:cross-build` with `--peer-exact f1852de3a`, the new scene alone, on M1's pushed head. Needs: a Mac under the load rule, build F as the peer; nothing of the owner's. Its result decides whether M2 starts. It runs again on the final head with M3's key.
2. **The new and reworked scenes, each alone, then their groups**, on a Mac under the load rule: the groups of §G.
3. **A drag by hand.** The scenes drive a drag with synthetic events. One hands-on pass on a Mac: a file's tab dragged onto the main strip, onto a pane's body and onto the right edge; a main file tab dragged onto the side column; a side tab dragged onto the other group and onto the lower part; with a page of the in-app browser shown beside (its cover must hold while the drag is on).
4. **Class 1a**, once, when the branch is complete: `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6b-1`.
5. **The branch review** (Decision Log 1): the panel.
6. **Three routes.** A terminal session and a session on another machine each open a file beside the chat in the sitting's script or in `e2e:remote` and `e2e:lane-a`; no engine runs for this landing (no engine fact is used: law 6 has nothing to verify here).
7. **The owner's look.** A drawn example is recommended before M3: the side column with a file's tab, drawn at the column's usual width (the tree beside the file, the italic preview tab beside a kept tab and Review's tab, the bar with the tree's button and "Move to main area") and at its narrowest (the file alone; then the tree in its place). Invented file names and text. It answers R8 and shows R1 (no pin on a file's tab). In the sitting's scene script: A1, A2, L1, L6.

## The pull request

Its body names its class 1a run, the review's verdict with what was dismissed or deferred, the cross-build run with build F as the exact peer, the Mac runs of §G's groups, and its residue. It carries, dated, the rulings this landing reverses where they stand (root UC-10, "The record"; the child's "Rulings reversed", l5-code-11):

- **`docs/charter.md`**, at each of §3 P0 ("Main tabs: session tabs, file viewer tabs, diff tabs"), §5.6 Files ("click opens a viewer tab in the main area") and §12 C8's acceptance ("Review opens a file tab at the changed line"), the sentence of R7.
- **`docs/charter.md`, X9's record, one line:** "Amended 2026-11-14 (UX wave U6b-1, l5-code-11): `show_pane` with pane `file` opens the file beside the chat and answers `opened` in its `panel-tool` form (`toolId: 'files'`, `title` the file's name); it answers the `main-tab` form when a main tab already shows the file. Neither form's shape changes, and no description changes."
- **The coverage table** in `e2e/cross-build.spec.ts`: the row of §A.

`docs/tech-debt-tracker.md` gains what the milestones' reviews leave, and these two unless a ruling removes them: a file's chips (a read's, an edit's, an anchored comment's) take no ⌘-click (R6); tabs of a side strip cannot be reordered by a drag.

What the pull request tells the owner beyond the item: a pinned Files tab keeps showing the tree alone and a file's tab has no pin (R1); ⌘S saves the file the keyboard is in, else the one file in view (R4); the Sources card's file row and a side thread's anchored file open beside the chat like every other open.

## Surprises & Discoveries

- Observation: at authoring, the check on build F the child's file asks for could be answered from F's source. F shows one surface per tool, its Files tool reads only `params.path`, and it keeps both the refs and the params through its own writes.
  Evidence: `git show f1852de3a:src/renderer/src/panel/surface-model.ts` (`normalizeSurfaceStack`), `…:src/renderer/src/tools/code/files/FilesTool.tsx` (`createState`), `…:src/renderer/src/stores/layout.ts` (`hydrate`'s `panelParams`).
- Observation: a move needs no hand-off of editor state when both surfaces key the file alike; what it needs is that both writes land in one commit.
  Evidence: `tools/code/viewer/CodeView.tsx`, the editor's effect and its cleanup; `viewer-store.ts`, `mount`.

## Decision Log

1. **2026-11-14 (UTC) · The verification call.** This document gets an adversarial review before an executor starts (the architect dispatches it). The branch gets `doperpowers:review-code` at the **xhigh panel**: by size (about 4,500 changed lines over about 50 files, past both of the root's marks), not because the root calls it delicate; its lenses are the move's hand-off of the editor's state (sequence 1), the stored form against build F (§A), the unsaved-file rules (sequences 2 and 6), and the keyboard in the strips. Class 1a on GitHub Actions is the gate of record. The pull request's body names its class 1a run, its review verdict and its residue.

## Outcomes & Retrospective

Pending — written at finish.
