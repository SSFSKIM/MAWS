// P3-G (§D1.3): a floating panel stands in the main column as a maximized one does: the grid gives it the main column's
// place, and the sidebar is sized against the window less main's floor alone.
import { describe, expect, it } from 'vitest';
import { LAYOUT_DEFAULTS, type LayoutRegions } from '@shared/ipc/schema/layout';
import { gridColumns, regionWidths } from './regions';

const regions = (panel: Partial<LayoutRegions['panel']>, sidebar: Partial<LayoutRegions['sidebar']> = {}): LayoutRegions => ({
  ...LAYOUT_DEFAULTS.regions,
  sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, ...sidebar },
  panel: { ...LAYOUT_DEFAULTS.regions.panel, ...panel },
});

describe('regions while floating', () => {
  it('gives the floating panel the main column’s place, as maximized does', () => {
    expect(gridColumns(regions({ floating: true }), 1440)).toBe('300px 0px minmax(0, 1fr)');
    expect(gridColumns(regions({ floating: true }), 1440)).toBe(gridColumns(regions({ maximized: true }), 1440));
    expect(gridColumns(regions({ floating: true }, { collapsed: true }), 1440)).toBe('0px 0px minmax(0, 1fr)');
    expect(gridColumns(regions({}), 1440)).toBe('300px minmax(0, 1fr) 380px');
  });

  it('sizes the sidebar against main’s floor alone and keeps the panel’s width for docking', () => {
    // 960 px: docked, the sidebar may take 960 - 480 - 280 = 200; floating (no panel beside main), 480.
    expect(regionWidths(regions({}, { width: 480 }), 960).sidebarMax).toBe(200);
    expect(regionWidths(regions({ floating: true }, { width: 480 }), 960)).toEqual(regionWidths(regions({ maximized: true }, { width: 480 }), 960));
    expect(regionWidths(regions({ floating: true }, { width: 480 }), 960).sidebarMax).toBe(480);
    expect(regionWidths(regions({ floating: true, width: 500 }), 1440).panel).toBe(500);
  });
});
