// X2 `layout.*` (C5 execution document, Interfaces "X2 — `layout.*`"). C5 owns the namespace: a key/value store over
// main's `<userData>/layout.json` (§4.4 as amended; wave-2 ledger ruling 10), one opaque JSON value per key, whose
// shapes are defined here and validated by the reader. There is no `layout.changed`: the renderer is the only writer
// and hydrates from the snapshot. `window.main` is main's own key and never crosses IPC.
import * as z from 'zod';
import { AgentIdSchema, AppSessionIdSchema, ProjectIdSchema } from '../../graph/ids';
import { ACTION_IDS } from '../../keymap/actions';
import type { CommandSpec } from './common';
import { CaptureAnswerSchema, CaptureRectSchema } from '../../markup/image'; // P3-G
// E4a start
import { BrowserTabIdSchema } from '../../browser/tab';
// E4a end
// P5 O6 M2
import { addressOf, isAddress } from '../../machine/address';
import { MachineRefSchema, type MachineRef } from '../../machine/ref';
import { OrgKeySchema } from '../../machine/org-key'; // P5 O6 M5

// W5 (§5.2 as amended 2026-10-01): the Overview is no longer a tab; it floats over the main area (`regions.overview`).
// A stored `main.tabs` that still holds its tab is read through `StoredMainSchema`, which drops it. W6 (E1): the
// Accounts tab retired the same way; its content is the top bar's usage popover. P3-G (§D5): that reader drops a tab of
// any kind this union does not name, so a kind is added without bumping `main.tabs`'s version.
//
// P5 O6 M2 (OX2; docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "The layout migration"): every id in a tab is
// an address (`<machine>/<id>`), and a `file` or `artifact` tab names its machine, since the same path or artifact id on
// two machines is two things; tab ids carry the machine too (`tabId`). Version 2's tabs held bare ids and no machine;
// `storedMainSchema(local)` reads them lifted with the local machine, since every id before O6 was its.
const SessionTabSchema = z.strictObject({ id: z.string(), kind: z.literal('session'), appSessionId: AppSessionIdSchema, pinned: z.boolean() });
const AgentTabSchema = z.strictObject({ id: z.string(), kind: z.literal('agent'),   appSessionId: AppSessionIdSchema, agentId: AgentIdSchema, pinned: z.boolean() });   // a child's transcript in the main area (C6 child variant); C8's drill-in stays in the panel
const FileTabV2Schema = z.strictObject({ id: z.string(), kind: z.literal('file'),    path: z.string(), line: z.number().int().nullable(), appSessionId: AppSessionIdSchema.nullable(), pinned: z.boolean() });
const DiffTabSchema = z.strictObject({ id: z.string(), kind: z.literal('diff'),    appSessionId: AppSessionIdSchema, ref: z.string(), pinned: z.boolean() });
const DiagnosticsTabSchema = z.strictObject({ id: z.literal('diagnostics'), kind: z.literal('diagnostics'), pinned: z.boolean() });
const SettingsTabSchema = z.strictObject({ id: z.literal('settings'), kind: z.literal('settings'), section: z.enum(['engine', 'gateway', 'keyboard', 'appearance', 'notifications', 'voice', 'browser', 'artifacts', 'sessions', 'org']).nullable(), pinned: z.literal(false) });   // C11: singleton; a second openTab activates it and updates `section`; titled 'Settings'; E9: 'voice' appended (the index places it after Keyboard); E4a: 'browser' appended (Settings › Browser, Task 3.4); P3-D: 'artifacts' appended (Settings › Artifacts, the design-system defaults); P5 O8 M1: 'org' appended (Settings › Org, the sign-in to the org)
// P3-G (§D5): the Artifacts library, a singleton like Settings; its content is the `artifactsLibrary` slot P3-L fills
const ArtifactsTabSchema = z.strictObject({ id: z.literal('artifacts'), kind: z.literal('artifacts'), pinned: z.literal(false) });
const ProjectsTabSchema = z.strictObject({ id: z.literal('projects'), kind: z.literal('projects'), pinned: z.literal(false) });
const CustomizeTabSchema = z.strictObject({ id: z.literal('customize'), kind: z.literal('customize'), section: z.enum(['plugins', 'skills', 'mcp']), pinned: z.literal(false) });
// P3-L (Decision Log 7, 8): one artifact in its kind's editor, one tab per artifact; the workspace's, not a session's
// (it follows the current tab set as the library does), pinnable like a file tab
const ArtifactTabV2Schema = z.strictObject({ id: z.string(), kind: z.literal('artifact'), artifactId: z.string(), pinned: z.boolean() });
// E4a start (X14): one of a session's browser tabs as a main tab; it restores to the Browser tool's empty state with
// the tab's last URL as a suggestion, never auto-loaded (the page itself lives in main, `<userData>/browser/tabs.json`)
const BrowserTabSchema = z.strictObject({ id: z.string(), kind: z.literal('browser'), appSessionId: AppSessionIdSchema, browserTabId: BrowserTabIdSchema, pinned: z.boolean() });
// E4a end
// P5 O6 M2 (M6's scene): a session tab in version 3 keeps its session's last-known title, so a tab of a machine whose
// records the page does not hold yet (one not loaded in this run) is still named; optional, so a tab written without it
// reads, and version 3 is unchanged otherwise.
const SessionTabV3Schema = SessionTabSchema.extend({ title: z.string().optional() });
export const TabRefSchema = z.discriminatedUnion('kind', [
  SessionTabV3Schema, AgentTabSchema, FileTabV2Schema.extend({ machine: MachineRefSchema }), DiffTabSchema, DiagnosticsTabSchema, SettingsTabSchema,
  ArtifactsTabSchema, ProjectsTabSchema, CustomizeTabSchema, ArtifactTabV2Schema.extend({ machine: MachineRefSchema }), BrowserTabSchema,
]);
export type TabRef = z.infer<typeof TabRefSchema>;
const TabRefV2Schema = z.discriminatedUnion('kind', [
  SessionTabSchema, AgentTabSchema, FileTabV2Schema, DiffTabSchema, DiagnosticsTabSchema, SettingsTabSchema,
  ArtifactsTabSchema, ProjectsTabSchema, CustomizeTabSchema, ArtifactTabV2Schema, BrowserTabSchema,
]);
type TabRefV2 = z.infer<typeof TabRefV2Schema>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type TabTarget = DistributiveOmit<TabRef, 'id' | 'pinned'>; // what `openTab` is given

