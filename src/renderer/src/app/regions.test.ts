// P3-G (§D1.3): a floating panel stands in the main column as a maximized one does: the grid gives it the main column's
// place, and the sidebar is sized against the window less main's floor alone.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT, tabId, type LayoutRegions, type TabRef } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { resetShellStores } from '../test-support/shell-stores';
import '../shell/floating'; // P3-F wave S (F6): the float's rule, as the shell imports it
import { gridColumns, panelInMain, regionWidths } from './regions';

const regions = (panel: Partial<LayoutRegions['panel']>, sidebar: Partial<LayoutRegions['sidebar']> = {}): LayoutRegions => ({
  ...LAYOUT_DEFAULTS.regions,
  sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, ...sidebar },
  panel: { ...LAYOUT_DEFAULTS.regions.panel, ...panel },
});

describe('regions while floating', () => {
  it('gives the floating panel the main column’s place, as maximized does', () => {
    expect(gridColumns(regions({ floating: true }), 1440)).toBe('240px 0px minmax(0, 1fr)');
    expect(gridColumns(regions({ floating: true }), 1440)).toBe(gridColumns(regions({ maximized: true }), 1440));
    expect(gridColumns(regions({ floating: true }, { collapsed: true }), 1440)).toBe('0px 0px minmax(0, 1fr)');
    expect(gridColumns(regions({}), 1440)).toBe('240px minmax(0, 1fr) 380px');
  });

  it('sizes the sidebar against main’s floor alone and keeps the panel’s width for docking', () => {
    // 960 px: docked, the sidebar may take 960 - 480 - 280 = 200; floating (no panel beside main), 480.
    expect(regionWidths(regions({}, { width: 480 }), 960).sidebarMax).toBe(200);
    expect(regionWidths(regions({ floating: true }, { width: 480 }), 960)).toEqual(regionWidths(regions({ maximized: true }, { width: 480 }), 960));
    expect(regionWidths(regions({ floating: true }, { width: 480 }), 960).sidebarMax).toBe(480);
    expect(regionWidths(regions({ floating: true, width: 500 }), 1440).panel).toBe(500);
  });
});

// P3-F wave S (F6, candidate 58): a float with no session for the card to draw never takes main's column. The owner's
// case: Float pressed, or a float restored, with an artifact tab in front left main at 0 px and its tab strip hidden.
describe('a float with no card session', () => {
  const ARTIFACT: TabRef = { id: tabId({ kind: 'artifact', artifactId: 'deck-1' }), kind: 'artifact', artifactId: 'deck-1', pinned: false };
  const main = { ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs: [ARTIFACT], activeTabId: ARTIFACT.id }] } } };

  it('restored with an artifact tab in front, main keeps its column and is not hidden', async () => {
    resetShellStores();
    const values: Record<string, unknown> = { regions: regions({ floating: true }), 'main.tabs': main };
    const { client } = fakeClient({ 'layout.list': { keys: ['regions', 'main.tabs'] }, 'layout.get': (input: unknown) => ({ value: values[(input as { key: string }).key] ?? null }) });
    useLayout.setState({ hydrated: false });
    await useLayout.getState().hydrate(client, () => true);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(panelInMain(useLayout.getState().regions)).toBe(false);
    expect(gridColumns(useLayout.getState().regions, 1440)).toBe('240px minmax(0, 1fr) 380px');
  });
});

// P4-B3 (its Decision Log 11): the split's float changes nothing about the regions; the panel stands in main only for
// its own maximize or float.
describe('a split float', () => {
  it('is never the panel in main: the grid and the sidebar’s room are as docked', () => {
    resetShellStores();
    const SESSION: TabRef = { id: 'session:app-s', kind: 'session', appSessionId: 'app-s' as AppSessionId, pinned: false };
    const DIAGNOSTICS: TabRef = { id: 'diagnostics', kind: 'diagnostics', pinned: false };
    useLayout.setState({
      main: { ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs: [SESSION], activeTabId: SESSION.id }, { tabs: [DIAGNOSTICS], activeTabId: DIAGNOSTICS.id }] } } },
    });
    const before = useLayout.getState().regions;
    useLayout.getState().floatSplit(SESSION.id);
    expect(currentSet(useLayout.getState().main).floating).toEqual({ sessionTabId: SESSION.id });
    expect(useLayout.getState().regions).toBe(before);
    expect(panelInMain(useLayout.getState().regions)).toBe(false);
    expect(gridColumns(useLayout.getState().regions, 1440)).toBe('240px minmax(0, 1fr) 380px');
  });
});
