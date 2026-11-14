# UX wave U8b: report of M1's run (2026-11-12)

The execution document is `docs/doperpowers/plans/2026-11-12-ux-wave-U8b-column-and-tabs.md`, accepted at `78d343799`. This run built M1 only ("What is stored, its readers, the side column's acts, and the two widths"). M2 to M9 were not started.

## Where the branch stands

- Branch `ux-wave/U8b`, pushed. M1's commits run from `37d2bd627` to the head named below.
- Master `7e5f2016c` (U8a) was merged at `25ce07b97`; the merge was clean. U6a, the other half of step 0, is not on master yet. M1 was built ahead of it on the architect's word, against Constraint 9 (Decision Log 3).
- The document's living sections are updated: Progress (M1 built and its checks green; the box stays open until the boundary review), Surprises (two entries), Decision Log entry 3 (ten decisions), and Interfaces §B (`repairScope`'s revised signature and "What counts as a replacement").

## What exists now

- **Three keys** in `src/shared/ipc/schema/layout.ts`: `cards.open`, `panelTools.widths` and `panelTools.groups`. They are added beside the existing schemas, and all three are added to `LayoutKeySchema`. No existing schema changed.
- **Three slices in the layout store**: `panelGroups`, `panelWidths` and `cardsOpen`.
  - They are read at hydration and written through `persistedKeys` / `storedValue`.
  - `storedLayout(state)` exports every key as `persistLayout` writes it.
  - **The first read** happens when the listing and every read of hydration answered and the listing holds no `panelTools.groups` (revised at the boundary review: a launch with a failed listing or read defers it whole, nothing pruned and nothing marked, and hydration writes no key it could not read; after such a launch, persistence's first write of a list, the stacks or the groups writes the marker, and the profile is never pruned):
    - In each session's list, a tab of a single-instance tool that is not in view (or to be shown) by §A's reading is dropped. The pins, and the tabs of multi-instance or unregistered tools, are kept.
    - Each scope whose list changed is repaired.
    - `panelTools.widths` becomes `{ wide: regions.panel.width, or null when that is 380; narrow: null }`.
    - The three keys, each pruned `panel.<session>` and, when the prune dropped some, `panelTools.params` are written at once.
  - `hydrate` takes `multiInstance`, and `ipc/events.ts` passes the host registry's answer.
- **The model** in `panel/surface-model.ts`:
  - `readGroups` / `sideGroups` implement §A's reading rule.
  - Also `groupOf`, `groupForOpen`, `lowerEntry`, `valuesOf` and `scopeValues`.
  - `repairScope(before & { refs }, refs, renamed?)`.
- **The store's acts**: `showSurfaceTab`, `hideSurfaces`, `moveSurfaceTab` (through `groupsAfterMove`), `setGroupShare`, `setPanelWidth` and `setCardOpen`.
  - **The repair** runs on every writer of refs (`setPanelTabs`, `updatePanelTabs` through it, `setPanelTabPinned`, `dropSession`, the first read), in every scope the change reaches. Replacements in place are read from the write itself.
  - Nothing calls the new acts yet.
  - `setPanelTabs` keeps its stacking rule for the scope it writes, until M2.
- **The two widths.**
  - `shellGeometry` takes the widths as a fifth argument and no longer reads `regions.panel.width`. The automatic width is 60 % of the room for a wide column and 360 for any other.
  - `WIDE_SURFACES` and `isWideColumn` move to `app/shell-geometry.ts`; `shell-view.ts` re-exports `WIDE_SURFACES`. `panelWidthClass(state)` is the store's one reading of the class.
  - The bar (`PanelRegion.tsx`) writes through `setPanelWidth`. `Resizer` gains `onReset`, so Enter and a double-click make the width automatic again, which F reads as 380.
  - A drag past either end hands back "automatic" when the width in use was automatic.
  - `toggleSessionCards` passes the widths.
- **Build F's reader, frozen** in `test/support/layout-build-f.ts` (one include line added to `tsconfig.web.json`).

## How it was verified

Every check ran on the wave's VM through `vmcheck.sh`, against the pushed head of the time.

| check | head | result |
|---|---|---|
| `pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null` | `37d2bd627` | exit 0 |
| `pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null` | `37d2bd627` | one error, in a test's array literal; fixed in `508de923d` |
| M1's suites: `vitest run src/shared/ipc/schema src/renderer/src/panel/surface-model.test.ts src/renderer/src/panel/side-groups.test.ts src/renderer/src/stores src/renderer/src/app` | `949340775` | first run: 1 failed of 1132 (`Shell.panel.test.tsx`, below); it passed alone and as its file. The rerun had 75 files and 1132 tests passed, exit 0 |
| `pnpm exec eslint` over the 16 changed `.ts`/`.tsx` files | `949340775` | exit 0 |
| `pnpm typecheck` (whole) | `949340775` | exit 0 |
| `pnpm test` (whole), first run | `61f2efd5d` | 69 failed of 36102. FloatingCard's Dock case (both renderer projects) was mine and is fixed. The rest are the known VM set, load, or failing on master too (list below) |
| renderer reruns of the non-known failures, on the branch and on master | `5f06bae5d` / master `5c9cfa0c5` | `ScmShell.test.tsx` and `viewer.test.tsx` fail on master the same way. `subagents`, `Library` and transcript `fixtures` pass on the rerun (load) |
| `vitest run src/renderer/src/shell src/renderer/src/app src/renderer/src/panel src/renderer/src/stores src/shared/ipc/schema` | `d316535b0` | 106 files and 1701 tests passed, exit 0 |
| eslint over the last test changes | `d316535b0` | exit 0 |
| `pnpm test` (whole), final run, on the new VM `dc-uxwave2-e584` (load under 1) | `29f5417bc` (the code of `d316535b0`, plus this report) | 2485 files passed, 6 failed; 35918 tests passed, 42 failed, 142 skipped. All 42 are the VM's known set: desk-hub `test/deploy/{hub-reads,production-scripts,staging-scripts}`, `services/machine/setup.test.ts`, `shared/machine/git-reads.test.ts`, `test/artifacts/portability.test.ts`. `ScmShell` and `viewer` pass here |

What the first whole run's other failures are:

- **The VM's known set**: desk-hub `test/deploy/*`, `services/machine/setup.test.ts`, `shared/machine/git-reads.test.ts`, `test/artifacts/portability.test.ts`, and `sidebar/Sidebar.test.tsx` under load.
- **Failing on master too**: `tools/scm/ScmShell.test.tsx` and `tools/code/viewer/viewer.test.tsx`.
- **Timing under load (a load average of 16 to 20, three builders) in suites M1 cannot reach.** None imports the renderer's layout store:
  - `artifacts` / `artifacts-dom`: slides, document editor, deck editor
  - `engine-host/session-stream`
  - `main/browser/screencast`
  - `main/org/rows`
  - `mawsd/daemon-browser`
  - `pty-host/detached`
  - `test/endpoint/{read-open,subscriptions-b}`
  - `test/react-compiler` (`DesignWorkbench.tsx`)
- **Passed on the rerun**: `library/Library`, `transcript/model/fixtures`, `tools/agents/subagents`.

### M1's proof, case by case

- **A5.**
  - `shell-geometry.test.ts`: 360 for a narrow tool and 720 (60 %) for Review with nothing stored, whatever `regions.panel.width` holds. A stored narrow width leaves the wide one alone, and the reverse. 380 stored is not automatic.
  - `side-groups.test.ts`: a drag writes the class in view and `regions.panel.width`, rounded. A reset gives null and writes 380.
  - `layout-persist.test.ts`: a first read at 380 gives `wide: null` and at 512 gives `wide: 512`. A later `setPanelWidth(380)` is kept across a relaunch.
  - `Shell.test.tsx`: the bar's arrow and Enter.
- **A11, the reader's half** (`layout-persist.test.ts`):
  - F's layout with two stacked surfaces reads as two groups with those two in view.
  - Session info (unviewed, single-instance) is gone, while the second terminal, the pin and an unregistered plugin pane stay.
  - The writes are exactly `panel.<A>` and the three keys.
  - A second hydration prunes and writes nothing.
  - Session info opened again is a tab after one more launch.
- **§A's rule** (`side-groups.test.ts`):
  - all five branches;
  - a stale or repeated id, and the cut to two;
  - a lower entry naming the upper tab in view;
  - a lower entry whose tabs are all gone (shown and hidden);
  - two terminals in view;
  - a share out of range, clamped by the reader and refused by the schema;
  - a stack whose only id is gone reads as hidden.
- **Decision 5** (`side-groups.test.ts`):
  - A's pin unpinned into B: A has Review in view and is not hidden.
  - A pin in A's lower group closed from B: A keeps its lower group with the other tab in view.
  - `@none`: the next pin, then nothing, with `activeNoSession` following.
  - A restored id replaced in place keeps its place.
  - The close-and-open case at one position, in three variants: the new tab is a pin; it is B's own; it is another tool.
  - A dropped session takes its lower entry.
- **§G**: every act's case parses every stored value of an F-known key with the frozen copies:
  - two groups, a hidden column, two terminals in view;
  - a move, a close, a pin and an unpin;
  - a width drag and a reset.
  `layout.build-f.test.ts` holds this build's stored forms against the copies, and the live schemas of F's keys against the copies (Constraint 2).
- **`cards.open`**: absent reads as `['environment']`, and a value with an unknown card falls back to it.

## What is not verified

- No e2e ran (not mine to start). M1 touches what these specs see:
  - `e2e/shell.spec.ts` (its resizer and relaunch step: the narrow automatic width is 360, not 420, and a reset writes 380);
  - `e2e/ux2-shell.spec.ts` (widths, A5);
  - `e2e/layout-transfer.spec.ts` (widths across a relaunch);
  - `e2e/cross-build.spec.ts`;
  - any spec that lists the keys of `layout.json` after a first launch, which now also holds `panelTools.groups`, `panelTools.widths` and `cards.open`, and a pruned `panel.<session>` on a profile F wrote.

  The scenes M1 should gain are M9's: the widths across a relaunch, and F's profile read the first time.
- Class 1a did not run (not this run's).
- M1 has had no boundary review. The document gives it to the controller's reviewer before M2.

## Decisions made (Decision Log 3 in the document)

1. M1 was built before step 0, on the architect's word. U8a was merged when it landed.
2. `ipc/events.ts` passes `multiInstance`. The file is no child's, the change is one option, and decision 1 foresaw "the shell passes". U13a's first milestone edits the same hydrate call on its own branch, so whichever lands second merges it. The built-in tools register in App's effects, in the same commit as `connectShell`'s, before any hydration read answers.
3. `repairScope` takes the refs from before the change (`before.refs`); §B is revised.
4. A replacement in place is read from the write itself (same position, same tool, new id), so `panel/host.ts` stays untouched. The close-and-open case at one position reads as a replacement too:
   - In every scope where the new ref is a tab, it takes the old one's place in its group and in view.
   - Where it is not a tab, the neighbour takes the place.
   - Nothing else carries over: its pin state is the writer's, and its params are its own.

   This is written in §B and pinned by a test.
5. Until M2:
   - `setPanelTabs`'s stacking rule owns the scope it writes, and only that scope's lower entry follows its refs.
   - `updatePanelTabs` keeps its `{ activeTabId }` options and `setSurfaceStack` stays.
   - A repaired scope's `activeTabId` takes §A's meaning at once. This differs from the stacking rule's only in a scope with two surfaces whose refs another session's write changed.
6. The first read keeps a hidden column's "to be shown" tab as well as one in view.
7. A launch at which `layout.list` or any `layout.get` failed is no first read (revised at the boundary review; first written as "a failed `layout.list`" alone). After such a launch, this build's first write of the side column's state writes `panelTools.groups`, so the prune never runs on lists this build has written.
8. The bar's restore value for an automatic width is 0, so a drag past either end hands back "automatic". `floatPanel` is called without a width.
9. F's frozen reader is in test support. The acts are tested in `panel/side-groups.test.ts`, because the node project cannot import the renderer store (composite, TS6307). That file also avoids U13a's `surface-model.test.ts`.
10. `WIDE_SURFACES` moves to `shell-geometry.ts`.

## Where M1 contradicted the document or the code

- **§B's `repairScope` signature could not express its own rule.** "The next tab to its right" needs the scope's refs from before the change. It is revised in §B; this is no contract of another child.
- **§B gave no way for the host to pass `renamed` without editing `host.ts`**, which the document defers to M2. The store infers it (decision 4).
- **M1's list of files touched omits `ipc/events.ts`**, which decision 1 needs. The file is no child's, so this was no stop.
- **Decision 2 names `src/shared/ipc/schema/layout.build-f.test.ts` as the test that runs the acts.** The node project cannot import the renderer's store, so the acts' parse is in the renderer's suite and the shared file holds the stored forms (decision 9).
- **Test helpers changed as the slices forced**:
  - `test-support/panel.tsx` and `test-support/shell-stores.ts` reset the three slices;
  - `layout-persist.test.ts`'s `setup` holds the three keys as a relaunch;
  - `Shell.test.tsx`, `FloatingCard.test.tsx` and `shell-geometry.test.ts` follow 360 and the width in use.

No stop was met. No contract of another child changed, and nothing the owner sees changed beyond the child's file: the side column draws as before, except the narrow automatic width (360) and the two remembered widths, which are A5.

## What M2 needs from the architect before it starts

- **Step 0's other half (U6a) on master**, merged into the branch (Constraint 9). U8a is in.
- **The owner's answers**, or the word to build on the defaults: M2's decision 5 (a strip too narrow for its tabs), then M3's decision 1 and M8's two.
- **What M2 inherits from M1.** M2 replaces `setPanelTabs`'s stacking rule with maintenance plus the repair (drop the "settled" scope), and does these with it:
  - change `updatePanelTabs`' options to `{ activate, group }` and `host.ts`'s callers with them;
  - remove `setSurfaceStack` and `stackAfterSelection`;
  - let `normalizeSurfaceStack` keep two tabs of one tool;
  - let the host's `repairSelections` defer to the store's repair, which already covers what it did.

  M2 may also make the host pass `renamed` explicitly instead of the inference. If it does, §B's "What counts as a replacement" changes with it.
- **The merge with U13a** in `stores/layout.ts`, `panel/surface-model.ts`, `test-support/panel.tsx`, `layout-persist.test.ts` and `ipc/events.ts` falls to whichever lands second.

## Friction

- **GitHub refused one branch push** (`remote rejected (failed)`) at `61f2efd5d`. An immediate retry went through, confirmed with `ls-remote`. The VM run chained after it tested the old head and was rerun. This is logged in the friction tracker (`MAWS/conditional/github-transient-rejection-of-ci-gate-scratch-ref-push.md`).
- **The VM's ssh link dropped during long runs** (exit 255, or the output cut short). The workaround was to keep each run's output in a file on the VM and read it back afterwards; the whole suite runs detached under `nohup`, polled for its status file.
- **The branch moved to the VM `dc-uxwave2-e584`** during the run, on the architect's word, because the first VM had reached load 31. My detached run there was stopped (its status was 143), and the final whole suite ran again on the new VM.

## Residue

- **The `Shell.panel.test.tsx` case "an addTool before hydration writes nothing…".** It asserts that the 250 ms write-back has not fired yet, which the shared VM's load can break; it failed once and passed alone, as its whole file and on the rerun. A ticket could make it wait on fake timers.
- **`ScmShell.test.tsx` ("draws the selected file's hunks…") and `viewer.test.tsx` ("a follow-the-file re-read…") failed on master on the loaded VM** (load 17 to 33) and passed in the final run on the unloaded one. They look load-bound (a `waitFor` and a 5 s time-out), as do the timing failures of the first whole run. Probably no ticket; at most a note for the wave's account of the VM's noise.
- **The panel harness's widths** (fixed at the boundary review): `setWidth(px)` now restores the column and writes through `setPanelWidth`, and the width buttons read the width of the class in view. 380 is now a width like any other, so `e2e/panel.spec.ts`'s child scene that expects 420 for `setWidth(380)` ("automatic narrow defaults cap at 420px") reads 380 now; its "and back" steps at 380 (the terminal refit, the review header) return to 380 px rather than to the automatic width. Those scenes are M9's to bring to the new widths.

## The whole run, M2 to M9 (2026-11-13, the controller)

Branch `ux-wave/U8b`, from `78d343799` (the document) to `a8a96e5d5`. Each milestone was built by a fresh executor and reviewed at its boundary, and every review closed clean. The milestones, with their fix rounds, are listed in the document's Progress; the decisions are in Decision Logs 6 to 18. Masters merged: `e71334239` (U6a), `d7ca414ae`, `80dcc59af`, `c0e7b2ae8` (U10a), and `9df6b4493` (U13a, five conflicts resolved as both, reviewed).

### Validation evidence (VM dc-uxwave5-26dc)

**At M9's head**
- `pnpm exec tsc --noEmit -p tsconfig.e2e.json`: 0 errors.
- `pnpm exec eslint e2e`: clean.
- `node --test .github/scripts/*.test.mjs scripts/*.test.mjs`: 556 of 556 pass, also at the fix round's head.
- `pnpm typecheck`: exit 0. The first run failed in desk web, fixed in `da097279b` (Decision Log 18).
- `pnpm exec vitest run src/shared/machine`: 129 of 131 pass. The 2 failures are the known `git-reads.test.ts`.
- `pnpm test`, run once for the landing (Decision Log 5), detached: 2,504 files passed, 7 failed, 27 skipped. Six of the seven are the known master failures named in the common brief. The seventh, `src/main/org/rows.test.ts`, timed out at 5 s under the suite's load and passes alone (36/36); the branch touches nothing under `src/main/org`.
- Stderr: 75 test files wrote to it in the whole run. 73 of them, and their modules, are untouched by this branch. The other 2 were traced to other tests (`history-window.test.ts`'s quiet follows, `ipc/events.test.ts`'s deliberately invalid event).

**At each milestone:** the typecheck of the projects it changed, eslint on its changed files, and vitest over its directories and their importers. The counts are in each milestone's task report.

### e2e groups whose spec files changed (none has run)

`e2e:layout`, `e2e:default`, `e2e:panel`, `e2e:code`, `e2e:scm`, `e2e:agents`, `e2e:agents-live`, `e2e:lane-a`, `e2e:remote`, `e2e:cross-build`, `e2e:browser-comment`, `e2e:terminal`, `e2e:presentations`, `e2e:browser`, `e2e:tools`, `e2e:supervisor-daemon`, `e2e:side`, `e2e:browser-chrome`, `e2e:dashboard`.

Also changed: `c12-prerun.spec.ts` (behind its flag) and `panel-live.spec.ts`.

Affected through shared helpers only: `e2e:deliverables` and `e2e:design`, whose bounds are open premises below. `e2e:desk-web` joins the Mac set (Decision Log 18).

### Open premises, and the scene that settles each

| Premise | Scene that settles it |
|---|---|
| Tab shapes at 280 px | `e2e/ux2-shell.spec.ts:488–493` |
| Strip order | `ux2-shell.spec.ts:368`; `cross-build.spec.ts:2161` |
| Radix's focus after Shift+F10 | `panel.spec.ts:1684–1693`, called at `panel.spec.ts:1783` |
| F keeping the session tab in front | `cross-build.spec.ts:2287` |
| The 316 px comment host | `deliverables.spec.ts:1020` |
| The 150 px design world under the strip | `design.spec.ts:209–215`, bound at `design.spec.ts:279` |
| The new reverse crossing of the global pin and the no-session selection | `cross-build.spec.ts:2218–2234`, `2328–2333` |
| A2's two roots | `agent-tools.spec.ts:702–726` |

### Not verified

- Every e2e scene.
- The cross-build run with F.
- Class 1a.
- The branch review.
- Desk web's rendering beyond its typecheck, though no pinned row text changed.
- `activeNoSession` read alone by F: this build always writes the matching `stacks` entry (Decision Log 17).

### Residue (ticket candidates)

- `app/Shell.panel.test.tsx` "an addTool before hydration writes nothing…" relies on the real 250 ms write-back not having fired, and failed once under VM load. Move it to fake timers.
- `panel/summary/PushState.test.tsx` "Sign in types gh auth login into a Terminal tab" registers no Terminal tool, so every run prints `panel: no tool registered as terminal`. Predates the branch.
- Load-sensitive time-outs in a broad run, each passing alone: `transcript/view/TranscriptSlot.test.tsx` (10 s hook) and `src/main/org/rows.test.ts` (5 s).
- No e2e fixture has a failed agent, so A7's "finished with errors" has unit proof only. No scene shows the ask sheet giving back its place.
- Tracker row added (`docs/tech-debt-tracker.md`): a folded parent does not say that a nested agent waits.