// Deterministic ids: a session has at most one tab across both panes.
export function tabId(tab: TabTarget): string {
  switch (tab.kind) {
    case 'session':
      return `session:${tab.appSessionId}`;
    case 'agent':
      return `agent:${tab.appSessionId}:${tab.agentId}`;
    case 'file':
      return `file:${tab.machine}:${tab.path}`; // P5 O6 M2: a ref holds no ':', so the path is all after the second
    case 'diff':
      return `diff:${tab.appSessionId}:${tab.ref}`;
    case 'diagnostics':
      return 'diagnostics';
    case 'settings':
      return 'settings';
    case 'artifacts': // P3-G
      return 'artifacts';
    case 'projects':
      return 'projects';
    case 'customize':
      return 'customize';
    case 'artifact': // P3-L; P5 O6 M2: with its machine
      return `artifact:${tab.machine}:${tab.artifactId}`;
    // E4a start
    case 'browser':
      return `browser:${tab.appSessionId}:${tab.browserTabId}`;
    // E4a end
  }
}

// Tab kinds the pin control never applies to: C11's singleton (the Accounts tab, the other, retired with W6) and P3-G's.
export const UNPINNABLE_KINDS: ReadonlySet<TabRef['kind']> = new Set(['settings', 'artifacts', 'projects', 'customize']);

// A pane holds at least one tab, except that the only pane may be empty (W5: with the Overview out of the strip, closing
// the last tab leaves an empty main area; `activeTabId` is '' then).
export const PaneStateSchema = z.strictObject({ tabs: z.array(TabRefSchema), activeTabId: z.string() });
export type PaneState = z.infer<typeof PaneStateSchema>;
export const PanelTabRefSchema = z.strictObject({ id: z.string(), toolId: z.string(), pinned: z.boolean() });      // X5: what C5 persists of a panel tab; C8 owns the rest
export type PanelTabRef = z.infer<typeof PanelTabRefSchema>;

// W11 (§5.1 as amended 2026-10-01, the owner's second look): the sidebar is Codex's flat tree, and `expandedProjects`
// lists the project rows open in place (a project id, or `'other'` for Other sessions), remembered across launches;
// every other row is collapsed. It replaces version 2's `openProject` (W5's drill-in: the open page becomes the one
// expanded project) and version 1's `collapsedProjects` and `collapsedSections` (read as nothing expanded).
// P5 O6 M5: a row is an org project's or a machine's (`OrgKeySchema`: `remote:…`, `machine:<ref>`, …), which replace
// project ids and `'other'`; an entry that is still a project's address, or `'other'`, is from before M5 and migrates
// once its machine's projects are known (`layout-model.ts`'s `rekeySets`). No version: every one is a string as before.
export const ProjectKeySchema = z.union([z.literal('other'), OrgKeySchema, ProjectIdSchema]);
export type ProjectKey = z.infer<typeof ProjectKeySchema>;
// The floating Overview's rect, in px from the top left of the main area under the top bar (null: the default place).
export const OverviewRectSchema = z.strictObject({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() });
export type OverviewRect = z.infer<typeof OverviewRectSchema>;
// P3-G (X30; the P3-G execution document, §D1.1): version 4 adds the panel's fourth state, `floating` (the panel takes
// the main column's place as maximized does and the floating card draws the shown session), and the card's size per
// panel tab it sits over (`floatingCard`: keyed by the panel tab's id, or 'summary' for the resting summary). Every
// writer goes through the layout store's `setPanel`, which keeps `floating` and `maximized` exclusive and both false
// while collapsed.
const PanelRegionSchema = z.strictObject({ width: z.number().int(), collapsed: z.boolean(), maximized: z.boolean(), floating: z.boolean() });
const PanelRegionV3Schema = z.strictObject({ width: z.number().int(), collapsed: z.boolean(), maximized: z.boolean() }); // versions 1 to 3
export const FloatingCardSizeSchema = z.strictObject({ w: z.number().int(), h: z.number().int() });
export type FloatingCardSize = z.infer<typeof FloatingCardSizeSchema>;
const SidebarRegionSchema = z.strictObject({ width: z.number().int(), collapsed: z.boolean(), sort: z.enum(['priority', 'recency']), expandedProjects: z.array(ProjectKeySchema) });
// P5 O6 M2: version 5 holds addresses: `expandedProjects`' project ids, and the session ids inside `floatingCard`'s
// main-tab keys (`main:<tab id>`). Version 4 is read through `storedRegionsSchema(local)`, lifted with the local machine.
const RegionsShape = {
  sidebar: SidebarRegionSchema,
  panel:   PanelRegionSchema,
  overview: OverviewRectSchema.nullable(),
  floatingCard: z.record(z.string(), FloatingCardSizeSchema) };
export const LayoutRegionsSchema = z.strictObject({ version: z.literal(5), ...RegionsShape });                // key `regions`
export type LayoutRegions = z.infer<typeof LayoutRegionsSchema>;
const RegionsV4Schema = z.strictObject({ version: z.literal(4), ...RegionsShape });
const RegionsV3Schema = z.strictObject({ version: z.literal(3),
  sidebar: SidebarRegionSchema,
  panel:   PanelRegionV3Schema,
  overview: OverviewRectSchema.nullable() });
