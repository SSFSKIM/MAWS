import { describe, expect, it } from 'vitest';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { cardColumnShown, shellGeometry } from './shell-geometry';
import { shellGeometryOf } from './shell-view';
import { useLayout } from '../stores/layout';
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
    for (const tool of ['review', 'files', 'browser', 'terminal']) { // UX wave U8b, Addendum 6: a terminal opens wide
      const id = `${tool}:aaaaaaaa`;
      expect(shellGeometryOf({ ...state, panelBySession: new Map([[A, { tabs: [ref(id)], activeTabId: id }]]) }, 1440).panel).toBe(720);
    }
  });
  // UX wave U7b (M5, decision 2): Projects, Customize and the library are pages, which decide no size: the geometry under
  // a page is the geometry of the tabs behind it.
  it('a page decides no size: the geometry is the one of the tabs behind it', () => {
    for (const page of [{ kind: 'projects' }, { kind: 'customize', view: 'mine', show: 'plugins' }, { kind: 'library' }] as const) {
      resetPanelStores();
      useLayout.setState({ main: mainShowing(A) });
      const state = useLayout.getState();
      for (const tool of ['background', 'browser']) {
        const id = `${tool}:aaaaaaaa`;
        const withSurface = { ...state, panelBySession: new Map([[A, { tabs: [ref(id)], activeTabId: id }]]) };
        for (const width of [1280, 900]) expect(shellGeometryOf({ ...withSurface, destination: page }, width)).toEqual(shellGeometryOf(withSurface, width));
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

// UX wave U8b (UC-9; its execution document, Interfaces §C.2): the card column's one predicate, a pure function of its facts.
describe('whether the card column is shown', () => {
  const base = { sessionTab: true, tabsInView: 0, collapsed: false, room: 960, opened: false, pageOpen: false };
  it('is shown for a session tab with nothing in view, the right side open and room for it', () => {
    expect(cardColumnShown(base)).toBe(true);
  });
  it.each([
    ['no session tab in front', { sessionTab: false }],
    ['a tab in view', { tabsInView: 1 }],
    ['two tabs in view', { tabsInView: 2 }],
    ['the right side collapsed', { collapsed: true }],
    ['a page open', { pageOpen: true }],
    ['too little room, not opened', { room: 959 }],
  ])('is not shown with %s', (_, facts) => {
    expect(cardColumnShown({ ...base, ...facts })).toBe(false);
  });
  it('opened by the person, it is shown in too little room, but never over a page or a tab in view', () => {
    expect(cardColumnShown({ ...base, room: 400, opened: true })).toBe(true);
    expect(cardColumnShown({ ...base, room: 400, opened: true, pageOpen: true })).toBe(false);
    expect(cardColumnShown({ ...base, room: 400, opened: true, tabsInView: 1 })).toBe(false);
  });
});
