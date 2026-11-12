# UX wave · U8b: the card column, the panels, and tabs in the side column (2026-11-12)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave, a composite), child **U8**, second pull request (**U8b** in the root's "Ordering and dependency map"). **Parent pin:** `48619c824` (master). The composite was read at `15801c792` of branch `ux-wave-spec`, which holds the corrections of 2026-11-12 (UC-4's readers, UC-14's rule for the settings files); where the two differ the newer holds, and it reaches master with the wave's next documents pull request.
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U8-card-column-working-folder.md`: Contracts → "UC-9 (owned)", acceptance A1 to A8 and A11, and the items O-05, O-09, O-36, O-10, #359 (with X-168) and l5-code-16. Where that file and a contract's statement in the root differ, the root binds. This document carries the constraints and the milestones, and of the design only what the child's file leaves open.
> **Binding on this landing:** UC-9 (owned), UC-14 (what is stored, build F can still read), UC-1 (one meaning of "waiting"), UC-6 (one keymap), UC-7, UC-8 (who owns which files), UC-10, UC-11, UC-12 (the destination hides the column); laws 2, 3, 5, 7 and 8.
> **Branch:** `ux-wave/U8b`, from master `48619c824`. **Board:** #580. **Written against** that commit; build F is `f1852de3a`.

## Purpose

Beside a session the person sees what matters about it without opening anything: where it works and what it changed, and, only while there is any, what it has running, as a tree of its subagents and a list of its background tasks. Finished work no longer takes the top of the Subagents and Background tasks panels, and a panel for watching work opens narrow. The tools opened beside the chat are tabs of one strip, one in view; nothing is placed under another by itself, and the person can move tabs into a second group under the first.

How to see it working, on the wave's build: open a session with nothing running and see Environment open with Context and Connectors folded under it; start a background shell and see a Background tasks card come and go; open Review, a terminal and Session info and see three tabs with one tool in view; choose "Move below" on one and see two groups; quit, relaunch, and see the same tabs, groups and folds. Then open the same profile with build F and see its two stacked surfaces, its sidebar and its tabs as F draws them. In the suites: the unit tests named under each milestone, and the e2e scenes of M8.

## Progress

- [x] (2026-11-12) Document written against master `48619c824`: the side column's model, the stored layout and build F's readers, the cards and the two panels read in the code; the stored form settled (Interfaces §A, §G).
- [ ] Adversarial review of this document (the architect dispatches it).
- [ ] Step 0 (U6a, U8a) is on master and the branch has merged it (Constraints 9).
- [ ] M1 — what is stored, its readers, and the two widths
- [ ] M2 — one strip, one tab in view
- [ ] M3 — the second group
- [ ] M4 — the card column
- [ ] M5 — what the graph knows of running work
- [ ] M6 — the two panels
- [ ] M7 — the two cards for running work
- [ ] M8 — the e2e scenes, the record, and the acceptance run
- [ ] The proof an executor does not run: the owner's look at the drawn column, the cross-build run with F, the e2e groups, the branch review, class 1a on the final head.

## The landing's edge

**In.** UC-9's column: the cards and their order, the remembered folds, the two slots, the gate a page uses. O-05: the Subagents and Background tasks cards, Artifacts as an entry of the three-dot menu, Environment open. O-09 with X-165: the two panels, and the two remembered widths. O-36: the strip of tabs over the side column, one tab in view, the icons' rule, the second group made by a tab's menu, what is stored and its first read. O-10: the Context card. #359 with X-168: an agent's state as it is known. l5-code-16: the Environment card's change line. The e2e scenes for these and the dated amendments of the three rulings this landing reverses.

**Out.** Everything of UC-4: U8a's selector is used where the cards already use it and nothing else of the working folder is built (the "moved from" line, the allowlist, Files' first root are U8c's). The drags of a tab (onto the lower part, between groups, to the main area), the selected tab kept in view in a scrolled strip, and Files' open files as tabs: U6b's, built on Interfaces §C. The content of the waiting-requests card and every rule about requests (U1). The `/btw` card (U4). The next-step button on the push row (U5). The page that hides the column (U7). Stopping or messaging an agent on another machine (U9). The artifact list's content (U10). The transcript's rows for an agent or a task that ends (U3) and any edit to the transcript's model (UC-3). The register and the board, which the architect updates at landing.

## Words used here

- **The side column:** the column of tools opened beside the chat, right of the main area (`#region-panel`, `src/renderer/src/panel/`). **A tab** of it: one tool instance open for a session, a `PanelTabRef` (`id`, `toolId`, `pinned`) in that session's list (`panel.<session>`) or among the global pins (`panel.pinned`). **The strip:** the row of tabs over the column. **In view:** the tab whose body is drawn. **A group:** a strip with one tab in view under it; the column has one, or two with the second (**the lower group**) under the first.
- **The card column:** the cards that float over the right of the main area while no tab is in view (`[data-region="cards"]`, `src/renderer/src/panel/summary/`).
- **A scope:** the key the side column's stored state is filed under: a session's address, or `@none` while no session is shown (`surfaceScope` in `panel/surface-model.ts`).
- **Build F** (`f1852de3a`): the build on the owner's machines, which may open the same profile after a trial of the wave's build. **Its reader:** the schemas of `src/shared/ipc/schema/layout.ts`, which are F's byte for byte at this document's base (`git diff f1852de3a 48619c824 -- src/shared/ipc/schema/layout.ts src/main/layout/store.ts src/renderer/src/panel src/renderer/src/stores/layout.ts` is empty).
- **The three routes** (law 5): a session MAWS runs, a terminal session, a session on another machine.
- **The VM**, **class 1a**, **the controller** (the plan executor that runs the milestones, reviews each at its boundary and is this document's one writer while they run).

## Constraints that bind every milestone

1. **Where work and checks happen** (root UC-10; `~/.local/share/maws-ux-wave/briefs/build-common.md`, which binds as written). On the MacBook: edit, commit, push; no `pnpm install`, typecheck, eslint, vitest, build or Electron. Every check runs on the wave's build VM in a checkout of the pushed head, through `vmcheck.sh` (Concrete Steps). The helper's exit status is the command's: never pipe it into `tail` or `head` without `set -o pipefail`. Electron e2e is never started by an executor. No pull request is opened by an executor. Every commit message ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution. Never commit to master or to `ux-wave-spec`.
2. **What is stored, build F can still read** (root UC-14). No existing schema in `src/shared/ipc/schema/layout.ts` is edited: no field is added to a stored panel tab, to `panel.<session>`, to `panel.pinned`, to `panelTools.surfaces`, to `panelTools.params` or to `regions`, and no version of them moves. What M1 puts in that file is added beside them, and the three key names are added to `LayoutKeySchema`. Neither settings file changes. Everything this landing writes under a key F knows is a value F's reader accepts (Interfaces §G), and a test holds F's schemas for the side column as a frozen copy (M1). An executor that finds a behaviour of this landing cannot be stored without changing a value F knows stops and reports it.
3. **Files other children own** (root UC-8). This landing owns `src/renderer/src/panel/` except `TabStrip.tsx`, `src/renderer/src/tools/agents/`, `app/Shell.tsx`, `app/shell-geometry.ts`, `app/slots.ts`, and its three keys in the layout schema. Its edits elsewhere are these and no others, each the smallest insertion that does the job. In files UC-8 gives another child: `stores/layout.ts` (U13: three slices, their reads and writes, the side column's acts of Interfaces §B); `panel/TabStrip.tsx` (U6: the two menu items and the strip's use without `inline`); `keymap/shell-navigation.ts` (U6: each group's strip as a stop); `src/shared/keymap/actions.ts` (U6: one title, M6); `tools/code/review/ReviewSummary.tsx` (U5: one button, M4). In files UC-8 gives nobody: `app/shell-view.ts`, `app/Resizer.tsx`, `app/slot-fallbacks.tsx`, `harness/agents/agentsProbes.ts`; and for M5 the three wire shapes (`src/shared/graph/events.ts`, `src/shared/engine/status.ts`, `src/shared/ipc/wire.ts`), the normalizer (`src/engine-host/normalizer-system.ts`, `session-status.ts`), the transcript follower (`src/engine-host/fs/`) and `src/renderer/src/lane-a/`. Test files and test helpers change as the new behaviour forces. An executor that finds a further file of another child must change, beyond a fixture's shape, stops and reports it.
4. **The repository is public** (root UC-11). Fixtures, test strings and screenshots use invented ids, titles, paths and names.
5. **The wave's laws.** Law 2: nothing here draws in place of a mod. Law 3: no setting is added. Law 5: every item holds on the three routes, and a milestone says so where a route differs. Law 7: today's tokens and shapes; no new colour, radius or shadow. Law 8: an executor that finds a behaviour the owner marked `keep` would change stops and reports; the relaunch that restores what was open is one (l7-shell-12).
6. **One meaning of "waiting"** (root UC-1). The waiting-requests card's presence and an agent's "Approval needed" read the predicate `src/shared/attention/kinds.ts` exports and add no second one (Interfaces §C names which, before and after U1a).
7. **Keys** (root UC-6; U6a's document, Interfaces A and G). This landing adds no action id and no chord. "Move below" and "Move above" are items of a tab's menu with no chord. One row's title changes (M6). A row added later by a fix follows U6a's Interfaces G and is not rebindable while F may run.
8. **Copy** is in Interfaces §F and is used exactly as written.
9. **Base.** No executor starts before step 0 (U6a and U8a) is on master. The controller merges `origin/master` into the branch before M1 and again before M8, and at any milestone boundary where master holds a new landing of the wave. What this landing meets there is listed in Interfaces §H.
10. **A stop is a stop.** Stop and hand back to the architect, with the evidence, when the code contradicts a statement of the child's file, of the root or of this document; when a contract or another child would have to change; or when a change would alter what the person sees beyond what the child's file says.

## What the code holds today

Read at `48619c824`. Only what the milestones lean on and the code does not say in one place.

- **The stacking rule is one function in the store.** Every write of a scope's refs or selection passes `setPanelTabs` (`stores/layout.ts`), which recomputes `panelSurfaces.stacks[scope]` with `stackAfterSelection` (`panel/surface-model.ts`). So a second tool stacks whoever opens it: an icon, `addTool`, a transcript row, a card's button, the agent's `show_pane`.
- **An icon closes nothing today either.** `toggleSurface` and `closeSurface` (`panel/SurfaceRow.tsx`) only take a tool out of the stack; its ref stays in the session's list for good. That is why the first read must prune (Interfaces §A).
- **An empty stack means "show the cards".** `toggleSessionCards` writes `stacks[scope] = []`; the card column is drawn when no tab is in view, `regions.panel.collapsed` is false, and there is room (`Shell.tsx`; the same rule is written again twice in `SurfaceRow.tsx`). `collapsed` turns the cards off with the column.
- **Only the tab in view is mounted** (`panel/ToolBody.tsx`); a tool's state lives outside React in the host's instance map and restores its own view state on mount.
- **Two stacked surfaces split the height equally**, with no bar and no stored share (`PanelHost.tsx`). A tool has no `header` of its own in its declaration; a header row's content comes from a body's X32 registration (`useEditorHost`, `panel/editor-host.ts`).
- **One width.** `shellGeometry` reads `regions.panel.width`, and reads exactly 380 as "automatic" (60 % of the room for Review, Files or the browser, else 420).
- **The cards.** `Summary.tsx` draws Environment, Context, Connectors, Artifacts; `FloatingCard.tsx` keeps each fold in component state, so every card is folded again at each change of session. `panel/summary/BackgroundWork.tsx` and `Subagents.tsx` are imported by nothing. The Environment card's change line is drawn by Review's `summary` component, `tools/code/review/ReviewSummary.tsx`.
- **"More surfaces"** lists every registered tool whose `menu` is not false, except `artifacts`, by an explicit filter in `SurfaceRow.tsx`. The surface rows of the keymap are written by hand in three places (`actions.ts`, `app/shell-actions.ts`, `SURFACE_ACTIONS`); `artifacts` has none and needs none.
- **The task graph** (`tools/agents/store.ts`, `model/task-graph.ts`) holds agents, workflows, shells, monitors and tasks of any other kind; nothing lists the last, and `counts()` ignores them. An agent knows its parent (`agent.parentAgentId`); a shell or a monitor does not know who started it: the engine's `owned_by_subagent` and `parent_task_id` are read nowhere in `src/`.
- **Who feeds the graph.** A session MAWS runs: its journal and status. A session not running here: sidecars and runs from disk, every agent "status unavailable". A terminal session on another machine: its plane transcript's tree with each agent's reported status laid over it (`lane-a/remote-agents.ts`, `lane-a/agents/task-feed.ts`). A terminal session on this Mac: the disk reading only. Its shells and monitors come beside the graph, from a ledger over its transcript's rows (`src/services/lane-a/jobs.ts`, a port of sminos's, pinned by DX4's vectors; `lane-a/jobs/` in the renderer), and that ledger derives no agents on purpose (`derive` answers `subagents: []`), so its Subagents panel shows no agent as running.
- **An exit ends agents in two models,** the graph (`process.exited` → every running node `exited`, read "ended with the session") and the transcript's reducer (`endAgents`, after which an agents row reads its agents stopped). The transcript draws no row for an exit that is disk-derived with reason `unknown` (`derive.ts`). The one place such an exit is made is the end of a transcript follower's backfill, and only when the session has no live holder at that moment and its last turn never ended (`src/engine-host/fs/chain-follower.ts`).
- **"Waiting".** `src/shared/attention/kinds.ts` exports `isOpen` and `waitsOnAnswer`; `waits` arrives with U1a. The renderer's one selector of a session's open items is `selectPendingOf` (`stores/attention.ts`), which `AgentList.tsx` reads for "Approval needed".

## Plan of Work

Eight milestones, run in order by the controller, a fresh implementer for each, each reviewed at its boundary before the next starts. M1 gives the stored form and the model the side column reads; M2 and M3 build the side column on it; M4 builds the card column; M5 gives the graph's reading of running work; M6 the two panels and M7 the two cards that read it; M8 writes the e2e scenes, carries the record and runs the acceptance. Every milestone leaves the branch green on the VM: the tests it changes are changed in it.

Each entry says what exists at its end, what it touches, the interfaces it exposes and consumes by name (defined once, in Interfaces), the decisions that are its alone, what it does not touch, and what it proves. An implementer reads the child's file for the design of its items and this document for everything the file leaves open.

### M1 — What is stored, its readers, and the two widths

**What exists at its end.** `layout.json` can hold `cards.open`, `panelTools.widths` and `panelTools.groups`; the layout store carries them as three slices, reads them at hydration, runs the first read once, and writes them back as it writes its other keys. The pure reading of a scope's groups (`sideGroups`) exists with its tests, and so do the store's acts of Interfaces §B, though the side column still draws as it did: nothing calls the new acts yet, and `setPanelTabs` keeps its stacking rule until M2. The side column has two remembered widths: a narrow tool opens 360 px wide, Review, Files and the browser at 60 % of the room, and a drag moves only the width in use (A5).

**What it touches.** `src/shared/ipc/schema/layout.ts` (additions only); `src/renderer/src/stores/layout.ts` (the slices, `hydrate`, `persistedKeys` and `storedValue`, the acts); `src/renderer/src/panel/surface-model.ts` and its test; `src/renderer/src/app/shell-geometry.ts` and its test; `app/shell-view.ts` (the widths passed to `shellGeometry`); `panel/PanelRegion.tsx` (the resizer's writes); `app/Resizer.tsx` (one optional prop, below); `panel/SurfaceRow.tsx` (`toggleSessionCards` passes the widths to `shellGeometry`); `stores/layout-persist.test.ts`; a new test file for F's frozen schemas.

**Interfaces.** Exposes §A and §B to M2, M3 and M4, and §G's guarantees to the cross-build run. Consumes nothing of this landing.

**Decisions.**

1. *The first read needs to know which tools are single-instance,* and the store must not import the panel host. `hydrate` takes one more option, `multiInstance?: (toolId: string) => boolean | undefined` (undefined: not registered now), and the shell passes the host registry's answer; every built-in tool is registered before hydration's reads return (`App.tsx` registers in effects that run before `hydrate` is awaited: check it, and where a tool registers later its tabs are kept, which is the safe side). Rejected: pruning in the host as `pruneRestoredLogs` does, which sees only the shown session, so a session not opened in the first run would never be pruned.
2. *One frozen copy of F's reader.* A new test file, `src/shared/ipc/schema/layout.build-f.test.ts`, holds F's schemas for `panelTools.surfaces` (version 2), a panel tab ref, `panel.<session>` and `panel.pinned`, transcribed from this file at `f1852de3a` (identical to the base), and asserts that every value the store's acts write in the cases of this milestone's tests parses with them: two groups, a hidden column, two terminals in view, a move, a close. It also asserts the live `LayoutRegionsSchema` accepts `regions` after `setPanelWidth` (integer width, version 5). The copy is the pin: an edit to the live schemas cannot make this test pass by accident.
3. *The widths.* `shellGeometry` takes the stored widths as a fifth argument and no longer reads `regions.panel.width`: the automatic width is 60 % of the room for a wide column and 360 for any other, the preferred width is the stored one for the class in view or the automatic one, and the clamps are today's. A column is wide while a tab of `WIDE_SURFACES` is among the tabs in view (already the rule in `shell-view.ts`, and with M3 it covers both groups). `setPanelWidth(px)` writes the class in view and `regions.panel.width`. The resizer's reset (Enter, a double-click) must mean "automatic again", which a width of 380 no longer does: `Resizer` gains `onReset?: () => void`, called in place of `set(defaultValue)` when given, and the panel's passes `() => setPanelWidth(null)`, which writes null for the class in view and 380 to `regions.panel.width` (F's automatic). The drag past the minimum that collapses the right side keeps writing `collapsed` as today.
4. *The acts are written against §A's rule, not against each other.* Each act's test sets a state, calls the act, and reads the result back through `sideGroups`; a second assertion parses the three written values with the frozen schemas. That is what makes "F wrote in between" and "this build wrote it" one code path.
5. *`panelTools.groups` holds an entry only for a scope that has a lower group* (shown or hidden); at every write, entries of scopes no session or pin list holds any more are dropped, as `setPanelParams` drops params of dead tabs.

**What it does not touch.** Any existing schema; `PanelHost.tsx`, `TabStrip.tsx`, `PanelHeader.tsx` (M2); the cards (M4). The stacking rule in `setPanelTabs` (M2 replaces it).

**What it proves.** A5, by unit tests of `shellGeometry` (360 for a narrow tool and 60 % for Review with nothing stored; a stored narrow width leaves the wide one alone and the reverse) and of the store (a drag writes the class in view and `regions.panel.width`; a first read of a layout whose `regions.panel.width` is 380 gives `wide: null`, and of one at 512 gives `wide: 512`; a later `setPanelWidth(380)` is kept as 380; a reset gives null). The reader's half of A11: a layout as F saves it with two stacked surfaces reads as two groups with those two in view, and its unviewed single-instance tabs are gone while a second terminal and the pins stay; a second hydration prunes nothing. §A's rule, as a table of cases over `sideGroups`: each of its five branches, a stale id in `stacks`, a `lower` entry naming the upper tab in view, a `lower` entry whose tabs are all gone, a share out of range. §G: every value the acts write parses with F's frozen schemas. `cards.open`: absent reads as `['environment']`; a value with an unknown card id falls back to the default. Existing tests that change here: the width cases of `app/shell-geometry.test.ts` (420 becomes 360; a stored 380 is no longer automatic), `app/Shell.test.tsx`'s resizer cases, and the hydration cases of `stores/layout-persist.test.ts` that list the keys written at a first launch.

### M2 — One strip, one tab in view

**What exists at its end.** The side column's first row is a strip with a tab for every tool instance open for the session in view, the pins first, and one tab is in view under it. A tool that is opened or chosen is shown in place of the one in view; nothing is placed under another by itself, whoever opens it (an icon, a chord, a transcript row, a card, the agent's `show_pane`). A click on a tool's icon in the title bar shows that tool's tab, and a click on the icon of the tool in view hides the column and closes nothing. A tab's close glyph closes that tab through the tool's own check. Terminals and plugin panes are tabs of the column and draw no strip of their own. (A11's first half, with one group.)

**What it touches.** `stores/layout.ts` (`setPanelTabs`'s rule; `setSurfaceStack` removed); `panel/surface-model.ts` (`stackAfterSelection` removed) and its test; `panel/PanelHost.tsx`; `panel/PanelHeader.tsx`; `panel/SurfaceRow.tsx` (`toggleSurface`, `closeSurface`, `toggleSessionCards`, the context menu's last item); `panel/TabStrip.tsx` (U6's file: the strip used without `inline`, the home glyph's act); `panel/copy.ts`; `panel/host.ts` where `selectTab` and `showSummary` call the store; `keymap/shell-navigation.ts` (U6's file: the strip as a stop); the unit tests named below.

**Interfaces.** Consumes §A, §B. Exposes §C.3 to U6b (the strip's markers and `toggleSurface`'s rule).

**Decisions.**

1. *The rule lives where the stacking rule lived.* Every opener already passes `setPanelTabs`, which is why a second tool stacks today from any of them; its body becomes §B's rule and no opener is edited. `toggleSurface(toolId)` stays the one entry of the icons, the three-dot menu, the context menu and the `surface.*` actions (so ⌘J, ⇧⌘D and ⇧⌘F, which U6a bound to those actions, follow without an edit): the tool has a tab in view and the right side is not collapsed: `hideSurfaces`; else the tool has a tab: `showSurfaceTab` of the one last in view of that tool in this run (a module map by scope and tool, forgotten at quit), else its last tab in strip order; else `panelHost.addTool`. Then `setPanel({ collapsed: false })` as today. The Questions tool's `settleWaitingAsks` call stays where it is.
2. *What the column draws.* `PanelHost` draws, for each group of `sideGroups` (one in this milestone): the strip (`TabStrip` over that group's tabs), then the tool's own header row only when the tab in view has an X32 registration (`useEditorHost`: a breadcrumb, a saved state, actions, exports), then the body. A tool without a registration has no row under the strip: its title is the tab's. The region's controls (Float, Maximize or Restore, Hide) sit at the right end of the first strip, drawn by `PanelHeader.tsx`'s `RegionControls`, which stays the one place they are defined (U10 inserts its control there). Hide is `hideSurfaces`; its label is "Hide" with the tooltip of Interfaces §F. The strip's home glyph goes: Hide is that act.
3. *Only the tab in view is mounted,* as today (`ToolBody`'s rule: a tool keeps the view state it would miss in its own state and restores it on mount). That is what "as it was left" rests on for Review's scroll and a terminal's process, and it is not changed. `ctx.visible` stays "the right side is not collapsed"; a tab not in view is not mounted, so no tool needs a new meaning of it.
4. *The markers U6b and the keyboard read.* The column's container keeps `data-surface-stack`; each group is `section[data-side-group="upper"|"lower"]`; a group's body keeps `data-surface={toolId}` and `role="tabpanel"`, so `regionStops` in `keymap/shell-navigation.ts` still finds a surface's content. This milestone adds each group's strip (`[role="tablist"]`, its selected tab) as a stop before that group's body, as the main panes' strips are.
5. *The context menu of an icon* reads "Open surface" when the tool is not in view and "Hide surface" when it is; "Close surface" is gone, since the icon closes nothing.
6. *"+"* keeps offering what `menuTools` offers today (a single-instance tool only while it has no tab), and a new tab comes into view.

**What it does not touch.** The second group (M3: `sideGroups` may already answer two groups for a stored layout, and this milestone draws both groups' strips and bodies in the plain equal split it has today, so a stored two-group layout is never drawn as one). The drags and the kept-in-view scroll (U6b). The browser's own page tabs. Which tools exist and what a tool draws.

**What it proves.** A11's first three sentences and the icon's rule, by unit tests: from one tab in view, opening a second tool by its icon, by `addTool` and by `selectTab` leaves one `[data-surface]` and two tabs in the strip, the first tool's state object unchanged; a click on the icon of the tool in view leaves no `[data-surface]`, the cards' condition true and both refs in the list, and a second click on either icon brings back the tab that was in view; closing a tab asks `beforeClose` and, on a pass, shows its right-hand neighbour; two terminals are two tabs of the strip and no strip is drawn inside the header; a tool with an X32 registration draws its header row under the strip and a plain tool draws none. Tests that pinned the old rule and change here, by title: in `panel/panel.test.tsx`, "plain icon clicks stack two surfaces, a third replaces only the lower slot, and closing an icon leaves the other open", "a same-tool tab click selects it; closing the surface preserves every tab for reopening", "on the Overview, clicking an open pinned surface clears its selection without removing the pin", "primary tools have icons and More lists other menu tools; opening a singleton makes it an open icon, not another tab"; in `panel/surface-model.test.ts` the five cases about slots and stacks (rewritten over `sideGroups`); in `panel/PanelHeader.test.tsx`, "puts an unregistered multi-instance tool's tabs and surface controls in one header, naming the terminal only once"; in `app/Shell.panel.test.tsx`, "keeps pins first in the inventory, shows only the selected tool's tabs, and the pin glyph moves its ref"; in `panel/TabStrip.test.tsx` the cases that pass `toolId`.

### M3 — The second group

**What exists at its end.** "Move below" in a tab's menu splits the column into two groups, one above the other, each with its own strip and one tab in view; a bar between them is dragged, or moved from the keyboard, to share the height, and neither group goes under 120 px. "Move above" and "Move below" move a tab between the groups. A group that loses its last tab closes. With two groups a tab that is opened goes where `groupForOpen` says, and a tab that is chosen is shown in its own group. Hiding the column and showing it again, and a relaunch, bring back the tabs, the two groups and the tab in view of each. (The rest of A11.)

**What it touches.** `panel/PanelHost.tsx` (two groups, the bar); `panel/TabStrip.tsx` (U6's file: the two menu items, beside "Move to main area"); `panel/copy.ts`; `panel/host.ts` (the group passed to `setPanelTabs` by an add made from a group's "+"); the unit tests.

**Interfaces.** Consumes §A, §B. Exposes §C.3 to U6b: `moveSurfaceTab`, `setGroupShare`, the markers.

**Decisions.**

1. *The menu.* A tab's context menu holds, in this order: "Move to main area" where `panelTabMoves` offers it today; "Move below" for a tab of the upper group, shown when the column has two groups or its one group has more than one tab; "Move above" for a tab of the lower group. Each calls `moveSurfaceTab`. They are menu items with no action id and no chord (Constraint 7). The menu opens on a right click and on Shift+F10, as an icon's does.
2. *The bar.* A `role="separator"` with `aria-orientation="horizontal"`, `aria-valuenow` the share in percent, focusable; a drag and the arrow keys (8 px a step, 32 with Shift, as the app's resizers) call `setGroupShare`. The share is clamped to 0.2..0.8 in the store and, when drawn, so that each group keeps 120 px; in a column too short for both it is the lower group that gives way down to its strip. It reuses `app/Resizer.tsx` if that takes a vertical axis without a new mode of more than a prop; otherwise a small bar of its own in `panel/`.
3. *"The group that holds the keyboard"* is read when an open is requested: the group whose `section[data-side-group]` contains `document.activeElement`, and none when focus is elsewhere. `panelHost.addTool` and the host's `onChange` pass it as `opts.group`; an opener that cannot know it passes nothing and `groupForOpen` falls to the upper group.
4. *The region's controls* stay on the first strip of the column; the lower group's strip has none.
5. *Widths.* Nothing to add: M1's rule already reads the tabs in view of both groups.

**What it does not touch.** The drags (U6b). More than two groups, groups side by side, a setting for stacking by default: not in the child's file.

**What it proves.** The rest of A11, by unit tests: with three tabs and the third in view, "Move below" on the second leaves the third in view above and the second in view below, each group with its own strip; a tab of a tool opened next joins the group that holds that tool's tab; a new tool opened from the lower group's "+" goes below, and one opened by an icon with focus outside the column goes above; closing the lower group's last tab leaves one group; "Move below" is absent on the only tab of a single group; the bar's keys move the share and it stops at the bounds; hide then show restores both groups and both tabs in view; a hydration from the values just written restores the same (the relaunch); the written values parse with F's frozen schemas, and read by F's rule (`normalizeSurfaceStack` as it is at `f1852de3a`, transcribed in the test) they give the two tabs in view as its stacked pair.

### M4 — The card column

**What exists at its end.** A session's column holds Environment (open), Context and Connectors (folded), in that order, and no Artifacts card; each of the three remembers its fold across sessions and relaunches. The three-dot menu lists Artifacts, which opens the session's artifact list as a tab and can be pinned to the icon row. The Context card has Details… and nothing else under its figures, and a Sources part only when it has a source. The Environment card's change line is a control that opens Review; the branch row has no Review button; there is no Claude Code version row. The column has two slots, first and at its foot, both empty until U1b and U4b fill them, and one predicate decides whether it is drawn. (A1, A3, A6, A8; UC-9 except the two cards for running work.)

**What it touches.** `panel/summary/Summary.tsx`, `FloatingCard.tsx`, `Environment.tsx`, `Context.tsx`, `Sources.tsx`, `Artifacts.tsx` (deleted) and their tests; `tools/code/review/ReviewSummary.tsx` (U5's file: the one button, decision 4); `app/Shell.tsx`; `app/shell-geometry.ts` (`cardColumnShown`); `app/shell-view.ts` (`useCardColumnShown`); `app/slots.ts`, `app/slot-fallbacks.tsx`; `panel/SurfaceRow.tsx` (the filter, the two copies of the cards' rule); `panel/copy.ts`.

**Interfaces.** Consumes `cardsOpen` and `setCardOpen` (§B). Exposes §C.1, §C.2, §C.4 and §D.

**Decisions.**

1. *The fold is the store's.* `FloatingCard` takes `open` and `onToggle` in place of its own state; `Summary.tsx` passes them from `cardsOpen`. A card's children still mount only while it is open, so a folded card makes no read (the test "starts folded without mounting expensive detail reads" keeps its meaning for Context and Connectors).
2. *One predicate, written once* (§C.2). `Shell.tsx`, the Session cards icon's pressed state and `toggleSessionCards` call it. `Shell.tsx` passes `pageOpen: false`; U7 passes its destination there.
3. *A session with no record in this window* (another machine's terminal session that is only listed: `isRemoteLaneA` and no record) gets the column with the slots and the two cards of M7, and none of the three record cards. Today the column needs a record; its condition becomes "the tab in front is a session's, and the session has a record here or is such a listed session".
4. *The change line* is `ReviewSummary`'s button, in a file of U5's. This landing changes that one element: the card's control class (`actionClass` of `Section.tsx`, the hover and focus treatment the card's other controls have), a trailing "›", and the accessible name "Open changes" with the counts as its description (`aria-describedby`), so a screen reader still hears them. The fallback paragraph in `Environment.tsx` for a build with no Review tool stays plain text.
5. *Artifacts.* The filter `tool.id !== 'artifacts'` and the "Open saved artifact" item leave `SurfaceRow.tsx`; the tool is then listed, opened and pinned like any other. No action id is added: the three-dot menu needs none (Constraint 7). The tool's own "Open library" keeps calling what it calls today; U7 points it at its page.
6. *Sources.* `Sources.tsx` exports the rule it has inline today as `useHasSources(appSessionId)`; `Context.tsx` draws the part only when it answers true, so none of the four notes ("No sources yet" and the others) is drawn in the card.
7. *Removed with their only reader:* `Artifacts.tsx`; the Context card's Compact…, Subagents and Background work buttons; the branch row's Review button; the version row and `SUMMARY_COPY.engineVersion`. `stores/summary.ts` and the key `summary.sections` are left as they are: nothing draws from them, and F's reader of that key has a closed set.

**What it does not touch.** The Connectors card. The push row's content and `PushState.tsx` (§C.4). The model row (U4 inserts one call there). The two cards for running work (M7). The content of the two slots.

**What it proves.** A1, A3, A6, A8 by unit tests: a session's column holds the three cards in order with Environment open; folding Environment, switching to another session and back, and re-hydrating the store keep it folded; the folded cards make no read. The three-dot menu lists Artifacts, selecting it adds an `artifacts` tab in view, and "Pin to toolbar" on it adds its icon. The Context card has one button, and a Sources part exactly when `useHasSources` holds. The change line is a button named "Open changes" that opens Review; the branch row holds no button; no row reads "Claude Code". `cardColumnShown` over its inputs, `pageOpen` among them. A component registered in `sessionCardWaiting` is drawn first only while a request of the session waits, and one in `sessionCardFoot` is drawn under the last card; with nothing registered neither draws an element. A listed session without a record gets the column with no record card. Tests that pinned the old column and change here: in `panel/summary/Summary.test.tsx`, "starts folded without mounting expensive detail reads, then opens only the requested card", "combines checkout, changes, push and real navigation in Environment", "opens the guarded compact widget only when a composer is available" (deleted), the five Artifacts cases (deleted), "switching sessions resets disclosures and project scope rather than leaking the previous session's choice"; in `app/Shell.test.tsx`, "the sidebar toggle runs its action, while Session cards toggles the cards and shows its chord"; in `tools/code/review/review.test.tsx`, "fills the folded Environment card's change line with the staged count, and opens Review from it"; in `panel/panel.test.tsx`, the More list.

### M5 — What the graph knows of running work

**What exists at its end.** One task graph per session answers, on every route that has the facts: which first-level agents are running or have running work under them, what is under an agent and how much of it runs, every running background task of any kind in the order it started, and what ended, by kind. A shell or a monitor that a subagent started is counted under that agent. An agent whose run ended while a task it started still runs stays among the running. When a terminal session's process is known to be gone and its transcript holds no exit, its agents end: where the graph holds them (a session on another machine) they read "ended with the session", and the transcript's agents row ends them on both terminal routes. Nothing is drawn differently yet except what follows from those states.

**What it touches.** `src/shared/graph/events.ts`, `src/shared/engine/status.ts`, `src/shared/ipc/wire.ts` (the minor); `src/engine-host/normalizer-system.ts`, `src/engine-host/session-status.ts` and their tests; `src/renderer/src/tools/agents/model/task-graph.ts` and its test; `tools/agents/store.ts`; a new `tools/agents/open-agents.ts`; `src/renderer/src/lane-a/plane-transcript.ts` (the remote exit) and its test; `src/engine-host/fs/service.ts` and `chain-follower.ts` (the local exit) and their tests; `spikes/protocol-probe/fixtures/pass3/uxwave/uxwave-subagent-tasks-{1,2,nodelay}.jsonl` and `spikes/protocol-probe/findings-uxwave-U8-subagent-tasks.txt`, brought from branch `ux-wave/probe-folder-memory` if master does not hold them by then.

**Interfaces.** Exposes §E to M6 and M7. Consumes nothing of this landing.

**Decisions.**

1. *Who started a task* (law 6: read in the fixtures above, six shells and monitors in three sessions). The engine's `task_started` frame and each entry of `background_tasks_changed` carry `parent_task_id` for a task a subagent started (with `owned_by_subagent: true` on `task_started`), and neither key for one the main loop started. The normalizer carries it as an optional `parentTaskId` on the `task.started` event, on each entry of `tasks.snapshot`, and on each entry of the status's `backgroundTasks`; `WIRE_MINOR` goes up by one with its comment, and the field is absent-safe on both sides (an older peer drops a key it does not know; a newer reader treats absence as "the main loop's"). `TaskNode` gains `parentTaskId: TaskId | null`. A test replays one fixture through the normalizer and the reducer and finds the subagent's shell and its monitor under the subagent and the main loop's shell under nothing.
2. *An agent that the engine starts again.* The fixtures show an agent reported `completed` while its own shell still runs, and started again under the same task id with a new run id when the shell's notification wakes it. The reducer continues the same node (running again, the new run id, its earlier facts kept); a test over the fixture holds one node for that task id from first start to last end.
3. *The readings* are pure selectors in `model/task-graph.ts`, defined in §E. `agentTree` and `agentRows` stay for On disk and for the teammates; the Running and Done parts read the new ones. "Under" an agent means its descendants at any depth, agents by `parentAgentId` and tasks by `parentTaskId`.
4. *Which parents are open* is one set of task ids per session, held for the run, in `tools/agents/open-agents.ts` (`useOpenAgents`), shared by the card and the panel. A pinned panel that follows another session reads that session's set.
5. *A terminal session on this Mac has no source for its agents' states, and this milestone adds none.* The child's acceptance (A2, A7) names the route and its Advice says the graph already serves it; the code says otherwise ("What the code holds today"), and the two ways to give it one are designs the child's file does not hold: porting the agents' half of sminos's ledger into `src/services/lane-a/jobs.ts`, which its header says was left out on purpose, or feeding the graph the transcript's disk-form events as the remote route does, which would also change what a session not running here reads. It is with the architect (Surprises & Discoveries). Until a ruling, on this route: the Background tasks card and panel hold (its jobs are known), the Subagents panel reads as today, the Subagents card does not appear, and decision 6 ends its agents in the transcript.
6. *The supplied exit (X-168).* An exit event of reason `unknown` with no sequence number: the transcript's reducer ends agents on it and `derive.ts` draws no row for it, so no file under `src/renderer/src/transcript/` is edited (UC-3). It is supplied once per session and only when the transcript holds no exit after its last row.
   - *This Mac.* The transcript's reader is the follower in `src/engine-host/fs/`. Today it makes this exit only at the end of its backfill, only when no holder is live then, and only when the last turn never ended. It now also makes it when the session's last live holder goes while the follow is open (the fs service knows the holders and tells the follow), and whether or not the last turn ended, since X-168's case is a process that ends after its turn. The existing rule for a session nobody holds at backfill is unchanged where the last turn never ended; where it ended, the exit is made too, so a session read from disk long after its terminal closed ends its agents alike.
   - *The graph of a terminal session on this Mac* holds no running agent (decision 5), so there the exit reaches the transcript alone. Its jobs already end with the process: the ledger reads a job no word ended as `exited` once the session's process is gone.
   - *Another machine.* `lane-a/plane-transcript.ts` supplies the same event to its rows and its tree when its subscription reports the session ended and the held rows end without an exit. While the machine's link is down nothing is supplied: the rows keep their last state and the machine's own offline mark says why.
   - *A session MAWS runs* has its exit on the wire; nothing changes.
7. *A task of another kind* (`other`) is listed with the background tasks and counted; it has no Output and no Stop unless the engine's stop capability covers it, as a monitor.

**What it does not touch.** Any file under `src/renderer/src/transcript/`. The panels' and the cards' drawing (M6, M7). Stopping a task on another machine (U9).

**What it proves.** The graph half of A2, A4 and A7, by unit tests: §E's selectors over built graphs (first level only; a parent with a running child listed though its own run ended; "N nested"; the count under an agent including a shell and a nested agent's shell; the heading's count of every running agent; background tasks in start order with an `other` task among them; Done newest first and its counts by kind and by outcome). The two fixture replays of decisions 1 and 2. A test that fails before, for each of the two readers (the follower on this Mac, the plane transcript for another machine): a terminal session whose last turn ended, with a background agent still running and no exit in the transcript, whose process then goes, delivers one exit of reason `unknown`; the transcript's agents row no longer stays in view as working; on the remote reader the tree's agent reads `exited`; and a second such change delivers nothing. A wire test: an event with `parentTaskId` passes an older reader's tolerant path, and a status without it reads as today.

### M6 — The two panels

**What exists at its end.** The Background tasks panel (the tool keeps its id `background` and takes the card's name) reads "Running N" with every running workflow, shell, monitor and other task in one list, then "Scheduled N" and "Tasks" only when the session has them, then one folded "Done N" whose heading counts by kind; with nothing running it reads "Nothing running" above the folded Done. The Subagents panel reads "Running N" with first-level agents only, a nested agent shown after a click on its parent, then "Done N" folded with what did not complete named, then "On disk N" folded. A running agent with running work under it says how much; a failed one reads "finished with errors" in the danger colour, a stopped one "stopped", one with a request of its own "Approval needed". (A4, A7's panel half; O-09, #359.)

**What it touches.** `tools/agents/background/BackgroundTool.tsx`, `Group.tsx`, `TaskRows.tsx`, `BackgroundSummary.tsx`; `tools/agents/subagents/SubagentsTool.tsx`, `AgentList.tsx`, `shared.ts`, `SubagentsSummary.tsx`; `tools/agents/copy.ts`; `src/shared/keymap/actions.ts` (U6's file: the title of `surface.background`); `harness/agents/agentsProbes.ts`; their tests.

**Interfaces.** Consumes §E. Exposes nothing new.

**Decisions.**

1. *A row is today's row.* A workflow keeps its compact card that opens its run, a shell its Output and Stop, a monitor its Stop; a terminal session's shell has no Output, as today. Only the grouping changes: by state, not by kind. Each row carries its kind's mark, since the section no longer says the kind.
2. *Done* is one section, last, folded at first for each session in each run of the app (the tool's state, as its folds are kept today): every ended workflow, shell, monitor and other task, newest first, each with its outcome word. Past workflow runs of a session not running here are in Done; such a session's note about shells and monitors stays at the top.
3. *"Tasks"* is drawn only when the session has a task list with at least one task; the two sentences for "no list yet" and "the engine is making no task list" are no longer drawn in this panel (the Tasks tool keeps them).
4. *Subagents.* The Running part is `firstLevelAgents` with `nestedOf` under each open parent, one level at a time, by `useOpenAgents`; under an opened parent its finished children stay folded into the "Done · N" line of today. A running row keeps its seconds while the panel is visible (`useTicker` at one second, as today). "Show N more" stays for long lists. Done lists first-level agents only; a finished agent's own children are reached by opening it.
5. *An agent that ended but has running work under it* stays in Running, reads its outcome word and "· N running under it", and moves to Done when the count reaches zero.
6. *"Approval needed"* keeps today's source (`selectPendingOf` with the item's `agentId` or `taskId`); U1a changes what that selector means and gives a predicate by agent, and this file then calls it (§C.6).
7. *The title* "Background tasks" is written in `BACKGROUND_COPY.title` and in the action row `surface.background` (U6a's table, where the title is "Background work"; a title only, no id, chord or placement).

**What it does not touch.** The run widget, the drill-in, the relay composer, the Tasks tool, the Log. Which tools count as wide.

**What it proves.** A4 and A7's panel half, by the panels' unit tests over the fake work client: the headings and their counts in each state; no heading reads "0 running"; "Nothing running" with a folded Done; Done's heading by kind with a kind of zero left out; a click on a parent with "1 nested" shows its child and a second click hides it, and the same set opens it in a second mounted reader; "· 2 running under it" on an agent with a shell and a nested agent running; Done's heading "Done 3 · 1 failed · 1 stopped". Tests that pinned the old panels and change here are the cases of `background/background.test.tsx` that assert a per-kind heading (`Workflows · 1`, `Shells · 1 running`, `Monitors · 1`, `Tasks · c/t`, `Scheduled · N`), the order of sections, the expanded set of `createState`, or read an ended row without opening Done; and in `subagents/subagents.test.tsx` the cases about nesting under a running parent, On disk being open, and the heading `Agents · N running`.

### M7 — The two cards for running work

**What exists at its end.** While an agent of the session runs, a Subagents card stands after Connectors: its heading with "N running", its first-level agents that are running or have running work under them, four at most and then "N more", each with its mark, name, one line of state and a coarse elapsed time; a row with agents under it shows a disclosure mark and "N nested" and opens them beneath it on a click; "N finished" as its last line. While a background task runs, a Background tasks card stands last, by the same shape. When the last running one ends the card leaves, and since both are last in the column nothing above them moves. No card opens a panel by itself. (A2; O-05's two cards.)

**What it touches.** `panel/summary/Subagents.tsx` and `BackgroundWork.tsx` (rewritten: today's are imported by nothing) and their tests; `panel/summary/Summary.tsx`; `panel/copy.ts`; `tools/agents/index.ts` if an export is needed.

**Interfaces.** Consumes §E, §D, `useOpenAgents`.

**Decisions.**

1. *Presence* is `runningAgents(graph) > 0` for the first and `backgroundRunning(graph).length > 0` for the second, plus a terminal session's running jobs where they come beside the graph (`useDrivenJobs`, as the panel merges them). The column watches the graph while it is drawn (`useTaskGraph().watch`), for a session with a record and for a listed one alike.
2. *No seconds on a card.* The elapsed time is the display module's compact age (`dateFormats().age`, `src/shared/app/date-format.ts`) and repaints on the slow tick (`SLOW_TICK_MS`), never each second: the measurement of an unattended window (#566) is the reason.
3. *Clicks.* The heading opens the panel. A row with nothing under it opens that agent in the Subagents panel (`open({ agentId })`); a row with agents under it opens or closes them; every row has an open arrow at its right end, on hover and focus, that opens the agent whatever it has under it. A background row opens the panel at that task (a workflow at its run). "N more" opens the panel; "N finished" opens it with Done unfolded. There is no Stop on a card.
4. *Opening a panel from a card* is `panelHost.addTool`, so it follows M2's rule: the panel's tab comes into view in place of the tab in view, and the card column gives way to the side column.
5. *An agent whose parent the session does not list* is drawn at the first level with today's "· nested" mark.
6. *The cards read no notification themselves.* Running or finished is what the graph or the terminal route's ledger says; this landing adds no reader of task-notification rows and does not call U3a's `readArrivals`. So a card and the transcript's line for the same task can disagree on the terminal routes, because two readers decide: the ledger (`src/services/lane-a/jobs.ts`, DX4's table) and U3's arrivals reader (`src/shared/engine/arrival.ts`). The ledger reads `completed`, `failed`, `error` (as failed), `stopped`, `killed`, `cancelled` and `interrupted` (as stopped) as ends, `running`, `pending` and a background agent's `async_launched` as running, and an unlisted word as no change: the task stays running on the card, with the word kept as `raw`, until a listed word comes or the session's process goes (`exited`). A notification with no `<status>` says nothing to it, except a monitor's expiry line (`[Monitor expired after `, `[Monitor timed out`), which ends a monitor as completed. It also ends a job on evidence that is no notification: a `task_status` attachment, the bridge's stop notes, the process going. So the two agree wherever U3's reader lists the same words; they can part on a word the ledger lists and U3's does not (the card drops the task while the line has no outcome), on a monitor's expiry, and on an end the transcript has no line for. This landing does not align them: the ledger is a port kept in step with sminos, which derives the same jobs for a session on another machine, so changing it here would make the two machines' lists differ. The residue is U3's: its reader takes DX4's table for the status words and the expiry rule, or the difference is named in its file. For a session MAWS runs the graph reads the engine's own frames and neither reader.

**What it does not touch.** The panels (M6). The transcript's line for an agent or a task that ends (U3's arrival).

**What it proves.** A2 by unit tests on each route's source: a graph with two running agents, one with a running child, draws the Subagents card with two rows, a mark and "1 nested" on one, and the child after a click; when all three end the card is not in the column and the three cards above have not moved (their elements are the same nodes); a fifth running agent gives "1 more"; a row of an agent with a waiting request reads "Approval needed"; a running shell gives a Background tasks card with one row and its stop removes the card; a scheduled job alone gives no card; a driven terminal session's running job gives the Background tasks card and its end removes it; a listed session on another machine gives both cards from its feed. A fake timer test: a card's elapsed text does not change within 29 seconds and no interval of one second is armed while only the cards are mounted.

### M8 — The e2e scenes, the record, and the acceptance run

**What exists at its end.** The e2e specs that pinned stacking, the four folded cards, the per-kind panels and the one width are rewritten to the new behaviour, and the scenes of "Proof that an executor does not run" exist in the specs, unrun. The three rulings this landing reverses are amended where they stand. The acceptance commands of Concrete Steps pass on the VM.

**What it touches.** `e2e/ux2-shell.spec.ts`, `e2e/shell.spec.ts`, `e2e/panel.spec.ts`, `e2e/agent-tools.spec.ts`, `e2e/layout-transfer.spec.ts`, `e2e/code-tools.spec.ts`, `e2e/remote.spec.ts`, `e2e/browser-comment.spec.ts`, `e2e/side.spec.ts`, `e2e/lane-a.spec.ts`, `e2e/cross-build.spec.ts`, `e2e/support/` helpers these use; `docs/doperpowers/evidence/p4/ux-wave/ux-directions.md`; `docs/charter.md` (its Decision Log); this document.

**Decisions.**

1. *Scenes are written, not run.* An executor cannot start Electron; it typechecks the specs (`tsconfig.e2e.json`) and lints them. Each new scene is listed for the architect with its group.
2. *The record* (root UC-10). The three sentences of the child's file, "Rulings reversed", are added verbatim, dated 2026-11-12: two in `ux-directions.md` (after the answer of 2026-10-24 on Q1, and at D3 and D4), one in the charter's Decision Log (the engine version leaves the Environment card).
3. *The cross-build scenes* are added to `e2e/cross-build.spec.ts` and skipped unless the peer's `src/shared/ipc/schema/layout.ts` does not name `panelTools.groups`. They prove a read by what the peer draws or by what it writes after an act, never by reading back a key the peer has not written.

**What it proves.** Every acceptance item this landing holds, by the commands of Concrete Steps; the specs compile.

## Concrete Steps

Commands run from the worktree of branch `ux-wave/U8b`; `vmcheck` stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U8b --`, each call tests the pushed head, and each is its own call so that its exit status is read.

1. **Base** (the controller, before M1 and again before M8): `git fetch origin master && git merge origin/master`, then push. Before M1, check that master holds step 0: `git cat-file -e origin/master:src/shared/sessions/working-folder.ts && git cat-file -e origin/master:src/shared/keymap/build-f.ts && echo step-0-landed` prints `step-0-landed`. If it does not, stop: no executor starts.
2. **While a milestone is built:** one TypeScript project at a time (`vmcheck 'pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'` for the renderer; `-p tsconfig.node.json` for `src/shared`, `src/engine-host`, `src/main` and `test/`), `vmcheck 'pnpm exec eslint <the changed paths>'`, and the milestone's suites:
   - M1: `vmcheck 'pnpm exec vitest run src/shared/ipc/schema src/renderer/src/panel/surface-model.test.ts src/renderer/src/stores src/renderer/src/app'`
   - M2, M3: `vmcheck 'pnpm exec vitest run src/renderer/src/panel src/renderer/src/app src/renderer/src/keymap src/renderer/src/stores src/shared/ipc/schema'`
   - M4: `vmcheck 'pnpm exec vitest run src/renderer/src/panel src/renderer/src/app src/renderer/src/tools/code/review'`
   - M5: `vmcheck 'pnpm exec vitest run src/shared src/engine-host src/renderer/src/tools/agents src/renderer/src/lane-a src/renderer/src/transcript'`
   - M6: `vmcheck 'pnpm exec vitest run src/renderer/src/tools/agents src/shared/keymap src/main'`
   - M7: `vmcheck 'pnpm exec vitest run src/renderer/src/panel/summary src/renderer/src/tools/agents src/renderer/src/sessions/resource.test.tsx'`
   Expect each to pass whole. A suite outside the list that fails on the VM after a milestone is that milestone's to fix before its review.
3. **At each milestone's end:** `vmcheck 'pnpm typecheck'` and `vmcheck 'pnpm test'` (the whole unit suite, which holds U8a's tree test and M1's frozen-schema test). Expect no error. The controller then has the milestone reviewed and ticks Progress.
4. **M8:** `vmcheck 'pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'` and `vmcheck 'pnpm exec eslint e2e'`; then step 3 once more.
5. **The gate,** once, on the head the pull request will carry, in the background: `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u8b`. Its last lines name the run and its conclusion; keep the run id.
6. **The cross-build run with F** (the architect), in the background: `scripts/ci-gate.sh "$PWD" --gates e2e:cross-build --peer f1852de3a --label u8b-xb`.

## Interfaces and Dependencies

### §A. What is stored (M1; `src/shared/ipc/schema/layout.ts`, added beside the existing schemas)

Three new keys of `<userData>/layout.json`, each outside the `panel.` namespace (hydration and main read every `panel.<x>` key as one session's list), each added to `LayoutKeySchema`:

    // key `cards.open` — which of the three folding cards are open, per device. Absent: ['environment'].
    export const CARD_IDS = ['environment', 'context', 'connectors'] as const;
    export const CardsOpenSchema = z.strictObject({ version: z.literal(1), open: z.array(z.enum(CARD_IDS)) });

    // key `panelTools.widths` — the side column's two remembered widths. null: never dragged, the automatic width applies.
    export const PanelWidthsSchema = z.strictObject({ version: z.literal(1), wide: z.number().int().nullable(), narrow: z.number().int().nullable() });

    // key `panelTools.groups` — the lower group of each scope that has one, by the scopes `panelTools.surfaces.stacks` uses.
    // tabs: the lower group's tab ids, the one in view (or last in view, while the column is hidden) first; never empty.
    // share: the lower group's part of the column's height, 0.2 to 0.8.
    export const PanelGroupsSchema = z.strictObject({ version: z.literal(1), lower: z.record(z.string(), z.strictObject({ tabs: z.array(z.string()).min(1), share: z.number().min(0.2).max(0.8) })) });

The values F knows keep their shapes and take these meanings (each is one F already gives the field, or reads without harm):

| stored value | what this build writes |
|---|---|
| `panel.<session>.tabs`, `panel.pinned` | the strip: one ref for every tab open, the pins first. A tab that is closed leaves the list. |
| `panel.<session>.activeTabId` (and `panelTools.activeNoSession` for `@none`) | the upper (or only) group's tab in view; kept while the column is hidden, so showing it again restores it. Null only when the scope has no tab. |
| `panelTools.surfaces.stacks[scope]` | the tabs in view: `[]` while the column is hidden for that scope or the scope has no tab; `[upper]` with one group; `[upper, lower]` with two. Never more than two ids (the schema's bound). |
| `panelTools.surfaces.pinnedTools`, `contexts` | as today (`contexts` is U13a's to narrow). |
| `regions.panel.width` | the width the column was last dragged to, an integer, written at each drag beside `panelTools.widths`. `regions` keeps version 5. |
| `regions.panel.collapsed`, `maximized`, `floating` | as today: `collapsed` is the person's switch for the right side as a whole (the cards with it), not "the column is hidden". |

**The reading rule** (`sideGroups` below), applied at every hydration and wherever the groups are derived, so that whatever F wrote in between is read the same way as a first read. For one scope, with `refs` its tabs in strip order (the pins, then the session's own), `stack` the stored `stacks[scope]`, `active` the stored `activeTabId`, and `lower` the stored entry of `panelTools.groups` or none:

1. `S` is `stack` without ids that are no tab of `refs` and without a repeated id, cut to two. Two tabs of one tool may both be in `S` (two terminals).
2. `S` has two ids: two groups. The lower group's tabs are `S[1]`, then `lower.tabs` that are still tabs, less `S[0]` and `S[1]`. The upper group has every other tab. In view: `S[0]` above, `S[1]` below. The share is `lower.share`, or 0.5.
3. `S` has one id: one group with every tab, `S[0]` in view. A stored `lower` entry is dropped.
4. `S` is empty and `stack` is absent (a scope from before stacks were stored): one group, `active` in view when it is a tab, as today.
5. `S` is empty otherwise: the column is hidden for the scope. What it shows when shown again: two groups when `lower.tabs` still names a tab and at least one tab is outside it (above: `active` when it is an upper tab, else the first upper tab; below: the first of `lower.tabs` that is a tab); else one group with `active` in view when it is a tab.

**The first read** (hydration finds no `panelTools.groups` key in the file), once per profile:

- every scope is read by the rule above with no `lower` entry, so two ids in a `stacks` entry open as two groups with those two in view;
- in every session's list, a tab of a single-instance tool that is not in view by that reading is dropped (under the old rule such a tab was never removed, and every tool ever opened would otherwise stand in the strip). Pins are kept. Tabs of a multi-instance tool (a terminal, a plugin pane) are kept. A tab whose tool is not registered at that moment is kept. The dropped tabs' entries in `panelTools.params` go with them, by the rule that already prunes params of tabs no list holds;
- `panelTools.widths` is `{ wide: regions.panel.width, narrow: null }`, with `wide: null` when that width is 380 (the old default cannot be told from a drag to exactly 380, so it is automatic once more, as it is today); after that no value is special (X-165);
- the three new keys are written at once, so the next launch is not a first read.

### §B. The side column in the store and the model (M1 states and pure functions; M2 and M3 wire them)

Pure, in `src/renderer/src/panel/surface-model.ts`:

    export interface SideGroup { tabs: PanelTabRef[]; shown: PanelTabRef | null }   // strip order; shown: in view, or to be when the column is shown
    export interface SideGroups { upper: SideGroup; lower: (SideGroup & { share: number }) | null; hidden: boolean }
    export function sideGroups(state: SurfaceState & Pick<LayoutState, 'panelGroups'>, session: AppSessionId | null): SideGroups;   // §A's reading rule
    export function groupOf(groups: SideGroups, tabId: string): 'upper' | 'lower' | null;
    // Where a tab that is opened goes while there are two groups: the group that already holds a tab of its tool,
    // else `focused` (the group that holds the keyboard, when the caller knows one), else 'upper'.
    export function groupForOpen(groups: SideGroups, toolId: string, focused: 'upper' | 'lower' | null): 'upper' | 'lower';

`surfaceTabs(state, session)` keeps its name and its meaning, the tabs in view (none while hidden, one, or two), so `shellGeometry`'s `hasSurface`, the title bar's icons and U13a's code read it unchanged. `normalizeSurfaceStack` no longer drops a second tab of the same tool. `stackAfterSelection` is removed with the stacking rule.

In the layout store (`stores/layout.ts`), three slices and their acts; every act writes `stacks`, `activeTabId` and `panelGroups` together so that §A's rule reads back what was set:

    panelGroups: PanelGroups;     // key `panelTools.groups`
    panelWidths: PanelWidths;     // key `panelTools.widths`
    cardsOpen: CardId[];          // key `cards.open`

    showSurfaceTab(appSessionId: AppSessionId | null, tabId: string): void;        // the tab comes into view in its own group; a hidden column is shown
    hideSurfaces(appSessionId: AppSessionId | null): void;                         // stacks[scope] = []; activeTabId and the lower entry kept
    moveSurfaceTab(appSessionId: AppSessionId | null, tabId: string, to: 'upper' | 'lower'): void;
    setGroupShare(appSessionId: AppSessionId | null, share: number): void;         // clamped to 0.2..0.8
    setPanelWidth(px: number): void;                                              // the width in use (wide or narrow) and regions.panel.width
    setCardOpen(card: CardId, open: boolean): void;

`setPanelTabs(appSessionId, next, opts?: { group?: 'upper' | 'lower' })` stays the one writer of a scope's refs (every opener passes it: `addTool`, `selectTab`, `updatePanelTabs`, the host's `onChange`). Its rule changes from stacking to this: a ref that is new goes to `groupForOpen(…, opts.group ?? null)` and comes into view there; `next.activeTabId` naming an existing tab is `showSurfaceTab`; a ref that left is removed from its group, whose tab in view becomes the next tab to its right in that group, else the last one; a group left with no tab closes (the other group is then the only one); `next.activeTabId === null` hides. `setSurfaceStack` is removed; its callers use `showSurfaceTab` and `hideSurfaces`.

`moveSurfaceTab`: the tab joins the other group and comes into view there; the group it left shows its neighbour by the rule above; moving a group's only tab leaves one group. Moving to `'lower'` with one group makes the second group with that tab alone, at share 0.5, and is refused when the group has one tab.

### §C. What the siblings code against

1. **The two slots** (`app/slots.ts`, U1b and U4b; M4). Added to `Slots`, each with a fallback in `app/slot-fallbacks.tsx` that draws nothing:

       sessionCardWaiting: ComponentType<{ appSessionId: AppSessionId }>;   // U1b registers its waiting-requests card
       sessionCardFoot: ComponentType<{ appSessionId: AppSessionId }>;      // U4b registers its /btw card

   `sessionCardWaiting` is mounted first in the column and only while a request of the session waits. The presence rule is one line of `Summary.tsx`, `useAttention((s) => selectPendingOf(s, appSessionId).some(waitsOnAnswer))`: the predicate `src/shared/attention/kinds.ts` exports today, which U1a redefines over `waits`, so the rule follows UC-1 without an edit; U1b may replace the line with the selector it supplies. `sessionCardFoot` is mounted under the last card, outside the cards' scrolling list, so the cards end where it begins; whether it draws is its component's. `useCardColumnShown(): boolean` (`app/shell-view.ts`) says whether the column is drawn now, for U4 to place its card itself when it is not.
2. **The gate** (`app/shell-geometry.ts`, U7; M4):

       export function cardColumnShown(input: { sessionTab: boolean; tabsInView: number; collapsed: boolean; room: number; opened: boolean; pageOpen: boolean }): boolean;
       // sessionTab && tabsInView === 0 && !collapsed && !pageOpen && (room >= 960 || opened)

   `opened` is the shell view's `cardsOverlay`. This landing passes `pageOpen: false`; U7's insertion in `Shell.tsx` passes whether its destination is open, and hides the side column by its own gate there.
3. **The side column's tabs** (U6b; M2, M3). A file is a tab like any other: a ref of U6's tool in the session's list, its path among that tab's params (`setPanelParams`), its header row an X32 registration. U6b builds on: the acts `showSurfaceTab`, `moveSurfaceTab`, `setGroupShare` and `sideGroups`, `groupOf`, `groupForOpen` (§B); `toggleSurface(toolId)` as the one entry of an icon, a menu row and a `surface.*` action; the markers `[data-surface-stack]` (the column), `section[data-side-group="upper"|"lower"]` (a group: its strip is the `[role="tablist"]` inside, its body the `[role="tabpanel"]`), on which U6b hangs its drop targets (a tab dragged onto the lower part of a one-group column or onto the other group's strip calls `moveSurfaceTab`); a tab's menu in `TabStrip.tsx`, where "Move to main area" stays first and U6b's items for a file join it. Reordering tabs, the drags and the scroll of the selected tab into view are U6b's.
4. **The push row** (U5; M4). `PushState({ directory, appSessionId, embedded })` (`panel/summary/PushState.tsx`) stays the Environment card's row after the change line, with its two lines; U5 mounts its next-step button there.
5. **The region's controls** (U10). `RegionControls` in `panel/PanelHeader.tsx` stays the one definition of the controls at the first strip's right end; U10's one control goes there.
6. **"Approval needed"** (U1). `AgentList.tsx` and the Subagents card read `selectPendingOf` and match an item's `request.agentId` or `request.taskId`; when U1a gives the predicate by agent, both call it.
7. **Opening a tool** (U12 and every opener). `panelHost.addTool` is unchanged in signature; what it opens comes into view in place of the tab in view of its group, and opens the column as it does today.

### §D. The card column (M4, M7)

`aside[data-region="cards"]` holds a scrolling list and, under it, the foot. In order:

| | drawn | fold |
|---|---|---|
| `sessionCardWaiting` | while a request of the session waits (§C.1) | none |
| Environment | for a session with a record here | from `cardsOpen`; open unless stored otherwise |
| Context | the same | from `cardsOpen`; folded unless stored otherwise |
| Connectors | the same | the same |
| Subagents | while `runningAgents` is above zero (M7) | none |
| Background tasks | while a background task runs (M7) | none |
| `sessionCardFoot` (the foot) | always mounted; its component decides | none |

A card that is not drawn leaves no element. `FloatingCard({ title, summary, open, onToggle, children })`.

### §E. The graph's reading (M5; `tools/agents/model/task-graph.ts`)

    // An optional key on three wire shapes (src/shared/graph/events.ts, src/shared/engine/status.ts):
    //   task.started { …, parentTaskId?: TaskId }      tasks.snapshot.tasks[] { …, parentTaskId?: TaskId }      status.backgroundTasks[] { …, parentTaskId?: TaskId }
    // TaskNode gains: parentTaskId: TaskId | null   (the agent that started this task; null for the main loop's and for an agent, whose parent is agent.parentAgentId)

    export function runningUnder(graph: TaskGraph, taskId: TaskId): number;    // running agents and tasks below it, at any depth
    export function runningAgents(graph: TaskGraph): number;                    // every running agent, nested ones included
    // First level: an agent the main loop dispatched, or one whose parent the session does not list (drawn with "· nested").
    // running: those that run or have running work under them (so one whose own run ended stays), in the order they started.
    // done: the others whose status is known, newest end first.
    export function firstLevelAgents(graph: TaskGraph): { running: TaskId[]; done: TaskId[] };
    export function nestedOf(graph: TaskGraph, parent: TaskId): { active: TaskId[]; done: TaskId[] };   // its direct child agents, by the same split
    export function backgroundRunning(graph: TaskGraph): TaskNode[];            // workflows, shells, monitors and other tasks that run, in start order
    export function backgroundDone(graph: TaskGraph): TaskNode[];               // those that ended, newest end first
    export function doneByKind(nodes: readonly TaskNode[]): { workflows: number; shells: number; monitors: number; other: number };
    export function doneByOutcome(graph: TaskGraph, taskIds: readonly TaskId[]): { failed: number; stopped: number };

    // tools/agents/open-agents.ts
    export const useOpenAgents: …;   // per session, the set of parent task ids that are open; toggle(appSessionId, taskId); held for the run

"N nested" on a row is `nestedOf(graph, id).active.length`. A shell counts as a background task by today's rule (only while it is in the background). A terminal session's job nodes, which come beside the graph (`lane-a/jobs/job-nodes.ts`), are merged into the lists before these readings, as `BackgroundTool.tsx` merges them today. A running teammate is a first-level agent for the card and the counts; the panel keeps its team grouping.

### §F. Copy

Exact strings; counts are numerals. Where a string exists today its constant is kept.

| where | string |
|---|---|
| a card's or a panel's running heading | `Subagents` · `N running`; `Background tasks` · `N running` (the card: title and count; the panel: `Running N`) |
| the Subagents card and panel, a row's state | the agent's activity as today, or `Working`, or `Approval needed` (warning colour) |
| a parent's disclosure | `N nested` |
| a card's overflow and tail | `N more`; `N finished` |
| an agent with running work under it | ` · N running under it`, after its state line |
| the Background tasks panel | `Running N`; `Scheduled N`; `Tasks`; `Done N` then, for each kind above zero, ` · N workflows`, ` · N shells`, ` · N monitors`, ` · N tasks` (singular `1 workflow`, `1 shell`, `1 monitor`, `1 task`); `Nothing running` |
| the Subagents panel | `Running N`; `Done N` then ` · N failed` and ` · N stopped` when above zero; `On disk N`; under an opened parent `Done · N`, as today |
| outcome words | as today: `finished`, `finished with errors`, `stopped`, `ended with the session` for an agent; `completed`, `failed`, `stopped`, `ended with the session` for a task |
| the tool's title and its action row | `Background tasks` (was `Background work`) |
| the Environment card's change line | the counts as today, then `›`; accessible name `Open changes` |
| a tab's menu | `Move below`; `Move above` |
| an icon's context menu | `Open surface`; `Hide surface` (was `Close surface`) |
| the control at the strip's right end | label and tooltip `Hide side column` (was `Close surface`) |

### §G. What this landing stores, and what build F does with it

F's main process reads `layout.json` as one object and writes every key back whole (`LayoutFileStore`, `src/main/layout/store.ts`), so a key F does not know survives F. F's renderer reads only the keys it names; a value that fails its schema costs that one key, which falls back to its default (`hydrate` in `stores/layout.ts`).

| key | what this build writes | what F does at its next launch | what this build does with what F left |
|---|---|---|---|
| `panel.<session>`, `panel.pinned` | the strip's refs and `activeTabId` (§A); the shape is unchanged | Parses it. Draws what `stacks` names; uses `activeTabId` only for a scope with no `stacks` entry. Never removes a ref when a tool is hidden, so its lists grow as tools are opened there. | Reads the list as the strip. Tabs F added stand in the strip until the person closes them: the first-read prune does not run again (below). |
| `panelTools.surfaces` | version 2; `stacks[scope]` of none, one or two ids (§A) | Parses it. Draws the ids as its stacked surfaces, the first above. Of two tabs of one tool it draws the first alone (`normalizeSurfaceStack`). An empty entry shows its cards. Rewrites the entry by its own rule at the next click on an icon or a tab. | §A's reading rule: two ids are two groups with those two in view, whatever `panelTools.groups` says of them; one id is one group; none is a hidden column. |
| `panelTools.params` | as today | As today. | As today. |
| `regions` | version 5, its shape unchanged; `panel.width` an integer at each drag (380 when a width is reset to automatic) | Parses it. Uses `panel.width` as its one width, 380 as automatic. | Ignores `panel.width` once `panelTools.widths` exists: a drag made in F does not move this build's two widths. |
| `panelTools.groups` (new) | §A | Never reads it; keeps it in the file. | Reads it under §A's rule, which lets `stacks` decide and drops what no longer fits. |
| `panelTools.widths` (new) | §A | Never reads it; keeps it. | Reads it as it left it. |
| `cards.open` (new) | §A | Never reads it; keeps it. Draws its own four cards, folded. | Reads it as it left it. |
| `summary.sections`, both settings files, every other key | not written by this landing | As with master. | As with master. |

Two limits, accepted and said here so that nobody finds them later:

- **Tabs F leaves.** After a stay in F, a session used there shows one tab for every tool opened there. This build cannot tell F's list from its own, and pruning at every launch would break "a tab stays until it is closed" and the relaunch of A11. Rejected: a digest of the lists in the new key to detect that another build wrote in between (law 4: state and a rule for a round trip that costs a few clicks).
- **Two tabs of one tool in view.** F shows the upper alone. When F next writes the entry, the lower group is gone on return and its tabs stand in the one group. Nothing is lost.

### §H. Dependencies on other landings

- **U6a and U8a (step 0): on master before any executor starts** (Constraint 9). From U6a this landing takes the table's shape and its rule for a later row (it adds none) and changes one title in it. From U8a it takes `workingFolder` where `Summary.tsx` already calls it (U8a moved that one site), and its tree test, which scans `src/`: no file of this landing may spell the session's folder itself.
- **U13a (parallel).** Both edit `stores/layout.ts`, `panel/surface-model.ts` and its test, `stores/layout-persist.test.ts`, `test-support/panel.tsx`, `harness/panel/PanelHarness.tsx`, `e2e/ux2-shell.spec.ts`, `e2e/shell.spec.ts`, `e2e/panel.spec.ts` and `e2e/cross-build.spec.ts`. Nothing is consumed either way: this landing's writes of the regions go through the store's existing `commit` (`setPanel`), and it brings no main tab to the front, so it does not call `commitShown`. U13a narrows `panelTools.surfaces.contexts` to the one key `none` and changes `LAYOUT_DEFAULTS.main`; neither touches §A. Whoever lands second rebases.
- **U3a (parallel).** Nothing consumed: no file of this landing parses a notification (M7, decision 6). A task or an agent that ends is said in the transcript by U3's line, which is why a card can let it go without a trace.
- **U1a (parallel).** Nothing waited for: §C.1 and §C.6 read what master exports and follow U1a's change without an edit here. **U1b** fills `sessionCardWaiting` after this landing.
- **U4b, U5, U6b, U7, U10** build on §C after this landing. **U9**: nothing; a card adds no act on a session.
- **The probe branch** `ux-wave/probe-folder-memory`: M5 needs its three subagent-task fixtures and their findings file in the tree.
- **Main and the engine host**: M5's one optional key and the local follower's exit; nothing else.

## Acceptance

The child's file holds the items as written. Where each is proved:

| item | proved by | milestone |
|---|---|---|
| A1 the column, its folds | unit (the column, the store's re-hydration); e2e `panel` | M4 |
| A2 the two cards, on the three routes | unit (the readings; the cards over each route's source); e2e `agents`, `lane-a`, `remote`. On a terminal session of this Mac the Subagents card has no source (M5, decision 5): the Background tasks card alone is proved there | M5, M7 |
| A3 Artifacts in the three-dot menu | unit; e2e `panel` | M4 |
| A4 the two panels | unit (the readings; the panels); e2e `agents` | M5, M6 |
| A5 the two widths, X-165 | unit (`shellGeometry`, the store's first read); e2e `layout` | M1 |
| A6 the Context card | unit; e2e `panel` | M4 |
| A7 an agent's state; the test that fails before | unit (the two readers' exit; the panel's words); e2e `agents`, `lane-a`, `remote`. The panel's "ended with the session" is proved where the graph holds a terminal session's agents (another machine); in the transcript the row ends its agents and reads them stopped (Surprises & Discoveries) | M5, M6 |
| A8 the Environment card | unit; e2e `panel`, `code` | M4 |
| A11 tabs, the second group, the relaunch, both directions with F | unit (the reading rule; the acts; F's frozen schemas); e2e `layout`; the cross-build run | M1, M2, M3, M8 |

A9 and A10 are not this landing's.

## Proof that an executor does not run

Each line has an owner other than an executor. The controller writes into Progress when a line's precondition is met.

| what | when it can start | what it needs | what comes back |
|---|---|---|---|
| **The owner's look at the column** (the child's file, O-36, "Shown to the owner before it lands") | after M3, from the running branch on a Mac; or now, as a drawn example | The side column with one group and with two, at 360 px and at the wide width, with a long strip, in today's tokens, with invented titles. Recommended beside it, since neither has been drawn for the owner: the card column with Environment open, a Subagents card with one parent opened on a nested agent, and a Background tasks card. | The owner's word. A change of what is drawn comes back as an amendment of the child's file. |
| **The cross-build run with F as the peer** (root UC-14; A11) | after M8 is pushed | Concrete Steps 6. Two scenes of this landing, in `e2e/cross-build.spec.ts`: *(F then this build)* F's app opens a session, opens Files, then Session info, then Review (which takes the lower place), and quits; this build opens the profile and shows two groups with Files above and Review below in view, no Session info tab in either strip, and `layout.json` then holds `panelTools.groups`, `panelTools.widths` and `cards.open`. *(this build then F)* this build opens Review, a terminal and Session info, moves one below, drags the bar and the column's edge, folds Environment, and quits; F's app opens the profile, draws its two stacked surfaces with the two tabs that were in view, in that order, its sidebar and its main tabs as they were, and logs no "is not a valid value" line of the layout; F hides one surface (a write of its own) and quits; `layout.json` still holds the three new keys as they were; this build opens it again as one group with every tab. Beyond `main.tabs` (U13a's scenes), these cover every key this landing writes. | The run's id and the two scenes' verdicts. Until it is green no build with this landing runs on a profile the owner uses. |
| **The e2e groups** on a Mac under the load rule | after M8 is pushed | The new and reworked scenes alone first, then the groups: `layout` (`ux2-shell.spec.ts`: the stacking scene rewritten as tabs, the second group and the relaunch, A11; the widths, A5; `shell.spec.ts`: its resizer and relaunch step), `panel` (`panel.spec.ts`: the column and its folds, A1; Artifacts in the menu, A3; the Context and Environment cards, A6, A8), `agents` (`agent-tools.spec.ts`: the two panels, A4, A7; the two cards over the harness, A2), `lane-a` (a terminal session's Background tasks card; its transcript's agents row ended when its terminal goes, A2, A7), `remote` (`remote.spec.ts`: its "both tools are on screen" step; the cards of a session on another machine), `browser-comment` (`browser-comment.spec.ts`: the step that expects the other stacked surface mounted), `side`, `code` (`code-tools.spec.ts`: Review opened from the change line) and `default` (`layout-transfer.spec.ts`: one surface after a relaunch, the widths). | Verdicts by group. A red scene goes back to the controller as a fix. |
| **The branch review** | after M8 | `doperpowers:review-code`, the xhigh panel (Decision Log 1), over `origin/master...ux-wave/U8b`. | A verdict and findings; the fixes are one wave through the controller. |
| **Class 1a** | once, on the head the pull request will carry, after the review's fixes | Concrete Steps 5. | The run's id. |

## The pull request

Opened on the architect's word, not by an executor. Its body opens with the composite's path, the child id (U8, second pull request) and the parent pin `48619c824`, and names the items (O-05, O-09 with X-165, O-36, O-10, #359 with X-168, l5-code-16) and the board ticket #580. It names its class 1a run by id, the branch review's verdict and what was done with each finding, the cross-build run with F by id, which e2e groups ran and where, and its residue: what is not verified, the limits of Interfaces §G, and anything logged as debt. It carries the dated amendments of the three rulings (M8). It ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.

## Surprises & Discoveries

Found while writing this document, against master `48619c824`, and reported to the architect, who alone edits the spec. Where a milestone needed a position to be buildable it takes one and says so; none of these is settled by this document.

- Observation: a terminal session on this Mac has no source for its subagents' states, so the Subagents card (A2) and the panel half of A7's test cannot hold on that route. The child's "Advice" says the graph already serves a terminal session.
  Evidence: `src/services/lane-a/jobs.ts`: "What the vectors' `subagents` and `mcp` pin (agents' outcomes, MCP names) is not ported", and `derive` answers `{ subagents: [], jobs, mcp: [] }`; `lane-a/watches.ts` keeps `body.jobs` alone; `tools/agents/store.ts` takes a feed only where `lane-a/remote-agents.ts` answers, which is `!records.has(id) && isRemoteLaneA(id)`; `AgentList.tsx` draws `SUBAGENTS_COPY.diskOnly` for a driven session. M5's decision 5 builds nothing there and names the two ways.
- Observation: counting a subagent's shells and monitors under it needs a key the code reads nowhere, carried from the engine's frames through the normalizer and three wire shapes, with the wire's minor raised; the child's file does not name those files among its edits, and the probe's fixtures are not on master.
  Evidence: no match for `owned_by_subagent` or `parent_task_id` under `src/`; `task.started` and `tasks.snapshot` in `src/shared/graph/events.ts`; the three fixtures are on `ux-wave/probe-folder-memory` only. M5's decision 1.
- Observation: A7 expects a terminal session's agent to read "ended with the session" in the transcript. The transcript's agents row reads an agent ended by an exit as stopped, and this landing may not edit the transcript.
  Evidence: `endedByExit` in `transcript/model/derive.ts` sets every agent not ended to `'stopped'`; "ended with the session" exists only in `tools/agents/copy.ts`. This landing proves the panel's words and that the transcript's row ends its agents.
- Observation: the exit X-168 needs is not one the follower can make today: it is made only at the end of a backfill, with no holder at that moment, and only when the last turn never ended, where X-168's case is a process that ends after its turn. The change is in `src/engine-host/fs/`, which the child's file does not name.
  Evidence: `endBackfill` and `unendedTurnExit` in `chain-follower.ts` ("A holder that appears later changes nothing here"). M5's decision 6.
- Observation: the control of l5-code-16 is drawn by a file of U5's.
  Evidence: `Environment.tsx` renders `<ToolSummary toolId="review" component={ReviewSummary}>`; the button is in `tools/code/review/ReviewSummary.tsx`. M4's decision 4 edits that one element.
- Observation: hiding the column has no stored form of its own. An empty `stacks` entry is F's and today's "show the cards", and today's hide also nulls `activeTabId`. This document keeps the tabs to show again in `activeTabId` and in the order of `lower.tabs` (Interfaces §A), so no field is added to the child's shape of `panelTools.groups`.
  Evidence: `toggleSessionCards` and `setSurfaceStack` in `SurfaceRow.tsx` and `stores/layout.ts`.
- Observation: the root names `cards.open` and `panelTools.widths` as U8's keys (UC-8's row for the layout schema, UC-14's list) and not `panelTools.groups`, which the child's file defines. And the root's "Looks the owner is asked for before a landing" does not list the drawn column the child's O-36 says is shown to the owner.
  Evidence: the root at `15801c792`, UC-8, UC-14 and "Ordering and dependency map".
- Observation: U4's file says a command moved to the background "is in the Background tasks card (U8), where it can be stopped by hand"; this child's card has no Stop, which is in the panel the card opens.
  Evidence: `U4-composer.md`, the item on Send now; the child's O-05, "No Stop on a card's row".
- Observation: on the terminal routes a task's end is decided by two readers, the job ledger (DX4's table) and U3's arrivals reader, so a card and the transcript's line can part (M7, decision 6). This landing reads the ledger's answer and aligns nothing.
  Evidence: `TABLE`, `fold` and `notification` in `src/services/lane-a/jobs.ts`; the note from U3a's author that its reader gives an unlisted word no outcome.
- Observation: the child's list of tests that pin today's behaviour is short of several that change: `panel/surface-model.test.ts`, `panel/PanelHeader.test.tsx`, `panel/TabStrip.test.tsx`, `app/Shell.test.tsx`, `tools/code/review/review.test.tsx`, and in e2e `remote.spec.ts`, `browser-comment.spec.ts`, `layout-transfer.spec.ts`, `code-tools.spec.ts`, `shell.spec.ts`.
  Evidence: the titles named under M2, M4 and "Proof that an executor does not run".

## Decision Log

1. **2026-11-12 (the author, at writing): the verification call.**
   - This document gets an adversarial review before any executor starts; the architect dispatches it.
   - Each milestone is reviewed at its boundary by the controller's reviewer before the next starts.
   - The branch gets `doperpowers:review-code` at the **xhigh panel**: it is panel-size, and it holds three delicate parts, each of which wants a lens: the stored layout and build F's readers (M1, Interfaces §A and §G), the key added to the wire (M5, decision 1), and the exit the transcript's follower supplies (M5, decision 6). The session that keeps master decides who runs the panel. Expected size: about **105 files** and about 8,000 changed lines, roughly a third of them tests; by milestone, M1 about 12 files, M2 14, M3 8, M4 18, M5 18, M6 14, M7 8, M8 13 (eleven of them e2e specs).
   - A new or reworked e2e scene runs alone on a Mac before the groups. The cross-build run with F as the peer is the proof UC-14 asks for and is the architect's to run.
   - Class 1a on GitHub Actions is the gate of record, on the head the pull request carries.
   - The pull request's body names its class 1a run, its review verdict and its residue.

## Outcomes & Retrospective

Pending — written at finish.
