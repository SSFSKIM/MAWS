// X2 `layout.*` (C5 execution document, Interfaces "X2 — `layout.*`"). C5 owns the namespace: a key/value store over
// main's `<userData>/layout.json` (§4.4 as amended; wave-2 ledger ruling 10), one opaque JSON value per key, whose
// shapes are defined here and validated by the reader. There is no `layout.changed`: the renderer is the only writer
// and hydrates from the snapshot. `window.main` is main's own key and never crosses IPC.
import * as z from 'zod';
import { AgentIdSchema, AppSessionIdSchema, ProjectIdSchema } from '../../graph/ids';
import { ACTION_IDS } from '../../keymap/actions';
import type { CommandSpec } from './common';

// W5 (§5.2 as amended 2026-10-01): the Overview is no longer a tab; it floats over the main area (`regions.overview`).
// A stored `main.tabs` that still holds its tab is read through `StoredMainSchema`, which drops it. W6 (E1): the
// Accounts tab retired the same way; its content is the top bar's usage popover.
export const TabRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id: z.string(), kind: z.literal('session'), appSessionId: AppSessionIdSchema, pinned: z.boolean() }),
  z.strictObject({ id: z.string(), kind: z.literal('agent'),   appSessionId: AppSessionIdSchema, agentId: AgentIdSchema, pinned: z.boolean() }),   // a child's transcript in the main area (C6 child variant); C8's drill-in stays in the panel
  z.strictObject({ id: z.string(), kind: z.literal('file'),    path: z.string(), line: z.number().int().nullable(), appSessionId: AppSessionIdSchema.nullable(), pinned: z.boolean() }),
  z.strictObject({ id: z.string(), kind: z.literal('diff'),    appSessionId: AppSessionIdSchema, ref: z.string(), pinned: z.boolean() }),
  z.strictObject({ id: z.literal('diagnostics'), kind: z.literal('diagnostics'), pinned: z.boolean() }),
  z.strictObject({ id: z.literal('settings'), kind: z.literal('settings'), section: z.enum(['engine', 'gateway', 'keyboard', 'appearance', 'notifications']).nullable(), pinned: z.literal(false) }),   // C11: singleton; a second openTab activates it and updates `section`; titled 'Settings'
]);
export type TabRef = z.infer<typeof TabRefSchema>;
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
      return `file:${tab.path}`;
    case 'diff':
      return `diff:${tab.appSessionId}:${tab.ref}`;
    case 'diagnostics':
      return 'diagnostics';
    case 'settings':
      return 'settings';
  }
}

// Tab kinds the pin control never applies to: C11's singleton (the Accounts tab, the other, retired with W6).
export const UNPINNABLE_KINDS: ReadonlySet<TabRef['kind']> = new Set(['settings']);

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
export const ProjectKeySchema = z.union([ProjectIdSchema, z.literal('other')]);
// The floating Overview's rect, in px from the top left of the main area under the top bar (null: the default place).
export const OverviewRectSchema = z.strictObject({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() });
export type OverviewRect = z.infer<typeof OverviewRectSchema>;
const PanelRegionSchema = z.strictObject({ width: z.number().int(), collapsed: z.boolean(), maximized: z.boolean() });
export const LayoutRegionsSchema = z.strictObject({ version: z.literal(3),                                       // key `regions`
  sidebar: z.strictObject({ width: z.number().int(), collapsed: z.boolean(), sort: z.enum(['priority', 'recency']), expandedProjects: z.array(ProjectKeySchema) }),
  panel:   PanelRegionSchema,
  overview: OverviewRectSchema.nullable() });
export type LayoutRegions = z.infer<typeof LayoutRegionsSchema>;
const RegionsV2Schema = z.strictObject({ version: z.literal(2),
  sidebar: z.strictObject({ width: z.number().int(), collapsed: z.boolean(), sort: z.enum(['priority', 'recency']), openProject: ProjectKeySchema.nullable() }),
  panel:   PanelRegionSchema,
  overview: OverviewRectSchema.nullable() });
const RegionsV1Schema = z.strictObject({ version: z.literal(1),
  sidebar: z.strictObject({ width: z.number().int(), collapsed: z.boolean(), sort: z.enum(['priority', 'recency']),
                            collapsedProjects: z.array(ProjectIdSchema), collapsedSections: z.array(z.enum(['pinned', 'other'])) }),
  panel:   PanelRegionSchema });