const RegionsV2Schema = z.strictObject({ version: z.literal(2),
  sidebar: z.strictObject({ width: z.number().int(), collapsed: z.boolean(), sort: z.enum(['priority', 'recency']), openProject: ProjectKeySchema.nullable() }),
  panel:   PanelRegionV3Schema,
  overview: OverviewRectSchema.nullable() });
const RegionsV1Schema = z.strictObject({ version: z.literal(1),
  sidebar: z.strictObject({ width: z.number().int(), collapsed: z.boolean(), sort: z.enum(['priority', 'recency']),
                            collapsedProjects: z.array(ProjectIdSchema), collapsedSections: z.array(z.enum(['pinned', 'other'])) }),
  panel:   PanelRegionV3Schema });
// What hydration reads from `regions`: the current shape, or an earlier version migrated (its widths, toggles, sort and
// Overview rect kept; version 2's open page expanded, version 1's tree collapsed; P3-G: not floating, no card sizes; P5 O6
// M2: every id lifted with the local machine).
const docked = (panel: z.infer<typeof PanelRegionV3Schema>): LayoutRegions['panel'] => ({ ...panel, floating: false });
export function storedRegionsSchema(local: MachineRef) {
  const lift = liftingWith(local);
  const fromV4 = ({ sidebar, panel, overview, floatingCard }: z.infer<typeof RegionsV4Schema>): LayoutRegions => ({
    version: 5,
    sidebar: { ...sidebar, expandedProjects: sidebar.expandedProjects.map(lift.projectKey) },
    panel,
    overview,
    floatingCard: Object.fromEntries(Object.entries(floatingCard).map(([key, size]) => [lift.cardKey(key), size])),
  });
  return z.union([
    LayoutRegionsSchema,
    RegionsV4Schema.transform(fromV4),
    RegionsV3Schema.transform(({ sidebar, panel, overview }) => fromV4({ version: 4, sidebar, panel: docked(panel), overview, floatingCard: {} })),
    RegionsV2Schema.transform(({ sidebar: { width, collapsed, sort, openProject }, panel, overview }) => fromV4({
      version: 4,
      sidebar: { width, collapsed, sort, expandedProjects: openProject === null ? [] : [openProject] },
      panel: docked(panel),
      overview,
      floatingCard: {},
    })),
    RegionsV1Schema.transform(({ sidebar: { width, collapsed, sort }, panel }) => fromV4({
      version: 4,
      sidebar: { width, collapsed, sort, expandedProjects: [] },
      panel: docked(panel),
      overview: null,
      floatingCard: {},
    })),
  ]);
}
// W12 (§5.2 as amended 2026-10-01, I3): a tab set per project. `sets` holds one pane layout per project with open tabs
// ('none': the tabs of sessions without a project, a New chat's before its project is chosen, and those of no session
// opened there); `current` is the set the strip shows, present in `sets` and possibly one empty pane; a tab id exists
// once across every set; the closed-tab history (⌘⇧T, newest last) is shared. Version 1, one pane layout, is read
// through `StoredMainSchema` and filed by project at hydration (the layout model's `fromV1`).
export const NO_PROJECT = 'none';
// P5 O6 M5: a set is an org project's or a machine's row's (`OrgKeySchema`); one keyed by a project's address is from
// before M5 and migrates as `ProjectKeySchema`'s entries do.
export const TabSetKeySchema = z.union([z.literal(NO_PROJECT), OrgKeySchema, ProjectIdSchema]);
export type TabSetKey = z.infer<typeof TabSetKeySchema>;
const TabSetShape = {
  panes: z.tuple([PaneStateSchema]).or(z.tuple([PaneStateSchema, PaneStateSchema])), focusedPane: z.union([z.literal(0), z.literal(1)]), splitRatio: z.number() };
// P4-B3 (X37; its Decision Log 1): `floating` names the session tab whose pane has yielded into the floating card; absent
// while docked (never written as null or undefined, so a docked set is the value it was before), and `splitRatio`, which
// a float never writes, is the ratio Dock returns. Version 2 is kept: an older build reading a set that floats rejects
// `main.tabs` and falls back to its default tabs. P4-B3x (P4 Decision Log 40): `foldedPanel` marks a float Expand made
// by also folding the right panel (`regions.panel.collapsed`), present only while that fold stands: the panel comes
// back when the float ends, unless the owner opened it meanwhile, which drops the mark (the layout store's
// `reconcileFold`). It persists as the float does, at the same downgrade cost.
const FloatingSchema = z.strictObject({ sessionTabId: z.string(), foldedPanel: z.literal(true).optional() });
export const TabSetSchema = z.strictObject({ ...TabSetShape, floating: FloatingSchema.optional() });
export type TabSet = z.infer<typeof TabSetSchema>;
const ClosedTabsSchema = z.array(TabRefSchema).max(10);
// P5 O6 M2: version 3 holds addresses (TabRefSchema above), and so do its `sets` keys and `current` that are project ids.
// The downgrade cost: an older build rejects version 3 and opens its default tabs, as it does for a set that floats (P4-B3).
export const LayoutMainSchema = z.strictObject({ version: z.literal(3), current: TabSetKeySchema,                // key `main.tabs`
  sets: z.partialRecord(TabSetKeySchema, TabSetSchema), closedTabs: ClosedTabsSchema });
