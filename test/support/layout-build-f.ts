// Build F's reader of the side column's values, frozen (UX wave U8b, docs/doperpowers/plans/2026-11-12-ux-wave-U8b-column-and-tabs.md,
// M1 decision 2; the wave's UC-14). Build F (`f1852de3a`) is the build on the owner's machines, which may open a profile
// after a trial of the wave's build; a value it fails to parse costs it that key (its `hydrate` falls back to the
// default). These are transcribed from `src/shared/ipc/schema/layout.ts` at `f1852de3a`, never imported from it: a parse
// with today's live schemas is no check against F. The branded ids are plain strings here (a brand is a type only), and
// the panel lists' preprocessing is left out (it renames the retired `deliverables` tool, which no build since writes).
// Delete this file with its tests when F is no longer a build to go back to (the owner's word).
import * as z from 'zod';

const Id = z.string().min(1); // F's AppSessionIdSchema, ProjectIdSchema and OrgKeySchema: z.string().min(1) branded

export const F_PanelTabRefSchema = z.strictObject({ id: z.string(), toolId: z.string(), pinned: z.boolean() });
// key `panel.pinned`
export const F_PanelPinnedSchema = z.array(F_PanelTabRefSchema);
// key `panel.<appSessionId>`
export const F_PanelSessionStateSchema = z.strictObject({ tabs: z.array(F_PanelTabRefSchema), activeTabId: z.string().nullable() });
// key `panelTools.activeNoSession`
export const F_PanelActiveNoSessionSchema = z.strictObject({ version: z.literal(1), activeTabId: z.string().nullable() });
// key `panelTools.params`
export const F_PanelParamsSchema = z.strictObject({ version: z.literal(1), params: z.record(z.string(), z.unknown()) });
// key `panelTools.surfaces`, version 2
export const F_PanelSurfacesSchema = z.strictObject({
  version: z.literal(2),
  stacks: z.record(z.string(), z.array(z.string()).max(2)),
  pinnedTools: z.array(z.string()),
  contexts: z.record(z.string(), Id),
});
// key `regions`, version 5 whole
const ProjectKeySchema = z.union([z.literal('other'), Id]); // F's: 'other', an org key or a project id
export const F_LayoutRegionsSchema = z.strictObject({
  version: z.literal(5),
  sidebar: z.strictObject({ width: z.number().int(), collapsed: z.boolean(), sort: z.enum(['priority', 'recency']), expandedProjects: z.array(ProjectKeySchema) }),
  panel: z.strictObject({ width: z.number().int(), collapsed: z.boolean(), maximized: z.boolean(), floating: z.boolean() }),
  overview: z.strictObject({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() }).nullable(),
  floatingCard: z.record(z.string(), z.strictObject({ w: z.number().int(), h: z.number().int() })),
});

// The schema F reads a key this build writes with; null for a key F does not read (it keeps it in the file untouched).
export function buildFSchemaOf(key: string): z.ZodType | null {
  if (key === 'regions') return F_LayoutRegionsSchema;
  if (key === 'panel.pinned') return F_PanelPinnedSchema;
  if (/^panel\.[^.]+$/.test(key)) return F_PanelSessionStateSchema;
  if (key === 'panelTools.activeNoSession') return F_PanelActiveNoSessionSchema;
  if (key === 'panelTools.params') return F_PanelParamsSchema;
  if (key === 'panelTools.surfaces') return F_PanelSurfacesSchema;
  return null;
}

// F's reading of what a scope has in view (`surfaceTabs` and `normalizeSurfaceStack` of `panel/surface-model.ts` at
// `f1852de3a`), over the values it parsed: the stored stack, else the selection; ids that are no ref dropped, one tab
// per tool, two at most. Its two ids are F's two stacked surfaces, upper first.
export function F_surfaceTabIds(refs: readonly { id: string; toolId: string }[], stack: readonly string[] | undefined, activeTabId: string | null): string[] {
  const ids = stack ?? (activeTabId === null ? [] : [activeTabId]);
  const tools = new Set<string>();
  return ids.filter((id) => {
    const ref = refs.find((tab) => tab.id === id);
    if (!ref || tools.has(ref.toolId)) return false;
    tools.add(ref.toolId);
    return true;
  }).slice(0, 2);
}
