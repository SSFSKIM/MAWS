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
  }
}

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

export const LayoutKeySchema = z.union([z.literal('regions'), z.literal('main.tabs'), z.literal('panel.pinned'), z.string().regex(/^panel\.[^.]+$/), z.literal('window.main')]);
export type LayoutKey = z.infer<typeof LayoutKeySchema>;

export const commands = {
  'layout.get':          { input: z.strictObject({ key: LayoutKeySchema }), output: z.strictObject({ value: z.unknown().nullable() }), owner: 'main' },
  'layout.set':          { input: z.strictObject({ key: LayoutKeySchema, value: z.unknown() }), output: z.void(), owner: 'main' },
  'layout.list':         { input: z.void(), output: z.strictObject({ keys: z.array(z.string()) }), owner: 'main' },
  'layout.openExternal': { input: z.strictObject({ url: z.string().url() }), output: z.void(), owner: 'main' },   // openExternalUrl (src/main/open-external.ts): http, https, mailto only
} as const satisfies Record<`layout.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'layout.action': z.strictObject({ action: z.enum(ACTION_IDS), arg: z.number().int().nullable() }),   // an application-menu click or accelerator; the renderer runs the action
} as const satisfies Record<`layout.${string}`, z.ZodType>;