export type LayoutMain = z.infer<typeof LayoutMainSchema>;
// Version 1 as hydration files it by project (the layout model's `fromV1`), its tabs lifted to version 3's.
export const LayoutMainV1Schema = z.strictObject({ version: z.literal(1), ...TabSetShape, closedTabs: ClosedTabsSchema });
export type LayoutMainV1 = z.infer<typeof LayoutMainV1Schema>;
// What versions 1 and 2 held as written: version 2's tabs (bare ids, no machine on a file or artifact tab).
const PaneV2Schema = z.strictObject({ tabs: z.array(TabRefV2Schema), activeTabId: z.string() });
const TabSetV2Shape = { panes: z.tuple([PaneV2Schema]).or(z.tuple([PaneV2Schema, PaneV2Schema])), focusedPane: TabSetShape.focusedPane, splitRatio: TabSetShape.splitRatio };
const TabSetV2Schema = z.strictObject({ ...TabSetV2Shape, floating: FloatingSchema.optional() });
const ClosedTabsV2Schema = z.array(TabRefV2Schema).max(10);
const LayoutMainV2Schema = z.strictObject({ version: z.literal(2), current: TabSetKeySchema, sets: z.partialRecord(TabSetKeySchema, TabSetV2Schema), closedTabs: ClosedTabsV2Schema });
const StoredMainV1Schema = z.strictObject({ version: z.literal(1), ...TabSetV2Shape, closedTabs: ClosedTabsV2Schema });

// ---- P5 O6 M2: lifting what a layout held before O6 -------------------------------------------------------------------
// Every id a layout held before O6 was the local machine's. Lifting is total, so a read never throws: an id already an
// address is kept (nothing before version 3 holds one), and so is an empty one (its schema refuses it).
// `regions.floatingCard`'s key for a main tab (the split's card, P4-B3): `main:<tab id>`.
export const MAIN_CARD_PREFIX = 'main:';
function liftingWith(local: MachineRef) {
  const id = <T extends string>(bare: T): T => (bare === '' || isAddress(bare) ? bare : addressOf(local, bare));
  const tab = (old: TabRefV2): TabRef => {
    switch (old.kind) {
      case 'session':
      case 'agent':
      case 'diff':
      case 'browser': {
        const next = { ...old, appSessionId: id(old.appSessionId) };
        return { ...next, id: tabId(next) };
      }
      case 'file': {
        const next = { ...old, appSessionId: old.appSessionId === null ? null : id(old.appSessionId), machine: local };
        return { ...next, id: tabId(next) };
      }
      case 'artifact': {
        const next = { ...old, machine: local };
        return { ...next, id: tabId(next) };
      }
      default:
        return old;
    }
  };
  // A main-tab id as version 2's `tabId` wrote it, rewritten as `tab` rewrites the tab it names.
  const tabIdOf = (old: string): string => {
    const colon = old.indexOf(':');
    if (colon === -1) return old;
    const kind = old.slice(0, colon);
    const rest = old.slice(colon + 1);
    switch (kind) {
      case 'session':
        return `session:${id(rest)}`;
      case 'agent':
      case 'diff':
      case 'browser': {
        const at = rest.indexOf(':');
        return at === -1 ? old : `${kind}:${id(rest.slice(0, at))}${rest.slice(at)}`;
      }
      case 'file':
      case 'artifact':
        return `${kind}:${local}:${rest}`;
      default:
        return old;
    }
  };
  const setKey = (key: TabSetKey): TabSetKey => (key === NO_PROJECT ? key : id(key));
  const panes = <P extends PaneState[]>(old: z.infer<typeof PaneV2Schema>[], renamed: Map<string, string>): P =>
    old.map((pane) => {
      const tabs = pane.tabs.map((before) => {
        const after = tab(before);
        renamed.set(before.id, after.id);
        return after;
      });
      return { tabs, activeTabId: renamed.get(pane.activeTabId) ?? pane.activeTabId };
    }) as P;
  const set = ({ floating, ...old }: z.infer<typeof TabSetV2Schema>): TabSet => {
    const renamed = new Map<string, string>();
    const next = { ...old, panes: panes<TabSet['panes']>(old.panes, renamed) };
    return floating === undefined ? next : { ...next, floating: { ...floating, sessionTabId: renamed.get(floating.sessionTabId) ?? floating.sessionTabId } };
  };
  return {
    main: (v2: z.infer<typeof LayoutMainV2Schema>): LayoutMain => ({
      version: 3,
      current: setKey(v2.current),
      sets: Object.fromEntries(Object.entries(v2.sets).flatMap(([key, value]) => (value === undefined ? [] : [[setKey(key as TabSetKey), set(value)]]))),
      closedTabs: v2.closedTabs.map(tab),
    }),
    v1: ({ panes: old, closedTabs, ...rest }: z.infer<typeof StoredMainV1Schema>): LayoutMainV1 => ({ ...rest, panes: panes<LayoutMainV1['panes']>(old, new Map()), closedTabs: closedTabs.map(tab) }),
    projectKey: (key: z.infer<typeof ProjectKeySchema>): z.infer<typeof ProjectKeySchema> => (key === 'other' ? key : id(key)),
    cardKey: (key: string): string => (key.startsWith(MAIN_CARD_PREFIX) ? `${MAIN_CARD_PREFIX}${tabIdOf(key.slice(MAIN_CARD_PREFIX.length))}` : key),
    id,
    tabIdOf,
  };
}
// ---- end P5 O6 M2 -----------------------------------------------------------------------------------------------------
// What hydration reads from `main.tabs`, either version: a tab whose kind this build does not name is dropped from the
// panes and the closed-tab history (a pane it leaves empty goes, focusing pane 0; a pane whose active tab it was
// activates its first tab), and everything else is kept. That covers the retired kinds, the Overview's (every layout
// before W5 held it) and the Accounts tab's (W6), and, since P3-G (§D5; the coordinator's condition, 2026-10-12), a
// later build's kind read after a downgrade: one unknown tab no longer fails the whole value back to the default. A
// read that drops a kind other than a retired one warns once. A tab of a known kind that breaks its schema still fails
// the read. The rewrite is total: a pane or tab that is not an object passes through untouched for the schema to
// reject, because a throw here would fail hydration's reads as a whole instead of falling back to the default.
type Entries = { tabs: unknown[]; activeTabId?: unknown };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const KNOWN_KINDS: ReadonlySet<unknown> = new Set(TabRefSchema.options.map((option) => option.shape.kind.value));
const RETIRED_KINDS: ReadonlySet<unknown> = new Set(['overview', 'accounts']);
const hasTabs = (pane: unknown): pane is Entries => isRecord(pane) && Array.isArray(pane.tabs);
const idOf = (tab: unknown) => (isRecord(tab) ? tab.id : undefined);

