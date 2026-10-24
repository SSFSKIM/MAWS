import { beforeEach, describe, expect, it } from 'vitest';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { createLayoutStore, useLayout } from '../stores/layout';
import { useNotices } from '../stores/notices';
import { cardHost, cardSession, floatPanel, FLOAT_COPY } from '../shell/floating';
import { recordTranscriptScroll, takeTranscriptCarry } from '../transcript/view/scroll-carry';
import { A, mainShowing, probeTool, resetPanelStores } from '../test-support/panel';
import { panelHost, registerPanelTool, selectedPanelTabId, shownSession, togglePinned, usePanelHost } from './host';
import { surfaceTabs } from './surface-model';

beforeEach(() => resetPanelStores());

const layout = () => useLayout.getState();
const add = (toolId: string) => {
  registerPanelTool(probeTool(toolId).tool);
  return panelHost.addTool(toolId, { appSessionId: A });
};

describe('visible surface lifecycle', () => {
  it('selects, pins and hides tools in the remembered surface context while a document is in front', () => {
    const first = add('terminal');
    const second = panelHost.addTool('terminal', { appSessionId: A });
    layout().openTab({ kind: 'artifact', artifactId: 'doc' });
    expect(shownSession()).toBeNull(); // a panel context does not turn a document into a chat
    panelHost.selectTab(first);
    expect(selectedPanelTabId()).toBe(first);
    expect(usePanelHost.getState().focus[first]).toBe(2);
    togglePinned(first);
    expect(layout().panelPinned.map((tab) => tab.id)).toEqual([first]);
    expect(surfaceTabs(layout(), A).map((tab) => tab.id)).toEqual([first]);
    panelHost.selectTab(second);
    panelHost.showSummary();
    expect(surfaceTabs(layout(), A)).toEqual([]);
    expect(layout().effectivePanelTabs(A)).toHaveLength(2);
  });

  it('keeps a non-active tool slot when its selected tab closes and another tab of the tool remains', async () => {
    const terminal = probeTool('terminal');
    registerPanelTool(terminal.tool);
    const first = panelHost.addTool('terminal', { appSessionId: A });
    const second = panelHost.addTool('terminal', { appSessionId: A });
    const browser = add('browser');
    expect(surfaceTabs(layout(), A).map((tab) => tab.id)).toEqual([second, browser]);

    await panelHost.closeTab(second);

    expect(surfaceTabs(layout(), A).map((tab) => tab.id)).toEqual([first, browser]);
    expect(layout().panelBySession.get(A)?.activeTabId).toBe(browser);
    expect(terminal.probe.beforeClose).toEqual([second]);
    expect(terminal.probe.disposed).toEqual([second]);
  });

  it.each(['floating', 'maximized'] as const)('hiding the final surface exits %s without closing refs or clearing saved params', (mode) => {
    const terminal = add('terminal');
    layout().setPanelParams(terminal, { attach: 'pty-1' });
    layout().setPanel({ [mode]: true, width: 444 });
    layout().setSurfaceStack(A, []);

    expect(layout().regions.panel).toMatchObject({ floating: false, maximized: false, width: 444 });
    expect(cardSession(layout())).toBeNull();
    expect(layout().effectivePanelTabs(A).map((tab) => tab.id)).toEqual([terminal]);
    expect(layout().panelParams).toEqual({ [terminal]: { attach: 'pty-1' } });
    expect(layout().main).toEqual(mainShowing(A));
  });

  it('closing the last floated tool tab immediately restores the ordinary session', async () => {
    const terminal = add('terminal');
    const scroll = { following: false, offset: 900, signature: '3:r3', anchor: 'r2' };
    recordTranscriptScroll(A, scroll);
    floatPanel();
    expect(cardSession(layout())).toBe(A);
    expect(takeTranscriptCarry(A)).toEqual(scroll); // the floating transcript consumed the first handoff
    await panelHost.closeTab(terminal);
    expect(cardSession(layout())).toBeNull();
    expect(layout().regions.panel.floating).toBe(false);
    expect(layout().main).toEqual(mainShowing(A));
    expect(takeTranscriptCarry(A)).toEqual(scroll); // the ordinary transcript returns to the same place
  });

  it('does not claim a panel card over the summary even before a stale float is reconciled', () => {
    useLayout.setState({ regions: { ...LAYOUT_DEFAULTS.regions, panel: { ...LAYOUT_DEFAULTS.regions.panel, floating: true } } });
    expect(cardHost(layout())).toBeNull();
    expect(cardSession(layout())).toBeNull();
  });

  it('refuses Float with no surface and preserves the divider restore width', () => {
    useNotices.setState({ notices: [] });
    floatPanel({ width: 444 });
    expect(layout().regions.panel).toMatchObject({ floating: false, width: 444 });
    expect(useNotices.getState().notices.map((notice) => notice.text)).toEqual([FLOAT_COPY.noSurface]);
  });

  it('restores an old summary float docked, without losing hidden refs, params or card sizes', async () => {
    const terminal = { id: 'terminal:old', toolId: 'terminal', pinned: false };
    const regions = { ...LAYOUT_DEFAULTS.regions, panel: { ...LAYOUT_DEFAULTS.regions.panel, width: 444, floating: true }, floatingCard: { [terminal.id]: { w: 420, h: 300 } } };
    const values: Record<string, unknown> = {
      regions,
      'main.tabs': mainShowing(A),
      [`panel.${A}`]: { tabs: [terminal], activeTabId: null },
      'panelTools.params': { version: 1, params: { [terminal.id]: { attach: 'pty-1' } } },
    };
    const fake = fakeClient({ 'layout.list': { keys: Object.keys(values) }, 'layout.get': ({ key }: { key: string }) => ({ value: values[key] ?? null }), 'layout.set': undefined });
    const store = createLayoutStore();
    await store.getState().hydrate(fake.client, () => true);
    const state = store.getState();
    expect(state.regions.panel).toMatchObject({ floating: false, maximized: false, width: 444 });
    expect(state.regions.floatingCard).toEqual(regions.floatingCard);
    expect(state.effectivePanelTabs(A)).toEqual([terminal]);
    expect(state.panelParams).toEqual({ [terminal.id]: { attach: 'pty-1' } });
    expect(fake.invoked('layout.set')).toContainEqual({ key: 'regions', value: state.regions });
  });
});