// What hydration reads from `regions`: the current shape, or an earlier version migrated (its widths, toggles, sort and
// Overview rect kept; version 2's open page expanded, version 1's tree collapsed).
export const StoredRegionsSchema = z.union([
  LayoutRegionsSchema,
  RegionsV2Schema.transform(({ sidebar: { width, collapsed, sort, openProject }, panel, overview }): LayoutRegions => ({
    version: 3,
    sidebar: { width, collapsed, sort, expandedProjects: openProject === null ? [] : [openProject] },
    panel,
    overview,
  })),
  RegionsV1Schema.transform(({ sidebar: { width, collapsed, sort }, panel }): LayoutRegions => ({ version: 3, sidebar: { width, collapsed, sort, expandedProjects: [] }, panel, overview: null })),
]);
export const LayoutMainSchema = z.strictObject({ version: z.literal(1),                                          // key `main.tabs`
  panes: z.tuple([PaneStateSchema]).or(z.tuple([PaneStateSchema, PaneStateSchema])), focusedPane: z.union([z.literal(0), z.literal(1)]), splitRatio: z.number(),
  closedTabs: z.array(TabRefSchema).max(10) });                                                                    // ⌘⇧T history, newest last
export type LayoutMain = z.infer<typeof LayoutMainSchema>;
// What hydration reads from `main.tabs`: the retired tab kinds, the Overview's (every layout before W5 held it) and the
// Accounts tab's (W6), are dropped from the panes and the closed-tab history (a pane it leaves empty goes; a pane whose
// active tab it was activates its first tab). The rewrite is total: a pane or tab that is not an object passes through
// untouched for the schema to reject, because a throw here would fail hydration's reads as a whole instead of falling
// back to the default.
type Entries = { tabs: unknown[]; activeTabId?: unknown };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const RETIRED_KINDS: ReadonlySet<unknown> = new Set(['overview', 'accounts']);
const isRetiredRef = (tab: unknown) => isRecord(tab) && RETIRED_KINDS.has(tab.kind);
const hasTabs = (pane: unknown): pane is Entries => isRecord(pane) && Array.isArray(pane.tabs);
const idOf = (tab: unknown) => (isRecord(tab) ? tab.id : undefined);
export const StoredMainSchema = z.preprocess((value) => {
  if (!isRecord(value) || !Array.isArray(value.panes)) return value;
  const panes = (value.panes as unknown[]).map((pane) => {
    if (!hasTabs(pane)) return pane;
    const tabs = pane.tabs.filter((t) => !isRetiredRef(t));
    const active = tabs.some((t) => idOf(t) === pane.activeTabId) ? pane.activeTabId : (idOf(tabs[0]) ?? '');
    return { ...pane, tabs, activeTabId: active };
  });
  const kept = panes.filter((pane) => !hasTabs(pane) || pane.tabs.length > 0);
  const closedTabs = Array.isArray(value.closedTabs) ? (value.closedTabs as unknown[]).filter((t) => !isRetiredRef(t)) : value.closedTabs;
  return { ...value, panes: kept.length > 0 ? kept : [{ tabs: [], activeTabId: '' }], focusedPane: kept.length < panes.length ? 0 : value.focusedPane, closedTabs };
}, LayoutMainSchema);
export const PanelPinnedSchema = z.array(PanelTabRefSchema);                                                      // key `panel.pinned`: the global pins (D-10)
export const PanelSessionStateSchema = z.strictObject({ tabs: z.array(PanelTabRefSchema), activeTabId: z.string().nullable() });   // key `panel.<appSessionId>`
export type PanelSessionState = z.infer<typeof PanelSessionStateSchema>;
export const WindowStateSchema = z.strictObject({ bounds: z.strictObject({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() }),
                                                  maximized: z.boolean(), fullscreen: z.boolean() });              // key `window.main`, main only, never crosses IPC
export type WindowState = z.infer<typeof WindowStateSchema>;

// Widths are the X7 tokens `--sidebar-w` and `--panel-w`.
export const LAYOUT_DEFAULTS: { regions: LayoutRegions; main: LayoutMain; panelPinned: PanelTabRef[] } = {
  regions: {
    version: 3,
    sidebar: { width: 300, collapsed: false, sort: 'priority', expandedProjects: [] },
    panel: { width: 380, collapsed: false, maximized: false },
    overview: null,
  },
  main: { version: 1, panes: [{ tabs: [], activeTabId: '' }], focusedPane: 0, splitRatio: 0.5, closedTabs: [] },
  panelPinned: [],
};