// One pane layout (version 1's value, or one of version 2's sets) without the tabs `keep` refuses.
function keepTabs(layout: unknown, keep: (tab: unknown) => boolean): unknown {
  if (!isRecord(layout) || !Array.isArray(layout.panes)) return layout;
  let emptied = false;
  const panes = (layout.panes as unknown[]).flatMap((pane) => {
    if (!hasTabs(pane)) return [pane];
    const tabs = pane.tabs.filter(keep);
    if (tabs.length === pane.tabs.length) return [pane];
    if (tabs.length === 0) {
      emptied = true;
      return [];
    }
    const active = tabs.some((t) => idOf(t) === pane.activeTabId) ? pane.activeTabId : (idOf(tabs[0]) ?? '');
    return [{ ...pane, tabs, activeTabId: active }];
  });
  if (!emptied) return { ...layout, panes };
  return { ...layout, panes: panes.length > 0 ? panes : [{ tabs: [], activeTabId: '' }], focusedPane: 0 };
}

function dropUnknownTabs(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const dropped: string[] = [];
  const keep = (tab: unknown) => {
    if (!isRecord(tab) || typeof tab.kind !== 'string' || KNOWN_KINDS.has(tab.kind)) return true;
    if (!RETIRED_KINDS.has(tab.kind)) dropped.push(tab.kind);
    return false;
  };
  const rewritten = isRecord(value.sets)
    ? { ...value, sets: Object.fromEntries(Object.entries(value.sets).map(([key, set]) => [key, keepTabs(set, keep)])) }
    : (keepTabs(value, keep) as Record<string, unknown>);
  const closedTabs = Array.isArray(value.closedTabs) ? (value.closedTabs as unknown[]).filter(keep) : value.closedTabs;
  if (dropped.length > 0) console.warn(`[layout] dropped ${dropped.length} tab(s) of unknown kind: ${[...new Set(dropped)].join(', ')}`);
  return { ...rewritten, closedTabs };
}

// P3-L (M6b; Decision Log 10, 18d): E2's `deliverable` tab (X14), retired at the cutover, reads as the `artifact` tab of
// the same id (the record's id is the artifact's), pinned as it was and active where it was, in the panes and the
// closed-tab history alike; one whose artifact is already open (as an artifact tab, or as an earlier deliverable tab)
// goes, since a tab id exists once across every set. `main.tabs` keeps its version.
type DeliverableTab = { id: string; kind: 'deliverable'; deliverableId: string; pinned: boolean };
const isDeliverableTab = (tab: unknown): tab is DeliverableTab =>
  isRecord(tab) && tab.kind === 'deliverable' && typeof tab.id === 'string' && typeof tab.deliverableId === 'string' && typeof tab.pinned === 'boolean';

function convertDeliverableTabs(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const layouts = isRecord(value.sets) ? Object.values(value.sets) : [value];
  const open = new Set<unknown>(); // every open tab's id that is not a deliverable's, then each converted one kept
  for (const layout of layouts) {
    if (!isRecord(layout) || !Array.isArray(layout.panes)) continue;
    for (const pane of layout.panes as unknown[]) if (hasTabs(pane)) for (const tab of pane.tabs) if (!isDeliverableTab(tab)) open.add(idOf(tab));
  }
  const converted = new WeakSet<object>();
  const convert = (tab: unknown): unknown => {
    if (!isDeliverableTab(tab)) return tab;
    // version 2's artifact tab, as its `tabId` wrote it (P5 O6 M2: a deliverable tab is older than version 3, so it reads lifted)
    const next = { id: `artifact:${tab.deliverableId}`, kind: 'artifact', artifactId: tab.deliverableId, pinned: tab.pinned };
    converted.add(next);
    return next;
  };
  const convertLayout = (layout: unknown): unknown => {
    if (!isRecord(layout) || !Array.isArray(layout.panes)) return layout;
    const panes = (layout.panes as unknown[]).map((pane) => {
      if (!hasTabs(pane)) return pane;
      const tabs = pane.tabs.map(convert);
      const active = pane.tabs.findIndex((tab) => idOf(tab) === pane.activeTabId);
      return { ...pane, tabs, activeTabId: active === -1 ? pane.activeTabId : idOf(tabs[active]) };
    });
    return keepTabs({ ...layout, panes }, (tab) => {
      if (!isRecord(tab) || !converted.has(tab)) return true;
      if (open.has(tab.id)) return false;
      open.add(tab.id);
      return true;
    });
  };
  const rewritten = isRecord(value.sets) ? { ...value, sets: Object.fromEntries(Object.entries(value.sets).map(([key, set]) => [key, convertLayout(set)])) } : (convertLayout(value) as Record<string, unknown>);
  if (!Array.isArray(value.closedTabs)) return rewritten;
  const closed = new Set<unknown>();
  const closedTabs = (value.closedTabs as unknown[]).map(convert).filter((tab) => {
    if (!isRecord(tab) || !converted.has(tab)) return true;
    if (closed.has(tab.id)) return false;
    closed.add(tab.id);
    return true;
  });
  return { ...rewritten, closedTabs };
}

