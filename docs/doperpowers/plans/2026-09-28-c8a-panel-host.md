# C8a — Panel host, tool registry and pinned summary

Child of the composite spec `docs/doperpowers/plans/2026-09-28-c8-right-panel.md`, child id **C8a**, parent pin `e1e40d21664cca4a1e536636b5404ecd4b5c13cd7978581b8e5dfcf5df1dba80` (SHA-256 of the C8 spec at master `d62a8ed`; its content is unchanged since 1e398b3, the commit the spec cites for itself; the file's git blob is `643fad97238d5d90d62b0ff45ea80e97728d3267`). The charter above it, `docs/charter.md` at the same commit, is `92763e36e37fdd588a366754593bd00a34b5d78744c385a88701fd963a62471d` (blob `f107b742495f1021e6cfff6ee645020c075520f7`). Design lives in the C8 spec: Terms, *The host*, *X5, final*, *The summary*, *Data paths*, *Failure semantics* and R7 under *Delegated unknowns*; the C8a child section; the Cross-Child Contracts (X5 owned here; K3 and K4 consumed); the Decision Log with the owner's rulings 1 to 5 and the P1 addendum. The spec is in adversarial review while this document is written; the four amendments its fix wave made to X5 and the host (relayed by the coordinator on 2026-09-28) are applied here and recorded in the Decision Log, and the X5 section as amended is authoritative, not re-litigated. Above the spec: charter §5.6 (the panel's tool list and the resting summary, binding for the list and the pin rule), §12 C8, D-1 to D-20 (D-10 pin split, D-20 reference apps first), contracts X1, X2, X3, X7 (consumed) and X5 (owned). Grounding evidence: `docs/doperpowers/plans/2026-09-28-c8-decomposing-grounding.md` §1.1 (C5's landed host slot and persistence), §1.2 (C9's terminal and draft X5), §1.8 (mockup 01's summary, Codex §3), §4 (X5 reconciled), §6 R7. The concrete shapes this document codes against are landed code, read in the executors' worktrees on 2026-09-28: C5 at `.claude/worktrees/agent-a3f9c764b1656a780` (395fb9d, M6 reviewed clean: `panel/host-slot.ts`, `panel/PanelRegion.tsx`, `stores/layout.ts`, `stores/layout-model.ts`, `app/slots.ts`, `app/Shell.test.tsx`, `stores/sessions.ts`, `ipc/events.ts`, `ipc/query.ts`), C9 at `agent-a6f3eb0835c0683ff` (ac7f0a8: `terminal/registry.ts`, the harness router, its document's X5 section rewritten to the spec's shape), C6 at `agent-a6b13869f9047b252` (9f102cf: `view/Transcript.tsx`, `stores/transcript.ts`, `source/ipc.ts`, `model/rows.ts`, `model/derive.ts`, `harness/*`), C4 at `agent-aa8c6f2b9fa7b10e9` (1edb4d7: `fs.ts`; `git.*` in its document's M6 including the absorbed `remoteUrl`), C3 at `agent-ad79344633814c604` (ade09db: `shared/engine/status.ts`), and the closed documents of C10 (attach, item 12) and C11 (`sessionInfoTool`). C8a executes when C5 is on master, in its own worktree branched from that point, after a refresh pass against the landed code (items the pass must settle are marked **[refresh]**); the ledger's merge order puts C3 and C4 on master before C5, so `session.status`, `git.*` and `fs.workflows`, which the summary reads, are there by then and the spec's "after C5" edge already carries them. This document carries the constraints, the interfaces C8a adds, the milestones with their gates, the residue decisions to be pasted into the charter's C8 section, and the record; none of the design, which lives in the spec.

## Purpose

After C8a the right panel is a real place. Open a session and the panel rests on a card that says what the session is standing on: the branch, how much is uncommitted, whether it is pushed, how many agents are working and done, what runs in the background, and the files the session has touched; every row is a door to the tool that owns it, and a door that is not built yet says which child brings it. Press "+" and the registered tools are offered; open one and it becomes a tab with a pin and a close glyph. Pin a Terminal and it is the first tab in every session; switch sessions and its shell is intact; collapse the panel, come back, and the tab's scroll position is where it was; quit and relaunch, and the pinned tab and every session's own tabs are back where they were. Click the home glyph and the summary returns without closing anything. A tool that is busy can refuse to close and explain itself in place. Three siblings register into this host and nothing else: C9's Terminal and C11's Session info at their refresh passes, C8b's Subagents, Background work and Log, C8c's Review and Files; C10's "attach in a terminal tab" lands a Terminal tab through the same call. Developers see all of it in a harness page, `#panel`, over fake sessions at the panel's three widths and maximized, with C6's child transcript mounted inside the region (R7).

What C8a does not do: build any tool (a stub stands in for each until its child lands), read a file (K1, C8c), render a diff (C8c), list agents or workflows beyond the summary's counts (C8b), persist anything but tab refs and the summary's section expansion (D-10, no fourth store), or write `layout.*` keys that C5 owns.

## Progress

- [ ] M1 — Host and registry: `tool.ts`, `host.ts`, the slot component with the strip (home glyph, tabs with pin and close, "+"), per-tab state outside React, `beforeClose`, single-instance re-targeting, placeholder tabs, hydration's Log filter, reconciliation; the `#panel` route with fake sessions and stub tools as the development surface
- [ ] M2 — The pinned summary: Environment, Push state, Subagents, Background work, Sources, footer; the git store and the summary store; every row opens its tool or names its child
- [ ] M3 — Persistence and pins under reload and session switch: `panel.pinned` and `panel.<id>` round trip, `panelActiveNoSession` with Overview, session-addressed `addTool` through C5's seam, `dropSession` reconciliation, the Log filter observed over a real `layout.json`
- [ ] M4 — The product `#panel` harness (transcript fixture, the child-transcript tool, the Playwright API, widths and maximize), R7, end-to-end over the harness and over C5's scenario records, the acceptance run

## Terms

