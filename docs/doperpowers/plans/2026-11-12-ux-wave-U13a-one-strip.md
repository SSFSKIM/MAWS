# UX wave · U13, first landing (U13a): one strip for everything open

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U13, first landing (**U13a**): the one strip and UC-14, with the small edits in the title bar, the sidebar and the empty pane. **Parent pin:** `25942f5d1`, the head of branch `ux-wave-spec` this document was written against.
>
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U13-tabs-new-chat-groups.md`, cited below as *section* (its acceptance items as A1 to A12, its contract rules as rule 1 to rule 8). This document carries the constraints, the milestones and the interfaces, and nothing of the design. Until the spec's pull request lands, the root and the section are read on branch `ux-wave-spec`.
>
> **Branch:** `ux-wave/U13a`. **Board:** #578, under epic #573 (the root's tracking map as of `f89e15baa`, a commit after the pin that changes nothing this document rests on). **Items:** O-01, the first half of O-31, #497. **Not in this landing:** session groups, the sidebar's views and the folded sidebar (the section's "Groups"); they follow a design round with the owner.

## Purpose

Today the main tabs are kept in one hidden set per project. A click on a project in the sidebar, or a New chat pressed from a project with no folder on this Mac, swaps the strip to another set, and the owner reads that as tabs being replaced. After this landing there is one strip: every open tab, from every project and machine, in one place, the same after a relaunch. New chat adds one tab and brings an empty one back instead of adding another; a New chat tab that arrives late takes nothing from the tab opened meanwhile; the title bar's project chip shows the project in the sidebar and starts no session.

The build on the owner's machines today, build F (commit `f1852de3a`), reads the stored layout strictly, and the owner will run F again on the same profile after trying the wave's build. So everything this landing stores must be something F reads whole (UC-14, which this child owns).

**What a trial leaves on a profile.** After the wave's build has run on a profile, F opens it with every tab, and nothing else of the strip is promised. F puts each session's tabs back into a set per project and shows the set of the tab that was in front. The order of the tabs, a split across two sessions and the split's floating card are F's own from there. If a split had been expanded with the side column folded, F opens the side column again. F also starts its own memory of which session the side column shows for each project. When the wave's build opens the profile again it brings every set into the strip again, in the order F left, and shows its notice again. The section's "nothing is lost when build F is run again" and the root's acceptance 6 are read as "no tab is lost" (the architect's ruling of 2026-11-12, who rewords both). Interfaces §H has the detail.

**How to see it working.** In the suites: the unit tests named under each milestone, and the e2e scenes of M5. On the wave's build by hand: open sessions of two projects, click project rows in the sidebar, and see the strip keep every tab; press New chat twice and see one empty chat; quit, relaunch, and see the same strip. Across builds: the cross-build run with F as the peer ("Proof that an executor does not run").

## Progress

- [x] (2026-11-12 22:46Z) Document written against master `85e934368`; the section checked against the code at that head ("What the code holds today").
- [x] (2026-11-12 23:09Z) Adversarial review of this document: its five findings and two remarks, and the architect's rulings on the six points reported at authoring, are folded in (Decision Log).
- [ ] Step 0 on master (U6a and U8a landed); this branch merges it (not a rebase: Decision Log, 2026-11-12 23:40Z). M1 runs before it, on the architect's word, over a merge of master at `eeba4e916`.
- [ ] M1 — The stored form and its reader.
- [ ] M2 — One strip in the store, and the current project.
- [ ] M3 — New chat.
- [ ] M4 — What the tabs and the title bar show.
- [ ] M5 — The e2e scenes, the record, and the acceptance run.
- [ ] The proof an executor does not run: the branch review, the rehearsal, the cross-build run with F, the e2e groups, the owner's look, class 1a on the final head.
- [ ] Pull request opened on the architect's word.

## The landing's edge

**In.** O-01: the strip's model, its stored form and reader, the upgrade and its notice, the current project, New chat's one entry (`newChat`) with the reuse of an empty chat, how a tab names its place, "Close tabs to the right". O-31, first half: the chip. #497: the late tab. The e2e scenes for these, and the dated amendments of the two rulings this landing reverses.

**Out.** Groups, the sidebar's views, the folded sidebar (O-31's second half, O-42, O-24). Everything the section lists under "Not in this child" (among it: U7's destinations and Settings dialog, U6's Back and Forward and files beside the chat, U9's drawing of a tab whose machine is not reachable, the chip's box being narrower than its text). Any change to the keymap table. Any change to what main reads from `main.tabs`. The register and the board, which the architect updates at landing.

## Constraints that bind every milestone

1. **Where work and checks happen** (root UC-10; `~/.local/share/maws-ux-wave/briefs/build-common.md`, which binds as written). On the MacBook: edit, commit, push; no `pnpm install`, typecheck, eslint, vitest, build or Electron. Every check runs on the wave's build VM in a checkout of the pushed head, through `vmcheck.sh` (Concrete Steps). Electron e2e is never started by an executor. No pull request is opened by an executor. Every commit message ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.
2. **What is stored, build F can still read** (root UC-14, owned by this child). F's reader of the layout is today's `src/shared/ipc/schema/layout.ts`, byte for byte (`git diff f1852de3a 85e934368 -- src/shared/ipc/schema/layout.ts` is empty), so:
   - `main.tabs` is written only through `storedMain` (Interfaces §A): version 3, `current: "none"`, exactly one set under `none`.
   - This landing adds no field to a stored tab, to a set, to `main.tabs`, to `regions` or to `panelTools.surfaces`; moves no version; adds no tab kind and no layout key.
   - `panelTools.surfaces.contexts` is written with at most one entry, under `none`.
   - No existing schema in `src/shared/ipc/schema/layout.ts` is edited. What M1 puts there is added beside them.
3. **Files other children own** (root UC-8, with the insertions the architect added to it on 2026-11-12). This landing owns `src/renderer/src/main/` except `Pane.tsx`, `stores/layout.ts`, `stores/layout-model.ts`, `overview/Overview.tsx` and the `main.tabs` part of the schema. Each edit elsewhere is the smallest insertion that does the job, and is one of these: `keymap/actions-runtime.ts` (U6: New chat and the current project), `shell/transfer.ts` (U6), `sidebar/Sidebar.tsx`, `sidebar/reveal.ts`, `sidebar/ProjectRow.tsx`, `sidebar/menus.tsx`, `sidebar/registry-new-chat.ts`, `app/Toolbar.tsx` (U7), `panel/surface-model.ts` (U8), `main/Pane.tsx`, `lane-b/remote-connect.ts` (U9), `shell/floating.ts` (U10: one comparison and five calls), `customize/CustomizeView.tsx` (U11). Test files and test helpers anywhere change only as the store's new shape forces. An executor that finds a further file of another child must change, beyond a fixture's shape, stops and reports it.
4. **The repository is public** (root UC-11). Fixtures use invented ids, titles, paths and names. The rehearsal (M1) prints structure and counts and nothing else.
5. **The wave's laws.** Law 3: no setting is added. Law 7: tabs, the chip and the menu use today's tokens and shapes. Law 8: the relaunch that restores what was open is the owner's `keep` (l7-shell-12); an executor that finds a `keep` would change stops and reports.
6. **No key changes** (root UC-6; A12). `src/shared/keymap/actions.ts` is not edited by this branch. "Close tabs to the right" is a menu item with no chord.
7. **Waiting marks** (root UC-1, consumed). A tab's waiting mark stays drawn from the attention store as it is today; this landing adds no second reading of "waiting".
8. **Copy** is in Interfaces §G and is used exactly as written.
9. **Base.** The branch is rebased onto a master that holds U6a (the keymap table's new fields) and U8a (the working-folder selector) before M1 starts. This landing consumes nothing from either: it adds no row to `ACTIONS` and reads no working folder. They come first only because the root's ordering lands them before any other child branches.

## What the code holds today

Checked at `85e934368`; F's side read with `git show f1852de3a:<path>`. Listed here is what an executor would not learn from the section alone.

- **F's reader.** F parses `main.tabs` with the same strict schemas as this head. F's own first-launch default is the one-set value under `none`, so the stored form of this landing is a value F writes itself.
- **What F does with a one-set value.** At hydration F's `refile` (`stores/layout-model.ts` at `f1852de3a`) moves each tab whose session has a row into that row's set, one tab at a time, each placed after the active tab of the set it joins, in one pane. Every tab is kept, with its pin. A split across sessions, a floating card, the order of tabs inside a set, and each set's active tab are not kept as the strip had them. The strip F then shows is the set of the tab that was in front; when that tab belongs to no session, F shows `none`, which then holds only the tabs of no session. A floating card that carried `foldedPanel` (Expand had folded the side column) is lost with its split, and F's `reconcileFold` then opens the side column again.
- **What F writes back, and when.** `main.tabs`: at hydration only when F's reader rewrote the value, learnt a title, dropped a fold (the case above), or replayed a tab change made before its read finished; a refile alone writes nothing, so otherwise `layout.json` keeps the one-set value until F's next change of the tabs. `regions`: at hydration when the fold's end opened the side column. `panelTools.surfaces`: at hydration whenever F remembers the session of the set it shows and the stored value has no such entry, which after a wave build is the usual case; F adds its own entry and keeps `none`.
- **`panelTools.surfaces`.** F accepts any string key in `contexts`; it reads the entry of the set it shows and falls back to the set's first session. The value is parsed strictly as a whole, so what F draws from its other fields (the tools pinned in the icon row) shows that F read all of it.
- **A commit function exists.** In `createLayoutStore` (`stores/layout.ts`) every change of the tabs or of the regions already lands through the closure `commit(nextMain, nextRegions)`, which applies the fold rule, titles the session tabs and remembers the side column's session. Hydration is the one writer beside it.
- **The chip** draws today only when the strip's set has a folder on this Mac (`localProjectOfSet`); a machine's row and a project with no folder here show none.
- **The tab's project label.** `main/Tab.tsx` names the project when the session's set key differs from `main.current`. In the unit tests every session is in the `none` set, so every session tab with a record is labelled there today (about a hundred `· <project>` strings in `main/MainArea.test.tsx`).
- **Tab widths.** A tab is at most 240 px (`max-w-60`) and has a minimum width computed from its marks (64 px bare, 96 px for the tab in front). The project label does not shrink today (`shrink-0`), and the minimum reserves 80 px for it. The All tabs menu exists and is drawn only while the row overflows.
- **`revealProject`** (`sidebar/reveal.ts`) takes a project id of any machine and already reveals by row key inside; it has no entry that takes a row key, which a machine's row and a project with no record here need.
- **An empty chat, as the code can tell it.** `unstartedReplaceVerdict` (`sessions/setup-actions.ts`) already answers "blank" for an unstarted chat: not starting, no first message held, an empty draft (the live editor's when mounted, else the intent's). An intent also records a fork (`kind: 'fork'`, `lineage`), a checkout a failed attempt created and kept (`progress.worktree`; discarding the intent leaves the worktree and shows a notice), and a failed attempt (`progress.lastFailure`).
- **Launch mode `scenario`.** With a stub session source (`MAWS_SESSION_SOURCE=stub:…`, which `e2e/shell.spec.ts` and `e2e/ux2-shell.spec.ts` use), the creator is `app/scenario-session-creator.ts` and nothing of `sessions/` is registered except the tab retention: a new session there has no intent and no draft store.
- **`newChatIn`** (`e2e/support/sidebar.ts`) presses a project row's "+" and waits until the tab in front is a session tab whose id was not in the strip before the press.
- **`panelSessionForArtifact`** (`shell/transfer.ts`) picks the session whose side column takes an artifact by looking at one set: the set keyed by the artifact's library project, else the set that holds the artifact's tab.
- **`customize/CustomizeView.tsx`** reads `main.current` itself to find the project its page is about.
- **`LAYOUT_DEFAULTS.main`** is used in about fifty places in tests as the store's empty value (`useLayout.setState({ main: LAYOUT_DEFAULTS.main })`) and in a few as the stored value a fake bridge holds.
- **The ordinary close is asynchronous before the tab goes.** `requestCloseTab` (`keymap/actions-runtime.ts`) awaits the kind's guard and only then takes the tab out of the strip. The session guard (`beforeCloseUnstarted`) looks at the draft once and then awaits `session.intent.discard`. Between the look and the answer the tab is still in the strip and can be selected and typed into, and the discard takes what was typed.
- **`focusPane` has two kinds of caller.** Some follow where the keyboard or a press already is: a pane's and the split card's focus and pointer capture (`main/Pane.tsx`, `shell/FloatingCard.tsx`), the compact composer (`focusCompactCard`), and a pane's or a strip's own tab cycle just before `cycleTab` or `activateTab`. The others are the person choosing a pane: `pane.focusOther` in `app/shell-actions.ts`, and `floatSplit`, `dockSplit`, `openCard`, `closeCard` and `focusSplitCard` in `shell/floating.ts`.
- **The two settings files.** `<profile>/settings.json` (the client half, written by main) and `<profile>/machine-settings.json` (the machine half, written by `mawsd`). Both are parsed strictly; a file a build cannot read is logged as `[settings] invalid <file>; using defaults` or `[settings] cannot read <file>; using defaults` and is not written by that build. Nothing under `src/shared/settings`, `src/main/client` or `src/services/settings` differs between F and this head, and this landing changes none of it.
- **Where a cross-layer test lives.** `test/**/*.test.ts` is in the unit suite's node project, and tests there import main, the services and shared together (`test/lane-b/`, `test/mawsd/`); `test/support/console-capture.ts` captures console output for a test.

## Plan of Work

Five milestones, one executor each, a review at each boundary. M1 is the delicate part (root UC-10 names the reader of the stored layout) and is kept alone so that it is reviewed alone and so that the rehearsal can run as soon as it is reviewed. M2 is the cutover and is kept whole by choice: the store's value changes type, and every reader and every fixture of it changes with it. It could be cut in two with a temporary adapter (one-set behaviour first over a one-set `LayoutMain`, then the unwrap to `Strip` with the fixtures); that would touch the model and the store twice and leave an adapter to remove, and the price of not doing it is one large review. M3 and M4 each build on M2 and not on each other. M5 writes the e2e scenes in one pass, because no executor can run them and one orientation in the e2e harness is enough.

Terms used below. **The strip:** the one set of open main tabs for the window, two rows of tabs under a split (section, "The strip"). **The stored form:** what `main.tabs` in `<userData>/layout.json` holds. **A set:** one of the per-project tab layouts a stored value from F holds. **A row:** a sidebar row, a project's or a machine's own, named by its `RowKey` (`stores/org-projects.ts`). **The tab in front:** the active tab of the focused pane. **The session in front** and **the current project:** rule 4 and rule 5. **An empty chat:** Interfaces §E. **The controller:** the plan-executor that runs the milestones, reviews each at its boundary and is this document's one writer while they run. **The VM:** the wave's build machine, reached through `vmcheck.sh`. **Class 1a:** typecheck, lint, the unit suite and the probes on GitHub Actions, through `scripts/ci-gate.sh`. **The peer:** the other build in the two-build e2e group (`e2e/cross-build.spec.ts`); here it is F.

Expected size, in lines added plus lines removed, so that the controller can judge each review: M1 about 520; M2 about 2,300, of which about 900 are test blocks deleted with the behaviour they tested and about 350 are fixtures changing shape, which leaves about 1,050 to read closely; M3 about 700; M4 about 550; M5 about 820. About 4,900 lines over about 98 files in all.

### M1 — The stored form and its reader

**What exists at its end.** Two pure functions: one makes one strip of any stored `main.tabs` this build can parse, the other makes the stored form of a strip. Tests prove that a stored value with several sets loses no tab and repeats none, and that main counts the same sessions as open before and after. The rehearsal over copies of real layout files can be run. Nothing in the app calls the functions yet.

**What it touches.** `src/shared/ipc/schema/layout.ts` (additions only), `src/shared/ipc/schema/layout.test.ts` (additions), a new test beside `src/main/layout/open-session-tabs.ts` for A7, and three new files under `test/layout/`: `rehearsal.ts` (the rehearsal's logic), `rehearsal.test.ts` (its own tests, always run) and `owner-files.test.ts` (the gated runner).

**Interfaces.** Exposes §A to M2. Consumes nothing.

**Decisions.**
- The functions live in the shared schema file, not in `stores/layout-model.ts`, because the A7 test and the rehearsal call them beside main's two readers (`sessionsInTabs`, `remoteSessionsInTabs`) and neither may import the renderer.
- M1 changes no existing export. `LAYOUT_DEFAULTS.main` changes in M2, with the store.
- `stripOf` removes a tab id that appears in more than one set, keeping the first it meets (the set that was showing first). Today `repairMain` does this across sets; after M2 it only sees one strip.
- The fixture for A6 has five sets: the one that was showing with a split, a pinned tab and a floating card; `none`; a machine's row; two project rows, one of them holding a pinned tab, a split of its own and a tab id the first set also holds; and a closed-tab history. All ids, titles and paths invented.
- **The rehearsal** is under `test/`, where a test may import the shared reader and main's two readers together. `owner-files.test.ts` is skipped unless `MAWS_LAYOUT_REHEARSAL` names a directory, in the way `src/engine-host/bundle-guard.test.ts` skips without a build. For each `*.json` there, in name order, `rehearsal.ts` reads `main.tabs` and `panelTools.surfaces` as the app would, runs `stripOf` then `storedMain`, and compares. The session comparison runs `sessionsInTabs` and `remoteSessionsInTabs` once per machine ref found in the file's tabs, each as the local machine.
- **Nothing of a file's content leaves the rehearsal** (constraint 4; its lines go into a public pull request). The logic is one boundary that returns, per file, a label it generates (`file 1`, `file 2`, in name order; the architect keeps the list of names), numbers, booleans, and one word from a closed list: `pass`, `unreadable`, `not-json`, `not-a-layout`, `main-tabs-absent`, `main-tabs-rejected`, `surfaces-rejected`, `tab-missing`, `tab-added`, `tab-twice`, `sessions-differ`, `not-stored-form`, `internal`. Every read, parse and conversion runs inside it under a catch that keeps the word and drops the error, because a file-system error carries the path, `JSON.parse`'s message can quote its input, and a schema issue can quote a value. What the reader prints while it runs (`dropUnknownTabs` warns with the kinds it dropped) is captured for the length of the read and reported as a count. The runner prints the returned lines and makes one assertion, on the number of files that did not pass. No value read from a file, no file name and not the directory's path is passed to `expect`, interpolated into a message, or printed. The boundary takes its two converters as an argument, so that a test can hand it a broken one.

**What it does not touch.** The store, the model, any file under `src/renderer/`, any existing schema or reader.

**What it proves.** A6's unit half and A7. Its tests also pin: the set that was showing keeps its panes, order, pins, active tabs, focused pane, ratio and floating card; the other sets' tabs follow in stored order, left pane before right, at the end of the focused pane, pinned ones at the end of its pinned tabs; none of them becomes active unless the strip was empty, and then the first does; `closedTabs` is kept; a version-1 value becomes the strip it already is; `stripOf(storedMain(s))` gives `s` back with `merged` false and `canonical` true; a value with one project-keyed set, and a value with an empty set beside `none`, are not merged and not canonical; `storedMain` output parses under `LayoutMainSchema`. The rehearsal's own tests, each with an invented sentinel string and a temporary directory whose path is searched for too: a file that is not JSON and holds the sentinel; a layout whose `main.tabs` holds a tab of an unknown kind named by the sentinel; a file that cannot be read; and a failing comparison, forced with a converter that drops the tab whose id holds the sentinel. Each proves that the returned lines, everything written to stdout and stderr during the run, and the message of the runner's failed assertion hold neither the sentinel nor the path.

### M2 — One strip in the store, and the current project

**What exists at its end.** The app runs on one strip. The layout store holds a `Strip`; hydration merges whatever is stored into it and writes the stored form back; a click on a project or machine row only opens or closes the row; a session of any project opens in the strip that is there; the upgrade shows its notice once. The current project is the row of the session in front, and New chat, the chip and Customize read it. Two interim states stand until M4 replaces them: the chip names the current row's folder on this Mac and still starts a chat, and every session tab with a record names its project.

**What it touches.** `src/shared/ipc/schema/layout.ts` (`LAYOUT_DEFAULTS.main`), `src/renderer/src/stores/layout-model.ts`, `stores/layout.ts`, `keymap/actions-runtime.ts`, `ipc/events.ts`, `sessions/connect.ts`, `panel/surface-model.ts`, `shell/floating.ts`, `shell/transfer.ts`, `lane-b/remote-connect.ts`, `sidebar/Sidebar.tsx`, `app/Toolbar.tsx`, `app/shell-actions.ts`, `customize/CustomizeView.tsx`, `main/Tab.tsx`, `main/TabStrip.tsx`, the three harnesses that build the store's value (`harness/composer/ComposerHarness.tsx`, `harness/widgets/WidgetsHarness.tsx`, `harness/panel/PanelHarness.tsx`), `test-support/panel.tsx`, `test-support/shell-stores.ts`, and the unit tests the change reaches (below).

**Interfaces.** Consumes §A. Exposes §B, §C, §D and §F to M3, M4 and the siblings.

**Decisions.**
- **What goes** is the section's list (Advice): `switchSet`, `moveToSet`, `tidy`, `refile`, `rekeySets`, `rekeyContexts`, `fromV1`, the store's `setCurrentProject`, `refileTabs`, `setOfSession`, `projectOf`. `rekeyExpanded` stays, and so does the store's `rekeyProjects` under its name: it now migrates the sidebar's expanded rows and nothing else, so `ipc/events.ts` keeps `rekeyOf` and its two calls and loses `projectOf` and the `refileTabs` calls.
- **Hydration**, in order: parse; `stripOf`; drop the fold when the panel is open (as today); `repairMain`; replay the changes made before the read over that strip; fold rule and titles. `main.tabs` is written at hydration for the reasons it is written today, less the migration that goes (the key absent, a version-1 value, a value the reader rewrote, a dropped fold, a learnt title, replayed changes that differ), and for one more: the stored envelope was not canonical (§A). That covers every merge, and it covers what a merge does not: a value with one project-keyed set, or with an empty set or a set of duplicates beside `none`. Without it such a value would stay under its project key while `contexts` is rewritten under `none` at the same hydration, and the next launch would look for the remembered session under the project key and find none. Whether the reader rewrote the value is judged on the value as stored, before `stripOf`. A value the reader rejects is left in the file as today, and so is a tab that `repairMain` alone dropped from a canonical value: this landing does not make hydration write more eagerly than that.
- **The remembered session** of the side column: at hydration `contexts` becomes the entry of the set that was showing, under `none` (for a version-1 value, the `none` entry), and nothing else; it is written back when that changed it. `surfaceSession` and `rememberSurfaceContext` read and write `contexts.none`.
- **The notice** follows `merged` and nothing else; the write follows `canonical` and the reasons above, and nothing of `merged`. `hydrate` resolves `{ merged }` (§B); `ipc/events.ts` shows the notice of §G when it is true. No key records that it was shown: the value written back has one set, so the next read does not merge. After a run of F on the profile the sets are back and the notice shows again, which is true each time.
- **`LAYOUT_DEFAULTS.main` becomes the empty strip.** The other choice, a new constant beside an unchanged default, would edit about fifty test files of other children that only reset the store. A fake bridge that holds `LAYOUT_DEFAULTS.main` or `mainShowing(...)` under `'main.tabs'` then holds a value the reader rejects, and the test may still pass on the fallback: each such place stores `storedMain(...)` instead. Among them: `stores/layout-persist.test.ts`, `app/Shell.panel.test.tsx`, `app/regions.test.ts`, `panel/host.test.tsx`, `panel/surface-lifecycle.test.ts`, `panel/surface-model.test.ts`, `shell/floating.test.ts`, `shell/SplitCard.test.tsx`, `tools/artifacts/artifacts.test.tsx` and the `persisted` helper of `test-support/panel.tsx`; a search for `'main.tabs'` in the test tree finds every place a stored value is built.
- **Writers of the stored form** are three and each goes through `storedMain`: the persistence's `storedValue`, hydration's write-back, and `retryRemoteSession` in `lane-b/remote-connect.ts`.
- **`shell/transfer.ts`.** `panelSessionForArtifact` chose among the session tabs of one set. Over one strip it chooses among the strip's session tabs whose session sits under the same row as the artifact's library project when the library row names one, else among all of them; of those, the session in front, else the remembered one, else the first; none when there is none, which keeps today's refusal. The two `main.current` comparisons (there and in `shell/floating.ts`) and the one in `requestCloseTab` go, as the section says.
- **A pane the person chose** (rule 7; §C). The store gains `showPane`, which lands through `commitShown`; `focusPane` stays for the callers that follow where the keyboard or a press already is ("What the code holds today"). Six calls change from `focusPane` to `showPane`: `pane.focusOther` in `app/shell-actions.ts`, and `floatSplit`, `dockSplit`, `openCard`, `closeCard` and `focusSplitCard` in `shell/floating.ts`. Nothing behaves differently in this landing: the two make the same change of the strip until U7 gives `commitShown` an effect.
- **The drop of a sidebar row on the strip** (`main/TabStrip.tsx`) always moves the tab to the drop point.
- **`harness/panel/PanelHarness.tsx`.** `switchSession(null)` relied on the no-project set holding no session. It now leaves the strip holding only the Diagnostics tab, which is the same state for the panel: no session shown. Three scenes of `e2e/panel.spec.ts` use it (M5 lists them for the run).
- **Interim rules**, chosen so that M2 edits no assertion M4 will edit again: the chip keeps its click and its menu and names the current row's folder on this Mac (`useCurrentRow`, then the rule `focusedProject` applies); `main/Tab.tsx` names the project of every session tab that has a record, which is what the unit tests see today.
- **Tests.** Deleted with the behaviour: the per-project blocks of `stores/layout-model.test.ts` ("tab sets per project", "rekeying project sets to org keys" except the `rekeyExpanded` case and its fixtures, the registry block) and of `stores/layout.test.ts`, the filing cases of `ipc/events.test.ts`, the "tab sets per project" block of `main/MainArea.test.tsx`, the set-switch assertions of `shell/floating.test.ts`, `shell/SplitCard.test.tsx` and `panel/surface-model.test.ts`. Rewritten: the cases of `stores/layout-persist.test.ts` that compare a written `main.tabs` with the store's value (they compare with `storedMain` of it), `lane-b/remote-connect.test.ts` and `session/SessionPane.test.tsx` (the retry's written value), `shell/transfer.test.ts` (the three cases on an artifact's session), `sessions/actions.test.ts`, `sidebar/Sidebar.test.tsx` and `app/Toolbar.test.tsx` (their setup puts a session in front where it called `setCurrentProject`; the two Sidebar cases that expect a row's click or Enter to change `main.current` expect the strip unchanged), `customize/CustomizeView.test.tsx` and `customize/customize-machine.test.tsx` (the page's project comes from a session in front). Fixture shape only: every other test that builds the store's value with `sets`; `mainShowing` in `test-support/panel.tsx` is fixed once for its twenty-one importers. `fileTabsByProject` in `test-support/shell-stores.ts` goes with `projectOf`.

**What it does not touch.** `newChat`, the reuse rule and the late tab (M3). The tab's place, the chip's click and "Close tabs to the right" (M4). Main: `src/main/layout/` and `src/main/lane-b/remote-interest.ts` are not edited. The e2e specs.

**What it proves.** A1, A11, and the unit halves of A5 and A6. Its tests pin: a stored value with several sets hydrates to one strip with the tab that was in front still in front, is written back once as one set, and reports `merged`; a second hydration of what was written reports no merge and writes nothing; two hydrations of a stored value with one project-keyed set, whose tab in front is not a session's and whose remembered session is not the set's first: the first shows no notice and writes `main.tabs` in the stored form and `contexts` under `none`, the second writes nothing, and the side column's session is the remembered one after each; a strip written and read back is the same strip (order, pins, split and ratio, floating card, each pane's active tab, the focused pane, the closed history); a tab opened before the read is replayed over the merged strip; a click, Enter, ArrowRight or Space on a project row and on a machine's row leaves the strip as it was; a session of a second project opens beside the first project's tabs; opening a file with a session beside an artifact tab and a document tab leaves both in the strip (A11); `currentRow` follows the session in front and stays on it while a tab of no session is in front; `focusedProject` answers that row's folder here and null for a machine's row, a hidden project and a project with no folder here; the notice shows once for a merged read and not for an unmerged one.

### M3 — New chat

**What exists at its end.** Every New chat control calls `newChat`. With three tabs open a press adds one tab after the tab in front and the three stay, also when the session in front belongs to a project with no folder on this Mac. A second press with an empty chat in the strip leaves one empty chat. A chat that arrives after another tab came to the front is added unselected.

**What it touches.** `src/renderer/src/keymap/actions-runtime.ts` (`newChat`, `closeEmptyChat`, `createSession`'s arrival, the `session.new` registration, the empty-chat registry), `sessions/setup-actions.ts` and `sessions/connect.ts` (the predicate, the discard and their registration), `sidebar/registry-new-chat.ts`, and one call each in `main/TabStrip.tsx`, `main/Pane.tsx`, `overview/Overview.tsx`, `sidebar/Sidebar.tsx`, `sidebar/ProjectRow.tsx`, `sidebar/menus.tsx`; their unit tests.

**Interfaces.** Consumes §B, §C, §D. Exposes §E.

**Decisions.**
- The whole behaviour is §E; the section's O-01 ("New chat") and #497 give the reasons.
- `keymap/actions-runtime.ts` does not import `sessions/`: it learns whether a chat is empty, and discards one, through a registered port, as it learns the close guard and the unstarted title. Nothing registers one in launch mode `scenario`, so there no chat counts as empty and each press makes a chat. That is why the e2e scenes on a stub source keep their tab counts.
- **An empty chat closed for the person never goes through `requestCloseTab`** (§E, "Closing an empty chat for the person"). The section says "through the ordinary close, which asks nothing of an empty chat"; the ordinary close asks nothing, but it leaves the tab in the strip while its discard is on the way to main, and what the person types into it in that time goes with it. The close `newChat` uses checks and takes the tab out in one synchronous run, and only then calls main.
- A project row's "+" and its menu's New chat keep their own enabled rule; only what they call changes.
- **Q1, the owner's open question** (section, "Waiting": after a relaunch, should a New chat with nothing typed come back?) changes one place, §E's last paragraph. Until answered, an empty chat returns as today and M3 builds nothing for it.
- Pitfall: `overview/OverviewPanel.test.tsx` has a case ("a delayed New chat closes the panel without restoring its opener, leaving the new composer with the keyboard") that selects another tab while the creator is held and expects the chat selected. #497 reverses exactly that; the case is rewritten to A4's two halves.

**What it does not touch.** The Worktrees dialog and the Library's "Ask Claude" keep calling `createSession` and reuse or close nothing (section: a creation that carries something). The composer, the machine menu, `sessions/remote-spawn.ts`. The palette and the File menu, which reach New chat through the `session.new` action.

**What it proves.** A2, A3, A4. Its tests pin, beyond those: each control calls `newChat` (the strip's "+" with its pane, a row's "+" and its menu item with their row); two presses before the first answer make one chat; the reused chat moves to the pane asked for when it sits in the other; a chat with a typed draft, a held first message, a start under way, a failed start, a fork, a worktree location or a checkout kept from a failed attempt is not empty; a late chat closes no tab that is in front, and no chat the person selected or typed into between the press and the arrival; with the discard held open, the closed chat's tab is already out of the strip, an attempt to select it changes nothing and no composer of it is mounted to type into, and then a discard that answers true drops its unstarted entry while one that answers false or throws puts the tab back unselected, with its intent as it was; `newChat` for a row whose project has no folder here opens it as the row's "+" does, on a machine that has the project, and for a row with neither opens it with no project.

### M4 — What the tabs and the title bar show

**What exists at its end.** In a strip that mixes places every session tab names its place after its title; in a strip of one place none does. A squeezed tab gives up its place before its title. The tab menu has "Close tabs to the right". The chip names the current project or machine, a click on it reveals that row in the sidebar, and it creates nothing.

**What it touches.** `src/renderer/src/main/Tab.tsx`, `main/TabStrip.tsx` (the All tabs menu's lines), `app/Toolbar.tsx` (`ProjectChip`), `sidebar/reveal.ts`; `main/Tab.test.tsx`, `main/MainArea.test.tsx`, `main/TabStrip.overflow.test.tsx`, `app/Toolbar.test.tsx`, `sidebar/Sidebar.test.tsx`.

**Interfaces.** Consumes §D. Exposes `revealRow` (§D) and the copy of §G.

**Decisions.**
- **A tab's place** (section, "How a tab names its place"; A9). A session tab's place is its row's name, followed by `@<machine name>` when its session is on another machine; the machine alone while `sessionRow` answers undefined; nothing for an unstarted chat with no project chosen. The mark is always `@<name>`: how a tab reads when its machine is not reachable is U9's. Places are drawn when the session tabs of the strip, both panes together, have more than one distinct place; a tab with no place does not count as a place. The tab's accessible name, its tooltip and its line in the All tabs menu carry title and place whenever the place is drawn.
- **Shrinking.** The place is the first thing to give way: it shrinks to nothing before the title starts to truncate, and the tab's minimum width no longer reserves room for it.
- **"Close tabs to the right"** closes the pane's unpinned tabs to the right of that tab, in order, each through `requestCloseTab`, as "Close other tabs" does. It sits after "Close other tabs" and is disabled when there is none to close.
- **The chip** (section, O-31; A8). It draws while `currentRow()` is not null, named by `rowName`. A click, Enter or Space calls `revealRow`. Its context menu, the F10 handler and `PROJECT_CHIP_COPY.newChat` go. `data-toolbar-project` stays, now holding the row key.
- **`revealRow`** shows the sidebar as the `sidebar.focus` action does (in a window where the sidebar steps aside it opens as the overlay), opens the row, and hands it to the mounted sidebar's revealer. A row the sidebar does not list (a hidden project) is restored first through the path `revealProject` uses, on this Mac's folder of it when there is one, else the first by machine order. `revealProject` stays for its callers.
- The many-tabs behaviour of A10 exists today (the shrink, the scroll with the tab in front kept in view, the All tabs menu, ⌘1 to ⌘9, the cycle); M4 pins it with forty tabs and changes none of it.

**What it does not touch.** The strip's model. The chip's width and its overlap with the first tab (U7's O-03). Tab shapes and tokens. The sidebar's rows and selection.

**What it proves.** A8, A9, A10. Its tests pin: places appear when the first tab of a second place opens and go when the last one closes; a session on another machine names its machine, and its machine alone before that machine has answered; an unstarted chat names the project chosen in it; with forty tabs, ⌘9 selects the ninth, the cycle visits all forty and wraps, and "Close tabs to the right" on the third leaves three, pinned tabs among them kept; the chip is absent with no session in front and for a chat with no project; a click on it creates no session and no tab, uncollapses the sidebar, expands and focuses the row; for a hidden project it restores the row first and reads "Show <name> in sidebar".

### M5 — The e2e scenes, the record, and the acceptance run

**What exists at its end.** The e2e specs say what the build now does and hold the new scenes. The two reversed rulings are amended where they stand. The branch has passed typecheck, lint and the whole unit suite on the VM, and the hand-over for the runs an executor does not start is written into Progress.

**What it touches.** `e2e/shell.spec.ts`, `e2e/sessions.spec.ts`, `e2e/cross-build.spec.ts`; `docs/charter.md`, `docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md`, `docs/doperpowers/plans/2026-10-18-p3-f-finish.md`; this document's Progress.

**Interfaces.** Consumes everything above. Exposes nothing.

**Decisions.**
- **`e2e/shell.spec.ts`.** The scene "tab sets per project: …" becomes the one-strip scene: sessions of two projects open in one strip; a click on either project's row and on the machine's row changes no tab; a plain click on a session of the other project replaces the tab in front and ⌘⇧T brings it back where it stood; ⌘1 to ⌘9 count over the whole pane; the chip follows the session in front, and a click on it focuses that project's row, expanded, with the tab count unchanged; the stored `main.tabs` has version 3, `current` `none` and the one key `none`. It attaches a screenshot of the title bar with the mixed strip and the chip, which the architect may use for the owner's look. In the long scene ("shell: sidebar, overview, …") the step that expects an empty strip after a project click and the stored `current` to be a project's key expects the strip unchanged and `none`. In "a layout from before O6 comes back …" the stored `current` is `none`, the set keys are `["none"]`, and the third launch still rewrites nothing.
- **`e2e/sessions.spec.ts`.** The five scenes "new chat takes typing from …" each make an empty chat and then press a second control expecting one more tab. They become A3's scenes: from the strip's "+", the sidebar's New chat, a project row's "+" and ⌘N the tab count stays and the same chat has the keyboard; with a draft typed in the first, each adds one. The title-bar entry leaves the loop. A2 gets a scene with three sessions open: each control adds one tab right after the tab in front. A5 extends "an unstarted tab with a draft survives a relaunch" with a split, a pinned tab and the tab order.
- **`newChatIn` is not edited.** Its wait cannot be met by a press that reuses a chat, so the scenes above that press a row's "+" expecting reuse press it directly and wait for the chat that was there to be in front.
- **`e2e/cross-build.spec.ts`** gains three scenes. Each is skipped unless the peer's `stores/layout-model.ts` still has `switchSet` (a peer that keeps sets). A skipped scene is not evidence: the run of record is the one whose peer is F, and it counts only with all three run. A scene proves a read by what the reading build draws, or by what it writes after an act, and never by reading back a key that build has not written: F writes `main.tabs` at its launch only in the cases "What the code holds today" lists, and otherwise at its next change of the tabs.
  - *(layout, from the peer)* The peer's app opens tabs under two sets, as a person does: the library's tab and an artifact's while no project shows, then the seeded session from its sidebar row. It pins one tab and pins one tool in its icon row, and quits with a `main.tabs` of at least two sets. This build opens the profile: every tab id of every set is in the strip once, the pinned tab is pinned, the tab that was in front is in front, the notice shows, `main.tabs` is written with the one set, the icon row shows the pinned tool, and `panelTools.surfaces.contexts` holds no key but `none`. A relaunch of this build shows no notice.
  - *(layout, to the peer)* This build opens the seeded session's tab, the library's tab and an artifact's tab, pins one, splits, opens a side surface for the session and pins a tool in the icon row (so that `panelTools.surfaces` is not its default and holds the remembered session under `none`), sets a sidebar width that is not the default, and quits. The peer opens the profile: it draws the tab that was in front, selected; it draws the pin on the pinned tab, the pinned tool in its icon row and the sidebar at the width written; none of its console messages (read as `e2e/support/launch.ts` reads them, with every type kept) says "[layout] … is not a valid value". Then the peer acts: it selects another tab, unpins the tool and folds the sidebar. Its `main.tabs` then holds every tab id this build wrote, the pinned one still `pinned: true`, at version 3; its `panelTools.surfaces` holds the changed pins and still the entry `none`; its `regions` is at version 5 with the sidebar folded. This build then opens the profile again: every tab id is in the strip once, the pin is kept, the tool is unpinned and the sidebar is folded.
  - *(settings, both ways)* This landing changes nothing in the settings files; the scene is here because this is the first landing to edit this spec and the wave needs the proof before any trial. This build changes one field of each file through Settings, since one act cannot reach both: the theme for `settings.json`, the engine host's idle time for `machine-settings.json` (the to-human switch instead, if the idle time disturbs the scene's own waits). It quits. The peer opens the profile: it draws the theme and shows the other value in its Settings; neither its output nor its `mawsd`'s log has a `[settings] invalid` or `[settings] cannot read` line; it changes both fields through its own Settings, and each file then holds the peer's value. This build opens the profile again and draws both of the peer's values, with no such line in its own output or its `mawsd`'s log.
- **The coverage of UC-14** is this table: for each stored thing this landing changes or relies on, the scene that asserts F reads what this build wrote and writes it on, and the scene that asserts this build reads what F wrote. These rows are U13a's. Every later landing that stores something new adds its row and extends a scene: U8's `cards.open` and `panelTools.widths`, U7's `sidebar.hidden`, `destination` and the retired tab kinds, U6's open files, any new tab kind, any field a landing adds to a settings file.

  | stored | F reads this build's value, and writes on | this build reads F's value |
  |---|---|---|
  | `main.tabs`: which tabs | *(layout, to the peer)*: the tab in front drawn; every id in what F writes after its act | *(layout, from the peer)*; the return of *(layout, to the peer)* |
  | `main.tabs`: pins | *(layout, to the peer)*: the pin drawn; `pinned: true` in what F writes | both, as above |
  | `main.tabs`: order, the split, the floating card | not asserted: F rebuilds them by its own rules (§H) | the showing set's order and split, by M1's unit tests |
  | `panelTools.surfaces`, not its default | *(layout, to the peer)*: the pinned tool drawn; F's written value keeps `none` beside its own entries | both layout scenes: the pinned tools kept, `contexts` back to `none` alone |
  | `regions` | *(layout, to the peer)*: the width drawn; version 5 in what F writes | the return of *(layout, to the peer)*: the sidebar folded |
  | `settings.json`, `machine-settings.json` | *(settings, both ways)* | *(settings, both ways)* |
  | `machine-route.json` | not covered: written only when the machine's default route is set, which neither this landing nor a scene does | not covered |

- **The record** (root UC-10, "The record"; section, "Rulings reversed", which gives each sentence). O-01: the sentence is added, dated, in charter §5.2's tab-strip paragraph where the W12 amendment stands, as a new entry at the end of the charter's §19 Decision log, and as a dated line under "I3. A tab set per project." in the waves plan. O-31: its sentence is added in the same charter paragraph where the amendment of 2026-10-19 stands, in the same §19 entry, and as a dated line in the P3-F finish plan beside its obs8 row. The earlier words stay; each amendment is a dated addition. Q1's reversal is not recorded: it waits for the owner.
- The acceptance run is Concrete Steps 3. The class 1a run is not M5's: it is run once on the head the pull request will carry, after the branch review's fixes.

**What it does not touch.** Product code, unless a scene shows a defect; then the fix goes to the milestone's owner through the controller. `e2e/support/sidebar.ts`. The register and the board.

**What it proves.** It writes the e2e halves of A1, A2, A3, A5, A6 and A8; they are proved when the architect's runs are green. It proves by its own run that typecheck (which covers `e2e/`), lint and the unit suite pass on the branch.

## Concrete Steps

Working directory for every command: the branch's worktree (the controller's brief names it). The VM sees only what is pushed.

1. **Before M1**, once step 0 is on master:

       git fetch origin && git rebase origin/master && git push --force-with-lease origin ux-wave/U13a

2. **While building**, after each push:

       git push origin ux-wave/U13a
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U13a -- 'pnpm typecheck'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U13a -- 'pnpm exec eslint <the paths changed>'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U13a -- 'pnpm exec vitest run <the test files touched>'

   Each call prints `vmcheck: ux-wave/U13a at <short sha>` and then the command's own output, and exits with the command's status. The first call for the branch installs dependencies and takes a few minutes. M1's vitest call names `src/shared/ipc/schema/layout.test.ts`, the A7 test and `test/layout/`; `owner-files.test.ts` there reports its suite skipped. M2 ends with the whole unit suite (`pnpm test`) and not a list of files, because the store's shape reaches about eighty test files.

3. **The acceptance run** (M5), on the pushed head:

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U13a -- 'pnpm typecheck'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U13a -- 'pnpm lint'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U13a -- 'pnpm test'

   Expected: each exits 0; vitest's summary names no failed file and no failed test, and lists the rehearsal's gated suite (`test/layout/owner-files.test.ts`) as skipped. `pnpm typecheck` covers `e2e/`, which is the only check an executor has on the scenes of M5.

4. **The rehearsal** (the architect; "Proof that an executor does not run"), in a checkout of the branch with dependencies installed, on a machine that may hold the copies:

       MAWS_LAYOUT_REHEARSAL=<a directory outside any repository> pnpm exec vitest run test/layout/owner-files.test.ts

   Expected: the suite passing, and one entry per file of this shape. Files are named by a generated label, in the order of their names; a file that does not pass shows its label and one category word and nothing else. The numbers here are invented.

       file 1 of 2  main.tabs v3: 5 sets, 12 tabs (session 8, file 2, artifact 1, artifacts 1), 2 pinned, 3 closed, 0 reader warnings
                    -> strip: 12 tabs, 1 pane, merged yes, canonical no; missing 0, twice 0; held here 5 = 5, held elsewhere 3 = 3; contexts 5 -> 1   pass
       file 2 of 2  not-json

   These lines hold counts and fixed words only (M1's decisions and tests), so they may be quoted in the pull request.

5. **Class 1a**, once, on the head the pull request will carry, started in the background:

       scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u13a

   Expected: the script waits for the run by itself (up to half an hour); its last lines are `ci-gate: run <id> attempt <n>` and `ci-gate: run <id> success`, and it exits 0. The run's id goes into the pull request's body.

6. **The cross-build run with F** (the architect), started in the background:

       scripts/ci-gate.sh "$PWD" --gates e2e:cross-build --peer f1852de3a --label u13a-xb

   F is a first-parent commit of master and its wire is 3.33 against this tree's 3.36, so the gate's plan accepts the pair. Expected: the three scenes of M5 are reported as passed, and none of them as skipped; a run in which they skipped proves nothing. The group's other scenes were written for a peer one minor away; a red among them is read against the same command run on master.

## Interfaces and Dependencies

Everything a later milestone or a sibling child codes against is defined here, once. No library is added.

### §A. The stored form and its reader (M1; `src/shared/ipc/schema/layout.ts`)

    /** The strip, as the layout store holds it (section, "The strip"). */
    export type Strip = TabSet & { closedTabs: TabRef[] };
    export const EMPTY_STRIP: Strip;   // one empty pane, focusedPane 0, splitRatio 0.5, no closed tabs

    /** What `main.tabs` is written as (UC-14). */
    export function storedMain(strip: Strip): LayoutMain;

    /** One strip from what `storedMainSchema(local)` parsed. */
    export function stripOf(stored: LayoutMain | LayoutMainV1): { strip: Strip; merged: boolean; canonical: boolean };

`storedMain(strip)` is `{ version: 3, current: "none", sets: { none: { panes, focusedPane, splitRatio } }, closedTabs }`, with `floating` in the set only when the strip has one (never written as null or undefined). Its output always parses under `LayoutMainSchema`.

`stripOf` is the section's "As read", steps 1 to 3, with these points made exact:
- The base is the set `current` names; when `sets` holds no such set, an empty strip. A version-1 value is its own base and has no other set.
- The other sets are taken in the order `Object.keys(sets)` gives, each set's first pane before its second.
- A tab whose id the strip already holds is skipped.
- The tabs taken go to the end of the base's focused pane: unpinned ones after its last tab, pinned ones after its last pinned tab, each group in the order taken.
- The focused pane's active tab is kept; when that pane was empty its first tab becomes active.
- `merged` is true when at least one tab was taken from a set other than the base. It decides the notice and nothing else.
- `canonical` is true when the stored value already has the stored form's envelope: version 3, `current` `none`, and `none` the only key of `sets`. It decides whether hydration writes the envelope again (M2) and says nothing about tabs. A value with one project-keyed set, or with an empty set beside `none`, is neither merged nor canonical.
- Nothing is repaired here: a floating card that no longer fits, a session that no longer exists and a pane's missing active tab are `repairMain`'s, as today.

From M2 on, `LAYOUT_DEFAULTS.main` is `EMPTY_STRIP`: the store's default, not a stored value. `LayoutMainSchema`, `LayoutMainV1Schema`, `storedMainSchema`, `TabSetSchema`, `TabRefSchema`, `NO_PROJECT` and `EMPTY_TAB_SET` keep their names and shapes.

### §B. The strip in the store and the model (M2)

`stores/layout.ts`:
- `LayoutState.main: Strip`.
- `hydrate(client, known, opts?: { settle?: () => void; rekeyOf?: RekeyOf; titleOf?: TitleOf }): Promise<{ merged: boolean }>`; `merged` is `stripOf`'s.
- Gone from `LayoutState`: `projectOf`, `setCurrentProject`, `refileTabs`. Gone from the module: `ProjectOf`, `NO_PROJECT_OF`.
- Every other action keeps its name, its arguments and its meaning: `openTab(ref, opts?: { pane?: PaneTarget; activate?: boolean })`, `openSession(appSessionId, opts?: OpenSessionOptions)`, `closeTab`, `retargetTab`, `reopenClosed`, `moveTab`, `reorderTab`, `selectTab`, `cycleTab`, `activateTab`, `togglePinned`, `splitWithActive`, `focusPane`, `setSplitRatio`, `floatSplit`, `dockSplit`, `dropSession`, `settleMachine`, `refreshTabTitles`, `rekeyProjects`.
- New: `frontOf(state: Pick<LayoutState, 'main'>): string`, the id of the tab in front, `''` when the focused pane is empty; and `showPane(pane: 0 | 1): void`, for a pane the person chose. `showPane` makes the same change of the strip as `focusPane` and differs only in the commit function it lands through (§C).

`stores/layout-model.ts`, every function over a `Strip`:
- Reading names kept: `currentSet(main): TabSet` (the strip itself), `allTabs`, `isOpen`, `activeTab`, `sessionOfTab`, `floatingPane`, `paneShowsSession`.
- `locateTab(main, id): { pane: 0 | 1; index: number } | null`: no `set` in the answer.
- Transitions kept, without a `set` option or argument: `openTab`, `openSession`, `replaceActive`, `retargetTab`, `activateTab`, `focusPane`, `closeTab`, `moveTab`, `splitWithActive`, `selectTab`, `cycleTab`, `reopenClosed`, `togglePinned`, `dropSession`, `setSplitRatio`, `floatSplit`, `dockSplit`, `titleTabs`, `repairMain`.
- `foldOf(main): { sessionTabId: string } | null`, `foldEnded`, `unfold`.
- `rekeyExpanded` and the type `RekeyOf`, unchanged.

A tab's id is still computed from what it shows (`tabId`), so a tab exists once in the strip.

### §C. The commit functions (M2; rule 7; root UC-12 and UC-14)

Inside `createLayoutStore`, three closures, the first two as today:

    const commit = (nextMain: Strip, nextRegions: LayoutRegions): void;   // every change of the strip or of the regions
    const main = (next: (strip: Strip) => Strip): void;                   // a change of the strip; replayed if made before the read
    const commitShown = (next: (strip: Strip) => Strip): void;            // an act that brings a tab to the front

`commitShown` is the one commit function the root's UC-12 and UC-14 name. Every act that brings a tab to the front lands through it, and nothing else does:

| the store's action | lands through |
|---|---|
| `openTab`, unless `activate` is `false` | `commitShown` |
| `openSession`, every form | `commitShown` |
| `activateTab`, `selectTab`, `cycleTab`, `reopenClosed` | `commitShown` |
| `moveTab`, `reorderTab`, `splitWithActive` | `commitShown` |
| `showPane`: the person chose a pane (`pane.focusOther`; the split card's float, dock, open and close, and ⌘⇧\ into it) | `commitShown` |
| `focusPane`: the store follows where the keyboard or a press already is (a pane's and the split card's focus and pointer capture, the compact composer, a pane's or a strip's own cycle just before `cycleTab` or `activateTab`) | `main` |
| `openTab` with `activate: false` | `main` |
| `closeTab`, `dropSession`, `settleMachine`, `retargetTab`, `togglePinned`, `setSplitRatio`, the store's `floatSplit` and `dockSplit`, `refreshTabTitles` | `main`, or `commit` directly |
| hydration | its own write |

The store's `floatSplit` and `dockSplit` change the float and are not acts of showing by themselves; the functions of the same names in `shell/floating.ts` call them and then `showPane`. `commitShown` stands for the act, whether or not the strip changes with it: a click on the tab already in front is an act. In this landing `commitShown` calls `main` and does nothing else, so no test here can tell the two apart: the table is the contract, and U7's tests prove it when U7 gives `commitShown` an effect.

### §D. The current project (M2), and the reveal (M4)

`keymap/actions-runtime.ts`:

    /** The row a session sits under (rule 5): its project's, a machine's own, or the project chosen in an unstarted chat.
        null: an unstarted chat with no project. undefined: its machine has not answered in this run, or it is not known. */
    export function sessionRow(appSessionId: AppSessionId): RowKey | null | undefined;
    export function currentRow(): RowKey | null;
    export function useCurrentRow(): RowKey | null;
    export function focusedProject(): ProjectId | null;

- `sessionRow` is what `ipc/events.ts` computes today as `projectOf` (the machine-loaded test, `sessionSetKey`, the retention and `unstartedProjectOf`), moved here and not rewritten. A hidden project's session answers the project's key, so that the chip can bring the row back.
- `currentRow()` is `sessionRow` of the session in front (`surfaceSession` of the layout state), and null when that is null or undefined. `useCurrentRow` is the same value as a hook.
- `focusedProject()` keeps its name and callers. It answers the folder on this Mac of `currentRow()` when the row has one that is not hidden (`localProjectOfSet`), else null.

`sidebar/reveal.ts`:

    export function revealRow(key: RowKey): void;   // M4's decisions say what it does

### §E. New chat (M3; rule 6; section, O-01 "New chat" and #497)

`keymap/actions-runtime.ts`:

    export interface NewChatOptions { pane?: 0 | 1; row?: RowKey }
    export function newChat(opts?: NewChatOptions): Promise<AppSessionId | null>;
    export interface EmptyChats {
      isEmpty(appSessionId: AppSessionId): boolean;
      /** Discards the chat's intent and asks nothing. false: main refused, and the person has been told why. */
      discard(appSessionId: AppSessionId): Promise<boolean>;
    }
    export function registerEmptyChats(port: EmptyChats): () => void;

`createSession(projectId, opts)` keeps its signature and stays the way a chat that carries something is made. `sessions/setup-actions.ts` gains `isEmptyIntent(intent: SetupIntent): boolean`, `isEmptyChat(appSessionId: AppSessionId): boolean` and `discardEmptyChat(appSessionId: AppSessionId): Promise<boolean>`; `connectSessions` registers the last two as the port.

**Where a chat starts.** For the row asked for (`opts.row`, else `currentRow()`), one of three places, by one resolver that `focusedProject` also uses:
- *here*: the row has a folder on this Mac that is not hidden; the chat is created in that project.
- *elsewhere*: it has none, and it is a registry project that `registrySpawnTarget` finds a machine for; the chat is created as `newChatElsewhere` creates it today.
- *none*: anything else (no row, a machine's row, a project with no reachable folder); the chat is created with no project.

**An empty chat.** `isEmptyIntent` is true when the intent is a `create` with no `lineage` and no `launchedBy`, its location is unset or a `directory`, it holds no first message, its draft is empty (`isEmptyDraft`), and its `progress` shows no attempt (no worktree, no last failure, no bootstrap, launch or send). `isEmptyChat` is true when the session has an intent and no record, `isEmptyIntent` holds, no start is under way and no setup card waits, and the mounted editor, if there is one, is empty. A chat that names a worktree, or holds a checkout a failed attempt kept, is not empty: bringing it forward would start the owner in a checkout they did not ask for, and closing it would leave a worktree behind a notice. Choices that are not typed (a model, a mode, a directory added) do not make a chat non-empty, as they do not for the standing rule that lets a session take an empty chat's place.

**The same chat.** An empty chat is for the same project as a press when it was created, or has since been given, the place the press resolves to: the same project id for *here*; no project and the same registry project for *elsewhere*; no project and no registry project for *none*.

**A press**, in order:
1. While an earlier press waits for its chat, the press returns that press's promise and does nothing else.
2. The empty chats of the strip are found (with no port registered there are none).
3. If one is the same chat: it comes to the front in the pane asked for (moved there if it sits in the other), its composer takes the keyboard, `closeEmptyChat` is called for every other one found, and its id is the answer. Nothing is created.
4. Otherwise a chat is created for the place. When its tab arrives it opens by the arrival rule; then `closeEmptyChat` is called for each chat found in step 2.

**The arrival rule** (#497) lives in `createSession`, so it holds for every creation: `frontOf` is read at the call and again when the creator answers. Equal: the tab opens selected, after the tab in front of the pane asked for, and its composer takes the keyboard (as today). Different: the tab is added after the tab now in front, with `activate: false`; it stays marked so that its composer takes the keyboard when the person selects it.

**Closing an empty chat for the person** is one function, `closeEmptyChat(appSessionId)`, and never `requestCloseTab` ("What the code holds today": that close leaves the tab in the strip while its discard is on the way). In one synchronous run it:
1. checks again, now, that the chat's tab is in the strip, that the chat is still empty by the port's `isEmpty`, and that its tab is not the tab in front (`frontOf`); if any of the three fails it does nothing;
2. takes the tab out of the strip with `dropSession`, which leaves no reopen entry, as an unstarted chat's ordinary close leaves none;
3. only then calls the port's `discard`.

From step 2 on the chat has no tab and no handle anywhere in the window, so nothing can select it or type into it while main works. When `discard` answers true, the session's unstarted entry is dropped. When it answers false or throws, the intent still exists with whatever it held: the tab is put back with `openTab(..., { activate: false })`, and the person has the notice the ordinary close shows for a refused discard.

This is what guarantees that a late chat never closes the tab in front, and that no chat is closed after it stopped being empty: both are read in the same synchronous run that takes the tab out, not at the press and not at the arrival. When `closeEmptyChat` declines, two empty chats can remain until the next press. The order in step 4 of a press is what puts a new chat in the place of an empty one that was in front: the new tab opens right after it and takes the front, then the empty one is closed.

**Q1: an empty chat at a relaunch.** Whether an unstarted chat's tab returns is decided today by `retainsTab` in `sessions/connect.ts`: it returns while its intent exists. That holds until the owner answers. If the answer is no, this paragraph is the one place that changes: when the intent snapshot first answers, and before the tab retention's `ready` resolves, `connectSessions` discards every intent for which `isEmptyIntent` holds (through `session.intent.discard`, as a close does), so hydration finds no intent and drops the tab without a word. With it go two unit tests (an empty chat is gone after the snapshot, a chat with a draft stays), the clause "an empty chat does not come back" in M5's relaunch scene, and the dated amendment the section names under "Waiting, not yet reversed".

### §F. What the siblings may rely on

**U7** (the destinations and the Settings dialog; root UC-12).
- The strip holds no page and no dialog state. U7 adds its own fields to `LayoutState` and its own layout key; it adds none to `Strip` or to `main.tabs`.
- `commitShown` (§C) is where U7 clears its page and closes its dialog, in the same store write as the strip's change. The table of §C is what U7's acceptance rests on: a session clicked in the sidebar, a tab clicked in the title bar and a New chat that arrives selected pass it; a tab added with `activate: false`, which is how a late chat arrives, does not.
- An acceptance case U7 carries, named here so that it is not lost: **"⌘⇧\ under a page"**. With a split and a destination open, `pane.focusOther` closes the destination and leaves the other pane's tab in front; the same for `panel.float` when it docks the split's card and for `main.expandArtifactPane`. This landing routes those acts through `commitShown` (`showPane`) and cannot test an effect that does not exist yet.
- `frontOf` (§B) is what `createSession` compares to decide whether a chat arrives selected. A page opened during the wait is not a tab and does not change it; U7 adds its page to `frontOf`'s answer if a chat must then arrive unselected.
- `currentRow`, `useCurrentRow` and `focusedProject` do not change while a page or the dialog is open.
- The strip's rows stay mounted in the title bar's two slots (`main/chrome-tabs.ts`); this landing does not edit `session/visibility.ts`.
- The chip is `ProjectChip` in `app/Toolbar.tsx` as M4 leaves it; U7's O-03 applies to that.
- In U7's files this landing changes exactly this: `sidebar/Sidebar.tsx` (a row's activation no longer touches the strip; the New chat row calls `newChat`), `sidebar/ProjectRow.tsx` and `sidebar/menus.tsx` (the call behind a project's New chat), `sidebar/registry-new-chat.ts` (reached through `newChat`), `sidebar/reveal.ts` (`revealRow` added), `app/Toolbar.tsx` (`ProjectChip`).

**U6's second landing** (a file moved to the main area; Back and Forward).
- A place is a pane and a `TabTarget`; `tabId(target)` is its id; `openTab(target, { pane })` brings it to the front when it is open and adds it when it is not. The model keeps no history.
- The tab in front is `activeTab(state.main)`, and `frontOf(state)` its id; both change only through the store.
- Every way a tab leaves the strip is a change of `allTabs(state.main).map((t) => t.id)`, seen through `useLayout.subscribe` once `hydrated` is true: `closeTab`, a plain `openSession` that takes a tab's place, `dropSession`, `settleMachine`, and `retargetTab` (the old id leaves and the new one enters).
- A `file` tab is one per machine and path; opening it again takes the new line and the session that opened it; it is placed after the tab in front. A move between the side column and the strip closes with `closeTab(id, { remember: false })`.
- `shell/transfer.ts` after this landing: the artifact's move and its `panelSessionForArtifact` over one strip (M2's decisions); nothing in it compares sets.
- ⌘[ and ⌘] are free. The strip uses ⌥⌘[ and ⌥⌘], ⇧⌘[ and ⇧⌘], ⌃Tab and ⌃⇧Tab, ⌘1 to ⌘9 and ⌘⇧T, all as before.

**The groups half of U13.** "Open as tabs" is `openTab({ kind: 'session', appSessionId }, { activate: false })` per member; it works for a session of any project and machine. Only a tab holds a session open (rule 3): main still counts what `main.tabs` holds and nothing else.

**U9.** `main/Pane.tsx` gets one call changed (the empty pane's New chat) and `lane-b/remote-connect.ts` one (`retryRemoteSession` writes `storedMain`). A tab of a session whose machine is not reachable is kept and restored by the rules that stand (`knownTab`, `settleMachine`); how it is drawn is U9's.

**U8.** `commit` keeps the fold rule between the strip and `regions`. `panel/surface-model.ts` keeps its functions; `contexts` has the one key `none`.

**U10.** In `shell/floating.ts` one comparison of `main.current` goes and five calls change from `focusPane` to `showPane` (`floatSplit`, `dockSplit`, `openCard`, `closeCard`, `focusSplitCard`); `focusCompactCard` keeps `focusPane`. The card behaves as before.

### §G. Copy

- The upgrade's notice, level info, dismissible, no action: `Tabs from every project are now in one strip`
- The tab menu's item: `Close tabs to the right`
- The chip's tooltip and accessible name: `Reveal <name> in sidebar`; for a row the sidebar does not list: `Show <name> in sidebar`
- A tab's place: the row's name; for a session on another machine `<row name> @<machine name>`, or `@<machine name>` alone. In the accessible name and the tooltip: `<title> · <place>`, as the project is joined today.

### §H. What this landing stores, and what build F does with it

| key of `layout.json` | what this build writes | what F does at its next launch |
|---|---|---|
| `main.tabs` | `storedMain(strip)`: version 3, `current` `none`, one set under `none`, `closedTabs`; tabs of the kinds and fields F knows | Parses it. Re-files each session's tabs into its row's set: every tab and pin kept; the order, a split across sessions, the floating card and each set's active tab are F's own afterwards. Writes its sets at once if it dropped a fold, else at its next tab change. |
| `panelTools.surfaces` | as today, with `contexts` holding at most `none` | Parses it. Uses `none` only while it shows the `none` set and the tab in front has no session. For the set it shows it records the session of the tab in front as an entry of its own, keeps `none`, and writes the value at once. The tools pinned in the icon row and each session's two visible tools are kept. |
| `regions` | as today (version 5; an expanded row's key added by a reveal, as a click adds it) | Parses it. If the strip held a split that Expand had floated with the side column folded, F loses that float with the split, opens the side column again and writes `regions` at once. |
| every other key, and the two settings files | as master writes them; this landing changes none | As with master. The settings files are proved once here, by M5's third scene, for the wave. |

**Going back to F, in full.** No tab is lost and no pin. What F does not keep as the strip had it: the order of tabs; a split whose panes hold sessions; the split's floating card; which tab each set has in front, except the one that was in front of the strip; the side column's remembered session; and, when a float had folded the side column, the side column's folded state. These follow from F's own rules (`refile`, `reconcileFold`, `rememberSurfaceContext`) and no one-set value changes them, so they are not a reason for another stored shape. When this build next opens the profile it merges F's sets again, in F's order, and shows the notice again. M5's table says which of this the cross-build scenes assert.

### §I. Dependencies on other landings

- **U6a, U8a** (step 0): nothing consumed. This landing adds no row to the keymap table and reads nothing U8a adds; of U6's files it edits only `keymap/actions-runtime.ts` and `shell/transfer.ts`. A file both this branch and a step-0 landing touch is a rebase, not a dependency.
- **U9** (parallel): the two files named in §F, and `sidebar/menus.tsx`, where U9 inserts in the session menu and this landing changes one call in the project menu; whoever lands second rebases.
- **U1**: nothing; a tab's waiting mark is read as today.
- **Main**: unchanged. `sessionsInTabs` and `remoteSessionsInTabs` read every set of whatever is stored, so they read the one-set form and F's sets alike.

## Acceptance

The acceptance is the section's A1 to A12, as written there; its "Groups" line is not this landing's. This table says where each is proved and by whom. "Unit" is run by the milestone's executor on the VM and again by class 1a. "E2e" is written in M5 and run by the architect on a Mac.

| item | proved by | milestone |
|---|---|---|
| A1 a row's click changes no tab; another project's session opens in the same strip | unit (store, Sidebar); e2e, the one-strip scene of `shell.spec.ts` | M2, M5 |
| A2 each New chat control adds exactly one tab after the tab in front | unit (`newChat`, one case per control); e2e, `sessions.spec.ts` | M3, M5 |
| A3 an empty chat is reused; a draft keeps its chat; two quick presses make one | unit; e2e, `sessions.spec.ts` | M3, M5 |
| A4 a late chat is added unselected | unit, the renderer test the item describes | M3 |
| A5 a relaunch brings the same strip back | unit (a strip written and read back); e2e, `sessions.spec.ts` (split, pin, order, a chat with a draft) and `machines.spec.ts` as it stands (a tab of a session on another machine, that machine up and down) | M2, M5 |
| A6 a stored value with several sets opens whole, with a notice once; both directions with F | unit (five sets, M1; the store and the notice, M2); the cross-build run with F, its three scenes run and not skipped | M1, M2, M5 |
| A7 main counts the same sessions before and after | unit | M1 |
| A8 the chip names and reveals, and creates nothing | unit; e2e, the one-strip scene | M4, M5 |
| A9 a tab names its place in a mixed strip only | unit; the screenshot of the one-strip scene for the owner's look | M4, M5 |
| A10 forty tabs | unit | M4 |
| A11 opening a file beside a deck's and a document's tab keeps both | unit (store). U14's reproduction of l6-artifacts-13 on build F is not this landing's | M2 |
| A12 no chord moves and none is added | `git diff origin/master...HEAD -- src/shared/keymap/actions.ts` prints nothing | M5 |

## Proof that an executor does not run

Each line has an owner other than an executor. The controller writes into Progress when a line's precondition is met.

| what | when it can start | what it needs | what comes back |
|---|---|---|---|
| **The rehearsal** (root UC-14; section, "The rehearsal") | after M1's review; again if the reader changes later | A copy of `<userData>/layout.json` from each of the owner's machines, in a directory outside any repository, on a machine that has a checkout of this branch with dependencies installed (the copies hold the owner's session ids, paths and titles, so where they may be copied is the architect's call). The architect keeps the list of file names, since the lines name files only as `file 1`, `file 2`, in name order. Concrete Steps 4. | The printed lines, which hold counts and fixed words only, and `pass` for each file. Anything else stops the landing: the stored shape is reconsidered. |
| **The cross-build run with F as the peer** (root UC-14; A6; root acceptance 6) | after M5 is pushed | Concrete Steps 6. GitHub Actions budget for one `e2e:cross-build` run, and for a second on master if a scene outside M5's three is red. The group installs a launchd unit and is never placed on the mini's home account; the gate's plan sees to it. | The run's id, and each of M5's three scenes named as run and green. A scene reported as skipped is not evidence, whatever the run's colour. The coverage is M5's table; until the run is green no wave build runs on a profile the owner uses. |
| **The e2e groups** on a Mac under the load rule | after M5 is pushed | The new and reworked scenes alone first: in `shell.spec.ts` the one-strip scene, the long shell scene and the pre-O6 layout scene; in `sessions.spec.ts` the New chat scenes and the relaunch scene. Then the groups that hold the specs this change reaches: `layout`, `default`, `panel` (three scenes use the harness's "no session shown"), `code` (`restoreWithTab` writes the stored envelope), `machines`, `remote`. | Verdicts by group. A red scene goes back to the controller as a fix. |
| **The owner's look at the mixed strip with the chip** (root, "Looks the owner is asked for before a landing") | after M4 | A drawn example or the running branch. The one-strip scene attaches a screenshot of the title bar with fixture names; a strip with a tab of a session on another machine needs the `machines` scene or a drawing. | The owner's word. A change of what a tab shows comes back as an amendment of the section. |
| **The branch review** | after M5 | `doperpowers:review-code`, the xhigh panel, dispatched from the architect's session over `origin/master...ux-wave/U13a`. | A verdict and findings; the fixes are one wave through the controller. |
| **Class 1a** | once, on the head the pull request will carry, after the review's fixes | Concrete Steps 5. | The run's id. |

## The pull request

Opened on the architect's word, not by an executor. Its body:
- opens with the composite's path, the child id (U13, first landing) and the parent pin `25942f5d1`, and names the items (O-01, O-31's first half, #497) and the board ticket #578;
- names its class 1a run by id, on the head it carries;
- names the branch review's verdict and what was done with each finding;
- names its residue: what is not verified, what waits (Q1; U14's reproduction of l6-artifacts-13; the groups half), and anything logged as debt;
- names the cross-build run with F by id, with each of M5's three scenes named as run and not skipped, and gives the rehearsal's lines;
- says which e2e groups ran and where;
- ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.

The pull request carries the dated amendments of the two rulings this landing reverses, where they stand (M5, "The record").

## Surprises & Discoveries

- Observation: build F reads the one-set value and loses no tab, but it does not keep the strip as the wave's build left it. It re-files each session's tabs into its row's set one at a time, so the order of tabs, a split across two sessions and the floating card are F's own after the first launch. It writes nothing for the re-filing itself; but a float that had folded the side column is lost with its split, and F then opens the side column and writes `main.tabs` and `regions` at once, and it writes `panelTools.surfaces` as soon as it remembers a session for the set it shows.
  Evidence: `git show f1852de3a:src/renderer/src/stores/layout-model.ts`, `refile` and `moveToSet` (each tab placed after the active tab of the set it joins, in one pane; `asSet` drops a float whose pane is gone); `git show f1852de3a:src/renderer/src/stores/layout.ts`, `hydrate` (`reconcileFold` over the re-filed value; `unfolded` and the `regions` and `panelTools.surfaces` comparisons add their keys to `unsaved`; no condition names a refile).
- Observation: `newChatIn` cannot serve a press that reuses an empty chat; it waits for a tab id the strip did not hold.
  Evidence: `e2e/support/sidebar.ts`, the helper's poll (`id.startsWith('session:') && !before.has(id)`); five scenes of `e2e/sessions.spec.ts` ("new chat takes typing from …") press a second New chat with the first left empty.
- Observation: three files read the per-project sets in ways the section does not name: `shell/transfer.ts` (`panelSessionForArtifact`), `customize/CustomizeView.tsx` (`main.current`), `harness/panel/PanelHarness.tsx` (`switchSession(null)`).
  Evidence: a search for `main.current`, `.sets[` and `setCurrentProject` outside the two store files at `85e934368`.
- Observation: the ordinary close cannot be used to close a chat for the person. It decides on the draft, then waits for main, and only then removes the tab; text typed in that wait is discarded with the intent and leaves no reopen entry.
  Evidence: `keymap/actions-runtime.ts`, `requestCloseTab` (awaits `guardAllows` before `dropSession`); `sessions/setup-actions.ts`, `beforeCloseUnstarted` (reads the draft, then awaits `session.intent.discard`). Found by the adversarial review, 2026-11-12.
- Observation: a stored value can need its envelope rewritten without any tab being merged (one project-keyed set; an empty set or a set of duplicates beside `none`), and the remembered side-column session is lost at the second launch if it is not.
  Evidence: `panel/surface-model.ts` reads `contexts[main.current]`; a hydration that rewrites `contexts` under `none` while `main.tabs` keeps `current: <project key>` leaves the next launch to look under the project key. Found by the adversarial review, 2026-11-12.
- Observation: `focusPane` is called both when the store follows the keyboard and when the person chooses a pane; six of its callers are the second kind.
  Evidence: `app/shell-actions.ts` (`pane.focusOther`); `shell/floating.ts` (`floatSplit`, `dockSplit`, `openCard`, `closeCard`, `focusSplitCard`), against `main/Pane.tsx`, `shell/FloatingCard.tsx` and `focusCompactCard`. Found by the adversarial review, 2026-11-12.
- Observation: on the wave's build VM under load (load average 20 to 27, another child's whole suite beside it), `pnpm test` fails about twenty files outside the known set with `Test timed out in 5000ms` (and a few load-bound assertions); the same files time out on the commit before M1 at the same load. A long `vmcheck.sh` call can also lose its ssh session (exit 255, no output) while the remote run goes on.
  Evidence: the M1 executor's runs at `d07608d6c` and `7fbf15772` (task report); a whole run detached on the VM (`nohup setsid`, log read after) is the workaround.

## Decision Log

- **2026-11-12 · Verification** (the one entry written at authoring). This document gets an adversarial review before any executor starts; the architect dispatches it. Each milestone is reviewed at its boundary by the controller's reviewer before the next starts. The branch gets `doperpowers:review-code` at the xhigh panel, on two counts: root UC-10 names U13's reader of the stored layout as delicate, and at about 98 files the branch is panel-sized. A new or reworked e2e scene runs alone on a Mac before the groups. Class 1a on GitHub Actions is the gate of record, on the head the pull request carries. The proof UC-14 asks for, the cross-build run with F and the rehearsal, is the architect's to run and is listed with what it needs under "Proof that an executor does not run".
- **2026-11-12 23:11Z · Revision 2: the adversarial review's findings and the architect's rulings.** The review found the one-strip design and the F-compatible envelope sound and five gaps in the execution contract; all five are adopted, with its two remarks. The architect ruled on the six points reported at authoring. No milestone was added or removed.
  - Decision: an empty chat closed for the person goes through `closeEmptyChat`, which re-checks and takes the tab out of the strip in one synchronous run before it calls main, and puts the tab back if main refuses (§E). The port registered by `sessions/` carries the discard beside the predicate.
    Rationale: the ordinary close leaves the tab selectable while its discard is in flight, so typed work could be discarded. Rejected: `requestCloseTab` followed by a second look at the draft, since the discard is already sent by then.
    Date/Author: 2026-11-12, the document's author, on review finding 1.
  - Decision: the rehearsal is one boundary under `test/layout/` that returns generated labels, numbers, booleans and a word from a closed list, catches every error inside it, captures the reader's own output, and has tests with a sentinel (M1).
    Rationale: an error message, the reader's warning and a file name can each carry the owner's text into lines meant for a public pull request. It also moves the rehearsal out of `src/shared`, which may not import main's readers. Rejected: asserting on counts only while leaving errors and warnings to print.
    Date/Author: 2026-11-12, the document's author, on review finding 2.
  - Decision: `stripOf` answers `canonical` beside `merged`; hydration writes `main.tabs` whenever the stored envelope is not canonical, and the notice follows `merged` alone (§A, M2).
    Rationale: a value with one project-keyed set is not merged, and was left under its key while the remembered session moved to `none`. Rejected: showing the notice for it, which would announce a merge that did not happen.
    Date/Author: 2026-11-12, the document's author, on review finding 3.
  - Decision: M5 carries a coverage table for UC-14 and a third cross-build scene for the two settings files; a skipped scene is not evidence (M5, the proof table).
    Rationale: tab ids and one width did not show F reading pins, a `panelTools.surfaces` that is not its default, or the settings files, and the wave needs the settings proof before any trial. Rejected: leaving the settings files to the landing that first changes them (U11), which would come after the first trial.
    Date/Author: 2026-11-12, the architect's ruling on review finding 4.
  - Decision: the store gains `showPane` for a pane the person chose; six callers move to it and `focusPane` stays for passive focus (§C, M2). U7 carries the acceptance case "⌘⇧\ under a page" (§F).
    Rationale: with `focusPane` wholly outside `commitShown`, `pane.focusOther` and the split card's acts would change the tab in front under an open destination, against root UC-12. Rejected: routing every `focusPane` through `commitShown`, which would close a page whenever focus merely follows the keyboard.
    Date/Author: 2026-11-12, the document's author, on review finding 5.
  - The architect's rulings on the reported points, 2026-11-12: (1) going back to F is accepted as §H states it, and the section's "nothing is lost" and root acceptance 6 are reworded to "no tab is lost"; (2) `newChatIn` stays unedited; (3) the section's e2e list takes `e2e/sessions.spec.ts` and drops `e2e/ux2-shell.spec.ts`; (4) its unit-test list is corrected; (5) the insertions in `customize/CustomizeView.tsx`, `shell/transfer.ts`, `sidebar/ProjectRow.tsx`, `sidebar/menus.tsx`, `sidebar/registry-new-chat.ts` and `panel/surface-model.ts` are added to root UC-8; (6) the three wording points are corrected in the section. The owner's answer on an empty chat at a relaunch (Q1) is still open, and §E's last paragraph stays a default.
  - Without a change of decision: M2 is said to be kept whole by choice, with the adapter route named and its cost; §H and the Purpose say in full what F does with a profile the wave's build has written.
- **2026-11-12 23:40Z · Execution starts on M1 alone; how the branch takes master.** The architect dispatched the controller for M1 only: M2 waits for the rehearsal of M1's reader (a failure there reconsiders the stored shape) and for step 0 to reach master.
  - Decision: Concrete Steps 1 and constraint 9 are not followed as written for M1. Step 0 is not on master yet and M1 touches none of its files, so the branch merged `origin/master` (`eeba4e916`, documents only) instead of rebasing onto it; from here on the branch takes master by merge, never by rebase or force-push, because reviewers pin ranges on it. Step 0 is merged the same way when it lands, before M2.
    Rationale: the architect's word at dispatch; a rebase would invalidate the ranges the M1 review and the rehearsal pin.
    Date/Author: 2026-11-12, the controller, on the architect's dispatch.
  - Decision: no executor or controller runs `scripts/ci-gate.sh`, opens a pull request or starts an Electron e2e on this branch; class 1a, the review panel, the cross-build run and the pull request are the architect's (as "Proof that an executor does not run" already says for most of them). Checks run on the VM through `vmcheck.sh` only.
    Date/Author: 2026-11-12, the controller, on the architect's dispatch.
- **2026-11-13 · M1: the means the document left open** (the M1 executor's decisions, folded by the controller).
  - Decision: the rehearsal parses with a placeholder local machine ref, `rehearsal-local-machine` (valid under `MachineRefSchema`, no machine's). Its session comparison runs once per *machine view*: each ref named by a session or agent tab's address in the parsed value, taken as the local machine; for a version-1 or version-2 value that is the placeholder. Each view compares `sessionsInTabs` and `remoteSessionsInTabs` over the raw stored value with the same readers over `storedMain` of the strip.
    Rationale: version 3 holds addresses, so the local ref changes nothing of its read; versions 1 and 2 are lifted by every reader with the ref it is given, so one placeholder used everywhere is as faithful as the owner's real ref and the rehearsal needs nothing from the owner's machine.
  - Decision: every view must be equal on its own (else `sessions-differ`); the printed "held here" and "held elsewhere" are sums over the views, and the line names the number of views (`2 machine views: held here 6 = 6, held elsewhere 6 = 6`).
  - Decision: `contexts n -> m` is information, not a pass condition: n is the number of keys stored, m is 1 when there is an entry for the set that was showing (`none` for version 1), else 0; `contexts absent` when the key is absent. M2's hydration should give the same m.
  - Decision: the first line adds `, N distinct` when a tab id repeats across sets (so the strip's smaller count does not read as a loss), and plurals follow the count. The checks run in the order `tab-missing`, `tab-added`, `tab-twice`, `sessions-differ`, `not-stored-form`, so each word is reachable; `not-stored-form` is `storedMain`'s output not parsing identically under `LayoutMainSchema`, or `stripOf` of it not being canonical, unmerged and the same strip.
  - Decision: a run that reads nothing fails: an unreadable directory (`directory unreadable`) or one with no `*.json` (`no layout files`) counts as one not passed, so a mistyped `MAWS_LAYOUT_REHEARSAL` cannot report green.
  - Decision: the runner's one assertion lives in `runRehearsal` (`test/layout/rehearsal.ts`) with a fixed message, so the sentinel tests exercise the exact assertion the runner makes; `owner-files.test.ts` is that one call under `describe.skipIf`.
  - Decision: when `focusedPane` names a pane the value does not have (the schema admits `focusedPane: 1` with one pane), `stripOf` appends to pane 0 and leaves `focusedPane` to `repairMain`, which keeps it total and repairing nothing (§A's last point).
  - Decision: the A7 test is `src/main/layout/one-strip.test.ts`.
    Date/Author: 2026-11-13, the M1 executor; folded by the controller.
- **2026-11-13 · M1's review: two findings adopted.**
  - Decision: `stripOf` takes the base only from an own key of `sets` (`Object.hasOwn`); a `current` that names no own set, `constructor` among them (the key schemas admit it), starts from an empty strip, as §A says.
    Rationale: the reviewer showed a parsed value with `current: 'constructor'` reaching `Object` through the prototype and throwing.
  - Decision: the rehearsal compares the distinct tab ids both ways and gains a word, `tab-added`, for an id in the strip that no set held, checked after `tab-missing`. The closed list of M1's decisions is revised to hold it.
    Rationale: "tabs in must equal tabs out" (section, "The rehearsal"); the reviewer showed a converter that adds a tab passing every other check. Rejected: reusing `tab-missing` or `not-stored-form`, whose words would then misname what the architect reads.
    Date/Author: 2026-11-13, the controller, on M1's task review.

## Outcomes & Retrospective

Pending — written at finish.