// What hydration reads from `main.tabs` (P5 O6 M2): version 3 as it is; version 2 lifted to version 3, and version 1's
// tabs lifted for `fromV1` to file, with the local machine.
export function storedMainSchema(local: MachineRef) {
  const lift = liftingWith(local);
  return z.preprocess(
    (value) => dropUnknownTabs(convertDeliverableTabs(value)),
    z.union([LayoutMainSchema, LayoutMainV2Schema.transform(lift.main), StoredMainV1Schema.transform(lift.v1)]),
  );
}
// P3-L (whole-branch review; Decision Log 10): E2's `deliverables` panel tool is the `artifacts` tool from the cutover. A
// stored tab of it reads as an Artifacts tab with its own instance id, place and pin, so the selection still names it;
// one in a list that already holds an Artifacts tab (a single-instance tool) goes, the selection following the kept one.
const isPanelRef = (tab: unknown): tab is { id: string; toolId: string } => isRecord(tab) && typeof tab.id === 'string' && typeof tab.toolId === 'string';
function convertDeliverablesRefs(tabs: unknown): { tabs: unknown; renamed: Map<string, string> } {
  const renamed = new Map<string, string>(); // a dropped tab's id to the kept Artifacts tab's
  if (!Array.isArray(tabs)) return { tabs, renamed };
  const kept = (tabs as unknown[]).find((tab) => isPanelRef(tab) && tab.toolId === 'artifacts') as { id: string } | undefined;
  let keptId = kept?.id;
  const next = (tabs as unknown[]).flatMap((tab) => {
    if (!isPanelRef(tab) || tab.toolId !== 'deliverables') return [tab];
    if (keptId !== undefined) {
      renamed.set(tab.id, keptId);
      return [];
    }
    keptId = tab.id;
    return [{ ...tab, toolId: 'artifacts' }];
  });
  return { tabs: next, renamed };
}
export const PanelPinnedSchema = z.preprocess((value) => convertDeliverablesRefs(value).tabs, z.array(PanelTabRefSchema));   // key `panel.pinned`: the global pins (D-10)
export const PanelSessionStateSchema = z.preprocess((value) => {
  if (!isRecord(value)) return value;
  const { tabs, renamed } = convertDeliverablesRefs(value.tabs);
  return { ...value, tabs, ...(typeof value.activeTabId === 'string' && renamed.has(value.activeTabId) ? { activeTabId: renamed.get(value.activeTabId) } : {}) };
}, z.strictObject({ tabs: z.array(PanelTabRefSchema), activeTabId: z.string().nullable() }));   // key `panel.<appSessionId>`
export type PanelSessionState = z.infer<typeof PanelSessionStateSchema>;
export const WindowStateSchema = z.strictObject({ bounds: z.strictObject({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() }),
                                                  maximized: z.boolean(), fullscreen: z.boolean() });              // key `window.main`, main only, never crosses IPC
export type WindowState = z.infer<typeof WindowStateSchema>;

// A set with nothing open: one empty pane (W5), which is also what a set's last tab closing leaves.
export const EMPTY_TAB_SET: TabSet = { panes: [{ tabs: [], activeTabId: '' }], focusedPane: 0, splitRatio: 0.5 };

// Widths are the X7 tokens `--sidebar-w` and `--panel-w`.
export const LAYOUT_DEFAULTS: { regions: LayoutRegions; main: LayoutMain; panelPinned: PanelTabRef[] } = {
  regions: {
    version: 5,
    sidebar: { width: 240, collapsed: false, sort: 'priority', expandedProjects: [] },
    panel: { width: 380, collapsed: false, maximized: false, floating: false },
    overview: null,
    floatingCard: {},
  },
  main: { version: 3, current: NO_PROJECT, sets: { [NO_PROJECT]: EMPTY_TAB_SET }, closedTabs: [] },
  panelPinned: [],
};

// C8a start: the panel summary's collapsed sections (C8a execution document, Interfaces *Layout key
// `summary.sections`*), written by `stores/summary.ts`; an absent key means every section expanded. Outside the
// `panel.` namespace on purpose: C5's hydration reads every `panel.<x>` key as a session's list.
// P3-L (M6b): E2's `deliverables` section is the `artifacts` section from the cutover; a value stored before it reads
// its collapsed `deliverables` as `artifacts`, keeping version 1.
export const SUMMARY_SECTIONS = ['environment', 'push', 'subagents', 'background', 'sources', 'plugins' /* R1 */, 'artifacts' /* E2's deliverables; P3-L */] as const;
export type SummarySection = (typeof SUMMARY_SECTIONS)[number];
const renameDeliverablesSection = (value: unknown): unknown =>
  isRecord(value) && Array.isArray(value.collapsed) ? { ...value, collapsed: (value.collapsed as unknown[]).map((section) => (section === 'deliverables' ? 'artifacts' : section)) } : value;
export const SummarySectionsSchema = z.preprocess(renameDeliverablesSection, z.strictObject({ version: z.literal(1), collapsed: z.array(z.enum(SUMMARY_SECTIONS)) }));   // key `summary.sections`
export type SummarySections = z.infer<typeof SummarySectionsSchema>;
// C8a end

// C10 start: the Terminal tabs "Attach in a terminal tab" opened, by session and background job (C10 execution
// document, M5), so a reloaded or reopened window finds the job's tab (its shell survives, re-adopted under the tab id)
// instead of opening a second `claude attach`; the Terminal tab's own params are not persisted. Written by
// `sessions/attach.ts`; entries whose tab the layout no longer lists are dropped at the next write.
export const AttachTabSchema = z.strictObject({ tabId: z.string(), appSessionId: AppSessionIdSchema, jobId: z.string() });
export type AttachTab = z.infer<typeof AttachTabSchema>;
// P5 O6 M2: version 2's `appSessionId`s are addresses; version 1 reads lifted with the local machine.
export const AttachTabsSchema = z.strictObject({ version: z.literal(2), tabs: z.array(AttachTabSchema) });   // key `sessions.attachTabs`
export const storedAttachTabsSchema = (local: MachineRef) => {
  const lift = liftingWith(local);
  return z.union([
    AttachTabsSchema,
    z.strictObject({ version: z.literal(1), tabs: z.array(AttachTabSchema) }).transform(({ tabs }): z.infer<typeof AttachTabsSchema> => ({
      version: 2,
      tabs: tabs.map((tab) => ({ ...tab, appSessionId: lift.id(tab.appSessionId) })),
    })),
  ]);
};
// C10 end