- **Host**: the React component C8a registers into C5's `panelHost` slot (`src/renderer/src/app/slots.ts`; props `PanelHostProps` in `src/renderer/src/panel/host-slot.ts`), plus the module-level registry behind it. C5's region (`panel/PanelRegion.tsx`) keeps the header strip (maximize, hide), the width and collapse, and hands the host `{ appSessionId, tabs, activeTabId, maximized, onChange, onTogglePinned, onToggleMaximize }`.
- **Tool**: a `PanelTool` declaration (X5): id, title, icon, `pinnable`, `multiInstance`, `menu`, a state factory, `open`, `beforeClose`, `dispose`, `render`, an optional `summary` section. **Registered**: known to `registerPanelTool`. **Stub tool**: a harness-only `PanelTool` with a sibling's id standing in for the sibling's tool.
- **Ref**: what C5 persists of a tab, `PanelTabRef { id, toolId, pinned }` (`src/shared/ipc/schema/layout.ts`), in `panel.pinned` (the global pins) or `panel.<appSessionId>` (a session's own list with its `activeTabId`). **Tab**: a ref shown in the strip. **Instance**: the live state of one tab (`createState`'s result and its bookkeeping), kept in the host's registry map keyed by the ref's id, outside React. **Placeholder tab**: a tab whose tool is not registered; it renders its `toolId` and "Arrives with <child>" and has no instance. **Transient tab**: a Log tab (`toolId: 'log'`); never pinned, dropped at hydration.
- **Shown session**: `PanelHostProps.appSessionId`, the session the focused pane's active tab belongs to (C5's `sessionOfTab`: `session`, `agent`, `diff` and `file` tabs carry one), or null on the Overview, Diagnostics, Accounts and Settings tabs. **Target session**: the `appSessionId` an `addTool` call names; it may differ from the shown session (C10 attaches to session A while B or the Overview is on screen).
- **Pin**: D-10. A pinned tab is in `panel.pinned`, shows first in every session's strip, and its instance's `ctx.appSessionId` follows the shown session. **Home glyph**: the strip's first control; it sets `activeTabId: null` without closing tabs, which shows the **summary**, mockup 01's "Session overview" card. **Section**: one collapsible part of the summary with a sticky muted heading (Codex §3) whose expansion persists.
- **Live session**: one whose `EngineSessionStatus` is in `useSessions().engine` (C3's `session.status` event, applied by C5). **Disk-only session**: a record with no status here. **Seam**: a C5-exported store action the host writes refs through; the host never writes `layout.*` commands for refs itself.
- **Harness**: the development page loaded under `MAWS_HARNESS=1` (`pnpm dev:harness`; `src/renderer/harness.html`, router `src/renderer/src/harness/main.tsx`, landed by C6 and extended by C9 with `#probe`). C8a's page is `#panel`; it replaces the `#panel` page the ledger (d.13) had allocated to C9, which does not exist yet and which C9 M4 now targets instead of building.

## Constraints

Binding on every milestone, from the spec, the charter and the sibling contracts:

- X5 as the spec's *X5, final* reads it, amended by the fix wave of 2026-09-28 (Decision Log): `addTool(toolId, params, { appSessionId, activate, pin })` is session-addressed and writes through C5's seam; Log tabs are transient; the summary's change line reads `git.diff`; a tool may mount C6's `Transcript variant: 'child'` and C6's child `ipcSource` owns disk-versus-wire provenance. The canonical files are `src/renderer/src/panel/tool.ts` and `host.ts` once C8a lands; C9's file is adopted where it matches and rewritten where it does not. (binding, owned here)
- The host's rules on every tool (spec *X5, final*, "Rules the host enforces"): `createState` once per tab, the result kept in the registry map across visibility, panel collapse, session switches under a pin and re-renders; unselected tools unmounted; `dispose` on close or unregister; a pinned tab's `ctx.appSessionId` follows the shown session; refs written only through C5's store actions (`onChange`, `onTogglePinned`, the asked `updatePanelTabs`); "+" lists every registered tool with `menu !== false` whose `multiInstance` allows another instance in the shown scope; the summary is host-owned composition whose data reads are the host's and whose "Open" calls `addTool`, a registered tool's `summary` component filling its section. (binding)
- D-10 and C5's pin split: `panel.pinned` and `panel.<appSessionId>` are the only stores of panel state; no per-tab payload is persisted in P0; tab ids are `<toolId>:<suffix>`, unique across pins and sessions; if a tool later needs persisted params, C8a asks C5 for an optional `params` on the ref rather than a second store. (binding)
- The summary (spec *The summary*, rulings 2 and 5): sections Environment, Push state, Subagents, Background work, Sources, then the footer; no Sent files and no pull-request row; one Session info row (the model row); a row whose tool is not registered renders disabled with "Arrives with <child>"; with `appSessionId === null` only the footer shows and the pins stay available; every fact a source cannot give is marked unavailable in words, never inferred (*Failure semantics*). (binding)
- §5.6 layout and copy, mockup 01's card (approved at eb480c2), Codex §3's collapsible sections with sticky muted headings and hover-revealed row actions, D-20 for anything the charter and the notes do not settle. (advisory on layout, binding on the tool list "+" offers: Subagents, Review, Terminal, Files, Background work, Session info; Log is `menu: false`)
- K3 and K4 as consumed: the summary's Sources rows open files only through C5's `openTab({ kind: 'file', path, line, appSessionId })` (K4; C8c's `openFile` is that call once exported); C8a registers nothing into C6's `TranscriptActions` (K3). (binding)
- X2: C8a adds no command. Its one schema touch is a delimited C8a block in `src/shared/ipc/schema/layout.ts` adding the layout key `summary.sections` and its value schema, the pattern C7 used for `usage.banners`; strict objects, validated by the reader. `git.*` (C4 M6), `fs.workflows` (C4), `session.status` (C3) and `layout.*` (C5) are consumed as their owners defined them. (binding)
- X7: tokens only, both themes, the guard test `test/support/tokens-guard.test.ts` covering every file under `src/renderer/`. (binding)
- C1's conventions: zod 4 (`import * as z from 'zod'`), `Schema` suffix, validators never default, unit tests beside sources as `*.test.ts(x)`, `@shared/*` alias, zustand stores, Radix through the `radix-ui` package. (binding by inheritance)
- Shared files (wave-2 ledger, section c, extended to wave 3): every addition to a file another child owns is a delimited block: `src/renderer/src/App.tsx` (one C8a block), `src/renderer/src/ipc/events.ts` (one block), `src/renderer/src/ipc/query.ts` (one line in `QUERY_COMMANDS`), `src/shared/ipc/schema/layout.ts` (one block), `src/renderer/src/harness/main.tsx` (one route in a block). C8b and C8c touch none of C8a's files; they register their tools from their own `App.tsx` blocks. (binding)
- Commit rules from `CLAUDE.md` and the owner's global instructions: no attribution footers. (binding)

## Repository map

Files C8a creates or touches; everything else is another child's. Paths are repository-relative.

```
src/renderer/src/panel/
  host-slot.ts                  [C5] unchanged: PanelHostProps
  PanelRegion.tsx               [C5] unchanged
  tool.ts                       X5: PanelToolInit, PanelToolContext, PanelTool (canonical; adopted from C9's file where it matches)
  host.ts                       X5: registerPanelTool, panelHost, the registry (tools, instances, titles, focus counters), mintTabId, reconcile, the hydration filter, connectPanelHost()
  host.test.tsx                 suites `panel host registry and instances`, `panel host transitions`
  PanelHost.tsx                 the slot component: TabStrip above ToolBody or Summary; registered into `panelHost` from App.tsx
  TabStrip.tsx                  home glyph, tabs (icon, title with suffix, pin, close), "+" (Radix DropdownMenu)
  ToolBody.tsx                  mounts the selected instance's `render` with its ctx; the placeholder body for an unregistered tool
  arrives-with.ts               ARRIVES_WITH: toolId → the child that brings it; the placeholder and the summary read it
  copy.ts                       every sentence the host and the summary show
  panel.test.tsx                suite `panel tab strip and plus menu`
  summary/Summary.tsx           the resting card: sections in order, footer; footer only when appSessionId is null
  summary/Section.tsx           a collapsible section (sticky muted heading, chevron) over the summary store
  summary/{Environment,PushState,Subagents,BackgroundWork,Sources}.tsx
  summary/derive.ts             pure: changeLine, pushState, githubUrl, backgroundCounts, sourcesOf, agentGlyphs
  summary/derive.test.ts        suite `summary derivations`
  summary/Summary.test.tsx      suite `summary card`
src/renderer/src/stores/
  git.ts                        C8a: ref-counted git.watch per directory; statuses by repoRoot; the uncommitted diff per directory; applyChanged(git.changed)
  git.test.ts                   suite `git store`
  summary.ts                    C8a: section expansion over layout key `summary.sections` (read once, written debounced)
  summary.test.ts               suite `summary store`
src/renderer/src/ipc/events.ts  [C5] C8a block: git.changed → git store; fs.workflowChanged → queryClient invalidation
src/renderer/src/ipc/query.ts   [C1] QUERY_COMMANDS gains fs.workflows
src/renderer/src/App.tsx        [C1/C5/C6/C7] C8a block: registerSlot('panelHost', PanelHost); useEffect(connectPanelHost)
src/renderer/src/app/Shell.panel.test.tsx   suite `shell renders the panel host in the region` (C5's Shell.test.tsx is not edited)
src/shared/ipc/schema/layout.ts [C5] C8a block: LayoutKeySchema gains 'summary.sections'; SummarySectionsSchema
src/renderer/src/harness/main.tsx           [C6/C9] C8a block: route #panel → panel/PanelHarness.tsx
src/renderer/src/harness/panel/PanelHarness.tsx   the page: the real PanelRegion inside a two-column frame, the fake session switcher, width and maximize controls, theme toggle, debug strip
src/renderer/src/harness/panel/fakeSessions.ts    records A (directory) and B (worktree), a status with backgroundTasks, digests
src/renderer/src/harness/panel/stubTool.tsx       stubTool(id, opts): a generic PanelTool whose body shows id · instanceId · ctx.appSessionId · a counter
src/renderer/src/harness/panel/childTranscriptTool.tsx   harness-only tool `child`: C6's Transcript variant 'child' over the child slice of pass1/subagent
src/renderer/src/harness/panel/api.ts             window.__maws_harness.panel types (the e2e project imports them)
e2e/panel.spec.ts               harness cases (MAWS_HARNESS=1 through launchMaws's env option) and the stub-scenario cases in one file
```

Not touched: `src/main/**`, `src/engine-host/**`, `src/preload/**`, `src/renderer/src/transcript/**`, `src/renderer/src/terminal/**`, `src/renderer/src/tools/**` (C9's and C11's), `src/renderer/src/stores/layout.ts` and `layout-model.ts` (C5's; the asked seam is C5's change), `src/shared/keymap/actions.ts` (no new action), `package.json` (no new dependency), `docs/charter.md`, the C8 spec.

## Interfaces and Dependencies

Code below is the code that is itself a decision: X5's canonical text, the host's state and transitions, the seams, the pure derivations and the copy. Everything else the executor writes with the code in view.

### X5, canonical (`src/renderer/src/panel/tool.ts`, `host.ts`)

The spec's *X5, final* with the fix wave's amendment to `addTool`. C9's `tool.ts` (in flight at its M4) is adopted file-for-file where it matches this text and rewritten where it does not; the header names C8a as the owner.

```ts
// src/renderer/src/panel/tool.ts
export interface PanelToolInit<P = void> {
  appSessionId: AppSessionId | null;   // the target session; null only for a pinned tool opened with no session shown
  session: SessionRecord | null;       // C5's X1 record for it: directory, additionalDirectories, worktree, holder
  instanceId: string;                  // the PanelTabRef.id; C9 uses it as the terminal label
  params: P;                           // the addTool call's params; `undefined` for a tab restored from layout.json (every P is void or all-optional)
}
export interface PanelToolContext {
  appSessionId: AppSessionId | null;   // the shown session; changes under a pinned tab; null on Overview, Diagnostics, Accounts, Settings
  session: SessionRecord | null;
  status: EngineSessionStatus | null;  // C3's status when the shown session is live in this app
  pinned: boolean;
  visible: boolean;                    // this tab is selected and regions.panel.collapsed is false
  focusRequest: number;                // increments on selection and on the collapsed → open transition while selected
  setTitle(suffix: string | null): void;
  close(): void;                       // panelHost.closeTab(instanceId): beforeClose, then dispose
  openTool: typeof panelHost.addTool;
}
export interface PanelTool<S, P = void> {
  id: string; title: string; icon: ComponentType<{ className?: string }>;
  pinnable: boolean; multiInstance: boolean;
  menu?: boolean;                             // offered from "+"; default true; false for Log
  createState(init: PanelToolInit<P>): S;
  open?(state: S, params: P): void;           // addTool on an existing single-instance tab re-targets it
  beforeClose(state: S): Promise<boolean>;    // false vetoes; the tool shows its own inline confirmation and calls ctx.close() later, and its next beforeClose passes
  dispose(state: S): void;
  render: ComponentType<{ state: S; ctx: PanelToolContext }>;
  summary?: ComponentType<{ appSessionId: AppSessionId; open(params?: P): void }>;
}

// src/renderer/src/panel/host.ts
export function registerPanelTool<S, P>(tool: PanelTool<S, P>): () => void;
export const panelHost: {
  // Session-addressed (fix wave, 2026-09-28): the tab is written into `appSessionId`'s list (or the pins with `pin`, or when
  // appSessionId is null) through C5's seam, whether or not that session is shown. `activate` (default true) selects the tab in
  // its own list; it never changes what the main area shows. Single-instance lookup is the target session's list plus the pins.
  addTool<P>(toolId: string, params: P, opts: { appSessionId: AppSessionId | null; activate?: boolean; pin?: boolean }): string;
  selectTab(tabId: string): void;
  closeTab(tabId: string): Promise<boolean>;   // false when beforeClose vetoed; a second call while one is pending returns the same promise
  showSummary(): void;                         // activeTabId null for the shown session (panelActiveNoSession when none)
  tools(): PanelTool<unknown, unknown>[];      // registration order
};
```

`addTool` throws (`Error('panel: no tool registered as <id>')`, `Error('panel: <id> is not pinnable and no session is shown')`) rather than returning a sentinel: its callers are adapters and the summary, which check `tools()` first; a thrown call is a programming error, not a state. `pin?` is carried from the spec's text as read; if the amended X5 drops it, the refresh pass drops it here and pins are made only through the strip (Decision Log). **[refresh]**

### The host's state and transitions

Two stores, deliberately split. The **instance map** is a module-level `Map<string, Instance>` in `host.ts`, never React state: `Instance { ref: PanelTabRef; tool: PanelTool; state: unknown; closing: Promise<boolean> | null }`. The **host store** (`usePanelHost`, zustand) carries only what React renders: `tools: Map<string, PanelTool>` (registration order), `titles: Record<tabId, string | null>` (from `setTitle`), `focus: Record<tabId, number>`, `closing: Set<tabId>`, and a `version` bumped when the instance map changes so the strip re-reads it. `ctx` is built per render from the props, the layout store's `regions.panel.collapsed`, `useSessions` (`records`, `engine`) and the host store.

| Event | Precondition | Effect |
|---|---|---|
| a ref appears in `props.tabs` | its tool registered, no instance | `createState({ appSessionId: props.appSessionId, session, instanceId: ref.id, params: undefined })`; the instance is created when the tab first appears in the strip, not when it is selected (a pinned Terminal re-adopts at launch; a session's own tabs when the session is shown) |
| a ref appears in `props.tabs` | its tool not registered | a placeholder tab: icon absent, title `toolId`, body "Arrives with <child>" from `ARRIVES_WITH`; close removes the ref; pin follows the ref |
| `registerPanelTool(tool)` | a tool of that id exists | the declaration is replaced; existing instances keep their state and render with the new component (HMR); the returned disposer unregisters only while its own registration is current |
| the returned disposer runs | | every instance of the tool is disposed and its refs removed from the pins and every session's list; no `beforeClose` |
| `addTool(id, params, { appSessionId: T, activate, pin })` | unregistered id | throws |
| | `!multiInstance` and a ref of that tool in T's list or the pins | `tool.open?.(state, params)`; `activate` selects it in the list that holds it; returns its id |
| | T null, `!pinnable`, no such instance | throws |
| | otherwise | mint `<id>:<8 base36 chars from crypto.getRandomValues>`; `createState` now with `appSessionId: T`; write the ref into the pins (`pin` or T null) or T's own list through the seam; `activate` sets that list's `activeTabId` (or `panelActiveNoSession`); returns the id |
| `selectTab(id)`, a tab click | | the list holding the ref gets `activeTabId: id`; if that is the shown list, `focus[id] += 1` |
| home glyph, `showSummary()` | | the shown list's `activeTabId: null` (`panelActiveNoSession` when no session is shown); tabs untouched |
| `closeTab(id)`, the close glyph, `ctx.close()` | instance live | `closing`; `await tool.beforeClose(state)`; false → live again, returns false; true → `dispose`, remove the ref from its list; if it was active, the next tab to its right, else the last, else null (the summary); returns true |
| | placeholder | remove the ref; true |
| | already closing | the pending promise |
| `onTogglePinned(id)` (the pin glyph) | `tool.pinnable` (or a placeholder) and a session is shown | C5 moves the ref between the lists; the instance is untouched; `ctx.pinned` flips on the next render. No pin glyph on a Log tab or an unpinnable tool |
| layout `hydrated` becomes true | | the Log filter: every `toolId === 'log'` ref is removed from the pins and from every `panelBySession` entry through the seam; only lists that changed are written |
| `panelPinned` or `panelBySession` changes | | reconcile: an instance whose id is in neither the pins nor any session's list is disposed (covers C5's `dropSession` on `session.removed`) |
| `regions.panel.collapsed` true → false | a tab is selected | `focus[activeTabId] += 1` (the ⌘⇧B transition the spec derives, since `panel.toggle` only flips `collapsed`) |
| `props.appSessionId` changes | | nothing in the map changes; every rendered instance's `ctx.appSessionId`, `session` and `status` re-derive (the pin rule) |

The panel region's slot is `overflow-auto`; the host renders `flex h-full min-h-0 flex-col` with the strip `shrink-0` and the body `min-h-0 flex-1` so a tool that owns its scrolling (C6's virtualised list, C9's terminal) gets a bounded height. R7 verifies this at the three widths and maximized; a failing anchor is a container fix here, not a design change.

### The C5 seam (Ask of C5, sent by the coordinator)

> C8a writes refs for a session that is not shown. C5's landed store already addresses a session: `setPanelTabs(appSessionId | null, { tabs, activeTabId })` splits pins from the session's own list and `effectivePanelTabs(appSessionId)` reads pins first. The asked pair names that seam for a caller that is not the slot: `panelTabsOf(appSessionId: AppSessionId | null): PanelTabRef[]` (pins first, then the session's own) and `updatePanelTabs(appSessionId: AppSessionId | null, fn: (state: PanelSessionState) => PanelSessionState): void`, which applies `fn` to the session's own state (`tabs` unpinned only, `activeTabId`) and leaves `panel.pinned` untouched; with `appSessionId === null` it applies to the pins with `panelActiveNoSession` as `activeTabId`. Pins move only through `setPanelTabPinned` (the strip's `onTogglePinned`). Until the pair lands the host wraps `effectivePanelTabs` and `setPanelTabs` in two lines of `host.ts`, taking care to pass the current pins through unchanged when it writes another session's list, because `setPanelTabs` rewrites `panel.pinned` from the `pinned` refs it is given. **[refresh]**

`PanelHostProps.onChange` stays the slot's write for the shown session (it is `setPanelTabs(props.appSessionId, next)` in `PanelRegion.tsx`); the seam is for the target session when it differs.

### Layout key `summary.sections` (`src/shared/ipc/schema/layout.ts`, C8a block)

```ts
export const SUMMARY_SECTIONS = ['environment', 'push', 'subagents', 'background', 'sources'] as const;
export const SummarySectionsSchema = z.strictObject({ version: z.literal(1), collapsed: z.array(z.enum(SUMMARY_SECTIONS)) });   // key `summary.sections`; absent key = everything expanded
// LayoutKeySchema: the union gains z.literal('summary.sections')
```

Written by `stores/summary.ts` through `layout.set` 250 ms after the last toggle (C5's cadence), read once through `layout.get` at first use. The key sits outside the `panel.` namespace on purpose: C5's hydration treats every `panel.<x>` key as a session's list.

### Git store (`src/renderer/src/stores/git.ts`)

```ts
export interface GitEntry { root: string | null; status: GitStatus | null; uncommitted: { files: GitDiffFile[]; at: string } | null; error: string | null }   // per directory
export interface GitStore {
  entries: Map<string, GitEntry>;                    // by directory (session.worktree?.path ?? session.directory)
  watch(directory: string): () => void;              // ref-counted here; the first watcher invokes git.watch and git.diff { scope: 'all' }, the last release invokes git.unwatch
  applyChanged(event: EventPayload<'git.changed'>): void;   // every directory whose root matches takes the status and re-runs git.diff
}
export const useGit: UseBoundStore<StoreApi<GitStore>>;
```

`git.watch` answers the status; `git.diff { directory, scope: 'all' }` (Review's Uncommitted: the working tree against `HEAD`) supplies `files` for the change line and is re-run on each `git.changed` for the root, coalesced to one in flight per directory. A `git.watch` that fails with `not a git repository` (C4's `internal` error) sets `error` and no root; the summary shows it in words. The composer's location chip (C7) also calls `git.watch`; main ref-counts by root across callers, so both sides call `unwatch` symmetrically and nothing else is coordinated.

### Summary derivations (`src/renderer/src/panel/summary/derive.ts`, pure)

```ts
export function changeLine(status: GitStatus | null, uncommitted: GitDiffFile[] | null): { kind: 'clean' } | { kind: 'change'; insertions: number; deletions: number; files: number } | { kind: 'unknown' };
//   clean when status.dirty is false; otherwise sums insertions and deletions over the diff's files and counts them plus status.files[].untracked (an untracked file has no diff row); unknown while the diff has not answered
export function pushState(status: GitStatus): { kind: 'not_pushed' } | { kind: 'ahead'; ahead: number; behind: number; upstream: string };   // ahead 0 reads "Up to date with <upstream>"
export function githubUrl(remoteUrl: string | null, branch: string | null): string | null;
//   git@github.com:o/r.git · ssh://git@github.com/o/r.git · https://github.com/o/r(.git) → https://github.com/o/r, plus /tree/<branch> when a branch is known; null for any other host or shape
export function backgroundCounts(tasks: EngineSessionStatus['backgroundTasks']): { shells: number; workflows: number; monitors: number; other: number };
//   local_bash → shells, local_workflow → workflows, taskType starting with 'monitor' → monitors, local_agent excluded (Subagents owns agents), the rest other
export function sourcesOf(rows: Row[], limit = 10): Source[];   // Source = { kind: 'file'; path: string; at: string } | { kind: 'web'; url: string; host: string; at: string } | { kind: 'mcp'; tool: string; server: string; at: string }
//   walks groups and standalone cells; categories files and exploration yield one file source per path (deduplicated, newest startedAt wins); web yields the cell's URL when its detail carries one; mcp yields the tool; newest first, bounded
export function agentGlyphs(rows: Row[], limit = 4): { glyph: number; name: string }[];   // SubagentRef.glyph from the session's subagent rows, active before done, bounded
```

`SubagentRef.glyph` is the index C6's derivation computed with its private hash, so the panel and the transcript agree by construction; the marks themselves are the Ask of C6 below.

### Copy (`src/renderer/src/panel/copy.ts`; exact strings are decisions)

Home glyph `aria-label`: `Session overview`. "+" `aria-label`: `Add a tool`; empty menu: `No tools registered yet`. Placeholder body and disabled summary rows: `Arrives with C9` (`terminal`), `Arrives with C11` (`session-info`), `Arrives with C8b` (`subagents`, `background`, `log`), `Arrives with C8c` (`review`, `files`). Environment: `⎇ <branch>`; `detached at <head, 7 chars>`; `Not a git repository`; `Clean`; `+<N> −<M> across <K> files` (`1 file`); `<model> · <effort>` with `effort unknown` when null; buttons `Review`, `Session info`. Push state: `Not pushed`; `<N> ahead of <upstream>`; `Up to date with <upstream>`; `· <M> behind` appended when behind; `Open on GitHub`. Subagents: `<N> working · <M> done`; `No subagents yet`. Background work: `<N> shell(s) · <N> workflow(s) · <N> monitor(s)` (zero counts omitted; `Nothing running`); disk-only: `<N> workflow run(s) on disk` and `Shells and monitors are known only while the session runs here`. Sources: `No sources yet`; `Open the session to list its sources` (no transcript entry); `Loading…` (hydrating); an MCP row's trailing text `Source only`. Footer: `Tools stay with this session. Pin a tab to keep it with you as you switch.` A section's heading carries its title only; the chevron is a glyph.

### Harness API (`src/renderer/src/harness/panel/api.ts`, `window.__maws_harness.panel`)

```ts
export interface PanelHarnessApi {
  switchSession(id: 'A' | 'B' | null): void;            // null focuses a fake Overview tab
  setSession(id: 'A' | 'B', patch: Partial<SessionRecord>): void;   // the e2e points A.directory at a scratch repository it created
  setStatus(id: 'A' | 'B', status: EngineSessionStatus | null): void;
  setDigest(id: 'A' | 'B', patch: Partial<SessionDigest>): void;
  loadTranscript(id: 'A' | 'B', fixture: string): Promise<void>;   // attaches C6's fixture as the session's transcript entry (Sources)
  addTool(toolId: string, params?: unknown, opts?: { appSessionId?: 'A' | 'B' | null; activate?: boolean; pin?: boolean }): string;
  selectTab(tabId: string): void; closeTab(tabId: string): Promise<boolean>; pin(tabId: string): void; showSummary(): void;
  tabs(): { id: string; toolId: string; pinned: boolean; active: boolean; title: string }[];
  stub(toolId: string): { counter(): number; vetoNextClose(): void; instances(): string[] };   // the stub tool's probe
  setWidth(px: 280 | 380 | 640): void; maximize(on: boolean): void; collapse(on: boolean): void; setTheme(theme: 'light' | 'dark'): void;
  hydrated(): Promise<void>;                              // the layout store finished reading layout.json
}
```

Fake sessions: `A` (`directory: /tmp/maws-harness/a`, no worktree, a live status with two `backgroundTasks`, a digest with `childAgents { active: 2, done: 1 }`) and `B` (`worktree: { path: /tmp/maws-harness/b, branch: 'harness' }`, disk-only). The defaults are constants the page builds records from; the e2e overrides `A.directory` with a scratch repository it creates in Node and passes through `setSession`, so the summary's git rows run over C4's real service on master. The page seeds `useSessions` and `useLayout` (a `session:A` tab active in one pane), runs `useLayout.hydrate(ipc, () => true)` so pins and `panel.A` round-trip the profile's real `layout.json`, and registers stubs for `terminal` and `session-info` (and, harness-only, `child`) unless a real tool of that id is already registered.

### Ask of C6 (additive; the glyph marks)

> `SubagentRef.glyph` is the mark's index, but the eight marks (`['✻', '❋', '✿', '✦', '❖', '✺', '✹', '❉']`, `view/rows/Subagent.tsx`) are module-private. Export them, or a `SubagentGlyph({ glyph })` component, from `src/renderer/src/transcript/index.ts` at M5 so the summary's Subagents glyphs are the transcript's. Degraded case until then: the array duplicated in one line of `summary/Subagents.tsx` with a comment naming the source. No other ask: `Transcript`'s `variant: 'child'`, `className` and `handle` props, `useTranscriptStore`'s `entries[key].rows` and `phase`, and the fact that `detach` on unmount keeps an entry's rows (`stores/transcript.ts`) are what the summary reads and are already landed.

### Ask of C9 (its M4 refresh against this document)

> (1) `terminalTool: PanelTool<TerminalTabState, { cwd?: string; command?: string }>` registered from C9's `App.tsx` block through `registerPanelTool(terminalTool)`; `openTerminal({ appSessionId, cwd, command })` is `panelHost.addTool('terminal', { cwd, command }, { appSessionId })`. (2) `createState` may be called for a restored tab with `params: undefined` after a reload; it re-adopts the pty whose label equals `instanceId` (the registry's `adopt()` by `(appSessionId, label)`), and C9 orders its own `adopt()` before it opens a new shell (the host awaits nothing from C9). (3) The `#panel` page is C8a's: C9 M4 registers into it, drops its `terminal/PanelHarness.tsx` plan, and drives `window.__maws_harness.panel` plus its own `terminals.*` probes from `e2e/terminal.spec.ts`; the fake docked card and `keys.counts()` C9's Enter/Escape test needs are C9's additions to the page as a delimited block. (4) If the Terminal needs `/tmp/maws-harness/{a,b}` to exist for its shell, C9 creates them in main under `MAWS_HARNESS=1` as its document planned; the summary needs nothing created.

### Ask of C11 (its M4 refresh)

> `sessionInfoTool: PanelTool<SessionInfoState, void>` registered through `registerPanelTool(sessionInfoTool)` from C11's `App.tsx` block; the summary opens it from one row (the model row) and "+" offers it; the four rows C11's ask assumed are not drawn (spec Surprises). `DiffWidget`'s "Open in Review" is `panelHost.addTool('review', {}, { appSessionId })` under the amended signature.

### Notes to C8b and C8c (siblings registering into this host)

Ids, `pinnable`, `multiInstance`, `params` and `summary` per the spec's X5 table. The host unmounts an unselected tool, so a tool that scrolls keeps its scroll offset (and any other view state the owner would miss) in its `S` and restores it on mount; the harness's stub demonstrates it and the acceptance's "returns with its scroll intact" is that behaviour. A tool with a `summary` component replaces the host's baseline section of the same name once registered (Subagents and Background work from C8b; Review's diff stats inside Environment from C8c); the host's baseline rows are what the summary shows before that. Log: `pinnable: false`, `multiInstance: true`, `menu: false`; its tabs are transient (never pinned, dropped at hydration), so a Log tab never survives a relaunch. `open(state, params)` is called for an `addTool` on an existing single-instance tab; a tool without `open` is simply selected. `params` is `undefined` on a restored tab. `ctx.openTool` is `panelHost.addTool`; opening a file is C5's `openTab` (K4), never a tool.

### Dependencies

No new package. Radix `DropdownMenu` from `radix-ui` (C5's sidebar menus use it), zustand, TanStack Query (`useCommand('fs.workflows', …)` once the name is in `QUERY_COMMANDS`), C6's `Transcript` and store, C5's stores and `openTab`, C4's `git.*` and `fs.workflows` on master, C3's `session.status` as applied by C5.

## Acceptance

C8a closes when all of the following are observed on the owner's Mac from the C8a worktree with C5 (and, by the merge order, C3 and C4) on master, in this order:

1. `pnpm test` passes and its output includes the suites `panel host registry and instances`, `panel host transitions`, `panel tab strip and plus menu`, `summary derivations`, `summary card`, `git store`, `summary store`, `shell renders the panel host in the region`, and C5's `right panel` suite in `Shell.test.tsx` unchanged; `ipc schema validates both directions` covers `summary.sections`; the tokens guard passes over the new files.
2. `pnpm build && pnpm e2e -- e2e/panel.spec.ts` passes. Over the harness (`MAWS_HARNESS=1` through `launchMaws`'s `env`, a throwaway `userData`, a scratch git repository the test creates with one commit, one dirty tracked file and one untracked file, `origin` a local bare repository with `main` pushed and one commit ahead), in named tests: `plus lists registered tools and opens a tab` ("+" lists `Terminal` and `Session info`, opening Terminal adds `terminal:<suffix>` to A's list and selects it); `state lives outside React across visibility, session switches and pins` (the stub's counter is 3 after three clicks; collapse and reopen, switch to B and back, pin and unpin: still 3, `instances()` still one id); `a pinned tab shows first for every session and unpins into the session's list` (pinned in A, first in B's strip with `ctx.appSessionId` reading B; unpinned in B, it is B's tab and absent from A); `home glyph shows the summary with the tabs kept and a tab click returns with its scroll intact` (a tall stub scrolled 400 px, home, back: `scrollTop` within 1 px); `the summary shows when the last tab closes`; `a beforeClose veto keeps the tab until the tool confirms` (`vetoNextClose`, close: the tab stays and the stub's confirmation line renders; its Confirm calls `ctx.close()` and the tab goes); `addTool targets a session that is not shown` (B on screen, `addTool('terminal', {}, { appSessionId: 'A', activate: false })`: B's strip unchanged, switching to A shows the tab unselected); `pins and session tabs round-trip a relaunch and log tabs do not` (pin a Terminal, add a Session info to A and a stub `log` tab to A; relaunch over the same `userData`; the pin is first in both sessions with the same id, A's Session info is back, the `log` ref is gone from `layout.json` and the strip); `Overview keeps the pin selection` (with two pins and the Overview focused, select the second, switch to A and back to the Overview: still selected); `the summary renders from git, the status, the digest and the transcript store and every row opens its tool` (Environment reads `⎇ main`, `+1 −0 across 2 files`; Push state reads `1 ahead of origin/main` and `Open on GitHub` is absent for the local remote; Subagents reads `2 working · 1 done`; Background work reads `1 shell · 1 workflow`; after `loadTranscript('A', 'pass1/permission-roundtrip')` Sources lists file rows newest first; `Review`, `Open`, `Open` and the model row each add the expected tool id or, for an unregistered id, render disabled with `Arrives with C8b` or `Arrives with C8c`; a file row calls `openTab` with `kind: 'file'` and A's id, observed through the layout store); `a disk-only session marks shells unavailable` (B: `Shells and monitors are known only while the session runs here`); `section expansion persists` (collapse Sources, reload: collapsed; `layout.json` holds `summary.sections`); `child transcript renders inside the region at 280, 380, 640 and maximized` (R7: the `child` tool over `pass1/subagent`'s first child at each width and maximized: the list's DOM rows are bounded, the last row is in view after `expandAll`, following stays true through a released batch, no horizontal overflow, and the `request_slot` renders C6's placeholder since C7 is not on master); `both themes use tokens only` (every element of the page, portals included, scanned for colours of the other theme at the summary, an open "+" menu and a veto line, in C5's smoke's manner). Over the stub scenario (`MAWS_SESSION_SOURCE=stub:test/fixtures/shell/nine-sessions.json`, `MAWS_SCENARIO_CLOCK=manual`): `the product host rests on the summary and follows the focused session` (open *Charter + research*: the summary names this repository's branch and its Subagents counts from the fixture's digest; open a second session in a split and focus it: the summary follows; the Overview tab: pins only and the footer); `unregistered tools are named` (every row's disabled text names C8b, C8c, C9 or C11, since no tool is registered in the product before those children merge).
3. Live, in `pnpm dev` with the real index (C4 on master) and this repository open as a session: the summary shows `⎇ <this branch>`, the change line matches `git diff HEAD --numstat` summed plus the untracked count from `git status --porcelain`, the push state matches `git rev-list --count @{u}..HEAD` and `Open on GitHub` opens `https://github.com/<owner>/MAWS/tree/<branch>` in the browser; editing a file changes the line within a second (`git.changed`); a session whose directory is not a repository reads `Not a git repository`. If C9's `terminalTool` or C11's `sessionInfoTool` is registered by then, the same run opens each from "+" and from its summary row and the pin survives a session switch with the shell intact; otherwise the rows read `Arrives with C9` and `Arrives with C11` and the harness run of item 2 stands for them (the spec's advisory edge on C9 M4).
4. Both themes: the summary at rest, a strip with a pinned and an unpinned tab, the "+" menu, a placeholder tab and a veto line render in light and dark from tokens only, checked in the harness by the theme toggle and in item 2's scan.
5. `pnpm verify` exits 0.

## Plan of Work

Constraints for every milestone are in Constraints; the interfaces are defined once above. Each milestone says what exists at its end, what it touches, what it exposes and consumes, the decisions that are its alone, its edge, and what it proves.

### M1 — Host and registry

At the end of M1 the slot is filled: `pnpm dev:harness` at `#panel` shows the real region with a strip whose home glyph, tabs and "+" work over two fake sessions and two stub tools; a stub's counter survives collapse, session switches and pins; a veto keeps its tab; a tab whose tool is unregistered is a placeholder naming its child; `panel/tool.ts` and `host.ts` are the canonical X5 with the amended `addTool`; hydration drops Log refs and reconciliation disposes orphaned instances. The product app registers the host from `App.tsx` and, with no tool registered, shows an empty strip with the home glyph and a "+" whose menu reads `No tools registered yet` above a summary that is M2's (a footer-only card until then).

Touches: `src/renderer/src/panel/{tool,host,arrives-with,copy}.ts`, `PanelHost.tsx`, `TabStrip.tsx`, `ToolBody.tsx`, `host.test.tsx`, `panel.test.tsx`, `App.tsx` (the C8a block), `harness/main.tsx` (the route), `harness/panel/{PanelHarness.tsx,fakeSessions.ts,stubTool.tsx,api.ts}`.

Exposes: `registerPanelTool`, `panelHost`, `PanelTool` and its context, `connectPanelHost`, the harness page and its API. Consumes: C5's `PanelHostProps`, `useLayout` (`regions.panel.collapsed`, `hydrated`, `panelPinned`, `panelBySession`, `setPanelTabs`, `setPanelTabPinned`, `effectivePanelTabs`), `useSessions`, `runAction`, `IconButton`.

Decisions local to M1: `connectPanelHost()` (mounted once from `App.tsx`, like C5's `connectShell`) subscribes to the layout store for the three transitions the table names (hydration's Log filter, reconciliation, the collapse transition) and returns their disposers; the strip is one horizontal row that scrolls, never wraps, each tab `icon · title · suffix` truncated with an ellipsis at a 72 px minimum, the pin and close glyphs revealed on hover, focus and selection (Codex §3's hover-revealed actions), the active tab marked with `aria-selected`; the strip is `role="tablist"` with `role="tab"` items and the body `role="tabpanel"`, the home glyph and "+" ordinary buttons outside the list; "+" is a Radix `DropdownMenu` listing `tools()` in a fixed §5.6 order (Subagents, Review, Terminal, Files, Background work, Session info, then registration order for anything else) filtered by `menu !== false` and by instance rules against the shown scope; a placeholder tab's body is a muted centred line and nothing else; the harness page seeds stores directly rather than through `connectShell` (no `session.list` answerer under the harness) and mounts C5's `PanelRegion` inside a two-column grid whose left column is a neutral main area showing the fake tab's name, so the region's resizer, header strip and slot are the product's; the stub tool's body is `<id> · <instanceId> · <ctx.appSessionId ?? 'no session'> · pinned/unpinned · visible/hidden · focus <n>` above a `+1` button and, after a veto, a `Close anyway` button that calls `ctx.close()` and sets the stub's flag so the next `beforeClose` passes; the stub's body is taller than the panel and stores its `scrollTop` in its state on scroll, restoring it on mount, which is how every tool survives the host's unmount of unselected tabs; the debug strip lists the instance map's ids and the persisted lists as C5's store holds them. `createState` for a restored ref runs when the ref first appears in the strip, not on selection (a pinned Terminal re-adopts at launch and the strip's titles are the tools' from the first paint; the alternative, on selection, would leave a pinned terminal's pty unadopted until clicked and titles unknown); the summary's position in `PanelHost.tsx` is reserved (footer-only card) so M2 fills a slot rather than restructuring.

Does not touch: the summary's sections, the git and summary stores, `layout.ts`'s schema, the child-transcript tool, e2e.

Proves: the `panel host registry and instances`, `panel host transitions` and `panel tab strip and plus menu` suites, and manually the harness behaviours above. Pins: `registerPanelTool` last-wins keeps instances and its disposer closes them without `beforeClose`; `addTool` mints `<id>:` plus eight base36 characters and throws for an unregistered id and for a null session with an unpinnable tool; a single-instance `addTool` re-targets a tab in the target session's list and one in the pins, and never one in another session's list; `activate: false` leaves `activeTabId` alone; `createState` runs once per ref across forty re-renders, three visibility flips, two session switches under a pin and a pin toggle, and the same object is handed to `render` each time; unselected tools are not in the DOM; `closeTab` awaits `beforeClose`, keeps the tab on `false`, disposes and removes the ref on `true`, and returns the same promise to a second caller; closing the active tab selects the next to its right, then the last, then null; the placeholder renders `Arrives with C9` for `terminal` and closes; the Log filter rewrites only lists that held a `log` ref; an instance whose ref vanished from both lists is disposed after the store change; `focus[id]` increments on selection and on collapsed → open, not on open → collapsed; `ctx.appSessionId` under a pin follows a session switch and reads null with no session; `panelHost.tools()` keeps registration order.

### M2 — The pinned summary

At the end of M2 the resting card is mockup 01's under the rulings: Environment (branch, change line, Review, the model row opening Session info), Push state (with Open on GitHub when the remote is GitHub), Subagents (glyphs and counts), Background work (counts by kind, or the disk-only wording), Sources (files, web and MCP sources from the transcript store, newest first, ten at most), the footer; sections collapse with a sticky heading and their expansion persists; every row opens its tool through `addTool`, a file row through `openTab`, and a row whose tool is unregistered is disabled and names its child; with no session shown the card is the footer alone.

Touches: `src/renderer/src/panel/summary/*`, `stores/git.ts` and its test, `stores/summary.ts` and its test, `ipc/events.ts` (the C8a block), `ipc/query.ts` (`fs.workflows`), `src/shared/ipc/schema/layout.ts` (the C8a block) and its schema test, `harness/panel/*` (`setStatus`, `setDigest`, `loadTranscript`, `setSession`).

Exposes: the derivations, `useGit`, `useSummary`, `SUMMARY_SECTIONS`. Consumes: M1's host and `addTool`; C4's `git.watch`, `git.unwatch`, `git.diff`, `git.changed`, `fs.workflows`, `fs.workflowChanged`; C3's status through `useSessions().engine`; C5's `records`, `digests`, `openTab`, `layout.get`/`layout.set`, `layout.openExternal`; C6's `useTranscriptStore`.

Decisions local to M2: the Environment section watches `session.worktree?.path ?? session.directory` through `useGit.watch` for as long as the summary is mounted for that session (the summary unmounts when a tab is selected, so a session with a tool open costs no watcher of the summary's; C7's chip has its own); the change line is `unknown` (rendered as `…`) until the first `git.diff` answers and never shows a partial sum; a `git.diff` that fails after a successful `git.watch` keeps the branch row and reads `Change unavailable` on the line; the Review button passes `{}` so Review picks its own default scope (dirty → Uncommitted, per the spec); the model row reads `record.model.resolved ?? record.model.requested` and `record.effort`; the push-state row is hidden entirely when `status.branch` is null (detached), since ahead and upstream are meaningless then; `Open on GitHub` goes through `layout.openExternal` with `githubUrl(status.remoteUrl, status.branch)`; the Subagents glyphs read the transcript store's subagent rows (active before done) and fall back to counts alone when the store holds no entry; Background work reads `status.backgroundTasks` for a live session and, for a disk-only one, `useCommand('fs.workflows', { appSessionId })` invalidated on `fs.workflowChanged` for that session, showing the run count with the shells-unavailable sentence; Sources reads `useTranscriptStore.getState().entries[appSessionId]` and never attaches a source of its own (a second hydration for a card would double the work C6 does when the session tab mounts; a session whose transcript was never mounted in this page reads `Open the session to list its sources`), a web row opens its URL through `layout.openExternal`, an MCP row has no action and says so; a row for an unregistered tool renders the button disabled with the child's name as its text, checked against `usePanelHost().tools` so a late registration enables it without a reload; `Section` is a `<details>`-like disclosure implemented with buttons (so the heading can be sticky inside the card's scroll) whose state is the summary store's `collapsed` set; the summary store reads `summary.sections` once with `layout.get`, treats a missing or invalid value as everything expanded, and writes with `layout.set` 250 ms after the last toggle; a `fs.workflows` that fails (the harness's fake ids, a session the engine host does not know) shows the shells-unavailable sentence alone; the card shows no relative times in P0, does not subscribe to C5's `useNow`, and subscribes to the stores it reads by selector.

Does not touch: C5's layout store internals, any tool's `summary` component (C8b's and C8c's arrive later and replace the baseline sections through the host's `summary` slot rule), the transcript store's contents.

Proves: acceptance item 2's summary tests in the harness and item 3's live rows. Pins (`summary derivations`): `changeLine` sums a two-file diff to `+3 −1` and counts an untracked file as a third file, reads `clean` for `dirty: false` and `unknown` with no diff; `pushState` reads `not_pushed` without an upstream, `ahead 2` with `upstream: 'origin/main'`, and `ahead 0` prints `Up to date with origin/main`; `githubUrl` converts the three GitHub forms with and without `.git` and a branch, and answers null for `git@gitlab.com:o/r.git`, `https://example.com/o/r` and null; `backgroundCounts` over `[local_bash, local_workflow, local_agent, monitor_ws]` is `{ shells: 1, workflows: 1, monitors: 1, other: 0 }`; `sourcesOf` over C6's rows for `pass1/permission-roundtrip` and a synthetic group with two reads of one path yields one file row for that path with the newer `startedAt`, orders newest first, stops at ten, and yields a web row with the host `example.com` for a `WebFetch` cell; `agentGlyphs` prefers active agents and stops at four. Pins (`summary card`, happy-dom with the stores seeded): sections render in order with their headings; the footer alone when `appSessionId` is null; `Review` calls `addTool('review', {}, { appSessionId })` when a `review` tool is registered and renders `Arrives with C8c` disabled when not; the model row opens `session-info`; a file row calls `openTab` with `{ kind: 'file', path, line: null, appSessionId }`; a disk-only session shows the shells sentence; collapsing a section writes `summary.sections` with that id once after the debounce; `git store` pins: two watchers of one directory invoke `git.watch` once and `git.unwatch` once after both release; a `git.changed` for the root updates the status and re-runs `git.diff` once even when two events arrive during one diff; `not a git repository` sets `error` and leaves `root` null.

### M3 — Persistence and pins under reload and session switch

At the end of M3 the panel's state survives what the day does to it: a relaunch restores the pins first in every session and each session's own tabs with their selection, and drops Log tabs; `addTool` for a session that is not shown persists into that session's list; the Overview keeps its pin selection; a removed session's instances are disposed; and, when C5's seam has landed, the host writes through `panelTabsOf`/`updatePanelTabs` with the two-line wrapper gone.

Touches: `src/renderer/src/panel/host.ts` (the seam adapter, the write paths), `host.test.tsx`, `app/Shell.panel.test.tsx`, `harness/panel/PanelHarness.tsx` (`hydrated()`, the fake Overview), `e2e/panel.spec.ts` (the relaunch and Overview cases).

Exposes: nothing new. Consumes: C5's `hydrate`, `panelActiveNoSession`, `pinSelection`, `dropSession`; the asked seam **[refresh]**.

Decisions local to M3: hydration order is C5's (sessions loaded, then `hydrate`), and the host does nothing until `hydrated` is true except render what `props.tabs` already carries (C5 replays early tab changes over the hydrated state, so an `addTool` before hydration is kept, and the Log filter runs after it); a restored ref whose tool registers later than hydration becomes an instance at the registration, through the same "appears in the strip" path; the harness's relaunch case reuses C5's `ShellLaunchOptions.userData` and asserts against the profile's `layout.json` as C5's smoke does; the Overview case relies on C5's `pinSelection` and asserts only the host's behaviour (a pin selected with no session, the summary's footer, the pins in the strip); a `session.removed` for a session whose own list holds instances disposes them on the store change, and its `panel.<id>` key stays in `layout.json` as C5 left it (no layout-key delete exists; deferred in the spec). **[refresh]** adopt the seam's landed names and delete the wrapper; if `pin?` is gone from the amended X5, remove the option and route pins through the strip only.

Does not touch: C5's store, the summary's content, the child-transcript tool.

Proves: acceptance item 2's `a pinned tab shows first…`, `addTool targets a session that is not shown`, `pins and session tabs round-trip a relaunch and log tabs do not`, `Overview keeps the pin selection`. Pins (`shell renders the panel host in the region`): rendering C5's `Shell` with the host registered, a session tab active and `panelPinned: [terminal pin]`, `panelBySession: { A: [files tab] }` shows the strip with the pin first and the summary hidden behind the active tab, and `onTogglePinned` from the strip moves the ref as C5's own test asserts; a `dropSession(A)` disposes A's instances and leaves the pin's; an `addTool('terminal', {}, { appSessionId: A, activate: false })` while the Overview is focused leaves `panelActiveNoSession` and writes `panelBySession.get(A).tabs` with the new ref and the pins unchanged.

### M4 — The product harness, R7, end-to-end, the acceptance run

At the end of M4 the `#panel` page is the product host's harness: the child-transcript tool mounts C6's `Transcript variant: 'child'` over `pass1/subagent`'s first child inside the region; the width controls set 280, 380 and 640 px and maximize; the Playwright API is complete; `e2e/panel.spec.ts` runs the harness cases and the stub-scenario cases; R7's verdict is recorded; the acceptance section is executed as written.

Touches: `harness/panel/{childTranscriptTool.tsx,PanelHarness.tsx,api.ts}`, `e2e/panel.spec.ts`, this document (Progress, Surprises, Decision Log, Outcomes).

Exposes: the harness API in full. Consumes: C6's `loadFixture`, `journalToEvents` and `HarnessSession` (`src/renderer/src/harness/{fixtures,player}.ts`), `Transcript`, C5's `launchMaws({ env, userData })` and the smoke's theme scan pattern (`e2e/shell.spec.ts`).

Decisions local to M4: the child slice is the fixture's events whose `agentId` is the first `subagent.started`'s agent (or, before that event, whose `parentToolUseId` is its tool use), wrapped as a `TranscriptSource` with `agentId` set and a `snapshot` that resolves the slice and a `subscribe` that releases the remainder through the player at the harness speed, so following and anchoring are exercised live; the `request_slot` in the slice renders C6's default placeholder because C7 is not on master (C8b wires `renderInlineRequest`), and R7's verdict is about the container, not the card; R7 passes when, at each of the three widths and maximized, the list's DOM row count stays bounded (C6's overscan) while `rows` grows, `expandAll` leaves the last row in view, following stays true through a released batch, and the region's `scrollWidth` equals its `clientWidth`; a failure is fixed in `PanelHost.tsx`'s container classes and re-run, and the verdict with the fix goes to Surprises; the e2e's scratch repository is built in Node with `git init`, one commit, a second commit pushed to a local bare `origin` with `git branch -u origin/main`, then a third commit not pushed, a tracked edit and an untracked file, so the expected strings are exact; the stub-scenario cases run against the built app with the shell smoke's environment and never `setViewportSize` (C5's rule); the acceptance run's live item is recorded in this document with the branch and counts observed.

Does not touch: any tool's code, C6's harness page, main.

Proves: acceptance items 1 to 5 as written; R7 (spec *Delegated unknowns*, this document's Surprises).

## Concrete Steps

Working directory for everything: the C8a worktree, created from master once C5 has merged: `git worktree add ../MAWS-c8a -b c8a-panel-host master`, shown here as `/Users/new/Developer/GitHub/MAWS-c8a`. Before M1, the refresh pass: re-read `src/renderer/src/panel/host-slot.ts`, `stores/layout.ts` (the seam's landed names), `src/renderer/src/panel/tool.ts` if C9 has merged it, the amended X5 section of the C8 spec, and mark each **[refresh]** item settled in the Decision Log.

M1:

```
cd /Users/new/Developer/GitHub/MAWS-c8a
pnpm install
pnpm test -- src/renderer/src/panel
pnpm dev:harness
```

In the harness window, `#panel`: the region shows an empty strip with the home glyph pressed and "+"; "+" lists `Terminal` and `Session info`; opening Terminal adds a tab `Terminal` whose body reads `terminal · terminal:xxxxxxxx · A · unpinned · visible · focus 1`; three clicks on `+1`, collapse with the header's hide button, reopen: the body reads `… · focus 2` and the counter `3`; the pin glyph, then the switcher to B: the tab is first, its body reads `B`; the debug strip lists one instance and `panel.pinned: [terminal:xxxxxxxx]`. In the console: `__maws_harness.panel.tabs()` → `[{ id: 'terminal:…', toolId: 'terminal', pinned: true, active: true, title: 'Terminal' }]`; `__maws_harness.panel.stub('terminal').vetoNextClose(); await __maws_harness.panel.closeTab('terminal:…')` → `false`, the body shows `Close anyway`.

M2:

```
pnpm test -- src/renderer/src/panel src/renderer/src/stores/git src/renderer/src/stores/summary src/shared/ipc
pnpm dev:harness
```

`#panel` with a scratch repository: in the console `__maws_harness.panel.setSession('A', { directory: '/path/to/scratch' })`; the summary reads `⎇ main`, `+1 −0 across 2 files`, `1 ahead of origin/main`; `touch /path/to/scratch/new.txt` in a terminal changes the line to `across 3 files` within a second; `__maws_harness.panel.setStatus('A', null)` turns Background work into `Shells and monitors are known only while the session runs here`; `await __maws_harness.panel.loadTranscript('A', 'pass1/permission-roundtrip')` fills Sources; collapsing Sources and reloading keeps it collapsed. In `pnpm dev` with the real index (C4 on master): `await window.maws.invoke('layout.get', { key: 'summary.sections' })` → `{ ok: true, value: { value: { version: 1, collapsed: ['sources'] } } }`.

M3:

```
pnpm test -- src/renderer/src/panel src/renderer/src/app/Shell.panel.test.tsx
pnpm build && pnpm e2e -- e2e/panel.spec.ts --grep "relaunch|Overview|not shown|pinned tab"
```

Expected: the four named tests pass; the relaunch test's second launch logs `layout.json` keys `regions`, `main.tabs`, `panel.pinned`, `panel.A`, `summary.sections`, `window.main` and no `log:` ref in any list.

M4:

```
pnpm build && pnpm e2e -- e2e/panel.spec.ts
MAWS_SESSION_SOURCE=stub:test/fixtures/shell/nine-sessions.json pnpm dev     # acceptance item 2's stub cases by hand, then
pnpm dev                                                                       # acceptance item 3 against this repository
pnpm verify
```

Expected: `pnpm e2e -- e2e/panel.spec.ts` prints every named test of acceptance item 2 as passed and R7's four-width check as one test with four steps; `pnpm verify` exits 0. **[refresh]** C6's `e2e:transcript` script sets `MAWS_HARNESS=1` at build time as well as at launch; if the harness page needs it at build (the electron-vite config in C9's worktree lists both `index.html` and `harness.html` as inputs unconditionally, so it should not), the harness cases get a `MAWS_HARNESS=1 pnpm build` of their own and `package.json` gains an `e2e:panel` script beside C6's.

## Residue decisions (C8a, 2026-09-28)

Ready to paste into the charter's C8 section under "**Residue decisions (C8a, 2026-09-28):** what the composite spec left to the child, settled here; the execution document `docs/doperpowers/plans/2026-09-28-c8a-panel-host.md` carries the interfaces, milestones and gates. Grades: binding where a sibling codes against the outcome or the design binds it, advisory where a later child may overturn with a dated line here."

- *Host composition and instances*: the slot component is a strip (`role="tablist"`) over a body; tab instances live in a module-level map keyed by `PanelTabRef.id`, never in React state, and a small zustand store carries only what React draws (registered tools, title suffixes, focus counters, closing flags); `ctx` is derived per render from C5's props, the layout store's `collapsed` flag, the sessions store and the host store; unselected tools are unmounted. An instance is created when its ref first appears in the strip (a pinned tab at launch, a session's own tabs when the session is shown) or at `addTool`, and disposed on close, on unregister, or when its ref is in no persisted list. Alternative rejected: instantiating on selection, which would leave a pinned terminal's pty unadopted until clicked and the strip's titles unknown. Binding on the map and the unmount rule (X5, every tool codes against it); advisory on the create-on-appearance moment.
- *Session-addressed writes*: `addTool(toolId, params, { appSessionId, activate, pin })` writes the ref into the target session's list through C5's session-addressed store action (the asked `updatePanelTabs`, today `setPanelTabs` behind a two-line wrapper) whether or not that session is shown; `activate` selects within that list and never changes the main area; single-instance lookup is the target's list plus the pins; the host writes `panel.pinned` and `panel.<id>` only through C5's actions and never through `layout.*` commands. Alternative rejected: a host-side queue of pending adds applied when the session is next shown, which would lose an attach across a relaunch. Binding (C10's attach and C11's hand-off code against it).
- *Transient Log tabs*: a `toolId: 'log'` ref is never pinned (no pin glyph; `pinnable: false`) and is removed from every list when the layout store hydrates, so a Log tab never survives a relaunch and no path is persisted. Binding (C8b's Log tool codes against it).
- *Placeholder tabs and rows*: a ref or a summary row whose tool is not registered renders disabled with `Arrives with <child>` from one map (`terminal` → C9, `session-info` → C11, `subagents`/`background`/`log` → C8b, `review`/`files` → C8c), enabled the moment the tool registers; a placeholder tab can be closed and pinned. Reason: a restored layout must not lose refs because a sibling has not merged. Advisory on copy; binding on keeping the ref.
- *"+" menu*: a Radix `DropdownMenu` listing registered tools with `menu !== false` in the §5.6 order (Subagents, Review, Terminal, Files, Background work, Session info, then registration order), omitting a single-instance tool that already has a tab in the shown scope; empty reads `No tools registered yet`. Advisory.
- *Summary composition*: host-owned sections Environment, Push state, Subagents, Background work, Sources and the footer, each a disclosure with a sticky muted heading whose collapsed set persists under the layout key `summary.sections` (a C8a block in `schema/layout.ts`, outside the `panel.` namespace C5's hydration reserves for sessions); a registered tool's `summary` component replaces the host's baseline section of the same name. Data: branch, push state and the change line from C4's `git.watch`/`git.changed` and `git.diff { scope: 'all' }` over `session.worktree?.path ?? session.directory`, ref-counted per directory in a renderer git store beside C7's chip; Subagents counts from `SessionDigest.childAgents` and glyphs from the transcript store's subagent rows (`SubagentRef.glyph`, C6's index; the marks are the Ask of C6); Background work from `status.backgroundTasks` grouped by `taskType` with agents excluded, or the run count of `fs.workflows` plus the shells-unavailable sentence for a disk-only session; Sources from the transcript store's rows (file changes and exploration yield file rows, web rows open externally, MCP rows have no action), newest first, ten at most, never hydrating a transcript of its own. Alternative rejected for Sources: attaching C6's `ipcSource` from the card, which would hydrate a session's whole history for a ten-row list. Binding on the sources and the section list (rulings 2 and 5, D-10); advisory on bounds, order and copy.
- *Push state and the GitHub link*: `Not pushed` without an upstream, `<N> ahead of <upstream>` (with `· <M> behind`), `Up to date with <upstream>` at zero; `Open on GitHub` only when `git.status.remoteUrl` names `github.com` in any of the SSH, `ssh://` or HTTPS forms, converted to `https://github.com/<owner>/<repo>/tree/<branch>` and opened through `layout.openExternal`; hidden on a detached head. Advisory.
- *Harness*: the `#panel` page hosts the real `PanelRegion` inside a two-column frame over two fake sessions (A a directory with a live status, B a worktree, disk-only), with stub tools for `terminal` and `session-info` until their children register, a harness-only `child` tool over C6's `pass1/subagent` slice for R7, controls for the three widths, maximize, collapse and theme, and an automation API under `window.__maws_harness.panel`; it hydrates the layout store from the profile's real `layout.json` so persistence is tested where it lives. C9 M4 and C11 M4 register into this page; C9's planned `terminal/PanelHarness.tsx` is not built. Advisory.
- *Testing*: vitest happy-dom for the registry, the transition table, the strip and menu, the summary card over seeded stores, the pure derivations, the git and summary stores, and C5's `Shell` with the host registered; Playwright over the harness (a scratch repository built by the test, a relaunch over the same profile, the R7 widths, both themes by computed colours in C5's smoke's manner) and over the shell's stub scenario; the live acceptance against this repository with C4's git service; whole-branch review at reviewer-medium. Advisory.

## Surprises & Discoveries

- Observation: C5's landed store is already session-addressed for panel refs, so the fix wave's seam is a naming wrapper rather than new behaviour.
  Evidence: `stores/layout.ts` (C5 worktree 395fb9d) `setPanelTabs(appSessionId, next)` writes `panelBySession.set(appSessionId, …)` for any id and `effectivePanelTabs(appSessionId)` reads any id; only `PanelRegion.tsx`'s `onChange` binds them to the shown session. Consequence: `addTool` for a non-shown session works before the asked names land, provided the caller passes the pins through unchanged, since `setPanelTabs` rewrites `panel.pinned` from the refs it is given.
- Observation: C5 M6 landed the spec's two asks, so the spec's degraded case "pins only on file tabs until it lands" does not arise for C8a.
  Evidence: `stores/layout-model.ts:30-40` `sessionOfTab` returns the id for `session`, `agent`, `diff` and `file` tabs (commits 2de77e9, 1b97b3b); `host-slot.ts` comment updated to match.
- Observation: a transcript's rows outlive its view: `Transcript` detaches on unmount but the store keeps the entry, so the summary can list a session's sources after the owner moves to a file tab without hydrating anything.
  Evidence: `view/Transcript.tsx` `return () => store.detach(storeKey)`; `stores/transcript.ts` `detach(key)` stops the attachment and leaves `entries[key]`, `drop(key)` is the one that forgets.
- Observation: C6's glyph hash is module-private but its result travels on the row, so the summary needs the eight marks, not the hash.
  Evidence: `model/derive.ts:139` `const glyphOf = (id) => …% 8` (not exported); `model/rows.ts:86` `SubagentRef.glyph: number`; `view/rows/Subagent.tsx:16` `const GLYPHS = ['✻', '❋', '✿', '✦', '❖', '✺', '✹', '❉']` (not exported). Resolution: the Ask of C6; duplicate the array as the degraded case.
- Observation: `LayoutKeySchema` is a closed union with a `panel.<x>` regex that C5's hydration treats as session ids, so the summary's expansion key must be a new literal outside that namespace.
  Evidence: `src/shared/ipc/schema/layout.ts:3` and `stores/layout.ts:68,133-149` (`PANEL_KEY`, `known(id)`); C7 added `usage.banners` the same way.
- Observation: the fixtures show three background task types and no monitor.
  Evidence: `grep -rho '"task_type":"[a-z_]+"' spikes/protocol-probe/fixtures` → `local_workflow` 6, `local_agent` 6, `local_bash` 5. `backgroundCounts` matches monitors by prefix and keeps an `other` bucket rather than guessing names.
- Observation: `pass1/subagent`'s journal carries no `agent_id` string, so the harness's child slice is chosen by the first `subagent.started`'s agent in C6's derived events, not by grepping the journal.
  Evidence: `grep -c '"agent_id"' spikes/protocol-probe/fixtures/subagent.jsonl` → 0; C3 attributes `agentId` in normalisation (spec grounding §1.3).

## Decision Log

- Decision: verification call for C8a: per-task reviews under subagent-driven execution on `doperpowers:task-reviewer`, with M1's boundary reviewed before M2 starts (M2 consumes `addTool` and the host's section slot) and M3's before M4; a whole-branch `doperpowers:reviewer-medium` review at M4 (the spec's call for C8a; C8c is the reviewer-high case because of `files.*`). The executor is `doperpowers:plan-executor` on opus, dispatched when C5 is on master, after the refresh pass named in Concrete Steps.
  Rationale: the branch is a renderer host with one pure core (the transition table and the derivations) whose tests are the load-bearing checks; its IPC touches are consumers of reviewed contracts; the sandbox is not crossed.
  Date/Author: 2026-09-28, C8a author.
- Decision: the four amendments the C8 spec's fix wave made after this document was started are applied throughout, relayed by the coordinator on 2026-09-28: (1) `addTool(toolId, params, { appSessionId, activate, pin })` is session-addressed through a C5-owned seam (`panelTabsOf`/`updatePanelTabs`, Ask of C5 sent), `activate: false` adds without switching, single-instance lookup is the target's list plus the pins; (2) Log tabs are transient, never pinned and dropped at hydration by the host; (3) the summary's change line reads `git.diff.files` (Uncommitted) refreshed on `git.changed`, so C8a consumes `git.diff`, and its real summary depends on C4's git milestone, which the ledger's merge order (C3, C4, then C5) puts on master before C5, so the spec's "after C5" edge already implies it; (4) the panel drill-in (C8b) and C5's agent tab share C6's child `ipcSource`, which owns disk-versus-wire provenance, and this host only needs to know a tool may mount `Transcript variant: 'child'` (R7). Everything else in X5 stands as read at 1e398b3. The `pin?` option on `addTool` is carried from the read text; the refresh pass drops it if the amended X5 omits it.
  Rationale: the coordinator's instruction; the spec's X5 section is authoritative and not re-litigated here.
  Date/Author: 2026-09-28, C8a author, on the coordinator's relay.
- Decision: `addTool` throws for an unregistered tool and for an unplaceable tab rather than widening its return type.
  Rationale: X5's `string` return is what C9, C10 and C11 wrote against; the callers are adapters and the summary, which consult `tools()` first, so a throw marks a programming error rather than a user-facing state.
  Date/Author: 2026-09-28, C8a author.
- Decision: the summary's Sources section reads the transcript store and never attaches a source; a session with no entry says `Open the session to list its sources`.
  Rationale: C6 hydrates a session's history when its tab mounts and keeps the rows after unmount; a second hydration for a ten-row list would double that cost for every session the panel glances at. Alternative kept in view: if C6 exposes a cheap classified index (paths per session) later, the sentence goes.
  Date/Author: 2026-09-28, C8a author.
- Decision: no `[parent-impact]` is raised beyond the spec's own Parent-impact list. C8a adds one layout key (`summary.sections`, X2 additive under ruling 6's pattern), one `QUERY_COMMANDS` name and no action, command or event; nothing binding was found wrong.
  Rationale: the host's rules held against C5's landed code (the seam exists in substance; the tenth ask is landed), and the summary's sources are the ones the spec names.
  Date/Author: 2026-09-28, C8a author.

## Outcomes & Retrospective

Pending — written at finish.
