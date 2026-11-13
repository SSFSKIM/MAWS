import { describe, expect, it } from 'vitest';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { shellGeometry } from './shell-geometry';
import { shellGeometryOf } from './shell-view';
import { useLayout } from '../stores/layout';
import { openTab } from '../stores/layout-model';
import { A, mainShowing, ref, resetPanelStores } from '../test-support/panel';

const regions = { ...LAYOUT_DEFAULTS.regions, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, width: 240 } };
const AUTO = { wide: null, narrow: null }; // UX wave U8b: neither width dragged
describe('the optional surface geometry', () => {
  it('leaves the whole main area to content when no surface is shown', () => {
    const g = shellGeometry(regions, 1280, false, false, AUTO);
    expect(g.sidebar).toBe(240);
    expect(g.panel).toBe(0);
    expect(g.mainHidden).toBe(false);
  });
  it('gives reading surfaces more width than narrow tools without starving the session', () => {
    const wide = shellGeometry(regions, 1280, true, true, AUTO);
    const narrow = shellGeometry(regions, 1280, true, false, AUTO);
    expect(wide.panel).toBeGreaterThan(narrow.panel);
    expect(1280 - wide.sidebar - wide.panel).toBeGreaterThanOrEqual(360);
  });
  it('keeps the automatic narrow width stable until the main floor requires it to yield, without writing saved regions', () => {
    const before = structuredClone(regions);
    expect(shellGeometry(regions, 1280, true, false, AUTO)).toMatchObject({ sidebar: 240, panel: 360 });
    expect(shellGeometry(regions, 900, true, false, AUTO)).toMatchObject({ sidebar: 0, panel: 360 });
    expect(shellGeometry(regions, 700, true, false, AUTO)).toMatchObject({ sidebar: 0, panel: 340 });
    expect(regions).toEqual(before);
  });
  it('opens an artifact surface at the narrow automatic width while reading tools alone earn wide defaults', () => {
    resetPanelStores();
    useLayout.setState({ main: mainShowing(A), panelBySession: new Map([[A, { tabs: [ref('artifacts:aaaaaaaa')], activeTabId: 'artifacts:aaaaaaaa' }]]) });
    const state = useLayout.getState();
    expect(shellGeometryOf(state, 1440).panel).toBe(360);
    for (const tool of ['review', 'files', 'browser']) {
      const id = `${tool}:aaaaaaaa`;
      expect(shellGeometryOf({ ...state, panelBySession: new Map([[A, { tabs: [ref(id)], activeTabId: id }]]) }, 1440).panel).toBe(720);
    }
  });
  it('keeps Projects and Customize on the same optional narrow/wide surface rules as other tabs', () => {
    for (const target of [{ kind: 'projects' }, { kind: 'customize', section: 'plugins' }] as const) {
      resetPanelStores();
      const main = openTab(mainShowing(A), target);
      useLayout.setState({ main });
      const state = useLayout.getState();
      expect(shellGeometryOf(state, 1280)).toMatchObject({ sidebar: 240, panel: 0 });
      for (const [tool, width] of [['terminal', 360], ['browser', 624]] as const) {
        const id = `${tool}:aaaaaaaa`;
        const withSurface = { ...state, panelBySession: new Map([[A, { tabs: [ref(id)], activeTabId: id }]]) };
        expect(shellGeometryOf(withSurface, 1280).panel).toBe(width);
        expect(shellGeometryOf(withSurface, 900)).toMatchObject({ sidebar: 0, sidebarAside: true });
      }
    }
  });
  it('honors a resized narrow surface up to the main floor and restores its remembered width when room returns', () => {
    const resized = { wide: null, narrow: 640 };
    expect(shellGeometry(regions, 1440, true, false, resized).panel).toBe(640);
    expect(shellGeometry(regions, 900, true, false, resized).panel).toBe(540);
    expect(shellGeometry(regions, 1440, true, false, resized).panel).toBe(640);
    expect(shellGeometry(regions, 1440, true, false, AUTO).panel).toBe(360);
  });
  // UX wave U8b (A5, X-165): two remembered widths, each automatic until dragged; regions.panel.width is build F's.
  it('opens a narrow tool at 360 and Review at 60 % of the room with nothing stored, whatever regions.panel.width says', () => {
    for (const width of [380, 512]) {
      const f = { ...regions, panel: { ...regions.panel, width } };
      expect(shellGeometry(f, 1440, true, false, AUTO).panel).toBe(360);
      expect(shellGeometry(f, 1440, true, true, AUTO).panel).toBe(720);
    }
  });
  it('a stored narrow width leaves the wide one automatic, and the reverse', () => {
    expect(shellGeometry(regions, 1440, true, true, { wide: null, narrow: 300 }).panel).toBe(720);
    expect(shellGeometry(regions, 1440, true, false, { wide: null, narrow: 300 }).panel).toBe(300);
    expect(shellGeometry(regions, 1440, true, false, { wide: 500, narrow: null }).panel).toBe(360);
    expect(shellGeometry(regions, 1440, true, true, { wide: 500, narrow: null }).panel).toBe(500);
    expect(shellGeometry(regions, 1440, true, false, { wide: null, narrow: 380 }).panel).toBe(380); // 380 is no longer automatic
  });
  it('temporarily yields the sidebar at 900, restoring the same width when the surface closes', () => {
    expect(shellGeometry(regions, 900, true, true, AUTO)).toMatchObject({ sidebar: 0, sidebarAside: true, sheet: false });
    expect(shellGeometry(regions, 900, false, false, AUTO)).toMatchObject({ sidebar: 240, sidebarAside: false });
    expect(regions.sidebar.collapsed).toBe(false);
  });
  it('turns the surface into a sheet below 700 rather than squeezing the main column', () => {
    expect(shellGeometry(regions, 600, true, true, AUTO)).toMatchObject({ sidebar: 0, sheet: true, columns: '0px minmax(0, 1fr) 0px' });
    expect(shellGeometry(regions, 700, true, false, AUTO).sheet).toBe(false);
    expect(shellGeometry(regions, 1100, true, false, AUTO).sidebarAside).toBe(false);
  });
  it('does not let stale maximize state reserve an empty column', () => {
    expect(shellGeometry({ ...regions, panel: { ...regions.panel, maximized: true } }, 1280, false, false, AUTO).mainHidden).toBe(false);
  });
});