// P4-B3 start (its Decision Log 22; X5 as amended, additive): what a panel tool persists of a tab, by panel tab id
// (`setPanelParams`; the Artifacts tool's record, so a relaunch shows it again), opaque here and validated by the tool that
// reads it back as a restored instance's `init.params`; and the pin selection while no session is in view, which no
// `panel.<appSessionId>` key holds. Both outside the `panel.` namespace (hydration reads every `panel.<x>` key as a
// session's list), each at its own version 1, no X15 slot.
export const PanelParamsSchema = z.strictObject({ version: z.literal(1), params: z.record(z.string(), z.unknown()) });   // key `panelTools.params`
export const PanelActiveNoSessionSchema = z.strictObject({ version: z.literal(1), activeTabId: z.string().nullable() });   // key `panelTools.activeNoSession`
// P4-B3 end

// UX2-L: the two visible tools per session (or '@none'), icon-row preferences, and the last session shown per project.
// Refs, tool params and keep-across-session tab pins remain in their existing keys. Missing scopes derive the old
// activeTabId; an explicitly empty stack instead shows the summary. Live refs and sessions are checked at derivation.
// P5 O6 M2: version 2 holds addresses: `stacks`' session keys (not '@none'), and `contexts`' tab-set keys that are project
// ids (not 'none') and its sessions. Version 1 reads lifted with the local machine.
const PanelSurfacesShape = {
  stacks: z.record(z.string(), z.array(z.string()).max(2)),
  pinnedTools: z.array(z.string()),
  contexts: z.record(z.string(), AppSessionIdSchema),
};
export const PanelSurfacesSchema = z.strictObject({ version: z.literal(2), ...PanelSurfacesShape });
export type PanelSurfaces = z.infer<typeof PanelSurfacesSchema>;
export const NO_SESSION_SCOPE = '@none'; // a `stacks` key: the panel while no session is in view
export const storedPanelSurfacesSchema = (local: MachineRef) => {
  const lift = liftingWith(local);
  return z.union([
    PanelSurfacesSchema,
    z.strictObject({ version: z.literal(1), ...PanelSurfacesShape }).transform(({ stacks, pinnedTools, contexts }): PanelSurfaces => ({
      version: 2,
      stacks: Object.fromEntries(Object.entries(stacks).map(([scope, ids]) => [scope === NO_SESSION_SCOPE ? scope : lift.id(scope), ids])),
      pinnedTools,
      contexts: Object.fromEntries(Object.entries(contexts).map(([key, session]) => [key === NO_PROJECT ? key : lift.id(key), lift.id(session)])),
    })),
  ]);
};

export const LayoutKeySchema = z.union([
  z.literal('regions'), z.literal('main.tabs'), z.literal('panel.pinned'), z.string().regex(/^panel\.[^.]+$/), z.literal('window.main'),
  // P4-B3 start
  z.literal('panelTools.params'), z.literal('panelTools.activeNoSession'), z.literal('panelTools.surfaces'),
  // P4-B3 end
  // C8a start
  z.literal('summary.sections'),
  // C8a end
  // C7 start
  z.literal('usage.banners'),
  // C7 end
  // C10 start
  z.literal('sessions.attachTabs'),
  // C10 end
  z.literal('sidebar.people'), // P5 O8 M5: SidebarPeopleSchema
]);
// P5 O8 M5 (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The People toggle"): the sidebar rows (org projects'
// and machines' row keys) whose People toggle is on, written by `stores/people.ts`; an absent key means every toggle off.
// A key of its own rather than a field of `SidebarRegionSchema`, which an older build would fail to parse.
export const SidebarPeopleSchema = z.strictObject({ version: z.literal(1), on: z.array(z.string()) });   // key `sidebar.people`
export type SidebarPeople = z.infer<typeof SidebarPeopleSchema>;
export type LayoutKey = z.infer<typeof LayoutKeySchema>;

// C7 start: the composer's file picker and the near-limit banners' dismissals (C7 execution document, Interfaces "X2
// additions"). A picked file carries its bytes (base64) only for an image up to 20 MiB or a PDF up to 32 MiB; anything
// else is answered by path alone (the renderer then mentions it). `kind: 'directory'` answers the chosen directory with
// mediaType `inode/directory` and no data. Key `usage.banners`: the dismissed banner keys, newest last.
export const PickedFileSchema = z.strictObject({ path: z.string(), name: z.string(), bytes: z.number().int(), mediaType: z.string().nullable(), data: z.string().nullable() });
export type PickedFile = z.infer<typeof PickedFileSchema>;
// E11: `pathsOnly` answers every file by path alone, its bytes never read (the Question sheet keeps only paths)
export const PickFilesInputSchema = z.strictObject({ kind: z.enum(['files', 'photos', 'directory']), directory: z.string().nullable(), multiple: z.boolean(), pathsOnly: z.boolean().optional() });
export type PickFilesInput = z.infer<typeof PickFilesInputSchema>;
export const UsageBannersSchema = z.array(z.string()).max(50);
const c7Commands = {
  'layout.pickFiles': { input: PickFilesInputSchema, output: z.strictObject({ files: z.array(PickedFileSchema) }), owner: 'main' },
} as const satisfies Record<`layout.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
// C7 end

// C11 start: the export widget's Save as… (C11 execution document, Interfaces "X2 additions"): a save dialog at
// ~/Downloads/<defaultName>, written through a temporary file and a rename; `saved: false` on cancel.
const c11Commands = {
  'layout.saveTextFile': {
    input: z.strictObject({ defaultName: z.string().min(1).max(255), text: z.string().max(64 * 1024 * 1024) }),
    output: z.union([z.strictObject({ saved: z.literal(true), path: z.string() }), z.strictObject({ saved: z.literal(false) })]),
    owner: 'main',
  },
  // The Settings tab's chord capture (M5 fix wave): while `active`, the window's application menu gives up its key
  // equivalents (webContents.setIgnoreMenuShortcuts), so a chord another action holds reaches the capture instead.
  'layout.captureChords': { input: z.strictObject({ active: z.boolean() }), output: z.void(), owner: 'main' },
} as const satisfies Record<`layout.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
// C11 end