// C8a start: the panel summary's collapsed sections (C8a execution document, Interfaces *Layout key
// `summary.sections`*), written by `stores/summary.ts`; an absent key means every section expanded. Outside the
// `panel.` namespace on purpose: C5's hydration reads every `panel.<x>` key as a session's list.
export const SUMMARY_SECTIONS = ['environment', 'push', 'subagents', 'background', 'sources'] as const;
export type SummarySection = (typeof SUMMARY_SECTIONS)[number];
export const SummarySectionsSchema = z.strictObject({ version: z.literal(1), collapsed: z.array(z.enum(SUMMARY_SECTIONS)) });   // key `summary.sections`
export type SummarySections = z.infer<typeof SummarySectionsSchema>;
// C8a end

// C10 start: the Terminal tabs "Attach in a terminal tab" opened, by session and background job (C10 execution
// document, M5), so a reloaded or reopened window finds the job's tab (its shell survives, re-adopted under the tab id)
// instead of opening a second `claude attach`; the Terminal tab's own params are not persisted. Written by
// `sessions/attach.ts`; entries whose tab the layout no longer lists are dropped at the next write.
export const AttachTabSchema = z.strictObject({ tabId: z.string(), appSessionId: AppSessionIdSchema, jobId: z.string() });
export type AttachTab = z.infer<typeof AttachTabSchema>;
export const AttachTabsSchema = z.strictObject({ version: z.literal(1), tabs: z.array(AttachTabSchema) });   // key `sessions.attachTabs`
// C10 end

export const LayoutKeySchema = z.union([
  z.literal('regions'), z.literal('main.tabs'), z.literal('panel.pinned'), z.string().regex(/^panel\.[^.]+$/), z.literal('window.main'),
  // C8a start
  z.literal('summary.sections'),
  // C8a end
  // C7 start
  z.literal('usage.banners'),
  // C7 end
  // C10 start
  z.literal('sessions.attachTabs'),
  // C10 end
]);
export type LayoutKey = z.infer<typeof LayoutKeySchema>;

// C7 start: the composer's file picker and the near-limit banners' dismissals (C7 execution document, Interfaces "X2
// additions"). A picked file carries its bytes (base64) only for an image up to 20 MiB or a PDF up to 32 MiB; anything
// else is answered by path alone (the renderer then mentions it). `kind: 'directory'` answers the chosen directory with
// mediaType `inode/directory` and no data. Key `usage.banners`: the dismissed banner keys, newest last.
export const PickedFileSchema = z.strictObject({ path: z.string(), name: z.string(), bytes: z.number().int(), mediaType: z.string().nullable(), data: z.string().nullable() });
export type PickedFile = z.infer<typeof PickedFileSchema>;
export const PickFilesInputSchema = z.strictObject({ kind: z.enum(['files', 'photos', 'directory']), directory: z.string().nullable(), multiple: z.boolean() });
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
export const BusyReportSchema = z.strictObject({ midTurn: z.number().int().nonnegative(), backgroundWork: z.number().int().nonnegative(), busyTerminals: z.number().int().nonnegative(), terminalsUnknown: z.boolean() });
export const QuitWaitSchema = z.strictObject({ waiting: BusyReportSchema.nullable() });
export type QuitWait = z.infer<typeof QuitWaitSchema>;
const c12Commands = {
  'layout.quitWait': { input: z.void(), output: QuitWaitSchema, owner: 'main' },
  'layout.quitWaitAnswer': { input: z.strictObject({ action: z.enum(['quitNow', 'cancel']) }), output: z.void(), owner: 'main' },
} as const satisfies Record<`layout.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
// C12 end

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
} as const satisfies Record<`layout.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'layout.action': z.strictObject({ action: z.enum(ACTION_IDS), arg: z.number().int().nullable() }),   // an application-menu click or accelerator; the renderer runs the action
  'layout.quitWait': QuitWaitSchema, // C12: the report main waits on to quit, or null
  // Edit ▸ Select All, the menu's own item (src/main/menu.ts; sitting finding, 2026-09-30): main has run the editor
  // command in the focused page, and the terminal holding focus, if any, selects its buffer, which that command misses
  'layout.selectAll': z.strictObject({}),
} as const satisfies Record<`layout.${string}`, z.ZodType>;
