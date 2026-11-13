# UX wave · U7: sidebar, title bar and destinations (2026-11-13)

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U7, in two landings: **U7a** (S-11, #407, O-03, O-38 with #559, O-16) and **U7b** (O-40, O-47, contract UC-12). **Parent pin:** `5f1972a3063cbcb9525bdbdbd3ab047dca74ce74`, the head of branch `ux-wave-spec` this document was written against.
>
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U7-sidebar-title-bar-destinations.md`, cited below as *section* (its acceptance items as A1 to A10). This document carries the cut, the constraints, the milestones and the interfaces, and nothing of the design. Until the spec's pull request lands, the root and the section are read on branch `ux-wave-spec`.
>
> **Branches:** U7a is built on `ux-wave/U7`, which carries this document; U7b on `ux-wave/U7b`, cut from a master that holds U7a and U13a. **Board:** #591. **Waiting, and not in either landing:** S-03 and S-08. Each waits for U14's check on the owner's machines (the section, "Waiting"); nothing of them is planned here, and an executor who meets either stops.

## Purpose

After U7a the owner can put a session out of the way with one menu act, or with one click on its row if the owner chooses the row's button, and get it back; a new session is named by six words of its prompt from its first second; a row of a session on another machine opens in a tab of its own like a local one; the sidebar says "reconnecting" while this Mac's daemon restarts, instead of showing a few sessions as if they were all; a long project name stays inside its chip.

After U7b usage is a small ring at the right end of the title bar; Settings opens as a dialog over the window; Customize, Projects and the Artifacts library open as a page beside the sidebar; none of the four adds a tab to the strip.

Build F (commit `f1852de3a`) is the build on the owner's machines, and the owner will run it again on the same profile after a trial of the wave's build. Everything these landings store is therefore something F reads whole or leaves alone (root UC-14).

**How to see it working.** In the suites: the unit tests named under each milestone and the e2e scenes of M4 and M8. By hand on the wave's build: hide a session from its row's menu and find it under "Hidden · 1"; start a session with a long prompt and read six words in its row; press ⌘, and see the tabs dimmed behind a dialog; click Customize in the sidebar and see a page with Back where the strip was.

## Progress

- [x] (2026-11-13 03:30Z) Document written against master `5c9cfa0c5` (`d6f8c10de` at the end of the writing: probe fixtures and one scanner entry since, nothing this document rests on). The section checked against that code; what is consumed from landings in flight read at `origin/ux-wave/U13a` `772fd07ca`, `U8b` `6dc2f24de`, `U11a` `0adbfd07c`, `U6a` `936d6c003`, and U9's and U1a's documents.
- [x] (2026-11-13) Adversarial review of this document (one P1, six P2, three short points) and the architect's rulings on it and on the thirteen points reported at authoring: folded in, one revision (Decision Log). The cut stands as written. Read again for the revision: master `d7ca414ae`, and `origin/ux-wave/U9` `c13d710b0`, which now holds code.
- [x] (2026-11-13) The drawn example came back with nineteen points, and the architect ruled on each; the nine points handed back with revision 2 were accepted as written. Folded in, one pass (Decision Log).
- [x] (2026-11-13) M1 — Three small fixes: six words, "reconnecting", the chip's box. Commits `83f56a79c..d3578520b`; reviewed clean.
- [x] (2026-11-13) M2 — A listed session opens like a local one. Commits `82c7fdebd..3f6a6ae59`, review fix `273101fd1..9303d53c4` (an anchored Needs you item of a listed session now goes through the opener too); reviewed clean.
- [x] (2026-11-13) M3 — Hide a session, and get it back. Commits `3705b6a36..7c3cb5054` (the row's button last, `7c3cb5054`), review fix `3dcf36df0..17acf3e0d` (a Hide settles the held order at once; the Hidden row is the keyboard parent of every row under it; no Hide on a Needs you row, by the architect's ruling); reviewed clean. Its last step, the row's own button, is built on the owner's answer to question 1 (M3, decision 9). The owner answered "Button on the row" (2026-11-12): it is built.
- [x] (2026-11-13) M4 — U7a's e2e scenes, the record, and the acceptance run. Master `d3c7edce3` merged at `d2b41c53f` (no file this document names changed in it). Commits `02f8cfccf..07821ccd0`, review fix `28d488f7e..aa32a4325` (the remote ⌘-click step now fails a plain open; the focus-after-Hide effect has its dependency list, so `pnpm lint` shows no warning); reviewed clean. Acceptance on the VM: `pnpm typecheck` and `pnpm lint` exit 0; `pnpm test` at `90ba59e08` fails only in the known set, a load timeout (`src/engine-host/journal.test.ts`, 20/20 alone at 60 s) and `test/support/tokens-guard.test.ts`, which `07821ccd0` fixed (the guard passes at the head); after it, `Sidebar.test.tsx` alone and the `sidebar` folder pass at `aa32a4325`. The keymap, menu and settings diff prints nothing.
- [ ] U7a: the proof an executor does not run; the pull request on the architect's word. Handed over (2026-11-13) on head `aa32a4325` and the head that follows with this entry: the branch review (xhigh panel); the e2e runs: `e2e/shell.spec.ts` ("a long project name stays inside the chip's box", "hide and unhide" with the row's button step, the long shell scene's menu list), `e2e/sessions.spec.ts` ("foreign-live: …"), `e2e/ux1-sidebar.spec.ts` ("UX1: titles keep their width on hover…"), `e2e/share.spec.ts` (line 283's assertion), `e2e/remote.spec.ts` with `MAWS_REMOTE_E2E=1` (the listed row's step); the cross-build group with `--peer-exact f1852de3a` (*(sidebar, both ways)*); class 1a.
- [ ] The re-check pass of "Statements to check again", once U13a is on master (the author of this document, on the architect's word). U7b does not start before it.
- [ ] M5 — The page and the dialog exist beside the tabs.
- [ ] M6 — The cutover: every way in, and the four tab kinds retire.
- [ ] M7 — Usage is a ring.
- [ ] M8 — U7b's e2e scenes, the record, and the acceptance run.
- [ ] U7b: the proof an executor does not run; the pull request on the architect's word.

## The cut: two landings

The section does not cut the child. Sorted by what each item needs, not by the section's Edges line:

| item | what it needs that is not on master | lands in |
|---|---|---|
| S-11 | nothing: one function in the services' index | U7a |
| #407 | nothing: the first read's retry exists (`ipc/until-answered.ts`) | U7a |
| O-03 | nothing: two class changes on the chip as it stands. U13a's fourth milestone rewrites the same component's click, so whoever lands second merges one element | U7a |
| O-38, #559 | nothing: both lanes' openers take the new-tab request today. The listed row's menu is in U7's own files; U9 builds in the same files at the same time, to one agreed order of the menu, and whichever lands second merges (Reported, 1) | U7a |
| O-16 | nothing: a store and a layout key of its own beside `sidebar.people`, and U7's own sidebar files. It does not touch the layout store | U7a |
| O-40 | U13a: the strip (`Strip`), `commitShown`, `stripOf` and `storedMain`, hydration as U13a leaves it | U7b |
| O-47 | O-40: "Usage settings" must open Settings at a section build F's stored tab cannot name (root UC-14), and the account actions need their new home in the landing that takes them out of the popover | U7b |

**Why two.** U7a stands on today's master and can start at once; its five items share one area (the sidebar, with one services function and one title-bar class) and one verification strategy. U7b cannot start before U13a, whose second of five milestones is being built. Kept whole, the five items of U7a would wait for a store change none of them reads.

**Why not three.** O-47 could be built on master against today's Settings tab, with a link that moves the tab's view without storing a section. It would then be converted when the dialog lands, its e2e scenes written twice, and the interim would hold a seam built to be removed. O-03 as a pull request of its own (the section allows it) would cost a gate and a review for two classes; it rides with U7a and is first in M1, so it can be cherry-picked out if the architect wants it earlier.

**What a reviewer holds.** U7a: about 2,100 changed lines over about 35 files, four milestones, and about 150 more with the row's button. U7b: about 5,000 over about 105, four milestones, of which about 1,500 are e2e scenes re-expressed and about 600 are unit tests moved with the usage panel.

**U7b's edge, exactly.** U7b consumes from U7a, by name: the key `sidebar.hidden` and `SidebarHiddenSchema` (it adds `destination` beside them in the same file and the same key list); the cross-build scene *(sidebar, both ways)*, which it extends; `e2e/support/shell.ts` and `e2e/support/sidebar.ts` as U7a leaves them; `sidebar/Sidebar.tsx`'s `Footer`, `DestinationRow` and `ArtifactsRow` as they stand (U7a does not edit them). Nothing else: U7b reads no store, type or component that U7a adds.

## Statements to check again

One list. Each is true of the branch named and must be read again on master before M5 starts; U7a depends on none of them, except where marked *(U7a at merge)*.

| # | statement | read at |
|---|---|---|
| R1 | `LayoutState.main` is a `Strip`; `commitShown` is a closure of `createLayoutStore` and lands `openTab` (unless `activate: false`), `openSession`, `activateTab`, `selectTab`, `cycleTab`, `reopenClosed`, `moveTab`, `reorderTab`, `splitWithActive`, `showPane`; `focusPane` lands through `main`; today `commitShown` only calls `main` | `origin/ux-wave/U13a:src/renderer/src/stores/layout.ts`; its document, Interfaces §C |
| R2 | `stripOf(stored)` answers `{ strip, merged, canonical }`; `storedMain(strip)` is the one stored form; hydration keeps the raw stored `main.tabs` in `readAs` and writes `main.tabs` when `!canonical \|\| rewritten \|\| unfolded \|\| titled \|\| changed` | the same file; `src/shared/ipc/schema/layout.ts` there |
| R3 | `frontOf(state)` is the id of the tab in front, and `createSession`'s arrival rule and `closeEmptyChat` compare it (U13a's M3, not built yet) | U13a's document, Interfaces §B and §E |
| R4 | `pane.focusOther` calls `showPane`; `shell/floating.ts` calls `showPane` from `floatSplit`, `dockSplit`, `openCard`, `closeCard`, `focusSplitCard`, and `focusCompactCard` keeps `focusPane` | `origin/ux-wave/U13a:src/renderer/src/app/shell-actions.ts`, `shell/floating.ts` |
| R5 | The chip is `ProjectChip` in `app/Toolbar.tsx`, drawn while `currentRow()` is not null, its click `revealRow`; its wrapper still carries `max-w-24` *(U7a at merge: O-03's two classes are applied to the chip as master then has it)* | U13a's document, M4; the file at that head |
| R6 | The rehearsal is `test/layout/rehearsal.ts` with the gated runner `test/layout/owner-files.test.ts`; it returns generated labels, numbers, booleans and one word of `OUTCOMES` | `origin/ux-wave/U13a:test/layout/` |
| R7 | U13a's three cross-build scenes and its coverage table are in `e2e/cross-build.spec.ts` and its document's M5; a scene skips unless the peer keeps sets | U13a's document, M5 |
| R8 | `cardColumnShown(input)` takes `pageOpen`; `cardColumnNow(state, width)` and `useCardColumn()` in `app/shell-view.ts` gather its inputs and hold `pageOpen: false`. Not built yet (U8b's M4) | U8b's document, Interfaces §C.2 |
| R9 | U8b's hydration writes nothing over a key whose read failed (`failed` in `hydrate`), and passes `multiInstance` in the shell's `hydrate` call | `origin/ux-wave/U8b:src/renderer/src/stores/layout.ts`, `ipc/events.ts` |
| R10 | `showSurfaceTab(appSessionId, tabId)` is the one act that brings a side surface into view; `toggleSurface` and `toggleSessionCards` live in `panel/SurfaceRow.tsx` | U8b's document, Interfaces §B |
| R11 | `useScrim()` and the element `Backdrop` are in `sessions/scrim.tsx` (the file is `.tsx`; U11a's document says `.ts`), and `Sheet`, `WidgetDialogHost`, `KeyboardShortcuts` and `AddProject` draw their overlay through `Backdrop` | `origin/ux-wave/U11a:src/renderer/src/sessions/scrim.tsx` |
| R12 | `SETTINGS_SECTIONS`, `SettingsSection`, `SECTION_TABLE` and `SETTINGS_ROWS` are exported from `settings-tab/SettingsView.tsx` and `settings-tab/rows.ts`; the search field carries `data-escape-clears`, and the scrolling body keeps the mark `data-settings-body`, which the dialog sets its right inset on. Not built yet (U11a's M9 and M10, which wait for the owner's look) | U11a's document, Interfaces §G |
| R13 | `BUILD_F_ACTION_IDS` is in `src/shared/keymap/build-f.ts`, and `settings.open`, `accounts.open`, `artifacts.open`, `tab.close`, `tab.overview`, `pane.focusOther`, `panel.float` and `main.expandArtifactPane` are among them, all `menu` rows of scope `app` | `origin/ux-wave/U6a:src/shared/keymap/` |
| R14 | `remoteSessionActions(facts)` and `REMOTE_ACTION_COMMAND` are in `app/session-actions.ts`, and `SessionItems` draws a listing with no record through `SessionItem`. U9's executor is building; its fourth milestone holds these *(U7a at merge: Concrete Steps 1 has the check that tells which way M2 is built)* | U9's document, Interfaces §6 and its Decision Log, "the order of a session row's menu, shared with U7a" |
| R15 | `waits(item)` in `src/shared/attention/kinds.ts` replaces `isOpen`, and `selectPendingOf` keeps its name. Not built yet; U7 calls neither | U1a's document, Interfaces §A |
| R16 | The panel host queues an `addTool` made before the layout is read (`pending`, with each entry's queued `opens`) and applies it in `passBarrier`; `applyAdd` and `activateIn` call the store's `openSession` for a target that is not shown | `panel/host.ts` on master; the same on `origin/ux-wave/U8b` |
| R17 | Every side-column tool gets `ctx.visible` from one line of `panel/ToolBody.tsx` (`visible: !collapsed`), and every main-tab artifact editor from one line of `library/ArtifactTab.tsx` (`!panelInMain(regions)`) | both files on master; U8b's M2 and M3 rework the side column around the first |

## Constraints that bind every milestone

1. **Where work and checks happen** (root UC-10; `~/.local/share/maws-ux-wave/briefs/build-common.md`, which binds as written). On the MacBook: edit, commit, push. No `pnpm install`, typecheck, eslint, vitest, build or Electron. Every check runs on the wave's build VM through `vmcheck.sh` (Concrete Steps). An executor starts no Electron e2e, runs no `scripts/ci-gate.sh` and opens no pull request. Every commit message ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution. Master is taken by merge, never by rebase or force-push.
2. **What is stored, build F can still read** (root UC-14). Neither settings file changes. No field is added to a stored tab, to `main.tabs`, to `regions` or to the stored side surfaces, and no version moves. New state has a layout key of its own: `sidebar.hidden` (U7a), `destination` (U7b). The four retired tab kinds are added to the reader's retired list in the change that removes them. Interfaces §G says what F does with each.
3. **Files other children own** (root UC-8). U7 owns `src/renderer/src/sidebar/`, `app/Toolbar.tsx` and `usage/`, and by key `sidebar.hidden`, `destination` and the retired tab kinds in `src/shared/ipc/schema/layout.ts`. Every edit elsewhere is the smallest insertion that carries the behaviour and is listed in Interfaces §J, with its owner. An executor who finds that a further file of another child must change, beyond a fixture's shape, stops and reports it.
4. **The repository is public** (root UC-11). Fixtures, test strings and screenshots use invented ids, titles, paths and names. The rehearsal prints structure and counts and nothing else.
5. **The wave's laws.** Law 3: no setting is added; the one control this child may draw on a row, the Hide button, is built only on the owner's answer (M3, decision 9). Law 5: each item's routes are in Interfaces §K. Law 7: today's tokens and shapes; the ring, the dialog and the page add no token. Law 8: the relaunch that restores what was open (l7-shell-12) stays for every tab that is not one of the four kinds; an executor who finds a `keep` would change stops and reports.
6. **No key changes** (root UC-6). `src/shared/keymap/actions.ts` and `src/main/menu.ts` are not edited by either branch: no row is added, no chord moves, so nothing of U6a's guard for build F (`BUILD_F_ACTION_IDS`, `isRebindable`) is touched.
7. **One meaning of "waiting"** (root UC-1). U7 reads no attention predicate. A hidden session is listed under Needs you because Needs you is not filtered by the hidden set, and for no other reason.
8. **Copy** is in Interfaces §L and is used exactly as written.

## What the code holds today

Checked at `5c9cfa0c5`; F's side read with `git show f1852de3a:<path>`. Listed here is what an executor would not learn from the section alone.

**For U7a.**
- **The title's projection.** `titleOf` in `src/services/index/sessions.ts` is the one place; `promptTitle` first turns command markup into `/name args`, pasted blocks into `[Pasted text #n +L lines]`, and collapses white space to single spaces. The conversation search reads the stored column itself (`s.first_prompt` in `src/services/index/session-search.ts`), so a cut in `titleOf` cannot reach it. Two tests pin a long title (`sessions.test.ts`): "the first prompt seeded at launch" expects eight words, and "a pasted block titles as its placeholder, cut or whole" expects `Review this [Pasted text #1 +3 lines]`, which is seven runs of non-space characters and three words by §A's count.
- **A mention's two forms** come from `mentionText` in `composer/editor/schema.ts`: `@"path"` when the path holds white space, else `@path`; an agent is `@agent-<name>`. The composer's own reader of them (`MENTION_TOKEN`, `composer/editor/recall.ts`) leaves trailing sentence punctuation outside a bare path.
- **A listing's title is not the index's.** A row that is only listed draws `listedTitle(listed)` (`sessions/title.ts`), and the listing's `title` is what the machine's endpoint was told in a `member` frame (`readMember`, `src/endpoint/rl10/members.ts`; `src/endpoint/listings.ts` passes `report.title` on). The desk's web view names a session by the same listing field (`apps/desk-web/src/cards/board.ts`, `sessionName` in `log/projection.ts`). `titleOf` is on neither path (Reported, 2).
- **The first read.** `askUntilAnswered` (`ipc/until-answered.ts`) takes this Mac's snapshot again at each `host.status` until answered. `answer` in `ipc/events.ts` calls its `failed` callback only for a refused request, never for an answer that arrived after the connection went stale. Both `useSessions.loaded` and `useAttention.loaded` become true after a refused first read (`setLoaded` follows `localFirst`, which resolves either way; the attention store's `cancelSnapshot` settles with `loaded: true`), so the skeleton ends and the body draws. `ipc/events.test.ts` already holds a refused first read open ("a local snapshot that fails").
- **The chip.** A `<button>` sizes to its content whatever its display, so the button (`max-w-48`) is wider than its wrapper (`max-w-24`, no clipping) for a long name.
- **A listed row.** `ListedRow.tsx` calls its lane's opener with no request, has no `onAuxClick`, and names a menu only when the session can be shared. `SessionItems` in `sidebar/menus.tsx` answers nothing for an address with no record unless it can be shared. Both openers honour `{ newTab: true }` (`lane-a/remote-connect.ts`, `lane-b/remote-connect.ts`); lane B's also retries a session whose stream ended. `openListed` (`sessions/remote-openers.ts`) passes no request, and `NeedsYou.tsx` skips it for ⌘-click. `openListed` has four other callers (the Overview, its cards, the palette, attention navigation), none of which asks for a new tab.
- **The three dots** are drawn only when `sessionActionsFor(record)` includes Rename (`hasActions` in `SessionRow.tsx`).
- **A turn's start is known for a session MAWS runs and for no other.** The digest's `turnStartedAt` is set by the services' fold for a session MAWS runs (`src/services/sessions/digest.ts`). For every other record the index seeds the digest with `turnStartedAt: null` and `lastTurnEndedAt` set to the transcript's newest record (`digest` in `src/services/index/source.ts`); a terminal session MAWS drives through its bridge adds the phase (`bridgedDigest`: `working`, `waiting`, `idle`) and still no turn start. A record of another machine has no digest; its listing's `state` and `issued` say what is known (`listedStateOf`, `sessions/listed-state.ts`). The section's "a record's turn start" therefore exists on one route of three (Reported, 3). A listing's `issued` says no more: the endpoint signs a new listing whenever any of its fields changes, the title and the owners among them (`#evaluate` and `#sign` in `src/endpoint/listings.ts`), so a newer `busy` listing is not a new turn.
- **A machine being named by the rows is not evidence about its sessions.** `applyRows` (`stores/sessions.ts`) fills `listedMachines` from any rows answer, whether or not the hub's snapshot is `complete` or the machine is among `pending`; `takeRows` (`ipc/events.ts`) waits for both before it marks the machine loaded, and `ipc/events.test.ts` holds that sequence ("keeps the named machine's restored tabs while the rows are incomplete or it is pending…"), with empty rows for a named machine at its start.
- **The sidebar holds its order while the pointer or the keyboard is inside it** (`holding`, `holdOrder` in `Sidebar.tsx`): a row that newly leads is drawn at its old rank until the pointer leaves, unless the sort was changed on purpose. `SessionRow` reads "nested under its lineage parent" from `aria-level >= 3`.
- **`stores/people.ts`**, the pattern the section names, treats a failed read as an empty set and writes at the next toggle, which would replace a stored set with the toggled row alone.
- **Exact menu lists in e2e.** `e2e/shell.spec.ts` (the long shell scene, "Item 1") and `e2e/sessions.spec.ts` ("foreign-live: …", twice) assert a row's menu as an exact list. `e2e/shell.spec.ts` asserts `layout.list`'s keys as an exact list in two places; neither scene hides a session or opens a page.

**For U7b.**
- **A pane mounts only its active tab's body** (`main/Pane.tsx`: one `TabBody`, keyed by the tab). So "everything behind stays mounted" means the tab in front, the side column and the card column; a tab that is not in front is not mounted today either.
- **Hidden regions today are squeezed, not hidden.** A maximized or floating side surface puts the main region at 0 px and `inert` (`shellGeometry`, `Shell.tsx`); a collapsed pane is kept laid out at its last size (`collapsedBody` in `main/Pane.tsx`), which is what keeps a transcript's scroll.
- **The Overview** closes on Esc from a `window` listener that yields to a prevented event, to `[aria-modal="true"]`, to an open menu and to an `inert` or `aria-hidden` ancestor (`overview/OverviewPanel.tsx`); it is mounted inside the main region.
- **A Radix dialog dismisses on Esc from a capture listener on the document**, before any React handler, and prevents the event when it does (`WidgetDialogHost` works around it with `clearsFirst`). Inside Settings, four fields give Esc a meaning of their own without preventing it (`settings-tab/parts.tsx`, `BudgetSettings.tsx`, `McpServersSettings.tsx`, `org/parts.tsx`), one in-place confirmation does too (`SupervisorSettings.tsx`, Stop all), and the shortcut recorder prevents and stops it (`KeymapSection.tsx`, `[data-chord-capture]`).
- **The key dispatcher refuses pane and composer chords under an open dialog** (`OPEN_OVERLAY` in `keymap/dispatcher.ts`: any `[role="dialog"][data-state="open"]`), and never refuses a chord of scope `app`. Menu rows reach the renderer as `layout.action` whatever is focused.
- **The four kinds' callers.** Settings: `settings.open` (`gateway/actions.ts`, whose `SETTINGS_SECTIONS` maps the action's numeric argument to five sections; one caller passes one, `transcript/view/rows/Error.tsx`), and two direct `openTab` calls in `tools/browser/chrome/` (`Chrome.tsx`, `ProfilePopover.tsx`). Customize and Projects: `customize/open.ts` (`openCustomize`, `openDiscover`, `openProjects`) and `selectSection` in `customize/CustomizeView.tsx`. The library: `openArtifacts` (`main/artifacts.ts`), called by the sidebar's row, the `artifacts.open` action, `tools/artifacts/List.tsx` and `panel/summary/Artifacts.tsx`. Each of the three openers calls `revealMain()` first.
- **Types derived from the tab kinds.** `SettingsSection` (`settings-tab/SettingsView.tsx`, `gateway/actions.ts`), the `settingsTab` slot's prop (`app/slots.ts`) and `CustomizeSection` (`customize/open.ts`) are each `Extract<TabRef, …>`. `UNPINNABLE_KINDS` holds exactly the four.
- **Who brings a tab or a side surface forward without the person.** Four listeners: an agent's `show_pane` (`connectPaneShows` in `tools/maws/panes/connect.ts`: `openFile`, `openSession` for a terminal, and `panelHost.addTool(…, { activate: true })`, two of those calls after an await); the Browser following an agent that acts in it (`browser.agent.acting` in `tools/browser/agent/connect.ts`); MAWS's ask sheet (`tools/maws/ask/connect.ts`); a mod's pane (`engine-surface/panes.ts`). The first three reach `addTool` with `activate: true`, which opens the target's session when it is not the one shown, and which before the layout is read is queued and applied later (R16). The fourth selects a tab only for a session it finds shown (Reported, 5; §F, "Not the person's act").
- **Who asks whether something is on screen.** Eight readers, each with its own rule, none of which knows a page: §N lists them.
- **Two pages carry their own name.** `customize/CustomizeView.tsx` draws `<h1>Customize</h1>` in its header row, and `projects/ProjectsView.tsx` draws `<h1>Projects</h1>`; the library has no heading of its name. Three cases of `customize/CustomizeView.test.tsx` find the header through that heading, and `e2e/ux2-shell.spec.ts` asserts that the heading, the section tabs and the Project select stand in one row.
- **Build F can write the very shape U13a calls canonical.** F keeps a tab of no session in the set it shows (`openTab` in `stores/layout-model.ts` at `f1852de3a`), and its first-launch value is one set under `none`. So a strip of Diagnostics alone, to which F adds a Settings tab, is stored by F with `current` `none` and the one key `none`.
- **The usage popover reopens itself** after an account action's confirmation (`ask` in `usage/controls.ts`), and `UsagePanel`'s root sets its own width from the popover's variables. `usage/UsagePill.test.tsx` holds twenty-three tests, twenty-one of them of the panel and its actions.
- **F's main keeps every top-level key.** `LayoutFileStore` reads the whole file into a map and writes the whole map (`src/main/layout/store.ts`; `git diff f1852de3a 5c9cfa0c5 -- src/main/layout/` is empty). F's renderer cannot ask for a key outside its `LayoutKeySchema`, and uses `layout.list` only to find `panel.<id>` keys and to skip reads of keys that are absent.
- **Tests that pin today's tabs**, beyond the section's list: `gateway/actions.test.ts`, `shell/transfer.test.ts`, `shell/floating.test.ts`, `main/editor-host.test.tsx`, `main/TabStrip.overflow.test.tsx`, `keymap/shell-navigation.test.tsx`, `app/Shell.test.tsx`, `app/Shell.chrome.test.tsx`, `app/shell-geometry.test.ts`, `tools/browser/chrome/ActionBar.test.tsx`, `ProfilePopover.test.tsx`, `panel/summary/Summary.test.tsx`, `transcript/view/rows/rows.test.tsx`, `settings-tab/SettingsView.test.tsx`, `customize/CustomizeView.test.tsx`, `src/shared/ipc/schema/layout.test.ts`, `src/shared/ipc/schema.test.ts`, `src/shared/browser/tab.test.ts`, `src/main/browser/extensions/register.test.ts`. The e2e scenes are in M8.