// C12 start: "Quit when idle" (C12 execution document, Interfaces "The quit question"): main holds the quit and the
// page shows the banner. `layout.quitWait` answers, and emits on every change, the busy report main is waiting on (null
// when it is not waiting); `layout.quitWaitAnswer` is the banner's Quit now or Cancel.
export const BusyReportSchema = z.strictObject({ midTurn: z.number().int().nonnegative(), backgroundWork: z.number().int().nonnegative(), busyTerminals: z.number().int().nonnegative(), terminalsUnknown: z.boolean(),
  // E5 start: the absolute paths of every window's dirty file tabs, sorted (E5 execution document, M5)
  unsavedFiles: z.array(z.string()),
  // E5 end
});
export const QuitWaitSchema = z.strictObject({ waiting: BusyReportSchema.nullable() });
export type QuitWait = z.infer<typeof QuitWaitSchema>;
const c12Commands = {
  'layout.quitWait': { input: z.void(), output: QuitWaitSchema, owner: 'main' },
  'layout.quitWaitAnswer': { input: z.strictObject({ action: z.enum(['quitNow', 'cancel']) }), output: z.void(), owner: 'main' },
} as const satisfies Record<`layout.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
// C12 end

// E5 start: the quit guard and unsaved files (E5 execution document, Interfaces "The quit guard and unsaved files (M5)").
// `layout.unsavedFiles` is a window's whole dirty set, sent on every change of it; main keeps one set per window and
// forgets it when the window navigates or closes. `layout.saveAll` (an event) asks every window to save its dirty file
// tabs; `layout.saveAllDone` is a window's answer once every save ended, listing the tabs not clean afterwards.
const e5Commands = {
  'layout.unsavedFiles': { input: z.strictObject({ paths: z.array(z.string()) }), output: z.void(), owner: 'main' },
  'layout.saveAllDone': {
    input: z.strictObject({ requestId: z.string(), failed: z.array(z.strictObject({ path: z.string(), message: z.string() })) }),
    output: z.void(),
    owner: 'main',
  },
} as const satisfies Record<`layout.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
// E5 end

// P3-G start (§D4.1): Mark-up's still of a region the renderer draws (an iframe included, which the compositor paints):
// the sender window's own page captured at the rect, under the comment crop's caps; `image: null` when nothing of the
// rect is inside the window or the capture failed.
const p3gCommands = {
  'layout.captureRegion': { input: z.strictObject({ rect: CaptureRectSchema }), output: CaptureAnswerSchema, owner: 'main' },
} as const satisfies Record<`layout.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
// P3-G end

// P4-B2 start (K6; docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D10): Edit ▸ Undo and Redo, the application
// menu's own items (src/main/menu.ts). `layout.edit` tells the app page holding the focus which was chosen; an editor that
// claims the page's focused element (a deck's or a design's stage, a slide text box on it, the deck's notes) runs it on
// its own stack, and otherwise the page asks main for the native command in itself (`layout.nativeEdit`), as the role
// items ran it.
export const EditOpSchema = z.enum(['undo', 'redo']);
export type EditOp = z.infer<typeof EditOpSchema>;
export const MenuEditSchema = z.strictObject({ op: EditOpSchema });
export type MenuEdit = z.infer<typeof MenuEditSchema>;
const p4b2Commands = {
  'layout.nativeEdit': { input: MenuEditSchema, output: z.void(), owner: 'main' },
} as const satisfies Record<`layout.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
// P4-B2 end

export const commands = {
  'layout.get':          { input: z.strictObject({ key: LayoutKeySchema }), output: z.strictObject({ value: z.unknown().nullable() }), owner: 'main' },
  'layout.set':          { input: z.strictObject({ key: LayoutKeySchema, value: z.unknown() }), output: z.void(), owner: 'main' },
  'layout.list':         { input: z.void(), output: z.strictObject({ keys: z.array(z.string()) }), owner: 'main' },
  'layout.openExternal': { input: z.strictObject({ url: z.string().url() }), output: z.void(), owner: 'main' },   // openExternalUrl (src/main/open-external.ts): http, https, mailto only
  // The actions the page has a handler for (the whole set, replace): the application menu enables exactly these, so an
  // action whose child has not landed renders disabled in the menu as it does in the page (src/main/menu.ts).
  'layout.setEnabledActions': { input: z.strictObject({ actions: z.array(z.enum(ACTION_IDS)) }), output: z.void(), owner: 'main' },
  ...c7Commands, // C7
  ...c11Commands, // C11
  ...c12Commands, // C12
  ...e5Commands, // E5
  ...p3gCommands, // P3-G
  ...p4b2Commands, // P4-B2 K6
} as const satisfies Record<`layout.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'layout.action': z.strictObject({ action: z.enum(ACTION_IDS), arg: z.number().int().nullable() }),   // an application-menu click or accelerator; the renderer runs the action
  'layout.quitWait': QuitWaitSchema, // C12: the report main waits on to quit, or null
  // Edit ▸ Select All, the menu's own item (src/main/menu.ts; sitting finding, 2026-09-30): main has run the editor
  // command in the focused page, and the terminal holding focus, if any, selects its buffer, which that command misses
  'layout.selectAll': z.strictObject({}),
  // E5 start: main asks every window to save its dirty file tabs (the quit question's Save all)
  'layout.saveAll': z.strictObject({ requestId: z.string() }),
  // E5 end
  'layout.edit': MenuEditSchema, // P4-B2 K6: Edit ▸ Undo or Redo, to the focused app page alone
} as const satisfies Record<`layout.${string}`, z.ZodType>;
