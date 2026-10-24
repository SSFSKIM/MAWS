import { describe, expect, it } from 'vitest';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { shellGeometry } from './shell-geometry';
import { shellGeometryOf } from './shell-view';
import { useLayout } from '../stores/layout';
import { A, mainShowing, ref, resetPanelStores } from '../test-support/panel';

const regions = { ...LAYOUT_DEFAULTS.regions, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, width: 240 } };
describe('the optional surface geometry', () => {
  it('leaves the whole main area to content when no surface is shown', () => {
    const g = shellGeometry(regions, 1280, false, false);
    expect(g.sidebar).toBe(240);
    expect(g.panel).toBe(0);
    expect(g.mainHidden).toBe(false);
  });
  it('gives reading surfaces more width than narrow tools without starving the session', () => {
    const wide = shellGeometry(regions, 1280, true, true);
    const narrow = shellGeometry(regions, 1280, true, false);
    expect(wide.panel).toBeGreaterThan(narrow.panel);
    expect(1280 - wide.sidebar - wide.panel).toBeGreaterThanOrEqual(360);
  });
  it('opens an artifact surface at the narrow automatic width while reading tools alone earn wide defaults', () => {
    resetPanelStores();
    useLayout.setState({ main: mainShowing(A), panelBySession: new Map([[A, { tabs: [ref('artifacts:aaaaaaaa')], activeTabId: 'artifacts:aaaaaaaa' }]]) });
    const state = useLayout.getState();
    expect(shellGeometryOf(state, 1440).panel).toBe(420);
    for (const tool of ['review', 'files', 'browser']) {
      const id = `${tool}:aaaaaaaa`;
      expect(shellGeometryOf({ ...state, panelBySession: new Map([[A, { tabs: [ref(id)], activeTabId: id }]]) }, 1440).panel).toBe(720);
    }
  });
  it('honors a resized narrow surface up to the main floor and restores its remembered width when room returns', () => {
    const resized = { ...regions, panel: { ...regions.panel, width: 640 } };
    expect(shellGeometry(resized, 1440, true, false).panel).toBe(640);
    expect(shellGeometry(resized, 900, true, false).panel).toBe(540);
    expect(shellGeometry(resized, 1440, true, false).panel).toBe(640);
    expect(resized.panel.width).toBe(640);
    expect(shellGeometry(regions, 1440, true, false).panel).toBe(420);
  });
  it('temporarily yields the sidebar at 900, restoring the same width when the surface closes', () => {
    expect(shellGeometry(regions, 900, true, true)).toMatchObject({ sidebar: 0, sidebarAside: true, sheet: false });
    expect(shellGeometry(regions, 900, false, false)).toMatchObject({ sidebar: 240, sidebarAside: false });
    expect(regions.sidebar.collapsed).toBe(false);
  });
  it('turns the surface into a sheet below 700 rather than squeezing the main column', () => {
    expect(shellGeometry(regions, 600, true, true)).toMatchObject({ sidebar: 0, sheet: true, columns: '0px minmax(0, 1fr) 0px' });
    expect(shellGeometry(regions, 700, true, false).sheet).toBe(false);
    expect(shellGeometry(regions, 1100, true, false).sidebarAside).toBe(false);
  });
  it('does not let stale maximize state reserve an empty column', () => {
    expect(shellGeometry({ ...regions, panel: { ...regions.panel, maximized: true } }, 1280, false, false).mainHidden).toBe(false);
  });
});