## Reported to the architect, and ruled

Thirteen points were reported at authoring, each with a default written into one named place. The architect ruled on all of them on 2026-11-13, with the review's findings; the document is written to the rulings, and a later ruling still changes only the place named.

| # | what | the ruling | the one place |
|---|---|---|---|
| 1 | **U7a and U9 in the sidebar's files.** Root UC-8 had U9 land first with the listed row's menu. | Neither order is imposed. Both landings build to §C's order of a row's menu, and whichever lands second merges. A2's and A3's halves for a listed row stay in U7a either way. | M2, decision 1, written both ways; Concrete Steps 1 has the check that tells which |
| 2 | **S-11 does not reach a row that is only listed, nor the desk.** A listing's title comes from the `member` frame, which the index does not write. | Accepted: no second cut in the window. Once U9 is on a machine, the listing of a session MAWS runs there carries its record's title (U9's listing rule), so the six words reach that listed row through the record; a terminal session's listing keeps the title its member frame states. | Interfaces §K, S-11's row |
| 3 | **A terminal session has no turn start.** O-16's "a record's turn start" has no datum for a session MAWS does not run. | Replaced, with the review's finding on a listing's `issued`, by one rule: a turn of the session began after the hide, and where no datum says when a turn began, the window must have seen it not working since the hide before it counts it as working again. The child's sentence is amended by the architect. | Interfaces §E, "When a hidden session returns" |
| 4 | **Insertions root UC-8 does not list.** | Accepted, with the additions of points 5 and 8; the architect adds them to UC-8. | Interfaces §J; each row can be struck alone |
| 5 | **An agent's pane would close the page.** UC-12 closes both for "any act of the person's"; U13a's table lands every activating open through `commitShown`, whoever calls. | Accepted as repaired by the review: `quietly(run)` holds only for what runs synchronously inside it; wherever an open is deferred between the request and the commit, who asked travels as data with the request and is applied at the commit. | Interfaces §F, "Not the person's act"; M6, decision 5 |
| 6 | **A side-surface key on a page.** | The default stands: it leaves the page first. It is also one of the four questions for the owner. | M6, decision 6 |
| 7 | **A page stored before a stay on F.** | Accepted as corrected: a retired Settings tab in front suppresses the stored page; the stored form's shape is a test of shape and not of who wrote it, and a legal one-set layout left by F with no retired tab in front may restore the page, which the person leaves with Back. No witness and no marker is added. | Interfaces §F, "At hydration"; §G |
| 8 | **A7's "as they were" needs the main area to keep its box,** and the section does not say whether the session behind a page is on screen. | Accepted: the main area and the card column keep their box; the side column is not drawn while a page shows and comes back unchanged, with nothing written (the ruling on the drawn example); behind a page no session is on screen, behind the dialog every session is. The list of readers is finished here, so that M5's executor discovers none. | M5, decisions 2 to 4; Interfaces §N |
| 9 | **The page's name is drawn twice.** `CustomizeView` has its own heading "Customize". | Changed: U7b removes Customize's own heading, in the insertion it already makes in that file. | M6, decision 9 |
| 10 | **View › Usage under the Settings dialog** would open a popover the modal dialog covers. | Accepted: while the dialog is open the action shows Settings › Usage. | M7, decision 5 |
| 11 | **Claude Desktop's dialog has a second size** (up to 1280 by 960 on a large window, `readable/app-5.1231.2/web/app/v1/shared-61-2ybPsRVk.js:6183-6185`). | Accepted; nothing changes: MAWS takes its own box (law 7). | §M |
| 12 | **A typed `@word` at a prompt's start is taken off as a mention.** | Accepted. | Interfaces §A |
| 13 | **Scenes whose premise goes.** | Accepted, with `e2e/browser-chrome.spec.ts` added. | M8's table |

Nine further points were handed back with revision 2 and accepted by the architect as written, among them: `projects/ProjectsView.tsx`'s own `<h1>Projects</h1>` goes with Customize's (M6, decision 9); Hide stays its own menu item; the stored entry is `{ at, armedAt }`; what `afterLook` does beyond the ruling's sentences, its limit included; `cardColumnShown` asked twice; `startMarkup` leaves a page first; `pageAtStart`. The drawn example then showed nineteen things the document said wrongly or not at all; the architect's rulings on them are written in where they apply (M3, M5, M7, §C, §D, §H, §L, §M, §N, "What the owner should look at") and listed in the Decision Log.

## Plan of Work

Eight milestones in two landings, one executor each, a review at each boundary. Every milestone leaves the branch green on the VM: the tests it changes are changed in it.

Terms used below. **The strip:** the one set of open main tabs (U13a). **The tab in front:** the active tab of the focused pane. **A listed row:** a sidebar row of a session on another machine of which this Mac holds only the listing (`ListedSession`) and no record. **A page:** an open destination. **The dialog:** the Settings dialog. **The layout store:** `stores/layout.ts`. **The hidden store:** `stores/hidden.ts` (M3). **A layer:** a sheet, dialog, menu or popover opened over something. **The controller:** the plan-executor that runs the milestones, reviews each at its boundary and is this document's one writer while they run. **The VM:** the wave's build machine, reached through `vmcheck.sh`. **Class 1a:** typecheck, lint, the unit suite and the probes on GitHub Actions. **The peer:** the other build in the two-build e2e group; here it is F.

Expected size, lines added plus removed: M1 about 350; M2 about 350; M3 about 1,000, and about 150 more with the row's button; M4 about 450. M5 about 1,300; M6 about 1,500, of which about 500 are tests deleted or changed with the tab kinds; M7 about 1,000, of which about 600 are the panel's tests moved; M8 about 1,500, nearly all e2e.

**Landing U7a: M1 to M4, on `ux-wave/U7`, from today's master.**

### M1 — Three small fixes: six words, "reconnecting", the chip's box

**What exists at its end.** A session with no title is named by the first six words of its first prompt, 60 characters at most, after the mentions at its start; the search over conversations still matches the whole prompt. While a read of this Mac's sessions has been refused and none has succeeded, the Projects heading carries the word "reconnecting" and "No projects yet" is not drawn. The project chip's button is never wider than its 96 px wrapper.

**What it touches.** `src/services/index/sessions.ts` and its test; `src/renderer/src/stores/sessions.ts`, `ipc/events.ts`, `sidebar/Sidebar.tsx`, `sidebar/SectionHeading.tsx` and their tests (`ipc/events.test.ts`, `sidebar/Sidebar.test.tsx`); `app/Toolbar.tsx`.

**Interfaces.** Exposes §A and §B. Consumes nothing.

**Decisions.**
1. *The cut is the last step of `titleOf`, and `promptTitle` keeps its meaning* (§A). Its tests stay as they are; of the two that pin a long title, the one with eight words then expects six, and the placeholder's stays as it is, by §A's second step.
2. *O-03 comes first and alone in its commit,* so that it can be taken out as a pull request of its own. The button's box is bounded by its wrapper (`max-w-full` in place of `max-w-48`) and the wrapper clips. The tooltip keeps the full name. No unit test: jsdom lays nothing out, and a test of two class names restates the edit; its proof is M4's scene.
3. *The word is a state of the sessions store, set where the read is refused* (§B). It is set only by a refused request of the three record reads of this Mac (`session.list`, `session.projects.list`, `session.digests`), through the `failed` callback `answer` already has, and cleared when all three have applied. A reply that arrives after the connection went stale sets nothing. Pitfall (the section's): "this Mac is not loaded yet" is not the condition, because an ordinary start has an awaited step between the skeleton's end and the mark.
4. *The word is drawn beside the heading, not in it,* as `SectionHeading`'s controls are, so that the heading's name stays "Projects"; it is a `role="status"` element in the muted text colour, not in capitals, and reads `RECONNECTING` from `sidebar/NeedsYou.tsx`.
5. *What the person can do meanwhile.* Everything: the rows events have delivered open as usual. Nothing times out; the read is asked again at each `host.status`, as today.

**What it does not touch.** How or when a title is generated. A listing's title (Reported, 2). `ProjectChip`'s click, menu and what it names (U13a's). The skeleton's rule.

**What it proves.** A1's unit half, A4, and A5's code. Its tests pin: thirty words give the first six; a prompt of one 80-character word is cut to 59 characters and "…"; a surrogate pair at the cut is kept whole; `@"my notes/plan.md" @src/app.ts, tidy the imports in both files please` gives "tidy the imports in both files"; a prompt that is only those two mentions gives "plan.md, app.ts"; `@agent-reviewer look at this` keeps all its words; `Review this [Pasted text #1 +3 lines] and the two files beside it now` gives "Review this [Pasted text #1 +3 lines] and the two"; a rename, the engine's title and a generated title are returned uncut; the conversation search finds the session by its thirtieth word. For #407, with the sequence held open in `ipc/events.test.ts`: the three reads refused, then the state is true and stays true through a second refusal, then false once a snapshot applied; on a start whose first reads answer, a subscriber to the store never sees it true; a reply after disconnect sets nothing. In `Sidebar.test.tsx`: with the state true and two records delivered by events, both rows are drawn, the word is drawn, and with no project "No projects yet" is not; with the state false the word is absent.

### M2 — A listed session opens like a local one

**What exists at its end.** A listed row has a menu and three dots. Its menu offers Open and Open in new tab, then Share and Add owner where it has them; ⌘-click and middle-click open it in a tab of its own; a plain click and Enter are as before. A Needs you row's ⌘-click on a listed session goes through the lane's opener.

**What it touches.** `src/renderer/src/sessions/remote-openers.ts`, `sidebar/ListedRow.tsx`, `sidebar/menus.tsx`, `sidebar/NeedsYou.tsx`, `sidebar/SessionRow.tsx` (the three dots), and `sidebar/Sidebar.test.tsx`, `sidebar/HoverCard.test.tsx` where a listed row's menu is pinned. Where U9's menu is on master (decision 1, the second way), also the `record: false` case of `remoteSessionActions` in `app/session-actions.ts`, which is U9's file and the extension U9's document names.

**Interfaces.** Exposes §C. Consumes nothing.

**Decisions.**
1. *The listed row's menu, in whichever of two ways master calls for* (Reported, 1). Its order is §C's in both, and A3 is proved the same way in both. Concrete Steps 1 has the check that tells which.
   - *Master holds no `remoteSessionActions`* (U9 is not on master yet): M2 gives `SessionItems` its branch for an address with a listing and no record, drawing Open and Open in new tab, then Share and Add owner where the row has them, and `ListedRow` names its menu always. U9, landing second, draws its acts for a listing between "Open in new tab" and Hide.
   - *Master holds it* (U9 landed first): the branch and `data-menu` exist. M2 extends the `record: false` case as U9's document says, putting `open` and `openInNewTab` at its head, and gives the two a listing's meaning where `SessionItems` draws them for an address with no record.
   - *In both:* for a listing with no record the two opens call `openListed`, with and without the new-tab request, and never the session actions' handlers: those run the layout store's `openSession`, which skips the lane's opener and its retry.
2. *Every way of opening a listed session passes its lane's opener.* `openListed` takes the request; Needs you passes it for ⌘-click and middle-click. Where a lane has no opener the two items are drawn disabled with "Not available here", and a click selects the row and shows its card, as today.
3. *The three dots show on every session row,* local and listed (the age gives them its slot on hover, as today for a row that can be renamed). M3 needs this, and M2 already has an item for every row.
4. *A Needs you row keeps no menu for a listed session.* The section gives Hide and the opens to the tree's rows.

**What it does not touch.** Open in split for a listed row. The openers themselves. U9's acts for a session on another machine, and `app/session-actions.ts` beyond the one case named above. The title bar's session menu.

**What it proves.** A3. Its tests pin, in `Sidebar.test.tsx`'s block "listed rows from another machine": the context menu of a listed row lists Open, Open in new tab; each calls the opener, the second with `{ newTab: true }`; ⌘-click and a middle click call it with `{ newTab: true }`; with no opener registered both items are disabled and titled "Not available here", and a click still selects the row. The existing case "…opening nothing and offering no menu" changes to that. A Needs you row's ⌘-click on a listed session calls the opener with `{ newTab: true }` and no longer calls the store's `openSession` (fails before, passes after).

### M3 — Hide a session, and get it back

**What exists at its end.** Hide is in every session row's menu and takes the row out of its project's list at once. "Hidden · N" at the project's end, with a chevron that says whether it is open, opens to the hidden rows, indented under it, each with Unhide. Unhide puts the session at the head of the list. A hidden session returns by itself when it starts a turn. Hidden rows stay hidden across a relaunch. If the owner has answered question 1 with the button: a session row under the pointer or holding focus also shows a Hide button, and one click hides it.

**What it touches.** `src/shared/ipc/schema/layout.ts` (one schema, one key); a new `src/renderer/src/stores/hidden.ts` and its test; `sidebar/derive.ts`, `sidebar/tree.ts`, `sidebar/Sidebar.tsx`, `sidebar/ProjectRow.tsx`, `sidebar/SessionRow.tsx`, `sidebar/ListedRow.tsx`, `sidebar/menus.tsx` and a new `sidebar/menus.test.ts`, `sidebar/copy.ts` and their tests; the mount of the store's connection beside `usePeople`'s first load; `src/main/layout/store.test.ts` (one case).

**Interfaces.** Exposes §D and §E. Consumes §C (the listed row's menu).

**Decisions.**
1. *A store of its own, after `stores/people.ts`, with one difference:* a read that failed is not an empty set. Until a read has answered nothing is written, the acts of the run are kept and drawn, and the read is asked again at the next act (§E). Otherwise one refused read followed by one Hide would replace the stored set with one entry.
2. *Hidden is applied after ranking and before the caps,* in one pure function (`splitHidden`, §D), so a hidden session counts in its project's marks and rollups, is found by the sidebar's search (a search draws every match in place and no Hidden row), and is absent from the five and the eight. A project whose sessions are all hidden still has its row.
3. *The Hidden row is a tree node of its own kind, and says whether it is open* (§D). It stays aligned with "Show more", carries a small chevron after its count (right when closed, down when open) and `aria-expanded`. It is open for the run only and closes when its project closes. The rows under it are ordinary rows one level deeper, indented one step so that they read as its contents and not as more sessions of the project. `SessionRow` takes "nested under its lineage parent" as a prop instead of reading it from the level, and both row kinds take the indent as a prop of its own.
4. *Hide and Unhide are items of the row's menu, not session actions, and stand where §C puts them.* In the menu of a session with a record, directly after Pin: both arrange the list. Where a menu has no Pin, after its opening items. So Archive, "Delete conversation…" and "Remove worktree…" keep the end of the record's actions, and nothing of this child is drawn under them. In the menu of a listing with no record, after U9's acts and before Share. One pure function places it (`withHide`, §C), so that the one line of `SessionItems` that maps a record's actions, which U9 also edits to pass `mine`, changes in one word for each. They do not appear in the title bar's session menu. This holds in both ways of M2's decision 1: where U9's `remoteSessionActions` draws a listing's menu, Hide is still its own item, after that list's items.
5. *An act of Hide or Unhide settles the sidebar's held order at once,* as a change of the sort does: without it an unhidden row would stand at its old rank until the pointer left the sidebar.
6. *Where the keyboard goes.* After Hide: to the row that took the hidden row's place, else to the Hidden row. After Unhide: to the unhidden row, at the list's head. The tab stop is never left on a row that is gone.
7. *When a hidden session returns is one pure function of an entry and a look* (`afterLook`, §E; the architect's ruling on Reported, 3). The store only gathers the look and applies the answer, so every case is a row of a table test, and a store test proves the wiring once per route.
8. *An entry of another machine's session is never dropped because the session is absent* (the review's first finding). The rows naming a machine say nothing certain about its sessions, at a start least of all. The key is bounded by count instead (§E, "The bound").
9. *The row's own button is one further step, built on the owner's answer* (question 1 of "What the owner should look at", put with the button recommended, in the owner's words "hide a session with one click"). The menu item is built in both answers; everything above is. The step, when the answer is the button: a 22 px control left of the three dots, shown while the pointer is over the row or focus is inside it, on every session row and listed row of the tree and on no other row; its label and tooltip are "Hide", and in the Hidden list "Unhide"; one click or Enter does what the menu item does, with decision 6's focus. While it shows, the title gives it 27 px, and the age's slot and the unread target do not move. If the answer has not arrived when M3 is otherwise done, M3 closes without the button and M4's scenes cover the menu; the button then follows as one commit with its scene (M4, decision 1). If the answer is the menu only, the step is not built.

**What it does not touch.** `stores/layout.ts`. Needs you and every attention reader. The Resume picker, the palette, the Overview. Archive. A project's "Remove from sidebar". Any call to another machine: Hide sends nothing.

**What it proves.** A2. Its tests pin, in `stores/hidden.test.ts`: a hide is written once, 250 ms later, in §E's stored shape, armed when the session was not working and unarmed when it was; with the first read held open, a hide is drawn at once, and when the read answers with another entry both are kept and written; with the read refused, a hide is drawn and nothing is written, and the next act reads again. The table test of `afterLook`, one row each: hidden at rest, then a turn; hidden in the middle of a turn, the turn goes on, it ends, the next begins; a listing re-issued for a rename while `busy`, for an entry hidden mid-turn and for one hidden at rest; the first look of a run for an armed and for an unarmed entry, each finding the session working and at rest; a `foreign` record hidden with its newest transcript record ten minutes old, and one hidden thirty seconds after a record; a session MAWS runs whose turn start is later than the hide, and one whose turn start is earlier. The wiring, once per route: a record MAWS runs, a bridged terminal record, a `foreign` record, a listing, and an address with neither digest nor listing, which is left as it is. Arming is stored: an entry hidden mid-turn and then seen at rest is written with its `armedAt`. The drop rule: this Mac's entry goes when this Mac is loaded and holds no record at the address, and not before; `ipc/events.test.ts`'s sequence for another machine (rows incomplete and empty, then the machine pending, then complete without the session) leaves every entry of that machine. The bound: 501 entries are written as 500, the oldest of another machine's gone, and this Mac's oldest only when no other is left. In `derive.test.ts`: `splitHidden` keeps rank order among the shown and orders the hidden by newest activity; six sessions with one hidden show five and no "Show more". In `sidebar/menus.test.ts`: `withHide` puts Hide after Pin; after Open in new tab for a session a terminal holds; after Attach in a terminal tab for a job; and for a record of another machine after Pin, or after Open in split where it has no Pin. In `Sidebar.test.tsx`: Hide from the three dots and from the context menu, for a local record, a record at another machine's address and a listed row; in a local record's menu Hide is the item after Pin and "Delete conversation…" is followed by no item of this child; the Hidden row has `aria-expanded` false, then true, and its rows carry the indent; "Hidden · 2" after "Show more"; the arrow keys reach it, Enter opens it, ArrowLeft from a hidden row lands on it; Unhide puts the row first while the pointer is still inside the sidebar; a hidden session with a pending request is under Needs you; a hidden pinned session is under Hidden and pinned first again after Unhide; a search lists a hidden session in place. With the button built: it is drawn on a hovered or focused session row and listed row, labelled "Hide", and in the Hidden list "Unhide"; a click hides without opening the session; it is absent from a project's row, "Show more", the Hidden row and a Needs you row. In `src/main/layout/store.test.ts`: a file that holds `sidebar.hidden` keeps it, value equal, through a `set` of another key (the property F's main has, held on the same code).

### M4 — U7a's e2e scenes, the record, and the acceptance run

**What exists at its end.** The e2e specs say what the build now does. S-11's reversed ruling is amended where it stands. The branch has passed typecheck, lint and the unit suite on the VM, and the hand-over for the runs an executor does not start is written into Progress.

**What it touches.** `e2e/shell.spec.ts`, `e2e/sessions.spec.ts`, `e2e/remote.spec.ts`, `e2e/cross-build.spec.ts`, and with the row's button `e2e/ux1-sidebar.spec.ts`; `docs/charter.md`, `docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md`; this document's Progress.

**Decisions.**
1. *Scenes written* (the group each belongs to and what a failure means are in "Proof that an executor does not run"):
   - `e2e/shell.spec.ts`, new: **"a long project name stays inside the chip's box"**. A stub scenario copied to a temporary file with one project renamed to an invented name of forty characters; a session of it in front. Asserts: the chip's right edge is not past the strip's left edge; the chip is at most 96 px wide; its name is truncated (its scroll width exceeds its client width); its tooltip holds the whole name.
   - `e2e/shell.spec.ts`, new: **"hide and unhide"**. On the stub scenario: Hide from a row's context menu; the row is gone and "Hidden · 1" is the project's last row, closed; a click opens it, and the hidden row is indented under it; a relaunch shows the same; open it, Unhide; the row is the project's first; `layout.json` holds `sidebar.hidden` with no entry.
   - `e2e/shell.spec.ts`, changed: the long shell scene's exact menu list for a foreign-live row gains "Hide" after "Open in new tab", where it is the last item.
   - `e2e/sessions.spec.ts`, changed: the two exact menu lists of "foreign-live: …" gain "Hide" after their opening items, which is last in both.
   - With the row's button (M3, decision 9), in the same commit as the button, whenever that is: "hide and unhide" gains a step in which the row's button hides with one click and the Hidden list's button unhides; and `e2e/ux1-sidebar.spec.ts`'s "UX1: titles keep their width on hover…" changes its measure, since a hovered row's title now gives 27 px to the button and nothing else: the age's slot and the unread target stand where they stood.
   - `e2e/remote.spec.ts`, new step in the scene that opens a listed row: its context menu holds Open, Open in new tab and Hide; ⌘-click adds a tab of its own, which comes to the front as a local row's ⌘-click does (both lanes' openers call `openTab`, which activates); Hide puts the row under "Hidden · 1" and the tab stays.
   - `e2e/cross-build.spec.ts`, new: ***(sidebar, both ways)***, skipped unless the peer's `src/shared/ipc/schema/layout.ts` does not name `sidebar.hidden`. This build hides the seeded session and quits. The peer opens the profile: it draws the session's row in its project; none of its console messages says "[layout] … is not a valid value"; it folds its sidebar, and `layout.json` then still holds `sidebar.hidden` with the same entry. This build opens the profile again: the row is under "Hidden · 1" and the sidebar is folded.
2. *The coverage row this landing adds* to the cross-build table U13a began:

   | stored | F reads this build's value, and writes on | this build reads F's value |
   |---|---|---|
   | `sidebar.hidden` | *(sidebar, both ways)*: F draws the session it does not know to be hidden, and the key is in the file F wrote after its act | the return of the same scene: the row under Hidden. F never writes the key |

3. *The record* (root UC-10; the section, "Rulings reversed"). S-11's sentence is added, dated, where W11's I1 stands in `docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md` and as a new entry at the end of the charter's §19 Decision log. The earlier words stay.

**What it does not touch.** Product code, unless a scene shows a defect; then the fix goes to the milestone's owner through the controller. The register and the board.

**What it proves.** It writes the e2e halves of A2, A3 and A5; they are proved when the architect's runs are green. By its own run: typecheck (which covers `e2e/`), lint and the unit suite pass.

**Landing U7b: M5 to M8, on `ux-wave/U7b`.** Not started before the re-check pass. Its base is a master that holds U7a and U13a.

### M5 — The page and the dialog exist beside the tabs

**What exists at its end.** The layout store holds one destination and the dialog's state, with their acts; a page and the Settings dialog can be opened from a test, and behave whole: what is drawn and what is not, Esc and ⌘W, where the keyboard returns, what an act that shows a tab closes, what a relaunch brings back. No control of the app opens either yet, and the four kinds are still tabs.

**What it touches.** `src/shared/ipc/schema/layout.ts` (additions); `stores/layout.ts`; a new directory `src/renderer/src/destination/` (`DestinationPage.tsx`, `SettingsDialog.tsx`, `escape.ts`, `copy.ts` and tests); `app/Shell.tsx`, `app/shell-view.ts`, `app/Toolbar.tsx`, `app/shell-actions.ts`, `keymap/actions-runtime.ts`, `sidebar/Sidebar.tsx` (which row is current, and that no session row is selected under a page); the eight readers of §N (`session/visibility.ts`, `attention/navigation.ts`, `app/plugin-toasts.ts`, `panel/ToolBody.tsx`, `library/ArtifactTab.tsx`, `tools/browser/covering.ts`, `engine-surface/panes.ts`, `tools/browser/agent/connect.ts`) and the test beside each; `stores/layout-persist.test.ts`.

**Interfaces.** Exposes §F, §G's `destination` row and §H. Consumes U13a's `commitShown`, `stripOf`, `storedMain`, `frontOf` (R1 to R3); U8b's `cardColumnNow` if it is on master (R8); U11a's `Backdrop` if it is on master (R11).

**Decisions.**
1. *The state and its acts* are §F, in the layout store, each change one store write. `commitShown` gains its effect here: in the write that lands the strip, it also clears the page and closes the dialog, unless it runs inside `quietly`.
2. *Mounting and layout: a page takes everything right of the sidebar* (Reported, 8; the ruling on the drawn example). While a page shows, three things are off screen by one mechanism: the main area's content, the card column and the side column are each mounted, invisible and `inert`. None is unmounted, set to `display: none` or squeezed to 0 px, and the grid's column tracks stay as they were, so the main area and the card column keep their box and with it their scroll. The side column's box does not matter: it is not drawn, the title bar spans to the window's right edge over its top, the banner row spans with it, and the page is drawn over the rest of it. Nothing of the side column is written: `regions`, the stored side surfaces and each session's tabs are equal by reference before the page opens and after Back, and Back shows the tabs and the side column exactly as they were. The one piece of layout that reads the page is that span of the title bar and the banner row; `shellGeometry`, `Shell`'s conditional mount of the card column and the padding it gives the main area do not. The Overview's layer is not among what is hidden: it is drawn over the page.
3. *The logical answer: behind a page nothing is on screen.* It is kept apart from decision 2. One selector says it, `pageOpen(state)` (§F), and the eight readers of §N each answer "not on screen" while it holds; §N names each reader, its owner, its change and its regression test, and the readers that ask only which session is in front and do not change. An executor who finds a ninth stops and reports it. The in-app browser's native views yield through `holdCover()`, held for as long as a page is open. Behind the dialog nothing of this applies: every session stays on screen, by the section, and the native views yield as under any dialog.
4. *The card column reads both, in different places.* Whether its place is kept (its mount, and the main area's padding beside it) is decision 2: `Shell` computes it without the page. Whether it is drawn and whether it counts as shown is decision 3. If U8b is on master, `cardColumnNow` sets `pageOpen` from `pageOpen(state)`, so that `useCardColumn`, `useCardColumnShown` (U4's card), the Session cards icon and `toggleSessionCards` say "not shown", and `Shell` asks the pure `cardColumnShown` a second time with `pageOpen: false` for the mount and the padding; while the two differ the column is mounted, invisible and `inert`. That changes one expectation of U8b's M4 test ("the column is not drawn" becomes "is not drawn and keeps its place"). If U8b is not on master, `Shell`'s own condition is the box and decision 2 hides it; U8b sets `pageOpen` when it merges (§I). The side column's gate is in `Shell.tsx` and is decision 2.
5. *The title bar in page mode* spans to the window's right edge. At its left, after the sidebar and Overview buttons: Back and the page's name. At its right end: the ring. The chip, the "+", the surface icons and the session menu are not drawn. The two slots the strips are mounted in stay mounted and hidden, so that a strip keeps its scroll.
6. *Esc* is §H's table. For the dialog it is decided in `onEscapeKeyDown`, because Radix dismisses before any handler inside can speak; for the page, in a `window` listener as the Overview has. Both ask one function, `escapeTaker(target)`.
7. *⌘W* is one line in the `tab.close` handler: `closeFront()` first, the tab only when it answered false.
8. *Where the keyboard returns.* The dialog: to the element that had it at the open, through `useDialogFocus`, which already leaves focus alone when the closing act moved it. A page: to the element that had it at the open if it is still connected and not inert, else to the focused pane (`focusPaneElement`). A page that was left for a tab gives the keyboard to that tab's pane.
9. *The dialog's frame.* Radix `Dialog`, modal. The box is `WIDGET_DIALOG_BOX.library`: 960 px wide, at most 800 px tall and never more than 85 percent of the window's height, which is 697 px at the default window. Its edge and shadow are the library dialog's (the rounded corner, the strong border, the composer's shadow). It has no padding of its own: U11a's one-line measure needs the width. Its title "Settings" is for assistive technology only; the index carries the word. Close is a 22 px button, 6 px in from the top and the right edge, outside the scrolling body. Nothing passes under it: the dialog gives the scrolling body (`[data-settings-body]`) a right inset of 30 px, set from the dialog's own element with no edit in U11's file, so that a right-aligned control ends left of Close's box at every scroll position and at every width; at the full box that leaves the body its 760 px (148 for the index, 20, 760, 30). The backdrop is `Backdrop` when U11a is on master, else the class the app's dialogs have today (§I); a sheet over the dialog follows U11a's rule, one painted backdrop. It is mounted once at the shell and draws the `settingsTab` slot's component with the state's section.
10. *What a relaunch brings back* is §F, "At hydration". The dialog is never stored.
11. *New chat's late arrival.* `placeOf` (§F) replaces `frontOf` in the arrival rule's comparison, so that a chat which arrives after the person opened a page or the dialog is added unselected and takes neither away. `closeEmptyChat` keeps `frontOf`.

**What it does not touch.** `TabRefSchema` and every `kind: 'settings' | 'customize' | 'projects' | 'artifacts'`. The openers. The usage pill. `src/shared/keymap/`, `src/main/menu.ts`.

**What it proves.** A7, A9 and A10 as component tests (§H says which), and the store's half of A8. Its tests pin, in `stores/layout.test.ts`: every row of U13a's §C table, now with an effect: each action in its upper rows closes an open page and an open dialog in the same write, and `focusPane`, `openTab` with `activate: false`, `closeTab`, `togglePinned`, `setSplitRatio`, `dropSession` and `refreshTabTitles` close neither; `openDestination` closes the dialog and leaves the strip equal by reference; the same kind again changes only its fields; `closeDestination` and `closeSettings` leave the strip equal by reference; `closeFront` closes the dialog and keeps the page, then closes the page, then answers false; `setOverviewOpen(true)` closes the dialog and keeps the page; inside `quietly` an activating `openTab` closes neither. With a chat's creation held open: a page opened during the wait stays, and the chat arrives unselected; a chat asked for from a page that is still open when it arrives is selected and closes the page. With a split and a page open (A10): `pane.focusOther`, `panel.float` when it docks the card, and `main.expandArtifactPane` each close the page and leave the other pane's tab in front. In `stores/layout-persist.test.ts`: a page opened is written as `{ version: 1, destination }`, closed deletes the key; the lines of "At hydration". In the destination tests: §H's cases. For decision 2, in `app/Shell.test.tsx`: with a session in front, the card column drawn and a side surface open, opening a page leaves the main area's element, the card column's and the side column's mounted (the same nodes), each invisible and `inert`, the grid's columns and the main area's padding unchanged, and the title bar spanning every column; `regions`, the stored side surfaces and the session's side tabs are the same objects before the page and after Back, and no `layout.set` goes out for them; Back restores all three without a remount. For the dialog: the body's right inset is 30 px and Close's box lies wholly inside it. For decision 3: §N's test of each reader.

### M6 — The cutover: every way in, and the four tab kinds retire

**What exists at its end.** The gear, ⌘, and MAWS › Settings… open the dialog; the sidebar's Projects, Artifacts and Customize rows, View › Artifacts and every link inside the app open a page or the dialog by what they opened before. No tab of the four kinds can exist; one stored by an earlier build is dropped at read, and where it was the tab in front its page opens.

**What it touches.** `src/shared/ipc/schema/layout.ts`; `stores/layout-model.ts`; `main/Pane.tsx`, `main/Tab.tsx`, `main/artifacts.ts`; `app/Toolbar.tsx` (`toolbarTitle`), `app/slots.ts`; `gateway/actions.ts`; `customize/open.ts`, `customize/CustomizeView.tsx`, `projects/ProjectsView.tsx`; `tools/browser/chrome/Chrome.tsx`, `ProfilePopover.tsx`; `panel/host.ts`, `tools/maws/panes/connect.ts`, `tools/browser/agent/connect.ts`, `tools/maws/ask/connect.ts`, `engine-surface/panes.ts`; `panel/SurfaceRow.tsx`, `markup/session.ts`; `settings-tab/SettingsView.tsx` (the type's home, §I), `settings-tab/SupervisorSettings.tsx` (one attribute); `test/layout/rehearsal.ts` and its test; the unit tests of "What the code holds today".

**Interfaces.** Consumes §F and §H. Exposes §G's retired kinds, `retiredFront` and `pageAtStart`, and the host's `asked` option (§F).

**Decisions.** *Built as two commits, each green* (the review's second short point): first every way in is switched (decisions 1, 5, 6, 7 and 9) while the four kinds are still tab kinds that render: after it nothing in the app opens such a tab, and a stored one still draws; then the four kinds are retired (decisions 2 to 4 and the tests of decision 8). The milestone stays one, with one review.

1. *Every way in* is §J's second table. The three openers keep their names and signatures and stop calling `revealMain()`: a page covers the side column whatever its state, and Back must find it as it was.
2. *The schema.* The four schemas leave `TabRefSchema` and `TabRefV2Schema`, their cases leave `tabId`, `UNPINNABLE_KINDS` goes with its readers, and the four names join `RETIRED_KINDS`. A retired kind is dropped without a warning, as the Overview's is. `SettingsSection` and `CustomizeSection` stop being derived from a tab (§I).
3. *A8.* `retiredFront(raw)` (§G) reads the stored value before the drop and answers a page, `'settings'` or null; `pageAtStart` (§G) is hydration's choice among the retired tab in front, the stored page and none (§F, "At hydration", rules 3 to 5), pure and in the shared schema file so that the store and the rehearsal run the same code. The reader's existing rule names the tab in front of a pane whose active tab was dropped. A dropped Settings tab opens nothing, and a stored page is not restored over it.
4. *The rehearsal learns the retirement, and has an expectation of its own* (§G, "The rehearsal"; the review's sixth finding). Per file it counts the tabs of the four kinds that were open and in the closed history, reads which kind was in front with a reader of its own, written in `test/layout/rehearsal.ts` and sharing no code with `retiredFront`, and compares the page that reader expects with the page `pageAtStart` answers. A difference is the outcome `destination-mismatch`. `pageAtStart` joins the converters the rehearsal takes as an argument, so that its test can hand in a broken one. It still prints nothing read from a file.
5. *What an agent or a mod asks for is not the person's act* (Reported, 5; §F, "Not the person's act"). `quietly(run)` holds only for what runs synchronously inside it. Where the open is deferred between the request and the commit, who asked travels as data with the request and is applied at the commit: `panelHost.addTool` and `panelHost.selectTab` take `asked: 'agent'`, the host keeps it on a queued add and on each queued open, and `applyAdd` and `activateIn` run their `openSession` inside `quietly` when it is set. The four listeners pass it on every call they make into the host, the calls after an await included; `connectPaneShows`' two calls that reach the store directly (`openFile`, and `openSession` for a terminal) run inside `quietly`. §F lists every deferral between such a request and the commit, and what carries the origin across each.
6. *An act on the side column leaves a page* (Reported, 6). `toggleSurface` and `toggleSessionCards` call `closeDestination()` first when a destination is open, and so does `startMarkup`, which marks up what the side column shows. Under the dialog they run as today.
7. *The Stop-all confirmation keeps Esc.* Its element is marked `data-escape-own`, the mark §H's table reads; it is the one in-place confirmation inside Settings.
8. *Tests.* Deleted with the behaviour: `main/destinations.test.ts` (its successor is M5's store test), the singleton-tab cases of `stores/layout-model.test.ts`, `main/MainArea.test.tsx`, `main/TabStrip.overflow.test.tsx`, `shell/floating.test.ts` (Settings in front of the card) and `shell/transfer.test.ts`. Rewritten to the new acts: `gateway/actions.test.ts`, `tools/browser/chrome/ActionBar.test.tsx`, `ProfilePopover.test.tsx`, `customize/CustomizeView.test.tsx`, `settings-tab/SettingsView.test.tsx`, `sidebar/Sidebar.test.tsx` ("the footer gear"; which row is current), `app/Toolbar.test.tsx`, `app/Shell.test.tsx`, `app/Shell.chrome.test.tsx`, `transcript/view/rows/rows.test.tsx`. Fixture only: the rest of the list.
9. *A page's name is drawn once, in the title bar* (the ruling on Reported, 9). `CustomizeView`'s own `<h1>Customize</h1>` goes, in the insertion this milestone already makes in that file; its header row keeps `data-customize-header`, the section tabs and the Project and Live session selects. The title bar's page name is the page's level-1 heading, and the page's region is labelled by it. `ProjectsView`'s own `<h1>Projects</h1>` repeats the title bar in the same way and goes for the same reason; what it labelled is labelled by the title bar's heading. That second removal is not in the ruling's words and is reported with this revision. With them move: the three cases of `customize/CustomizeView.test.tsx` that find the header through the heading (they find `[data-customize-header]`), and M8's two e2e lines.

**What it does not touch.** The content of Settings, Customize, Projects and the library, beyond the two headings of decision 9. `transcript/view/rows/Error.tsx` (it keeps calling the action with its number). Diagnostics and a project's Channel, which stay tabs. The usage pill.

**What it proves.** A7 and A9 end to end in the suites, and A8. Its tests pin, in `src/shared/ipc/schema/layout.test.ts`: A8's value (version 3, written as F writes it: a `settings` tab, a `customize` tab at section `skills` in front, a `projects` tab in the other pane, an `artifacts` tab in the closed history, session and file tabs among them) reads with the four gone, every other tab in its order, a tab active in each pane, no warning; `retiredFront` answers Customize at Skills for it, Projects and the library for their variants, `'settings'` for a Settings tab in front, and null for a tab of any other kind in front and for any value that is not a layout; the same for a version-2 and a version-1 value. `pageAtStart`, one case per line of §F's rules 3 to 5: a retired page in front wins over a stored page; a Settings tab in front gives none though a page is stored and the shape is the stored form's; a stored page with the stored form's shape and a Diagnostics tab in front is restored (the accepted case of §G: F can leave exactly this); a stored page with any other shape is not. In the store: A8's value hydrates with the page open and `destination` written; a second hydration of what was written opens the same page and writes nothing; the Settings case deletes the stored key. For decision 5, in `panel/host.test.tsx`, with hydration held open: an agent's `addTool` with `activate: true` for a session that is not the one stored in front, then the person opens a page (and, in a second case, the dialog), then the layout's read answers: the barrier applies the add, the session's tab is in front of the strip, and the page (the dialog) is still open; the same add without `asked` closes it. In `tools/maws/panes/connect.test.ts`: with a page open, `show_pane` for a file adds its tab in front of the strip and the page stays; a session's row clicked while the `artifact` pane's read is still out closes the page, and the add that then arrives leaves the strip's page state as the click left it. In `test/layout/rehearsal.test.ts`: the new counts; a converter whose `pageAtStart` always answers null, and one that always answers Projects, each make a file whose tab in front is a Customize tab end `destination-mismatch`; and a sentinel in a retired tab's fields reaches no output in any of these runs.

### M7 — Usage is a ring

**What exists at its end.** The title bar's right end holds the ring; a click opens the compact popover; "Usage settings" opens Settings at Usage, which holds the whole panel. The sidebar's foot holds the gear alone. View › Usage and the palette's Usage open the popover.

**What it touches.** `usage/` (`UsageRing.tsx` and `UsagePopover.tsx` in place of `UsagePill.tsx`; `UsagePanel.tsx`, `controls.ts`, `index.ts`, the tests); `accounts/copy.ts` (four strings); `app/Toolbar.tsx`; `sidebar/Sidebar.tsx` (`Footer`); in U11's files, the Usage entry and a new `settings-tab/UsageSection.tsx` (§I); `app/Shell.test.tsx`.

**Interfaces.** Consumes §F (`openSettings`). Exposes nothing.

**Decisions.**
1. *The ring is mounted through the existing `topBarEnd` slot,* by the title bar instead of the sidebar's foot, at the title bar's own right end: after the surface icons and outside their overflow. With a side surface open that is left of the side column, which is the window's full-height right column; on a page the title bar spans the window, and the ring is at the window's right edge. The room the surface icons are counted from gives up the ring's 28 px.
2. *The ring.* A 14 px circle: a track and an arc of `usagePill`'s percent, in the severity's colour; a muted empty track with no reading; half opacity when the account must sign in again. Its colours are MAWS's severity colours at today's thresholds. No number. Its tooltip and accessible name are today's sentences (`USAGE.pill`, `pillNoReading`, `pillNoData`).
3. *The popover* is §L's layout, 320 px at most, opening below the ring and aligned to its right edge: no saved sessions, no actions, no add row; the relay's line only when it is degraded or not answering. Each account's first line is its name, which truncates with an ellipsis and carries its whole text as its title (the app's account names are long), and at the right of that line a mark that never truncates: the routed account's "Routing here", a Codex account's muted "Codex".
4. *The panel becomes the section's content, in the section's own measure.* `UsagePanel` stops setting its own width and its own horizontal padding, so its content starts at the section's label column. Its own title there reads "Claude accounts", beside "Codex accounts"; "Usage" is the section's name, and `USAGE.title` is unchanged wherever else it is read. Its grid has two columns from two accounts on where the body is at least 640 px wide; one account is one column whose limit rows keep their own width. The panel decides that itself and no longer reads the model's `columns`, which `accounts/model.ts` keeps. An account action no longer reopens anything after its confirmation. The confirmation's sheet opens over the dialog.
5. *The Usage action under the dialog* shows Settings › Usage (Reported, 10); everywhere else it opens the popover.
6. *Tests.* `usage/UsagePill.test.tsx` becomes `usage/UsageRing.test.tsx` (the ring's states, the popover's content and its link) and `usage/UsagePanel.test.tsx` (the panel's twenty-one cases, rendered directly; "a Route cancelled on the sheet posts nothing and reopens the popover" loses its second half).

**What it does not touch.** `accounts/model.ts` (`usagePill`, `accountsViewModel`), `accounts/AccountCard.tsx`, `accounts/LimitRow.tsx`. What ClaudeUsage's data holds. `src/shared/keymap/actions.ts`: the action keeps its id and title.

**What it proves.** A6. Its tests pin: the ring's arc and colour for a reading at 30, 80 and 96 percent, the empty ring, the dimmed ring, and that no digit is drawn; the popover lists the routed account first and marked, then the others, then Codex accounts, each as its name and limit rows; the relay's line is absent when healthy and drawn when degraded; with no data one line and the link; the link calls `openSettings('usage')` and closes the popover; the popover's content box is at most 320 px by its class; in the popover a name of fifty characters is cut with an ellipsis and whole in its title while "Routing here" beside it is whole, and a Codex account carries "Codex"; Settings' index holds Usage after Gateway and its section holds the grid with the account actions, under the title "Claude accounts", with no horizontal padding of the panel's own, in two columns for two accounts and one for one; the sidebar's foot holds one button.

### M8 — U7b's e2e scenes, the record, and the acceptance run

**What exists at its end.** The e2e specs find Settings in a dialog and the three pages beside the sidebar, and hold the new scenes. The two reversed rulings are amended where they stand. The branch has passed typecheck, lint and the unit suite on the VM, and the hand-over is written into Progress.

**What it touches.** `e2e/support/shell.ts`, `e2e/support/browser-import-scene.ts`, the specs of the table below (`e2e/browser-chrome.spec.ts` and `e2e/browser-import.spec.ts` among them), `e2e/cross-build.spec.ts`; `docs/charter.md`, `docs/doperpowers/ledgers/2026-10-24-P4-UX2.md`; this document's Progress.

**Decisions.**
1. *Helpers first.* `e2e/support/shell.ts` gains `settingsDialog(page)` (the dialog by its accessible name "Settings") and `openSettings(app, page)` (the menu's action, then the dialog visible), `pageRegion(page)` (`[data-region="page"]`) and `backToTabs(page)`; `openAppDestination` ends by asserting the row is `aria-current="page"` and the title bar names the page, not a selected tab; `usagePill` becomes `usageRing` (the title bar's `[data-usage-ring]`); `sidebarFooter` stays.
2. *Scenes re-expressed.* One line each; a scene keeps what it proves and changes how it gets there.

   | spec | scene | becomes |
   |---|---|---|
   | `settings.spec.ts` | the six that read content through the main pane's tabpanel | read through `settingsDialog`; "⌘, opens the tab" asserts the dialog and that the strip's tab count is unchanged |
   | `settings.spec.ts` | "WR #57: first tab click after choosing or dismissing the design-system popup navigates" | the same popup inside the dialog, then one click on a section link moves the view |
   | `settings.spec.ts` | "in a 50/50 split the view stacks inside its pane…" | the view's two container forms at the dialog's width and at the window's smallest |
   | `settings.spec.ts` | "Customize and Projects are reachable without a chat…" | each opens as a page with Back and its name; no tab is added; the strip chords are dropped from the scene; the level-1 heading "Projects" it asserts is the title bar's |
   | `ux2-shell.spec.ts` | "Chrome: live Customize keeps scopes on its two control rows…" | the section tabs and the Project select stand in one row of `[data-customize-header]`; the heading it measured with them is the title bar's and leaves the measure |
   | `shell.spec.ts` | "a session opens in place of Settings or Diagnostics…" | its Diagnostics half stays; a new step: with Settings open, a click on the dimmed window closes it and the strip is as it was |
   | `shell.spec.ts` | "Float with no session in front…, and Settings over the card docks it" | Diagnostics stands for the tab with no session; a new step: Settings over the floating card leaves the card floating |
   | `shell.spec.ts` | `assertToolbarPlacement`; `ux2-shell.spec.ts` `singleChromeRow` | the ring is in the title bar and no usage control is in the sidebar's foot |
   | `ux2-shell.spec.ts` | the three that use a Settings tab as "another tab" | Diagnostics takes its place; the tab count after ⌘, is unchanged |
   | `accounts.spec.ts` | all three | the ring and the compact popover; the grid, its widths and the account actions through Settings › Usage |
   | `browser.spec.ts` | the cover scene's usage step | the popover now overlaps the pane: the view is covered while it is open |
   | `support/browser-import-scene.ts`, `browser-import.spec.ts`, `browser-chrome.spec.ts` | `openSettingsBrowser`, `importThrough` and `closeSheet`, then an act on the session | `openSettingsBrowser` reads `settingsDialog`. `closeSheet` asserts that the sheet is gone and that Settings is still open: closing the import sheet alone leaves the dialog. A new helper `closeSettings(s)` closes it, and each spec's `browserPanel` calls it before it clicks the session's row, so every `browserPanel` that follows `importThrough`, `openImportSheet` or `openSettingsBrowser` in the same launch is covered in one place per spec; both specs are read through for any other click behind an open dialog |
   | `browser-chrome.spec.ts` | "4, 6: ⌘⇧B in the page hides the bar…": it opens Settings, changes the switch, then asks for the browser panel | Settings is closed before the session's row is clicked (a click on the dimmed window closes the dialog and goes nowhere, so the row would not open); the line that says the Settings tab hid the session's panel goes, since the panel is behind the dialog all along |
   | `org-page.spec.ts` | the unnamed `getByRole('dialog')` for its sheets | each sheet by its name; Esc closes the sheet and the dialog stays |
   | `design-systems.spec.ts`, `voice.spec.ts`, `supervisor.spec.ts`, `c11-shots.spec.ts`, `c12-live.spec.ts`, `c11-live.spec.ts` | the Settings locator | `settingsDialog` |
   | `discover.spec.ts`, `discover-connectors.spec.ts`, `discover-live.spec.ts`, `widgets.spec.ts`, `plugins-live.spec.ts`, `plugins-library-live.spec.ts` | Customize's content under `[data-region="main"]`; a Customize tab's close button | under `pageRegion`; `backToTabs` |
   | `dashboard-live-data.spec.ts` | "8a. the dashboard's tab inactive behind the Artifacts tab…" | the dashboard behind the library page: no call while the page is open, one catch-up after Back |
   | `connectors-direct.spec.ts` | "transition: …" | the page's surface behind the library page makes no request; it is asserted quiet, not unmounted |
   | `remote.spec.ts` | the steps that click the session's tab after "Open library" | `backToTabs`, or the row's click, which leaves the page |
   | `cross-build.spec.ts` | "(embedded profile, mawsd) …" | the peer's `artifacts` tab is expected gone from this build's strip, every other id kept |

   The scenes that open the library and then an artifact's row (about forty-five, through `openArtifactInPanel` and its kin) need no edit: a row's click opens the artifact's tab, which leaves the page.
3. *Scenes added.*
   - `e2e/shell.spec.ts`: **"Settings is a dialog"** (A7): ⌘, over a session with a draft typed; the strip, the sidebar and the transcript are still drawn; Esc closes it and the composer has the keyboard and the draft; ⌘, again, ⌘W closes it and the tab count is unchanged; with a sheet opened from Settings, Esc closes the sheet alone.
   - `e2e/shell.spec.ts`: **"a page beside the sidebar"** (A7, A9): scroll a transcript up and open a side surface; open Customize; the side column is not drawn and the title bar spans to the window's right edge, the ring at its end; no strip, Back and "Customize" in the title bar, the row current; ⌘, opens the dialog over the page and Esc shows the page again; Back returns to the same tab at the same scroll offset with its draft, and to the side surface as it was, with `regions` and `panelTools.surfaces` in `layout.json` unchanged by the visit; a session's row leaves the page; a stub request raised meanwhile shows under Needs you and on the Overview button and the page stays; a relaunch with the page open shows the page, and with the dialog open over it shows the page without the dialog.
   - `e2e/shell.spec.ts`: **"⌘⇧\ under a page"** (A10), with a split.
   - `e2e/accounts.spec.ts`: **"the ring"** (A6), as M7 proves it, in a window.
   - `e2e/cross-build.spec.ts`: ***(destinations, both ways)***, skipped unless the peer's schema still names the `customize` tab kind. The peer opens the seeded session, then Settings and Customize as tabs, leaves Customize in front, and quits. This build opens the profile: neither tab is in the strip, every other tab is, the Customize page is open, no dialog is open. It opens Projects as a page and quits. The peer opens the profile: it draws its tabs, none of its console messages says "[layout] … is not a valid value", and after it selects the session's tab, which it files under the session's project, `layout.json` still holds `destination`. This build opens the profile again: no page is open (the peer wrote its sets, so the stored form is no longer this build's), and the key is gone.
4. *The coverage rows this landing adds:*

   | stored | F reads this build's value, and writes on | this build reads F's value |
   |---|---|---|
   | `destination` | *(destinations, both ways)*: F draws its tabs and keeps the key through its write | the return: not restored after F wrote `main.tabs`, and deleted. F never writes the key |
   | tabs of the four kinds | not written by this build | *(destinations, both ways)*: dropped, the page of the one in front opened; and "(embedded profile, mawsd) …" |

5. *The record.* O-40's sentence: a dated addition in the charter's §5.2 paragraph on what the strip holds, and a new entry at the end of its §19 Decision log. O-47's sentence: a dated line in `docs/doperpowers/ledgers/2026-10-24-P4-UX2.md` where the move to the sidebar's foot stands. The earlier words stay.

**What it does not touch.** Product code, unless a scene shows a defect. `e2e/support/sidebar.ts`. The register and the board.

**What it proves.** It writes the e2e halves of A6 to A10; they are proved when the architect's runs are green. By its own run: typecheck, lint and the unit suite pass.

## Concrete Steps

Working directory for every command: the branch's worktree (the controller's brief names it). The VM sees only what is pushed. `<branch>` is `ux-wave/U7` for M1 to M4 and `ux-wave/U7b` for M5 to M8.

1. **Before a landing's first milestone, and again before its last:**

       git fetch origin master && git merge origin/master

   Never a rebase and never a force-push. After the merge, for each file this document names that the merge changed (`git diff --name-only ORIG_HEAD HEAD`), read it again against "What the code holds today" before building on it. For U7a, three merges are foreseen (§I): `app/Toolbar.tsx` if U13a's M4 is on master (apply decision 2 of M1 to the chip as it then is); `sidebar/menus.tsx` and `sidebar/ListedRow.tsx` if U9 is (keep U9's acts where §C puts them); `src/shared/ipc/schema/layout.ts`'s key list if U8b or U13a is (keep every line).

   **Which way M2 is built** (M2, decision 1), asked after that merge and before M2 starts:

       git grep -n "remoteSessionActions" HEAD -- src/renderer/src/app/session-actions.ts

   A line printed: U9's menu is on master, and M2 extends its `record: false` case. Nothing printed: M2 gives the listed row its menu.

2. **While building, after each push:**

       git push origin <branch>
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh <branch> -- 'pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh <branch> -- 'pnpm exec eslint <the paths changed>'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh <branch> -- 'pnpm exec vitest run <the test files touched>'

   Each call prints `vmcheck: <branch> at <short sha>` and then the command's own output, and exits with the command's status; it is never piped into `head` or `tail`. M1's services half and M3's and M6's schema half are checked with `tsconfig.node.json` instead. The first call for a branch installs dependencies and takes a few minutes.

3. **A milestone's end:** the whole `pnpm typecheck`, and the tests of the milestone. M3 and M6 end with the whole unit suite (`pnpm test`), because the sidebar's and the schema's shapes reach many test files. On the VM a known set fails on master too and is not this branch's: the desk-hub `test/deploy/{hub-reads,production-scripts,staging-scripts}.test.ts`, `src/services/machine/setup.test.ts`, `src/shared/machine/git-reads.test.ts`, `test/artifacts/portability.test.ts`; `sidebar/Sidebar.test.tsx` can fail under the full suite's load and pass alone, so M2 and M3 also run it alone.

4. **The acceptance run** (M4, M8), on the pushed head:

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh <branch> -- 'pnpm typecheck'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh <branch> -- 'pnpm lint'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh <branch> -- 'pnpm test'
       git diff origin/master...HEAD -- src/shared/keymap/actions.ts src/main/menu.ts src/shared/ipc/schema/settings.ts

   Expected: the first three exit 0 but for the known set; the last prints nothing (Constraints 2 and 6). M8 also runs `node --test .github/scripts/maws-app-scan.test.mjs`, since it edits recorded scenes.

5. **Then the executor stops and hands back** to the controller: what exists and the commands that showed it, what is not verified, the decisions it made, anything that contradicts this document, and the list of e2e scenes written. The runs of "Proof that an executor does not run", class 1a and the pull request are the architect's.

## Interfaces and Dependencies

Everything a later milestone or a sibling codes against is defined here, once. No library is added.

### §A. The six words (M1; `src/services/index/sessions.ts`)

    /** The name of a session that has no title yet: Claude Desktop's cut of its first prompt (S-11). `prompt` is `promptTitle`'s result. */
    export function cutPrompt(prompt: string): string;

In `titleOf`, the last line that returns the prompt returns `{ text: cutPrompt(prompt), source: 'none' }`. The steps, in order, over a prompt whose white space `promptTitle` has already collapsed:

1. Mentions at the very start are taken off, one after another, and each one's file name kept (the last segment of its path, split on `/`; the path itself when it has no segment). Two forms: Claude Desktop's, `/^@"([^"\n]+)"( |$)/`; and MAWS's bare form, `/^@(?!agent-)([^\s"]+?)[,.;:!?)\]]*( |$)/`, where trailing sentence punctuation goes with the mention as the composer's own reader leaves it outside the path. An agent mention (`@agent-…`) is a word of the prompt and ends the taking off.
2. The first six words of the rest. A word is a run without white space, except that a placeholder the composer or the terminal wrote for a pasted block or an attachment (`[Pasted text #n +L lines]`, `[Pasted text #n]`, `[Image #n]`, `[PDF #n]`) is one word: `/\[(?:Pasted text|Image|PDF) #\d+(?: \+\d+ lines)?\]|\S+/g`.
3. When the rest is empty, the kept file names joined with ", ".
4. Counted by code point (`Array.from`): more than 60 gives the first 59 and "…".

Against Claude Desktop (`readable/app-5.1231.2/web/app/v1/cef1e6037-C_l5Pvir.js:2017-2034`, the pattern at `shared-5-C9P6KnmH.js:16138`, the file name at `shared-98-DEv7MzNi.js:13576-13579`; each read for this document): steps 1, 2 and 4 are its function line for line. MAWS departs in three places, on purpose. The bare form, because MAWS's composer writes it (Reported, 12). The placeholder as one word, because Desktop has no such text and six bare words would end inside one ("Review this [Pasted text #1 +3"). And where the cut is made: Desktop gives the words to the session as its title when it starts it and lets the generated title replace them (`:3767-3847`); MAWS cuts at every projection of the stored prompt, which draws the same thing and leaves the prompt whole for the search.

### §B. "reconnecting" (M1)

    // stores/sessions.ts
    reconnecting: boolean;                  // a read of this Mac's sessions was refused and none has succeeded since
    setReconnecting(on: boolean): void;

| event | state |
|---|---|
| the app starts | false |
| `session.list`, `session.projects.list` or `session.digests` of this Mac answers `ok: false` | true |
| the same, for another machine | unchanged |
| a reply arrives for a connection that is no longer live | unchanged |
| this Mac's three record reads have all applied | false |
| the retry is refused again | true (unchanged) |

Nothing else writes it and nothing times it out. `ipc/events.ts` is edited in the local snapshot's closure only (the call into `snapshot(local)` and what follows its `records`), not in the `hydrate` call below it, which U13a and U8b each edit.

### §C. Opening a listed session (M2)

    // sessions/remote-openers.ts
    export function openListed(appSessionId: AppSessionId, how?: { newTab: boolean }): boolean;   // passes `how` to the lane's opener; false: not listed, or its lane has no opener

**The menu of a session row,** as `SessionItems` draws it, top to bottom. This order is the contract U7a and U9 both build to (U9's Decision Log holds the same table), whichever lands first.

| the row | items |
|---|---|
| a record (this Mac's, or another machine's open here) | the record's opening items, as it has them (Open, Open in new tab, Resume, Open in split, Attach in a terminal tab); Pin where it has it; **Hide** or **Unhide** (M3); the rest of the record's actions as today, Archive, "Delete conversation…" and "Remove worktree…" at their end; Keep running where it has it; Share; Add owner |
| a listing with no record | **Open**; **Open in new tab**; *U9's acts for a listing, where U9 is on master*; **Hide** or **Unhide** (M3); Share; Add owner |

`ListedRow` names its menu in `data-menu` always. Both row kinds draw the three dots (`SessionOverflow`) in the age's slot on hover.

    // sidebar/menus.tsx (M3)
    /** Where Hide stands among a record's actions: directly after `pin`; with no `pin`, after the last of `open`, `openInNewTab`, `resume`, `openInSplit` and `attach`. */
    export function withHide(ids: readonly SessionActionId[]): (SessionActionId | 'hide')[];

For a record of another machine Hide therefore stands between Pin and the acts U9 adds after it (Rename…, Fork, Archive).

### §D. The Hidden row (M3)

    // sidebar/derive.ts
    /** A project's ranked sessions, split by the hidden set: `shown` keeps its order; `hidden` is newest activity first. */
    export function splitHidden(items: readonly SidebarSession[], isHidden: (id: AppSessionId) => boolean, activityOf: (item: SidebarSession) => number): { shown: SidebarSession[]; hidden: SidebarSession[] };

    // sidebar/tree.ts
    | { id: string; kind: 'hidden'; key: ProjectKey; expanded: boolean; parent: string }   // a new member of TreeNode

    export const hiddenNodeId = (key: ProjectKey) => `hidden:${key}`;
    | { kind: 'hidden'; key: ProjectKey }                                                  // a new member of TreeCommand

- The row is drawn where "Show more" is drawn and aligned with it (`data-kind="hidden"`, level 2), after it, only while the project is open, no search is typed and at least one of its sessions is hidden. N counts the project's hidden sessions. After the count stands a small chevron, right while it is closed and down while it is open, the glyph the app's other folds use (`ChevronDownIcon` in `app/IconButton.tsx`, turned). The row is a tree item that acts as a button and carries `aria-expanded`.
- Keys: Enter and Space toggle it; ArrowRight opens it, or steps into it when open; ArrowLeft closes it, or steps to its project when closed. A row under it has the Hidden row as its parent, so ArrowLeft lands there.
- Open, it is followed by the hidden sessions as ordinary rows at level 3 (plus a row's lineage depth), nested among themselves by lineage, and each indented one step, the inset a nested row has, so that they read as the Hidden row's contents. Which Hidden rows are open is held in the sidebar for the run, beside which projects showed more, and a project that closes forgets both.
- `SessionRow` gains the prop `nested: boolean` (under its lineage parent: the `↳` mark and the lineage caption), which it read from `level >= 3` until now; `ProjectRow` passes `row.depth > 0`. `SessionRow` and `ListedRow` both gain `indented: boolean` (under the Hidden row), which gives the one-step inset alone.
- The row's own button, where the owner's answer builds it (M3, decision 9): a 22 px control left of the three dots on a session row and a listed row of the tree, shown on hover and on focus within the row.
- The lead after Unhide is `leadsAsSpawned`'s: the sidebar hands it the union of `useSpawnedHere`'s `leading` and the hidden store's `leading`. No function of `derive.ts` changes for it.

### §E. The hidden store (M3; `stores/hidden.ts`, and the key in `src/shared/ipc/schema/layout.ts`)

    // key `sidebar.hidden`: session address → when it was hidden, and since when its entry is armed (ISO-8601; null: not armed)
    export const SidebarHiddenSchema = z.strictObject({
      version: z.literal(1),
      hidden: z.record(z.string().min(1), z.strictObject({ at: z.string(), armedAt: z.string().nullable() })),
    });
    export type HiddenEntry = { at: string; armedAt: string | null };
    export const HIDDEN_MAX = 500;

    export interface HiddenStore {
      hidden: ReadonlyMap<AppSessionId, HiddenEntry>;
      leading: ReadonlySet<AppSessionId>;   // unhidden in this run, until its next turn ends; never stored
      acts: number;                         // counts hide and unhide, for the sidebar's held order
      load(): Promise<void>;
      hide(id: AppSessionId): void;
      unhide(id: AppSessionId): void;
    }
    export const useHidden: UseBoundStore<StoreApi<HiddenStore>>;
    export function connectHidden(): () => void;   // follows the sessions store and the machines store; gathers each look and applies `afterLook`

    // the rule, pure
    /** What the window knows of a session at one look. */
    export type Look =
      | { route: 'runs'; working: boolean; turnStartedAt: string | null }   // a session MAWS runs on this Mac (its record's holder is `self`)
      | { route: 'says'; working: boolean }                                 // any other record whose phase says its turns; a listing
      | { route: 'transcript'; newestAt: string | null }                    // a record whose phase is `foreign`: nothing says its turns
      | { route: 'nothing' };                                               // neither a digest nor a listing at this look

    export const QUIET_MS = 120_000;
    /** Whether the look finds the session working; null when it cannot say. */
    export function working(look: Look, now: number): boolean | null;
    /** The entry a hide makes at `now`. */
    export function entryAt(look: Look, now: number): HiddenEntry;
    /** One look at a hidden session: it returns, or its entry as it is afterwards (the same object when nothing changed). */
    export function afterLook(entry: HiddenEntry, look: Look, now: number): 'returns' | HiddenEntry;

**Reading and writing.**

| event | what happens |
|---|---|
| first use | one `layout.get`; a later call shares it |
| `hide` or `unhide` before the read has answered | drawn at once; remembered as "this address: this entry" or "this address: not hidden" |
| the read answers a valid value, or that the key is absent | the remembered acts are applied over it; if there were any, one write follows |
| the read answers a value the schema refuses | read as empty, with one warning; the next act writes over it |
| the read is refused, or throws | the acts of the run stay drawn; nothing is written; the next `hide` or `unhide` reads again |
| an act, or an entry that `afterLook` armed, after a read has answered | one `layout.set` of the whole value, 250 ms after the last change, and at once when the page unloads |
| a write is refused | logged; the state stands, and the next change writes the whole value again |

**When a hidden session returns** (its entry is deleted and it ranks as any session). The rule is the architect's of 2026-11-13, which replaces the child's sentence: a hidden session returns when a turn of its began after the hide; and where no datum says when a turn began, the window must have seen the session not working since the hide before it counts it as working again. An entry that has been so seen is *armed*, and the fact is stored.

| route | "working" means | what `afterLook` answers |
|---|---|---|
| `runs` | its phase is `starting`, `working` or `waiting` | It returns when `turnStartedAt` is later than `at`, armed or not. Otherwise an unarmed entry found not working is armed at `now`, so that the entry is right if a terminal later holds the session |
| `says` | a record's phase is `starting`, `working` or `waiting`; a listing's state is `busy` | Unarmed: found not working, it is armed at `now`; found working, unchanged. Armed: found working, it returns; found not working, unchanged |
| `transcript` | its newest transcript record (the digest's `lastTurnEndedAt`, which for these records is that) is newer than `now` less `QUIET_MS` | Unarmed: found not working, it is armed at `now`; found working, unchanged. Armed: it returns when its newest record is later than `armedAt`; otherwise unchanged |
| `nothing` | it cannot say | unchanged |

`entryAt` gives `at: now`, and `armedAt: now` when `working` answers false; when it answers true or cannot say, `armedAt` is null. A listing's `issued` is read nowhere: a listing is signed again for a rename or a change of owners while its state stays `busy`, and that is no turn.

Which look a session gets, gathered by the connection:

| the session | its look |
|---|---|
| this Mac's record, held by MAWS (`self`) | `runs`, from its digest; `nothing` while it has no digest |
| any other record of this Mac (a terminal session, a job, a session at rest) | `transcript` when its digest's phase is `foreign`; else `says`, from the phase; `nothing` while it has no digest |
| a session on another machine, with or without a record here | `says`, from its listing's state; `nothing` while it has no listing |

The connection looks at every hidden session once when the store's read has answered and the sessions store holds its first values (the first look of a run), and again at each change of the digests, the records or the listings.

So: a session hidden at rest returns at its next turn. One hidden in the middle of a turn stays hidden through that turn and returns at the next. A rename, or a change of owners, brings nothing back.

**The limit that remains.** For a session other than one MAWS runs here, the window sees turns only while it runs. Hidden while it worked, such a session that ends that turn and begins another while the window is closed is found working by the first look of the next run, with an entry still unarmed: it stays hidden through that turn, is armed at the first look that finds it at rest, and returns at the turn after. Had the window seen it at rest before it closed, the entry was stored armed, and the first look that finds it working returns it. And a turn that both begins and ends while the window is closed is not seen on the `says` route at all: an armed session found at rest stays hidden until the next turn the window sees. A `foreign` record in that case does return at the first look, by its newer transcript record.

**When an entry is dropped without a return.**

| the session | its entry goes when |
|---|---|
| this Mac's | this Mac is loaded (`useMachines`' `loaded`) and the sessions store holds no record at the address: archived, deleted or gone. Never before this Mac is loaded: an empty list at a start is not evidence |
| another machine's | never because the session is absent. The rows naming a machine do not say that its listing is whole, a machine can be offline for days, and a session archived there can be brought back. Its entry goes by Unhide, by a return, or by the bound |

**The bound.** At a write, when the map holds more than `HIDDEN_MAX` entries, entries go until it holds `HIDDEN_MAX`: those of other machines' sessions first, oldest `at` first; this Mac's oldest only when no other is left.

**When a lead ends** (`leading` loses the id): for a session MAWS runs, its digest's `lastTurnEndedAt` later than the unhide; for any other, the first look that finds it not working after a look since the unhide found it working; and the end of the run.

### §F. The destination and the Settings dialog (M5; root UC-12, which this child owns)

    // src/shared/ipc/schema/layout.ts
    export const DestinationSchema = z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('customize'), view: z.enum(['mine', 'discover']), show: z.enum(['all', 'plugins', 'skills', 'connectors']) }),
      z.strictObject({ kind: z.literal('library') }),
      z.strictObject({ kind: z.literal('projects') }),
    ]);
    export type Destination = z.infer<typeof DestinationSchema>;
    export const StoredDestinationSchema = z.strictObject({ version: z.literal(1), destination: DestinationSchema });   // key `destination`; absent: the tabs show

    // stores/layout.ts, in LayoutState
    destination: Destination | null;
    settings: { section: SettingsSection | null } | null;   // never stored
    openDestination(target: Destination): void;             // replaces an open one; the same kind again changes only its fields; closes the dialog
    closeDestination(): void;                               // the strip is not touched
    openSettings(section?: SettingsSection): void;          // over the tabs or over a page; open already: only a section that is given changes
    closeSettings(): void;
    closeFront(): boolean;                                  // ⌘W: closes the dialog if it is open, else the page; false when neither was

    // stores/layout.ts, the module
    /** The logical answer the readers of §N ask: a page is open, so nothing behind it is on screen. Read by no mount, and by one piece of layout: the span of the title bar and of the banner row (M5, decision 2). */
    export const pageOpen = (state: Pick<LayoutState, 'destination'>): boolean => state.destination !== null;
    /** What the person is looking at: 'settings', 'page:<kind>', or `frontOf(state)`. */
    export function placeOf(state: Pick<LayoutState, 'main' | 'destination' | 'settings'>): string;
    /** Runs `run` as something that is not the person's act: a tab it brings to the front closes neither the page nor the dialog. It holds only for what runs synchronously inside it. */
    export function quietly<T>(run: () => T): T;

    // panel/host.ts (M6): who asked travels with the request
    addTool<P>(toolId: string, opts: AddToolOptions<P> & { asked?: 'agent' }): string;
    selectTab(id: string, opts?: { focus?: boolean; asked?: 'agent' }): void;

**What closes what.**

| act | the page | the dialog |
|---|---|---|
| any action that lands through `commitShown` (U13a's table), outside `quietly` | closes | closes |
| the same inside `quietly`, or reached through a host call that carries `asked: 'agent'`; `focusPane`; `openTab` with `activate: false`; every other change of the strip | stays | stays |
| `openDestination` | opens or changes | closes |
| `openSettings` | stays | opens or changes |
| `setOverviewOpen(true)` | stays (the Overview is drawn over it) | closes |
| `closeFront` | closes when no dialog is open | closes |
| a session that starts waiting; a record, a digest, a listing arriving; a tab's title changing | stays | stays |

**Not the person's act.** An agent's `show_pane`, the Browser following an agent, MAWS's ask sheet and a mod's pane bring a tab or a side surface forward by themselves. Each closes neither the page nor the dialog, and the tab it brings to the front is in front of the strip behind them, as it would be with neither open. `quietly` covers a call that reaches the store in the same synchronous run. Everywhere else the origin is data: `asked: 'agent'` on the call into the host, kept by the host until the commit. Every deferral between such a request and `commitShown`:

| the deferral | where | what carries the origin across it |
|---|---|---|
| an `addTool`, or a further open of the same tool, made before the layout is read and applied at the barrier | `panel/host.ts`: `pending`, each entry's `opens`, `passBarrier` | `asked` is stored on the pending entry and on each queued open; `applyAdd` and `activateIn` run their `openSession` inside `quietly` when it is set |
| an await inside `show_pane` before its `addTool`: the artifact's lookup (the bridge allows 8 s), the browser's | `tools/maws/panes/connect.ts` | the call made after the await passes `asked: 'agent'`; no `quietly` scope spans an await, so an act of the person's in between closes the page as usual |
| the layout store's replay, at its read, of strip changes made before it | `stores/layout.ts`, `early` | nothing that closes is replayed: the replay changes the strip only. Whether an act showed a tab before the read (rule 2 of "At hydration") is recorded at the call, and a call inside `quietly` does not record it |
| a mod's panes, reconciled only once the layout and the session's roster are read | `engine-surface/panes.ts` | it selects a tab only for a session it finds on screen at that moment (§N), so it never opens a session; its calls pass `asked` all the same |
| MAWS's ask sheet waiting until its session is shown | `tools/maws/ask/connect.ts`, `waiting` | it opens once the person has shown the session; its `addTool` passes `asked`, for the first row's case |
| the store's close guard answering after an open | `stores/layout.ts`, `openSession` | not an act of showing: it ends in `dropSession` |

No timer stands between such a request and a commit. Three late arrivals are the person's own and are not exempted: New chat, which has U13a's arrival rule (`placeOf`, M5); and a fork's tab after its adoption (`sessions/record-ops.ts`) and after a resubmit (`composer/resubmit-seam.ts`), which take the front when they arrive, as they do today.

**While `customize/CustomizeView.tsx` still takes a section** (until U11c): the page gives it `plugins` for `show` `all` or `plugins`, `skills` for `skills`, `mcp` for `connectors`; a `discover` view is delivered through today's `useDiscoverRequest`. No opener of U7b writes `all`.

**What the siblings may rely on.**
- *The page's element* is `<section id="region-page" data-region="page" data-destination="<kind>">`, named by the page's name; U6b makes it a stop of F6.
- *U6b:* a page is a place and the dialog none. `openDestination(target)` and `closeDestination()` are the two acts its history calls; `placeOf` says where the person is. Back's button calls `closeDestination()` until U6b gives it the history.
- *U8:* `openArtifacts` (`main/artifacts.ts`) stays the opener behind "Open library". The card column reads `pageOpen` (R8).
- *U10:* any act that opens or activates a tab leaves the page for that tab (`newChat`, `openTab`, `openSession`), and the library's narrowed view is kept for the return because it lives in `useLibraryView`, which the page does not reset.
- *U11:* `SettingsView` is drawn through the `settingsTab` slot with `{ section }` and fills the dialog; the dialog gives its scrolling body (`[data-settings-body]`) a right inset of 30 px in place of the body's own, which leaves the body 760 px at the full box (M5, decision 9); Customize switches its view and filter with `openDestination` of the same kind; a sheet it opens is a layer over the dialog.
- *U13's groups:* opening a group's tabs with `activate: false` closes nothing.

**At hydration.** The page to open is the first of these that applies, and whatever results is what `destination` holds afterwards (written, or deleted, when it differs from the file):

1. If the person opened or closed a page before the read answered: that.
2. If an act of the person's that shows a tab ran before the read answered: none.
3. A retired tab was in front (`retiredFront`, §G): a Customize, Projects or Artifacts tab opens its page (A8); a Settings tab opens none, and the stored page is not restored over it.
4. The stored `destination`, when it parses and the stored `main.tabs` has the stored form's shape (`canonical`, R2): that page.
5. Otherwise none. A stored value that does not parse is left in the file, with one warning, until the next page is opened or closed.

Rules 3 to 5 are `pageAtStart` (§G). `canonical` is a test of shape, not of who wrote the value: it says that `current` is `none` and `none` is the only set. A read of `destination` that failed writes nothing (R9's rule, kept whether or not U8b has landed).

### §G. What is stored, and what build F does with it

| key | what this build writes | what F does with it | this build, then F, then this build |
|---|---|---|---|
| `sidebar.hidden` (U7a) | `{ version: 1, hidden: { <address>: { at, armedAt } } }` after each hide or unhide and each arming; at most 500 entries | Never asks for it: the key is outside F's `LayoutKeySchema`. F's main holds it in memory with the rest of the file and writes it back whole with every write of its own. F draws every session, hidden or not. | The entries are as they were, each armed or not as it was stored. What happened while F ran is read as §E reads a closed window: a session MAWS runs returns by its turn start; any other returns when an armed entry is found working, and a turn it began and ended meanwhile is not seen. |
| `destination` (U7b) | `{ version: 1, destination }` while a page is open; the key is deleted when none is | The same: never read, kept through F's writes. F shows its tabs. | By §F's rules 3 to 5. If F left a retired tab in front, that decides: its page, or none for Settings. If F left `main.tabs` in another shape (it files a session's tab under its project as soon as it changes the tabs), the stored page is not restored and the key is deleted. **Accepted:** if F left a legal one-set layout with no retired tab in front (it ran with tabs of no session only, or changed none), the page the wave's build was quit on opens again, and the person leaves it with Back. No witness and no marker is stored to tell that case apart; M6's test pins it. |
| `main.tabs` (U7b) | as U13a writes it; never a tab of the four kinds | F reads it as U13a's document says. In F the person can open Settings, Customize, Projects and Artifacts as tabs, and F stores them. | F's tabs of the four kinds are dropped at read, from the panes and the closed history; where one was in front and is a page's, that page opens (A8); the value is written back without them, once. |
| the Settings dialog | nothing | — | — |
| either settings file | unchanged by both landings | as with master | — |

**In the other direction: a layout F wrote, read by this build** is A8, proved by M6's unit test on the reader and by *(destinations, both ways)*. **A layout this build wrote, read by F:** F meets no tab kind it does not know (this build adds none) and two top-level keys it does not read.

    // src/shared/ipc/schema/layout.ts (M6)
    /** What a stored value's tab in front was, read before retired kinds are dropped: the page of a Customize, Projects or Artifacts tab; 'settings' for a Settings tab; null for anything else. Total: it never throws. */
    export function retiredFront(stored: unknown): { page: Destination } | 'settings' | null;
    /** The page hydration opens by rules 3 to 5 of "At hydration". Pure, so the store and the rehearsal run the same code. */
    export function pageAtStart(input: { rawMain: unknown; canonical: boolean; stored: Destination | null }): Destination | null;

`retiredFront` reads the set that was showing (`sets[current]`; a version-1 value is its own), that set's focused pane, and the tab whose id is the pane's `activeTabId`. A `customize` tab answers `view: 'mine'` and its section as `show` (`mcp` as `connectors`).

**The rehearsal** (root UC-14; R6). M6 adds to each file's facts, computed from the raw value and printed as numbers and fixed words: tabs of the four kinds open, by kind; the same in the closed history; `front` as one of `settings`, `customize`, `projects`, `artifacts`, `other`, `none`; `expected`, the page that front calls for; and `page`, what `pageAtStart` answers; the last two each one of `customize`, `projects`, `library`, `none`, with Customize's `show` word after it. `front` and `expected` come from a reader of the raw file written in `test/layout/rehearsal.ts`, which shares no code with `retiredFront` or `pageAtStart`: a Customize, Projects or Artifacts tab in front expects its page, a Settings tab none, and any other front the file's own `destination` when it holds one and `current` and the only set are `none`, else none. Three words join `OUTCOMES`: `retired-kept` (a tab of the four survived the read), `no-active-tab` (a pane with tabs and none active) and `destination-mismatch` (`page` is not `expected`). The tab comparison becomes: tabs in, less the retired, equal tabs out. `pageAtStart` is a member of the converters the rehearsal takes as an argument.

### §H. Keys and focus (M5; A7, A10)

**Esc: who takes it, first to last.** Each row is reached only when none above it took the key.

| # | taker | how it takes it | tested without a window |
|---|---|---|---|
| 1 | an input method that is composing | nobody acts (`isComposing`) | the dialog's and the page's tests, one case each |
| 2 | a layer opened over the dialog or the page: a menu, a popover, a sheet (the enroll, grant and import sheets, a confirmation), the palette, the shortcut sheet | Radix closes the topmost layer only, and prevents the event | `SettingsDialog.test.tsx`: a `Sheet` opened inside, Esc closes the sheet and the dialog stays; U11a's stacked-layers test owns the scrim |
| 3 | the shortcut recorder (`[data-chord-capture]`); an element marked `data-escape-own` | `escapeTaker` answers `own`: the dialog or the page does nothing, and the element's handler runs | a recorder stand-in and a marked button |
| 4 | a search field that holds text (`data-escape-clears`) | `escapeTaker` answers `own`: the field clears itself | as `WidgetDialog`'s test has it |
| 5 | any other text field inside the dialog or the page that holds the keyboard | `escapeTaker` answers `field`: the field's own handler runs, and the keyboard moves from the field to the dialog or the page; the next Esc goes on down this table | a field with an Esc handler: one press reverts and blurs, the second closes |
| 6 | the Settings dialog | closes; the keyboard returns where it was | opened from a focused composer stand-in: focus is back on it |
| 7 | the Overview, when open | its own listener, unchanged; it already yields to rows 1 to 6 | `OverviewPanel.test.tsx`, one case with a page open |
| 8 | a page | closes; the keyboard returns where it was | opened from a focused sidebar row: focus is back on it |
| 9 | what is there today: a request's card (`request.decline`), the composer | unchanged; under a page their region is `inert`, under the dialog the dispatcher refuses them (`OPEN_OVERLAY`) | `keymap/key-dispatch.test.tsx`: with the dialog open, Esc does not decline a docked request |

    // destination/escape.ts
    /** Whether an Esc at `target` belongs to something inside: 'own' (it handles it itself), 'field' (a text field: leave it first), or null. */
    export function escapeTaker(target: EventTarget | null): 'own' | 'field' | null;

**Where Settings opens from when the gear is not on screen.** In a window narrower than 700 px the sidebar is folded and its foot with it. Nothing is added for that: Settings opens by ⌘,, by MAWS › Settings… and by the popover's "Usage settings".

**⌘W** (`tab.close`, a menu row of scope `app`, so it arrives whatever is focused): the dialog if open, never the page or the tab behind it; else the page, never the tab; else the tab in front, as today. One line in the action's handler (`closeFront()`).

**Against U6a's table** (R13). U7 adds no row. Of the rows there, these act on what U7 builds: `settings.open` (⌘,; open already: stays open), `accounts.open`, `artifacts.open`, `tab.close`, and every row whose handler lands through `commitShown` (`session.new`, `tab.select`, `tab.reopen`, `tab.stripNext` and `tab.stripPrevious`, `session.next` and `session.previous`, `attention.next`, `pane.split`, `pane.focusOther`, `panel.float`, `main.expandArtifactPane`, `diagnostics.open`): each closes the dialog and the page as part of its act. `tab.overview` closes the dialog and opens over a page. `tab.next` and `tab.previous` are pane-scoped and do not fire under either. The surface rows are M6's decision 6. `palette.open` and `shortcuts.open` open a layer over either. Back and Forward are U6b's, not waited for: a page will be a place in that history and the dialog none.

**Against U11a's stacked dialogs** (R11). The dialog's backdrop is one layer of U11a's stack: a sheet opened from Settings mounts later, is the top layer, and alone paints the scrim. The dialog sits at the z-index of the app's dialogs, below a sheet's.

**With a window** the same table is proved by M8's scenes "Settings is a dialog", "a page beside the sidebar" and "⌘⇧\ under a page".

### §I. Landings in flight: who edits what, and who merges after whom

The rule is root UC-8's: whoever lands second merges master and keeps both.

| file | also edited by | what each edits | note for the second to land |
|---|---|---|---|
| `src/shared/ipc/schema/layout.ts` | U13a, U8b | U13a: `Strip`, `storedMain`, `stripOf`, `LAYOUT_DEFAULTS.main`. U8b: three schemas and three literals at the end of `LayoutKeySchema`. U7a: one schema, one literal. U7b: two schemas, one literal, the four tab schemas and `RETIRED_KINDS` | the key list is one line per landing: keep every line |
| `ipc/events.ts` | U13a, U8b | both: the `hydrate` call. U7a: the local snapshot's closure, above it | hunks do not meet |
| `sidebar/Sidebar.tsx` | U13a | U13a: a project's activation no longer touches the strip; the New chat row. U7a: the heading's word, the rows shown, the tree's nodes. U7b: the foot, which row is current | hunks do not meet |
| `sidebar/ProjectRow.tsx`, `sidebar/menus.tsx`, `sidebar/ListedRow.tsx` | U13a, U9 | U13a: the call behind a project's New chat. U9: its acts for a listing, and `data-menu` for a listed row. U7a: the Hidden row; the session items | neither of U7a and U9 goes first by rule (Reported, 1): both build to §C's order, and the second to land merges and keeps U9's acts between "Open in new tab" and Hide |
| `app/Toolbar.tsx` | U13a, U9 | U13a: `ProjectChip`. U9: the session menu's disabled sentences. U7a: two classes on the chip. U7b: page mode, the ring's slot, `toolbarTitle` | O-03's classes are applied to the chip as master has it |
| `e2e/shell.spec.ts`, `e2e/sessions.spec.ts`, `e2e/remote.spec.ts`, `e2e/cross-build.spec.ts` | U13a, U9, U8b, U6a | each adds or rewrites its own scenes | U7's scenes are new blocks, except the exact menu lists |
| `stores/layout.ts` | U13a (owner), U8b | U8b: three slices and the side column's acts. U7b: §F | U7b starts from a master that holds U13a; U8b on either side |
| `app/shell-view.ts`, `app/Shell.tsx` | U8b (owner) | U8b: `cardColumnNow`, the card column. U7b: `pageOpen`'s one line; the page's mount and what it hides | if U8b lands second, it sets `pageOpen: state.destination !== null` in `cardColumnNow` |
| `panel/surface-model.ts` | U13a, U8b | not edited by U7 | — |

**U11a and U7b: what moves, and the order.** U11a rebuilds Settings' sections and search inside today's tab and waits for the owner's look; U7b may land before or after it.

| what | if U11a is on master first | if U7b lands first |
|---|---|---|
| `SettingsSection`, the list of sections | U7b adds `'usage'` to `SETTINGS_SECTIONS`, `{ group: 'sessions', section: 'usage' }` after Gateway in `SECTION_TABLE`, and its rows to `SETTINGS_ROWS` | U7b gives `settings-tab/SettingsView.tsx` the export `SETTINGS_SECTIONS` (today's ten and `usage`, in today's order with Usage after Gateway) and derives `SettingsSection` from it. U11a, merging, replaces the list with its own and keeps `usage` |
| the dialog's backdrop | `Backdrop` | the overlay class the app's dialogs have today. U11a's M3, merging, makes it `Backdrop` as it does for the others: one element in `destination/SettingsDialog.tsx` |
| the section a tab stores | gone with the tab; U11a's rule "the stored list stays F's ten" has nothing left to guard | the same, earlier: U11a's document says to stop and report when it meets a master with no `settings` tab kind, and what it then finds is this table |
| `e2e/settings.spec.ts` | U7b moves U11a's scenes to `settingsDialog` | U11a writes its scenes against `settingsDialog` |
| Esc in the search field | row 4 of §H | the same; U11a's "while Settings is a tab, Esc in an empty field does nothing" no longer applies |

Neither assumes the other's content: the dialog draws whatever `SettingsView` the `settingsTab` slot holds and passes it a section, and `SettingsView` fills its host. U7b must not assume `SECTION_TABLE`, `SETTINGS_ROWS` or the search exist; U11a must not assume a Settings tab, a stored section or a main pane around the view.

**Consumed and not waited for.** U6a: R13, nothing else. U9: §C's order, which its Decision Log carries too; where its menu is on master when M2 starts, `remoteSessionActions`' `record: false` case, which M2 then extends (M2, decision 1). U1a: nothing; `waits` is read by Needs you, not by U7. U8b: R8 to R10, R16 and R17.

### §J. Insertions in files other children own (root UC-8)

| file | owner | the insertion | milestone |
|---|---|---|---|
| `ipc/events.ts`, `stores/sessions.ts`, `sessions/remote-openers.ts`, `gateway/actions.ts` | no child | §B; §C; `settings.open` calls `openSettings` | M1, M2, M6 |
| `session/visibility.ts`, `attention/navigation.ts`, `app/plugin-toasts.ts`, `engine-surface/panes.ts` | no child | §N: each answers "not on screen" while a page is open | M5 |
| `tools/maws/panes/connect.ts`, `engine-surface/panes.ts`, `markup/session.ts`, `projects/ProjectsView.tsx` | no child | `asked: 'agent'` on every call into the host, and `quietly` around the two calls that reach the store (§F); `startMarkup` leaves a page first; the page's own heading removed (M6, decision 9) | M6 |
| `app/session-actions.ts` | U9 | only where U9's menu is on master when M2 starts: `open` and `openInNewTab` at the head of `remoteSessionActions`' `record: false` case | M2 |
| `stores/layout.ts` | U13 | §F: state, acts, `commitShown`'s effect, hydration and persistence of `destination`, `placeOf`, `quietly` | M5 |
| `stores/layout-model.ts`, `main/Tab.tsx`, `main/artifacts.ts` | U13 | the four kinds' cases removed; `openArtifacts` calls `openDestination` | M6 |
| `main/Pane.tsx` | U9 | the four kinds' cases and their two helper components removed | M6 |
| `app/Shell.tsx`, `app/shell-view.ts`, `app/slots.ts`, `panel/SurfaceRow.tsx` | U8 | the page's mount and what it hides, with the card column's place kept; `pageOpen` in `cardColumnNow`; the `settingsTab` slot's prop type; two calls of `closeDestination` | M5, M6 |
| `panel/ToolBody.tsx`, `panel/host.ts` | U8 | §N: `ctx.visible` is false while a page is open; §F: `asked` on `addTool` and `selectTab`, kept on a queued add and its queued opens, applied in `applyAdd` and `activateIn` | M5, M6 |
| `library/ArtifactTab.tsx` | U10 | §N: a main-tab editor's `visible` is false while a page is open | M5 |
| `tools/browser/covering.ts`, `tools/browser/agent/connect.ts` | U12 | §N: `sessionsOnScreen` answers none while a page is open; the Browser does not follow an agent behind a page. §F: `asked` on the follow's `addTool` | M5, M6 |
| `tools/maws/ask/connect.ts` | U1 | §F: `asked` on the ask sheet's `addTool` | M6 |
| `app/shell-actions.ts`, `keymap/actions-runtime.ts` | U6 | `closeFront()` in `tab.close`; `placeOf` in the arrival rule | M5 |
| `settings-tab/SettingsView.tsx`, `settings-tab/UsageSection.tsx` (new), `settings-tab/rows.ts` if it exists, `settings-tab/SupervisorSettings.tsx` | U11 | the Usage entry and the component that mounts the panel; the type's home (§I); one attribute | M6, M7 |
| `customize/open.ts`, `customize/CustomizeView.tsx` | U11 | the three openers and `selectSection` call `openDestination`; the view's own heading removed (M6, decision 9) | M6 |
| `tools/browser/chrome/Chrome.tsx`, `ProfilePopover.tsx` | U12 | one call each: `openSettings('browser')` | M6 |
| `accounts/copy.ts` | no child | four strings (§L) | M7 |

**Every way in** (M6), by what it opens:

| caller | calls |
|---|---|
| the gear, ⌘,, MAWS › Settings…, the palette's Settings, the composer's and widgets' links (`settings.open`, with its section when it names one) | `openSettings(section)` |
| the browser's extension and profile links | `openSettings('browser')` |
| the ring's "Usage settings" | `openSettings('usage')` |
| the sidebar's Customize row, the composer's "Manage…" items, Settings' link to Customize (`openCustomize`) | `openDestination({ kind: 'customize', view: 'mine', show })` |
| the plugins widget's Open Discover (`openDiscover`) | the same with `view: 'discover'` |
| Customize's own section tabs (`selectSection`) | the same kind, its `show` changed |
| the sidebar's Projects row (`openProjects`) | `openDestination({ kind: 'projects' })` |
| the sidebar's Artifacts row, View › Artifacts, the palette's Artifacts, the Artifacts list's "Open library" (`openArtifacts`) | `openDestination({ kind: 'library' })` |

### §K. Routes (law 5)

| item | a session MAWS runs | a terminal session on this Mac | a session on another machine |
|---|---|---|---|
| S-11 | named by this Mac's index: changes | the same index: changes | open here: named by its machine's index, so it changes when that machine runs the wave's build. Only listed: named by its listing. Once U9 is on that machine, the listing of a session MAWS runs there carries its record's title (U9's listing rule), so the six words reach the listed row through the record; a terminal session's listing keeps the title its member frame states. The desk's web view names every session by its listing and follows the same two cases; nothing in `apps/desk-web` changes |
| #407 | the word is about this Mac's reads, whatever the sessions | the same | not this item: a machine whose link is down greys its rows in place, as today |
| O-03 | not a session surface | — | — |
| O-38 | unchanged, already built | unchanged, already built | this item: its row's menu, ⌘-click and middle-click, through its lane's opener; for a terminal session there (lane A) the same, by that lane's opener |
| O-16: the act | the same on all three: an entry in this window's own store; nothing is sent, so no offer is needed (root UC-7) | the same | the same, for a row with a record here and for one that is only listed |
| O-16: the return | exact: its turn start is later than the hide | no turn start exists: an armed entry returns when the session is seen working, by its phase where a bridge says its turns, by a newer transcript record where none does (§E) | the same rule by its listing's `busy`; its listing's `issued` is not read; none without a listing |
| O-47, O-40 | not session surfaces: the same whatever is in front | — | — |

### §L. Copy

| where | string |
|---|---|
| the row's menu, and the row's own button where it is built (label and tooltip) | `Hide`; `Unhide` |
| the Hidden row | `Hidden · N` (N a numeral), then the chevron; its accessible name `Hidden, N sessions` (`Hidden, 1 session`), its state in `aria-expanded` |
| the Projects heading's word | `reconnecting` (the constant `RECONNECTING`) |
| a listed row's menu | `Open`; `Open in new tab`; disabled: `Not available here` |
| the page's title-bar button | `Back`; its tooltip `Back · Esc`, written as this literal: Esc is not a chord of the keymap |
| the pages' names | `Customize`; `Projects`; `Artifacts` |
| the dialog | accessible name `Settings`; its button `Close` |
| the ring | no visible text; tooltip and accessible name as `USAGE.pill`, `USAGE.pillNoReading`, `USAGE.pillNoData` give them today |
| the popover | accessible name and heading `Usage` (a new string); the reading's age as `USAGE.updated` gives it; on the routed account's name line `ROUTING.here`; on a Codex account's name line `Codex` (new, muted), and under it `USAGE.codexLimits`; with no data `ACCOUNTS.unavailable`; the link `Usage settings` (new) |
| Settings' index and section | `Usage` |
| the panel's own title in Settings › Usage | `Claude accounts` (new), beside `USAGE.codexTitle`; `USAGE.title` is unchanged elsewhere |

### §M. Against Claude Desktop (law 1)

Each citation was read again for this document at `readable/app-5.1231.2/`; S-11's is in §A.

| item | what Desktop does, where | where MAWS departs, and why |
|---|---|---|
| O-16 | No per-session hide. Every group is cut to a first run of rows behind "Show {count} more in {bucketLabel}" (`web/app/v1/shared-63-B1QmL_kC.js:7137-7163`) | Hide is MAWS's own: the owner asked for the act on a chosen session, and MAWS already has the cut by order (five, then eight) |
| O-38 | No tab strip; ⌘-click pops a session out to a window | MAWS follows its own local rows (the browser's rule), since it builds no second window in this wave |
| O-47 | A 14 px ring (`web/app/v1/c82492f2c-B1kvcJEb.js:32000`, named "View usage limits" at `:30838`) opening a 360 px popover (`:32130`) with a "Usage settings" link (`:29846`), in the composer's row, the popover above it | The place: the title bar's right end, which the owner named, so the popover opens below. The width, 320 px, which the limit rows need and no more. The colours: MAWS's severity colours at today's thresholds, where Desktop's ring is drawn in its accent colour (the ring itself is `shared-8-BNzaQaMo.js:39281-39345`: a 2 px stroke from twelve o'clock; the line cited for 14 px is its call). The popover lists every account, because MAWS routes over several |
| O-40, the dialog | The `/settings` route turns into the page behind it and opens a dialog (`web/app/v1/index-m4Lmn-QT.js:23530-23541`, `:22785-22815`, `:22354-22438`, `:22500-22541`); the dialog is `SettingsModal` (`cc011544b-6SoHAY-3.js:2743-2748`), centred with a 16 px margin, at most 1024 by 800 px, larger on a large window (`shared-61-2ybPsRVk.js:6175-6192`), with a Close button (`cc011544b-6SoHAY-3.js:2509`); the app menu's ⌘, navigates to that route (`main-process/index.chunk-BV3uOqbK.js:276110-276122`). A full page with "Close settings" is the route's fallback (`cf4f70727-Crsbk-hp.js:1976-1987`) | The box is MAWS's library dialogs', edge and shadow included: 960 px wide, at most 800 px tall and never more than 85 percent of the window's height, so 697 px at the default window and it is dismissed as MAWS's dialogs are: law 7. It is not restored at a relaunch. Read in the source, not in the running app; U14's sitting has the look |
| O-40, the pages | Customize is a page under the sidebar layout (`index-m4Lmn-QT.js:23576-23584`; `c63a78ed4-C3ocXnDa.js:2078-2085`); the Artifacts list and the Projects list are routes under the same parent (`:23718-23726`, `:23620-23636`), read in the route table only | The comparison for the library and for Projects is by kind: Desktop's projects are chat projects. MAWS hides its strip while a page is open; Desktop has none to hide |

### §N. What is on screen behind a page (M5)

Two things, kept apart. *Mounting and layout:* what a page hides stays mounted, the main area and the card column at their size, and the one piece of layout that reads the page is the span of the title bar and the banner row (M5, decision 2). *The logical answer:* a page is open, so nothing behind it is on screen; `pageOpen(state)` says it, and these readers ask it: eight that change, and the side column's own gate. Behind the Settings dialog none of them changes.

| reader | file · owner | behind a page | its regression test |
|---|---|---|---|
| `visibleSessions`, and the connection that reports it | `session/visibility.ts` · no child | no session of the main area, the side column or a card; the connection runs again when the page opens or closes | `session/visibility.test.ts`: with a session in front, a page opening sends `session.setVisible` false and `attention.viewing` null, Back sends them true again; the dialog opening sends nothing |
| `requestOnScreen` | `attention/navigation.ts` · no child | false | `attention/navigation.test.ts`: ⇧⌘J with the waiting session's tab in front behind a page opens that session, which leaves the page |
| `shownHere` | `app/plugin-toasts.ts` · no child | false; `engine-surface/asks.ts` reads it and needs no edit | `app/plugin-toasts.test.ts`: a mod's toast for the session behind a page is not shown; `engine-surface/asks.test.ts`: its prompt request is not this window's to answer |
| the `shown` of a mod's panes | `engine-surface/panes.ts` · no child | false: a pane the engine shows gets its tab unselected, and a focus request is answered as for a session this window does not show | `engine-surface/panes.test.tsx` |
| `ctx.visible` of every side-column tool: Review, Files, Source control, the Terminal (whose renderer releases its acceleration on it), the Browser, Artifacts with its dashboards and viewers, the Side pane and its threads, the ask sheet, a mod's pane | `panel/ToolBody.tsx` · U8 | false, from the one line that gives it | `panel/host.test.tsx`: a tool's `visible` goes false when a page opens and true at Back, its instance the same object; `tools/terminal/terminal.test.tsx`: the terminal's renderer is told hidden |
| the side column itself, as a region | `app/Shell.tsx` (its gate, this child's own) around `panel/PanelRegion.tsx` · U8 | not drawn: mounted, invisible and `inert`, with nothing written (M5, decision 2); F6 does not stop in it, because `regionStops` in `keymap/shell-navigation.ts` already passes over an `inert` or invisible region and needs no edit | `app/Shell.test.tsx`, M5's case; `keymap/shell-navigation.test.tsx`: with a page open F6 never lands in the side column or in a pane |
| `visible` of every main-tab artifact editor: documents, decks, designs, dashboards (`tools/dashboard/DashboardPanel.tsx`, whose live queries stop on it), pages and files (`tools/artifacts/viewers/ByteViewer.tsx`), the connectors' tab state | `library/ArtifactTab.tsx` · U10 | false, from the one line that gives it | `library/ArtifactTab.test.tsx`; `tools/dashboard/live.compiled.test.tsx`: a live query makes no call while its tab is behind a page, and one catch-up at Back |
| `sessionsOnScreen`, and the in-app browser's native views | `tools/browser/covering.ts` · U12 | none; the views are covered by a `holdCover()` that `Shell` holds for as long as a page is open | `tools/browser/covering.test.ts`; `app/Shell.browser-cover.test.tsx`: `browser.view.cover` true when a page opens over a mounted pane and false at Back, and true under the Settings dialog through the watch of the DOM |
| the Browser following an agent | `tools/browser/agent/connect.ts` · U12 | it does not open the Browser, as for a session that is not in front | `tools/browser/agent/connect.test.ts` |

Readers that ask only which session is in front, and do not change: `shownSession()` in `tools/maws/ask/connect.ts` (the sheet it opens is drawn when the page is left), `side/actions.ts` and `tools/browser/comment/actions.ts` (acts of the person's, from surfaces a page hides; the second's notice goes through `sessionsOnScreen` and so becomes a toast behind a page), `tools/agents/actions.ts`, `tools/code/open-file.ts`, `sessions/attach.ts`, and `markup/session.ts` (M6, decision 6). `openCardSession` in `shell/floating.ts` is read only through the first two rows. `overviewShownIn` in `tools/browser/covering.ts` is unchanged: the Overview is drawn over a page. `customize/discover/DiscoverGrid.tsx`'s observer watches the page's own content. `currentRow`, `useCurrentRow` and `focusedProject` do not change while a page is open (U13a's §F).

## Acceptance

The acceptance is the section's A1 to A10 as written there, read with the rulings of "Reported to the architect, and ruled". "Unit" is run by the milestone's executor on the VM and again by class 1a. "E2e" is written in M4 and M8 and run by the architect on a Mac.

| item | proved by | milestone |
|---|---|---|
| A1 six words, mentions, the search unchanged | unit (`sessions.test.ts`), on the record's title for all three routes | M1 |
| A2 Hide, Hidden · N, Unhide at the head, across a relaunch, the return, Needs you | unit (`hidden.test.ts` with `afterLook`'s table, the drop rule and the bound; `derive.test.ts`; `Sidebar.test.tsx`); e2e "hide and unhide", the step in `remote.spec.ts`, *(sidebar, both ways)*. Hide in the menu is proved in both answers to question 1, and the row's button with its own commit. "A hidden session that starts a new turn returns by itself" is read with §E's rule and its limit, by the architect's ruling | M3, M4 |
| A3 a listed row opens in a tab of its own | unit (the listed row's cases, failing before and passing after); e2e, the step in `remote.spec.ts` | M2, M4 |
| A4 "reconnecting" | unit (`events.test.ts`, `Sidebar.test.tsx`) | M1 |
| A5 the chip stays in its box | e2e "a long project name stays inside the chip's box" | M1, M4 |
| A6 the ring, the popover, Settings › Usage, the foot | unit (`UsageRing.test.tsx`, `UsagePanel.test.tsx`, Settings' and the sidebar's tests); e2e `accounts.spec.ts` | M7, M8 |
| A7 the dialog and the pages | unit (the store's table; §H's cases); e2e "Settings is a dialog", "a page beside the sidebar" | M5, M6, M8 |
| A8 a layout from build F | unit (the reader; `retiredFront` and `pageAtStart`; the store's hydration, the accepted case of §G among its cases); the rehearsal, with its own expectation; e2e *(destinations, both ways)* | M6, M8 |
| A9 nothing takes the page or the dialog away; the relaunch | unit (the store's table; "At hydration"); e2e "a page beside the sidebar" | M5, M8 |
| A10 ⌘⇧\ under a page | unit (the store, with a split); e2e "⌘⇧\ under a page" | M5, M8 |

## Proof that an executor does not run

Each line has an owner other than an executor. The controller writes into Progress when a line's precondition is met.

| what | when it can start | what it needs | what comes back, and what a failure means |
|---|---|---|---|
| **The branch review, U7a** | after M4 | `doperpowers:review-code`, the xhigh panel by size (about 35 files, about 2,100 lines; nothing in it is delicate by the root), over `origin/master...ux-wave/U7`. Lenses: the hidden store's reads and writes under a refused read; `afterLook`'s table on each route with its stated limit, the drop rule (never by absence on another machine) and the bound; the tree's keys and where focus lands after Hide and Unhide; the cut against Claude Desktop's function and the search untouched; the merges of §I | a verdict and findings; the fixes are one wave through the controller |
| **The branch review, U7b** | after M8 | the xhigh panel: root UC-10 calls the reader of the stored layout delicate. Lenses: the stored layout in both directions with F, and "At hydration" line by line; `commitShown`'s table, what closes and what must not, and every deferral of §F's list carrying who asked to the commit; §H's takers and where the keyboard returns; that the box and the logical answer stay apart (M5, decisions 2 to 4) and that §N's list is whole; the seam with U11a; that no re-expressed scene proves less than it did | the same |
| **The e2e scenes of U7a**, each alone first, then its group, on a Mac under the load rule | after M4 | `shell.spec.ts` (group `layout`; also in `default`): the two new scenes and the long shell scene. `sessions.spec.ts` (group `default`): "foreign-live: …". `remote.spec.ts` (group `remote`, `MAWS_REMOTE_E2E=1`): the scene that opens a listed row | Verdicts by scene. The chip scene red: the name still runs under the first tab. "hide and unhide" red at the relaunch: the key is not written or not read. The menu lists red: an item is missing or out of §C's order. With the row's button, `ux1-sidebar.spec.ts` (group `default`): red means the button took room from more than the title. The remote step red at ⌘-click: a listed row does not reach its opener with the request |
| **The e2e scenes of U7b** | after M8 | Alone first: the three new scenes of `shell.spec.ts`, "the ring", and every scene of M8's table. Then the groups: `layout`, `settings` (which also runs the org page, the Channel, Share and the registry), `default`, `discover`, `widgets`, `browser`, `browser-import`, `browser-chrome`, `design-systems`, `voice`, `supervisor-daemon`, `remote`, `library`, `deliverables`. `dashboard-live-data` and `connectors-direct` are gated by their own flags; `c11-shots`, `c11-live`, `c12-live`, `plugins-live`, `plugins-library-live` and `discover-live` have live or shot gates and are typechecked, then run at the next live sitting | Verdicts by group. "Settings is a dialog" red at Esc: a taker of §H is out of order. "a page beside the sidebar" red at the scroll offset: what the page hides lost its box (M5, decision 2). Red at Needs you: something closed the page that is not the person's act. The dashboard step red: a tab behind a page still counts as on screen (M5, decision 3) |
| **The rehearsal over the owner's layout files** (root UC-14) | after M6's review | A copy of `<userData>/layout.json` from each of the owner's machines, in a directory outside any repository, on a machine with a checkout of `ux-wave/U7b` and its dependencies. Run, reading structure and counts only: `MAWS_LAYOUT_REHEARSAL=<that directory> ./node_modules/.bin/vitest run test/layout/owner-files.test.ts --silent=false` | One entry per file, each ending `pass`, of this shape (the numbers are invented): `file 1 of 2  main.tabs v3: 1 set, 11 tabs (session 7, file 1, artifact 1, settings 1, customize 1), 1 pinned, 2 closed, 0 reader warnings; retired 2 open, 1 closed; front customize, expected customize skills` then `-> strip: 9 tabs, 1 pane, merged no, canonical yes; missing 0, added 0, twice 0; active in every pane yes; page customize skills   pass`. Any other word stops the landing: `retired-kept` or `no-active-tab` means the reader is wrong for a layout the owner really has, and `destination-mismatch` that the page it would open is not the one the file's own front calls for. Only these lines are quoted anywhere |
| **The cross-build run with F as the peer** | after M4 for U7a, after M8 for U7b | `scripts/ci-gate.sh "$PWD" --gates e2e:cross-build --peer f1852de3a --label u7a-xb` (then `u7b-xb`), in the background | The run's id, with *(sidebar, both ways)*, and for U7b *(destinations, both ways)*, named as run and green. A scene reported as skipped is not evidence. Until it is green no build that holds the landing runs on a profile the owner uses |
| **The owner's look** | question 1 before M3's last step; all four before M5 starts | "What the owner should look at", below; the drawn page is made | the owner's word on each question. Question 1 decides whether M3's decision 9 is built; if it has not come when M3 is otherwise done, M3 closes without the button and the button follows as one commit with its scene. A change of what is drawn comes back as an amendment of the section |
| **Class 1a** | once per landing, on the head its pull request will carry, after the review's fixes | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u7a` (then `u7b`), in the background | the run's id |

## What the owner should look at

A drawn example was warranted, and it is made: six frames and one frame per question, with invented names and text (root UC-11). It was needed for U7b, which changes what the owner sees first in every session. U7a starts without waiting for it: Hide in the menu is built in both answers to question 1, and the row's button is one further step on the answer (M3, decision 9). What the drawing showed that this document said wrongly or not at all is written in by the architect's rulings (Decision Log).

**Frames.**
1. The title bar at rest, at the default window: the ring at the title bar's own right end, after the surface icons, in three states (a reading, a reading past 75 percent, no reading). The sidebar's foot with the gear alone, which keeps its 43 px bar and its rule for the one button: it is on the list for the owner's look. The title bar at the window's smallest, where the sidebar is folded and the gear is not on screen (§H says how Settings opens there).
2. The popover open under the ring: two Claude accounts, the routed one first with its mark at the right of its name's line, one Codex account with "Codex" in that place, the link; and its no-data form.
3. Settings as a dialog over a session with a split and a side surface open, the window dimmed, U11a's index with Usage, Close: at a tall window the box is 960 by 800 px, at the default window 960 by 697 px; and the same with a sheet opened over it. With a side surface open the ring stands left of the side column.
4. Settings › Usage at the body's 760 px, under the title "Claude accounts": the grid in two columns for two accounts and for three, with the account actions.
5. A page: Customize taking everything right of the sidebar, the title bar spanning to the window's right edge with Back and "Customize" at its left and the ring at its right end, the sidebar's row current, no strip and no side column; then the title bar alone for Projects (with Back's tooltip) and for Artifacts. The page's name stands once.
6. A project in the sidebar with "Hidden · 2" closed and its chevron, then open with its rows indented; a row's menu with Hide directly after Pin; a hidden row's menu with Unhide.

**Questions only the owner can settle,** each with the answer recommended to the owner. The document is written so that each answer changes one place.
1. *Hide: only in a row's menu, or also a button on the row?* Recommended: also a button on the row, by the owner's own words, "hide a session with one click". Every row under the pointer then shows a Hide button beside the three dots, and the title gives it 27 px while it shows. The other answer leaves a row as it looks today. Place: M3, decision 9, which is built on the answer; the menu item is built either way. **Answered (2026-11-12): "Button on the row (Recommended)"**: M3 builds the button.
2. *The ring alone, or with the limit's name and percent beside it?* Recommended: the ring alone, as Claude Desktop draws it; the percent is in the tooltip and in the popover. The other answer keeps today's words beside the ring and takes 79 px of the title bar from the tabs, as measured on the drawing: at the default window with eight tabs the last no longer fits. Place: M7, decision 2. **Answered (2026-11-12): "Ring alone (Recommended)".**
3. *After a relaunch, is Settings open again?* Recommended: no; the app opens on what was behind it. The other answer restores the dialog over the tabs. Place: §F, the dialog's state, and "At hydration". **Answered (2026-11-12): "No (Recommended)".**
4. *⌘J, ⇧⌘D or ⇧⌘F pressed while a page is open:* the page is left and the surface shows (recommended), or nothing happens until the person is back on the tabs. Place: M6, decision 6. **Answered (2026-11-12): "Leave the page (Recommended)".**

## The pull requests

Two, each opened on the architect's word and never by an executor. Each body:
- opens with the composite's path, the child id (U7, first or second landing) and the parent pin `5f1972a30`, and names its items and the board ticket #591;
- names its class 1a run by id, on the head it carries;
- names the branch review's verdict and what was done with each finding;
- names its residue: what is not verified, what waits (S-03, S-08; for U7a also O-40 and O-47), and anything logged as debt;
- U7a's states the limit of §E in one sentence: a session MAWS does not run here returns only for a turn the window sees begin after it has seen the session at rest, so one hidden while it worked, which ends that turn and begins another while the window is closed, stays hidden through that second turn, and a turn that both begins and ends while the window is closed is not seen at all;
- names its cross-build run with F by id, with its scene named as run and not skipped; U7b's gives the rehearsal's lines;
- says which e2e groups ran and where;
- ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.

U7a's pull request carries the dated amendment of the ruling S-11 reverses; U7b's carries those of O-40 and O-47 (M4 and M8, "the record").

## Surprises & Discoveries

- Observation: a row that is only listed, and the desk's web view, are named by the listing's `title`, which reaches the machine in a `member` frame; `titleOf` is not on that path.
  Evidence: `readMember` in `src/endpoint/rl10/members.ts`; `title: report.title` in `src/endpoint/listings.ts`; `title: fields.title` in `apps/desk-web/src/cards/board.ts`.
- Observation: a digest carries a turn's start only for a session MAWS runs.
  Evidence: `turnStartedAt: null` in `digest`, `src/services/index/source.ts`; `bridgedDigest` returns phase, activity and pending requests only.
- Observation: a second test pins a title that a cut by bare words would break inside a placeholder.
  Evidence: `sessions.test.ts`, "a pasted block titles as its placeholder, cut or whole": `Review this [Pasted text #1 +3 lines]` is seven runs of non-space characters.
- Observation: `stores/people.ts` writes over a stored set after a failed read.
  Evidence: its `load` sets `loaded = true` whatever `result.ok` is, and `toggle` then schedules a write of the set in memory.
- Observation: an agent's `show_pane` and a mod's pane reach the store's activating opens.
  Evidence: `showPane` in `tools/maws/panes/connect.ts` (`openFile`, `layout.openSession`, `panelHost.addTool(…, { activate: true })`); `activateIn` and `addTool` in `panel/host.ts` call `openSession` for a session that is not shown.
- Observation: every citation of Claude Desktop the section builds on was read again at `readable/app-5.1231.2/` and stands; one is narrower than the source (the dialog's second, larger size).
  Evidence: `shared-61-2ybPsRVk.js:6183-6185`; the others at the lines the section gives.

- Observation (the review, 2026-11-13): a machine named by the rows is in `listedMachines` whether or not the hub's snapshot is complete or the machine pending, so "named and absent" is not "gone".
  Evidence: `applyRows` in `stores/sessions.ts`; `takeRows` in `ipc/events.ts`; the case "keeps the named machine's restored tabs while the rows are incomplete or it is pending…" in `ipc/events.test.ts`.
- Observation (the review): a listing is signed again, with a new `issued`, whenever any field changes, so a newer `busy` listing can be a rename.
  Evidence: `#evaluate` and `#sign` in `src/endpoint/listings.ts`.
- Observation (the review): an `addTool` made before the layout is read is queued in the panel host and applied later, outside any synchronous scope of its caller.
  Evidence: `pending` and `passBarrier` in `panel/host.ts`, unchanged on `origin/ux-wave/U8b`.
- Observation (the review): the shape U13a calls canonical is one build F writes itself.
  Evidence: `git show f1852de3a:src/renderer/src/stores/layout-model.ts`, `openTab`: a tab of no session stays in the set that is showing.
- Observation: eight readers ask whether something is on screen, by six different rules; and three more listeners than `show_pane` bring a side surface forward without the person.
  Evidence: §N's table; `tools/browser/agent/connect.ts`, `tools/maws/ask/connect.ts`, `engine-surface/panes.ts`.
- Observation: Projects draws its own level-1 heading, as Customize does.
  Evidence: `projects/ProjectsView.tsx`, `<h1 id={heading}>Projects</h1>`.

- Observation (the drawn example, 2026-11-13): the title bar's right end is not the window's right edge while a side surface is open, and a page drawn "right of the sidebar" over a kept side column would leave the ring in mid-window with a blank strip beside it.
  Evidence: the side column is the grid's full-height right column (`panel/PanelRegion.tsx`, `row-span-3 row-start-1`), and the title bar spans two columns beside it.
- Observation (the drawn example): the dialog's box is 960 by 800 px only in a window at least 942 px tall; at the default window it is 960 by 697 px. A Close button 8 px in overlaps the body column's last 6 px, so right-aligned controls pass under it.
  Evidence: `WIDGET_DIALOG_BOX.library`, `h-[min(85vh,800px)]`; the drawing's measures (headless Chromium, not Electron).
- Observation (the drawn example): with Hide after the record's actions it was the eleventh item of a local session's menu, directly under "Delete conversation…"; and rows under the Hidden row, drawn as ordinary rows, started 23 px left of the row that holds them.
  Evidence: `SESSION_ACTIONS`' order; `SessionRow`'s inset for a row that is not nested (7 px) against "Show more"'s 30 px.

## Decision Log

- Decision: the verification call. This document gets one adversarial review before an executor starts, dispatched by the architect. Each branch gets the `doperpowers:review-code` xhigh panel, with the lenses of "Proof that an executor does not run": U7a by size, U7b by size and because the root calls the reader of the stored layout delicate. Class 1a on GitHub Actions is the gate of record for each landing.
  Rationale: root UC-10. Rejected for U7a: a single reviewer, since the hidden store's rules on three routes and a stored key are more than one pass holds beside the sidebar's tree.
  Date/Author: 2026-11-13, the document's author.

- Decision: one revision on the adversarial review (one P1, six P2, three short points) and on the architect's rulings of 2026-11-13, which bind where they differ from the review's smallest change. The cut into U7a and U7b stands.
  (1) *Referred and ruled:* the child's rule for when a hidden session returns ("a record's turn start; a listing's `busy` state issued after it") is replaced. No datum says when a turn began for a session MAWS does not run, and a listing's `issued` moves for a rename. The rule is §E's: a turn start later than the hide where one exists; elsewhere an entry is armed once the session was seen not working since the hide, and an armed entry returns when the session is seen working. The stored value is `{ at, armedAt }` per address. The architect amends the child's file. Rejected: an observed change into `busy` kept in memory only, which a relaunch forgets; a rule on `issued` with exceptions for renames.
  (2) Another machine's hidden entry is never dropped for being absent; the key is bounded at 500 entries instead, other machines' oldest first. Rejected: carrying the rows' `complete` and `pending` into the store, since absence on another machine is not evidence even then.
  (3) `quietly` holds only synchronously; who asked travels as data (`asked` on the panel host's `addTool` and `selectTab`) across every deferral, which §F lists. `panel/host.ts`, `tools/browser/agent/connect.ts` and `tools/maws/ask/connect.ts` join §J.
  (4) A retired Settings tab in front suppresses the stored page; `canonical` is stated as a test of shape; a legal one-set layout left by F with no retired tab in front may restore the page, accepted and pinned by a test, with no witness or marker.
  (5) The readers of "is this on screen" are listed whole, with owners and tests (§N), and the logical answer is kept apart from mounting and layout, the card column's place among it.
  (6) The rehearsal has an expectation of its own and the outcome `destination-mismatch`, with a unit case that makes it fail.
  (7) `e2e/browser-chrome.spec.ts` joins M8. M6 is built as two green commits.
  (8) On the thirteen points: 1, neither U7a nor U9 goes first by rule, and M2's decision 1 is written both ways; 2, accepted with U9's listing rule added; 3, replaced by (1); 4, 5, 7 and 8, accepted as repaired above; 6, the default stands; 9, changed: U7b removes Customize's own heading; 10 to 13, accepted.
  Rationale: the review's findings were each confirmed in the code it cites; the rulings are the architect's.
  Date/Author: 2026-11-13, the document's author, on the architect's rulings.

- Decision: one pass on the drawn example's nineteen points, by the architect's rulings of 2026-11-13; the nine points handed back with revision 2 were accepted as written. No further review follows this pass.
  *U7a (M3).* The rows under an open Hidden row are indented one step, and the Hidden row carries a chevron and `aria-expanded`. In a record's menu Hide stands directly after Pin, after the opening items where a menu has no Pin, so Archive and Delete stay last; one function places it (`withHide`). The row's own Hide button is one further step built on the owner's answer to question 1, which now goes to the owner with the button recommended.
  *U7b.* A page takes everything right of the sidebar: the side column is not drawn while a page shows, the title bar spans to the window's right edge, and Back shows the side column unchanged with nothing written. This replaces "keeps the side column's box" and adds a row to §N. The ring's place is the title bar's own right end. The dialog's box is written as measured, its edge and shadow are the library dialog's, and nothing passes under Close. In Settings › Usage the panel's title reads "Claude accounts", it has no horizontal padding of its own, and its grid is two columns from two accounts on. In the popover a name truncates and its mark does not, and a Codex account carries a muted "Codex". Back's tooltip is the literal "Back · Esc". Under 700 px nothing is added for the gear.
  Accepted as drawn: the sidebar's foot with the gear alone; the ring's colours as MAWS's severity colours at today's thresholds; 79 px for the ring with a number.
  Rationale: the drawing showed each of these; the rulings are the architect's, who amends the child's file where a ruling changes one of its sentences.
  Date/Author: 2026-11-13, the document's author, on the architect's rulings.

- Decision (M1, the executor's, folded by the controller): O-03 takes a third class, `focus-visible:-outline-offset-2` on the chip's button, beside the two of M1's decision 2. Once the wrapper clips, the outside focus ring would be clipped whole; the strip's tabs draw the same inset ring. Wherever R5 or §I says "two classes", whoever applies O-03 to the chip after U13a's M4 applies these three.
  `snapshot(machine, refused?)` in `ipc/events.ts` gains an optional callback that the three record reads pass to `answer` as its `failed`: §B's "the local snapshot's closure only" is read as this signature plus the closure, since decision 3 needs `answer`'s callback inside `snapshot`. Only `snapshot(local, …)` passes it; the `hydrate` call is untouched, and no sibling's hunk meets these lines.
  `SectionHeading` takes an optional `status` prop that keeps one `role="status"` element mounted (empty while there is nothing to say), so the word is announced when it appears; only the Projects heading passes it. `setReconnecting` writes only on a change, and `test-support/shell-stores.ts`' `resetShellStores` resets it. A mention's file name is its path's last non-empty segment, as Claude Desktop takes it (`@src/` gives `src`).
  Rationale: each is the smallest means of M1's decisions 2 to 4 that the code allows.
  Date/Author: 2026-11-13, M1's executor; folded by the controller.

- Decision (the owner's answers to the four questions of "What the owner should look at", 2026-11-12, the owner's local day, relayed by the architect). Question 1: "Button on the row (Recommended)", so M3 builds decision 9's button (22 px, left of the three dots, shown while the pointer is over the row or focus is inside it, "Unhide" in the Hidden list, never on a row that cannot be hidden), with its step in M4's "hide and unhide" and the changed measure in `e2e/ux1-sidebar.spec.ts`; the menu item is built as well. Question 2: "Ring alone (Recommended)". Question 3: "No (Recommended)": Settings is not open again after a relaunch. Question 4: "Leave the page (Recommended)". Each is the answer the document was written to; nothing of M5 to M8 changes.
  Date/Author: 2026-11-12, the owner, through the architect; recorded by the controller.

- Decision (M2, the executor's, folded by the controller). Built the first way of decision 1: U9's `remoteSessionActions` was not on the master merged at `6c92b03ff`; `app/session-actions.ts` is not touched. The listed row's own click, ⌘-click and middle-click call `openListed`; with no opener registered the row is selected and its card shows, as a plain click does. `ListedOpenItems` takes its two labels from `SESSION_ACTIONS` and reads whether they are enabled from `remoteOpenerFor` when the menu draws. The listing branch of `SessionItems` is taken only for an address with no record; one with neither record nor listing keeps today's answer. The listed rows' menus are pinned in `sidebar/reach.test.tsx`, not `HoverCard.test.tsx`, whose three assertions changed. One line of `e2e/share.spec.ts` (283), which M2 made false, is changed: a file this document did not name, edited only where M2's behaviour falsified it (typechecked, not run).
  Correction (the executor's): M4's remote step said "⌘-click adds a tab and keeps the tab in front"; both lanes' openers bring the new tab to the front, as a local ⌘-click does (M2 does not touch the openers). The step now says so.
  Date/Author: 2026-11-13, M2's executor; folded by the controller.

- Decision (the controller, 2026-11-13): M3 does not end with the whole `pnpm test`, as Concrete Steps 3 says it does. The owner's rule for the shared build VM (`build-common.md`, which Constraint 1 makes binding as written) has the whole unit suite run once per landing, by the builder of the last milestone; M4's acceptance run is that run. M3 ends instead with vitest over every folder its shapes reach (the sidebar, the stores, `src/shared/ipc`, `src/main/layout`, `app`, and the folders that import the changed modules), and `Sidebar.test.tsx` alone.
  Rationale: two whole-suite runs on one shared VM make every other builder's checks time out; M4 runs it a milestone later on the whole landing.
  Date/Author: 2026-11-13, the controller.

- Decision (M3, the executor's, folded by the controller). The hidden store is built as `createHiddenStore(client, { writeDelayMs, now })`, so each test has a store and a clock of its own. `HiddenStore` gains `attach(sources)`, through which the connection hands the store the looks, and `review()`, so that `hide` can take its look for `entryAt`. The end of a lead for a session MAWS runs reads `lastTurnEndedAt` from a source of its own, so §E's `Look` stays as written. A wake timer looks again at an unarmed `foreign` entry once `QUIET_MS` has passed: nothing in any store changes to cause that look, and without it the entry would never arm. Looks run only after the read has answered, the first of them at the answer; leads are the exception. For the drop rule an archived record counts as gone. The bound also applies in memory, so what is drawn is what is stored. A stored key that is not an address counts as another machine's. A refused read is logged.
  Hide also stands in the menu of a Needs you row of a record, because that menu is the same `SessionItems`. Its keyboard rule moves focus only when the act comes from a tree row. A listed session's Needs you row still has no menu (M2, decision 4), and the row's button is drawn on no Needs you row. After an act that moves focus, Radix's restore of focus on close is cancelled. The Hidden row closes when its count reaches 0, so the next Hide finds it closed. Hidden rows are drawn flat after the Hidden row, with no fold motion; indented rows carry `data-indented`. The button's glyphs are an eye and an eye struck through.
  No wire bump: `layout.*` commands are not on the wire manifest, and no wire file changed. The e2e lists M3 made false were changed in M3 (`e2e/shell.spec.ts` long scene, `e2e/sessions.spec.ts` "foreign-live: …" twice, and with the button `e2e/ux1-sidebar.spec.ts`'s hover measure); M4 writes the new scenes.
  Date/Author: 2026-11-13, M3's executor; folded by the controller.

- Decision (the architect's ruling, 2026-11-13, on the controller's report of M3): a Needs you row carries no Hide, neither the row's button (as M3 already says) nor the menu item, whether or not the session has a record. A session that needs the person stays listed under Needs you whatever is hidden (root UC-1), so an item that leaves its own row in place reads as an act that did nothing. The session's row in the tree keeps both the button and the item, and hiding it there still leaves it under Needs you. Pinned by a test: a Needs you row's menu holds no Hide, and the same session's tree row's menu does. Built in M3's fix round.
  Rejected: the same items wherever a session is listed, which is the simpler code and the more confusing menu.
  Also from the architect: the cross-build run against build F is the architect's, and waits for a gate flag (`--peer-exact`) now in a pull request, because F is off master's first-parent chain and `--peer f1852de3a` is mapped to another commit. No executor or controller starts it.
  Date/Author: 2026-11-13, the architect; recorded by the controller.

- Decision (M3's fix round, the executor's, folded by the controller): the menu's target records whether its row is in the tree, and Hide and Unhide are drawn only for a tree row, so Needs you keeps the one shared `SessionItems` and `NeedsYou.tsx` is untouched. With Hide reachable only from the tree, decision 6's focus rule holds without exception. The four `act()` warnings of `palette/CommandPalette.test.tsx` are on the branch before M3 too (counted at `c5bfe9cf9` and at the head): not this landing's.
  Date/Author: 2026-11-13, M3's executor; folded by the controller.

- Decision (M4, the executor's, folded by the controller). "hide and unhide" hides a session of the stub scenario that is at rest, in a project with no pinned row, so that "first after Unhide" proves the lead and not a pin; the row's button step follows the menu's Unhide after the relaunch, in the same scene. "Indented" is asserted by `data-indented` and by the computed left padding (30 px against 7 px). The remote step stands before the scene's first plain click, while the row is only listed, asserts the menu's first three items exactly and then only Share… and Add owner…, asserts that ⌘-click adds exactly one tab and that it is in front, and ends with Unhide so that the scene's later steps are unchanged. *(sidebar, both ways)* stops `mawsd` between the builds, sets the window to 1360 px before each fold, and reads the peer's side of `sidebar.hidden` from `layout.json` on disk, since the peer's schema refuses the key. U13a's coverage table is not on this branch: decision 2's row is a comment table at the head of the scene's block at the end of `e2e/cross-build.spec.ts`, and one line at the file's head points to it; whoever lands second joins the two tables. The S-11 sentence is recorded word for word in both places of decision 3.
  `test/support/tokens-guard.test.ts` refuses `#<number>` in renderer sources: nineteen ticket numbers in M1 to M3's comments are written in words ("ticket 407") in one commit, `07821ccd0`, the only edit of product files in M4, comments alone.
  Date/Author: 2026-11-13, M4's executor; folded by the controller.

- Decision (the branch review, xhigh panel over `d3c7edce3..3b620d532`: "incorrect", five findings each confirmed by its verifier; the architect's rulings, 2026-11-13; built as one fix wave on M3's executor):
  (1) A lead's quiet deadline is a deadline: the store's wake timer takes the leads' deadlines as well as the hidden entries' (a transcript-read lead found working wakes the store at its newest record plus `QUIET_MS`), so unhiding the last hidden foreign session no longer leaves a lead that outlives the quiet time until some other update.
  (2) Until the stored read answers, only the write of the unread stored set waits: looks at the entries this run made apply at once, and their changes (a return or a drop as "not hidden") are carried into what is stored when the read resolves or is retried. So a session hidden busy while the read is held, then seen idle and busy again, returns in this window, with the read answered or refused once.
  (3) An entry is never armed from a bridge that has given no snapshot; inside a reconnect it is armed from the last snapshot. Built in main, not in the window, which cannot tell a provisional bridge from a real idle (an empty fold reads `running: false`; `LaneAState` carries no freshness): in `src/services/spine-root.ts`'s lane-A listener, while a bridge is live and its view is not fresh, `setBridged` is not called and the digest keeps what it had, its `foreign` seed before the first snapshot, the last snapshot's phase and count inside a reconnect (what master shows then: the driver keeps the stale state with `fresh: false`). No wire minor, no new field; build F's daemon is untouched. `src/services/spine-root.ts` is an insertion in a file of the session that keeps master. *The limit:* a Hide made while a terminal session's state stream reconnects, when a turn began inside that interval, returns at the interval's end. Rejected: calling `setBridged(null)` while not fresh, which turns every bridged row to `foreign` with no waiting count through every reconnect, a visible regression for everyone to close a case that needs a reconnect, a turn begun inside it and a Hide inside it at once.
  (4) The Hidden rows keep the held order while the sidebar's interaction hold stands, like every other row: their activity order is settled and held with the ranks.
  (5) A row that returns while it holds the keyboard keeps it; when the Hidden row goes while focus is on it or inside it, focus goes to the row that returned, else to the project's row; no focus is taken when the sidebar did not hold it. Placed by a layout effect, `ProjectRow`'s two lists left as they are (one list would still have React move a focused node). The case the ruling left open, accepted by the architect: a focused row under Hidden that leaves without returning, while the Hidden row stays, gives the keyboard to the Hidden row.
  Date/Author: 2026-11-13, the architect's rulings on the branch review; recorded by the controller.

- Decision (the controller, on the task review of the branch review's fix wave, 2026-11-13): ruling (5) also holds past the caps. A returning row that holds the keyboard, on itself or on the Hidden row its return empties, joins the set `shownTrees` already exempts from the five and the eight, for as long as the keyboard stays on it; ranking still reads the spawned set alone, so it keeps its own rank and gains no lead, and it falls under the caps again when the keyboard leaves. When the return empties the Hidden row, the tab stop moves to the returned row. The fix wave (`4f21f91f0..8bdbaeca5`) is reviewed clean.
  Date/Author: 2026-11-13, the controller; built by M3's executor.

## Outcomes & Retrospective

**U7a (2026-11-13, at the controller's hand-back; the branch review refreshes it).** The five items are built as the document planned, with the row's Hide button on the owner's answer: six words of the prompt name an untitled session and the search still reads the whole prompt; "reconnecting" stands beside Projects while this Mac's reads are refused; the chip clips inside its 96 px; a listed row opens through its lane's opener, in a tab of its own on ⌘-click, middle-click and its menu, and Needs you does the same, anchored items included; Hide and Unhide from the tree's rows' menus and buttons, "Hidden · N" with its chevron and indented rows, §E's return rule on every route, the drop rule and the bound. What changed against the document: a third class on the chip (focus ring); no Hide on a Needs you row (the architect's ruling); the new tab of a listed row comes to the front; M3's whole-suite run moved to M4 under the VM rule. Each task review found something real (an anchored Needs you item skipping the opener; a Hide leaving the held order to release on a later update; hidden lineage children's keyboard parent; a remote step that a plain open would pass), each fixed with a test that failed first. Not verified by the builders: every e2e scene (written and typechecked only), the cross-build crossing with F, and the whole unit suite after `07821ccd0` (comments) and the fix round (one effect's dependency list and one e2e step), for which the touched folders ran.
