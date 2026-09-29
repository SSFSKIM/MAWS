// X2 `layout.*` (C5 execution document, Interfaces "X2 — `layout.*`"). C5 owns the namespace: a key/value store over
// main's `<userData>/layout.json` (§4.4 as amended; wave-2 ledger ruling 10), one opaque JSON value per key, whose
// shapes are defined here and validated by the reader. There is no `layout.changed`: the renderer is the only writer
// and hydrates from the snapshot. `window.main` is main's own key and never crosses IPC.
import * as z from 'zod';
import { AgentIdSchema, AppSessionIdSchema, ProjectIdSchema } from '../../graph/ids';
import { ACTION_IDS } from '../../keymap/actions';
import type { CommandSpec } from './common';

export const TabRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id: z.literal('overview'), kind: z.literal('overview'), pinned: z.literal(true) }),
  z.strictObject({ id: z.string(), kind: z.literal('session'), appSessionId: AppSessionIdSchema, pinned: z.boolean() }),
  z.strictObject({ id: z.string(), kind: z.literal('agent'),   appSessionId: AppSessionIdSchema, agentId: AgentIdSchema, pinned: z.boolean() }),   // a child's transcript in the main area (C6 child variant); C8's drill-in stays in the panel
  z.strictObject({ id: z.string(), kind: z.literal('file'),    path: z.string(), line: z.number().int().nullable(), appSessionId: AppSessionIdSchema.nullable(), pinned: z.boolean() }),
  z.strictObject({ id: z.string(), kind: z.literal('diff'),    appSessionId: AppSessionIdSchema, ref: z.string(), pinned: z.boolean() }),
  z.strictObject({ id: z.literal('diagnostics'), kind: z.literal('diagnostics'), pinned: z.boolean() }),
  z.strictObject({ id: z.literal('accounts'), kind: z.literal('accounts'), pinned: z.literal(false) }),   // C11 (eighth ask): singleton, closable, never pinned, titled 'Accounts'
  z.strictObject({ id: z.literal('settings'), kind: z.literal('settings'), section: z.enum(['engine', 'gateway', 'keyboard', 'appearance', 'notifications']).nullable(), pinned: z.literal(false) }),   // C11: singleton; a second openTab activates it and updates `section`; titled 'Settings'
]);
export type TabRef = z.infer<typeof TabRefSchema>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type TabTarget = DistributiveOmit<TabRef, 'id' | 'pinned'>; // what `openTab` is given

// Deterministic ids: a session has at most one tab across both panes.
export function tabId(tab: TabTarget): string {
  switch (tab.kind) {
    case 'overview':
      return 'overview';
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
    case 'accounts':
      return 'accounts';
    case 'settings':
      return 'settings';
  }
}

// Tab kinds the pin control never applies to: Overview is pinned for good, C11's two singletons never are.
export const UNPINNABLE_KINDS: ReadonlySet<TabRef['kind']> = new Set(['overview', 'accounts', 'settings']);

export const PaneStateSchema = z.strictObject({ tabs: z.array(TabRefSchema).min(1), activeTabId: z.string() });
export type PaneState = z.infer<typeof PaneStateSchema>;
export const PanelTabRefSchema = z.strictObject({ id: z.string(), toolId: z.string(), pinned: z.boolean() });      // X5: what C5 persists of a panel tab; C8 owns the rest
export type PanelTabRef = z.infer<typeof PanelTabRefSchema>;

export const LayoutRegionsSchema = z.strictObject({ version: z.literal(1),                                       // key `regions`
  sidebar: z.strictObject({ width: z.number().int(), collapsed: z.boolean(), sort: z.enum(['priority', 'recency']),
                            collapsedProjects: z.array(ProjectIdSchema), collapsedSections: z.array(z.enum(['pinned', 'other'])) }),
  panel:   z.strictObject({ width: z.number().int(), collapsed: z.boolean(), maximized: z.boolean() }) });
export type LayoutRegions = z.infer<typeof LayoutRegionsSchema>;
export const LayoutMainSchema = z.strictObject({ version: z.literal(1),                                          // key `main.tabs`
  panes: z.tuple([PaneStateSchema]).or(z.tuple([PaneStateSchema, PaneStateSchema])), focusedPane: z.union([z.literal(0), z.literal(1)]), splitRatio: z.number(),
  closedTabs: z.array(TabRefSchema).max(10) });                                                                    // ⌘⇧T history, newest last
export type LayoutMain = z.infer<typeof LayoutMainSchema>;
export const PanelPinnedSchema = z.array(PanelTabRefSchema);                                                      // key `panel.pinned`: the global pins (D-10)
export const PanelSessionStateSchema = z.strictObject({ tabs: z.array(PanelTabRefSchema), activeTabId: z.string().nullable() });   // key `panel.<appSessionId>`
export type PanelSessionState = z.infer<typeof PanelSessionStateSchema>;
export const WindowStateSchema = z.strictObject({ bounds: z.strictObject({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() }),
                                                  maximized: z.boolean(), fullscreen: z.boolean() });              // key `window.main`, main only, never crosses IPC
export type WindowState = z.infer<typeof WindowStateSchema>;

const OVERVIEW_TAB = { id: 'overview', kind: 'overview', pinned: true } as const satisfies TabRef;
// Widths are the X7 tokens `--sidebar-w` and `--panel-w`.
export const LAYOUT_DEFAULTS: { regions: LayoutRegions; main: LayoutMain; panelPinned: PanelTabRef[] } = {
  regions: {
    version: 1,
    sidebar: { width: 300, collapsed: false, sort: 'priority', collapsedProjects: [], collapsedSections: [] },
    panel: { width: 380, collapsed: false, maximized: false },
  },
  main: { version: 1, panes: [{ tabs: [OVERVIEW_TAB], activeTabId: 'overview' }], focusedPane: 0, splitRatio: 0.5, closedTabs: [] },
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
  // C10 start
  z.literal('sessions.attachTabs'),
  // C10 end
]);
export type LayoutKey = z.infer<typeof LayoutKeySchema>;

export const commands = {
  'layout.get':          { input: z.strictObject({ key: LayoutKeySchema }), output: z.strictObject({ value: z.unknown().nullable() }), owner: 'main' },
  'layout.set':          { input: z.strictObject({ key: LayoutKeySchema, value: z.unknown() }), output: z.void(), owner: 'main' },
  'layout.list':         { input: z.void(), output: z.strictObject({ keys: z.array(z.string()) }), owner: 'main' },
  'layout.openExternal': { input: z.strictObject({ url: z.string().url() }), output: z.void(), owner: 'main' },   // openExternalUrl (src/main/open-external.ts): http, https, mailto only
  // The actions the page has a handler for (the whole set, replace): the application menu enables exactly these, so an
  // action whose child has not landed renders disabled in the menu as it does in the page (src/main/menu.ts).
  'layout.setEnabledActions': { input: z.strictObject({ actions: z.array(z.enum(ACTION_IDS)) }), output: z.void(), owner: 'main' },
} as const satisfies Record<`layout.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'layout.action': z.strictObject({ action: z.enum(ACTION_IDS), arg: z.number().int().nullable() }),   // an application-menu click or accelerator; the renderer runs the action
} as const satisfies Record<`layout.${string}`, z.ZodType>;
