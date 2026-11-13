// UX wave U8b (docs/doperpowers/plans/2026-11-12-ux-wave-U8b-column-and-tabs.md, M1 decision 2; the wave's UC-14): the
// side column's stored values as this build writes them under the keys build F knows, held against F's reader frozen in
// test/support/layout-build-f.ts. The store's acts are held against the same copies in the renderer's suite
// (src/renderer/src/panel/side-groups.test.ts), which this project cannot import.
import { describe, expect, it } from 'vitest';
import {
  F_LayoutRegionsSchema,
  F_PanelActiveNoSessionSchema,
  F_PanelParamsSchema,
  F_PanelPinnedSchema,
  F_PanelSessionStateSchema,
  F_PanelSurfacesSchema,
} from '../../../../test/support/layout-build-f';
import {
  CardsOpenSchema,
  LAYOUT_DEFAULTS,
  LayoutKeySchema,
  LayoutRegionsSchema,
  PanelActiveNoSessionSchema,
  PanelGroupsSchema,
  PanelParamsSchema,
  PanelPinnedSchema,
  PanelSessionStateSchema,
  PanelSurfacesSchema,
  PanelWidthsSchema,
} from './layout';

const A = 'MachineRefForTests00000/app-a';
const review = { id: 'review:aaaa0001', toolId: 'review', pinned: false };
const files = { id: 'files:aaaa0002', toolId: 'files', pinned: false };
const t1 = { id: 'terminal:aaaa0003', toolId: 'terminal', pinned: false };
const t2 = { id: 'terminal:aaaa0004', toolId: 'terminal', pinned: false };
const pin = { id: 'terminal:aaaa0005', toolId: 'terminal', pinned: true };
const surfaces = (stacks: Record<string, string[]>) => ({ version: 2, stacks, pinnedTools: [], contexts: {} });

describe('what this build writes under the keys build F reads (Interfaces §A, §G)', () => {
  it('the tabs in view as stacks: none while hidden, one, two groups, two tabs of one tool', () => {
    const written: Record<string, string[]>[] = [{ [A]: [] }, { [A]: [review.id] }, { [A]: [review.id, files.id] }, { [A]: [t1.id, t2.id] }, { '@none': [pin.id] }];
    for (const stacks of written) {
      expect(F_PanelSurfacesSchema.safeParse(surfaces(stacks)).success).toBe(true);
    }
  });

  it('a strip of every tab open with its selection kept while hidden, the pins, the selection with no session', () => {
    expect(F_PanelSessionStateSchema.safeParse({ tabs: [review, files, t1, t2], activeTabId: review.id }).success).toBe(true);
    expect(F_PanelSessionStateSchema.safeParse({ tabs: [], activeTabId: null }).success).toBe(true);
    expect(F_PanelPinnedSchema.safeParse([pin]).success).toBe(true);
    expect(F_PanelActiveNoSessionSchema.safeParse({ version: 1, activeTabId: pin.id }).success).toBe(true);
    expect(F_PanelParamsSchema.safeParse({ version: 1, params: { [review.id]: { scope: 'all' } } }).success).toBe(true);
  });

  it('regions at version 5 with the width last dragged, or 380 for automatic', () => {
    for (const width of [380, 512, 360]) {
      expect(F_LayoutRegionsSchema.safeParse({ ...LAYOUT_DEFAULTS.regions, panel: { ...LAYOUT_DEFAULTS.regions.panel, width } }).success).toBe(true);
    }
    expect(F_LayoutRegionsSchema.safeParse({ ...LAYOUT_DEFAULTS.regions, panel: { ...LAYOUT_DEFAULTS.regions.panel, width: 512.5 } }).success).toBe(false);
  });

  it('F refuses what this build must never write: a third tab in view, a field added to a ref, another version', () => {
    expect(F_PanelSurfacesSchema.safeParse(surfaces({ [A]: [review.id, files.id, t1.id] })).success).toBe(false);
    expect(F_PanelSessionStateSchema.safeParse({ tabs: [{ ...review, group: 'lower' }], activeTabId: null }).success).toBe(false);
    expect(F_PanelSurfacesSchema.safeParse({ ...surfaces({}), version: 3 }).success).toBe(false);
    expect(F_LayoutRegionsSchema.safeParse({ ...LAYOUT_DEFAULTS.regions, version: 6 }).success).toBe(false);
  });

  // Constraint 2: no existing schema is edited. Over values each copy accepts and refuses, today's schema of the key
  // answers as F's does.
  it('the live schemas of those keys still answer as F’s copies do', () => {
    const cases: [{ safeParse(v: unknown): { success: boolean } }, { safeParse(v: unknown): { success: boolean } }, unknown[]][] = [
      [PanelSurfacesSchema, F_PanelSurfacesSchema, [surfaces({ [A]: [review.id, files.id] }), surfaces({ [A]: [review.id, files.id, t1.id] }), { ...surfaces({}), version: 3 }, { ...surfaces({}), extra: 1 }]],
      [PanelSessionStateSchema, F_PanelSessionStateSchema, [{ tabs: [review], activeTabId: review.id }, { tabs: [{ ...review, group: 'lower' }], activeTabId: null }, { tabs: [], activeTabId: 1 }]],
      [PanelPinnedSchema, F_PanelPinnedSchema, [[pin], [{ ...pin, pinned: 'yes' }]]],
      [PanelActiveNoSessionSchema, F_PanelActiveNoSessionSchema, [{ version: 1, activeTabId: null }, { version: 2, activeTabId: null }]],
      [PanelParamsSchema, F_PanelParamsSchema, [{ version: 1, params: {} }, { version: 1, params: [] }]],
      [LayoutRegionsSchema, F_LayoutRegionsSchema, [LAYOUT_DEFAULTS.regions, { ...LAYOUT_DEFAULTS.regions, version: 6 }, { ...LAYOUT_DEFAULTS.regions, panel: { ...LAYOUT_DEFAULTS.regions.panel, groups: 2 } }]],
    ];
    for (const [live, frozen, values] of cases) for (const value of values) expect(live.safeParse(value).success).toBe(frozen.safeParse(value).success);
  });
});

describe('the three keys this landing adds', () => {
  it('are layout keys outside the panel namespace, which hydration reads as one session’s list', () => {
    for (const key of ['cards.open', 'panelTools.widths', 'panelTools.groups']) {
      expect(LayoutKeySchema.safeParse(key).success).toBe(true);
      expect(/^panel\.[^.]+$/.test(key)).toBe(false);
    }
  });

  it('hold their shapes: the open cards, two widths or automatic, a lower group per scope', () => {
    expect(CardsOpenSchema.safeParse({ version: 1, open: ['environment', 'connectors'] }).success).toBe(true);
    expect(CardsOpenSchema.safeParse({ version: 1, open: ['environment', 'artifacts'] }).success).toBe(false); // an unknown card
    expect(PanelWidthsSchema.safeParse({ version: 1, wide: null, narrow: 380 }).success).toBe(true);
    expect(PanelWidthsSchema.safeParse({ version: 1, wide: 512.5, narrow: null }).success).toBe(false);
    expect(PanelGroupsSchema.safeParse({ version: 1, lower: { [A]: { tabs: [files.id, t1.id], share: 0.5 } } }).success).toBe(true);
    expect(PanelGroupsSchema.safeParse({ version: 1, lower: { [A]: { tabs: [], share: 0.5 } } }).success).toBe(false); // never empty
    expect(PanelGroupsSchema.safeParse({ version: 1, lower: { [A]: { tabs: [files.id], share: 0.9 } } }).success).toBe(false); // 0.2 to 0.8
  });
});
