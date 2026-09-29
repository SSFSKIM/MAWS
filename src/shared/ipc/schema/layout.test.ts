import { describe, expect, it } from 'vitest';
import { commands, LAYOUT_DEFAULTS, LayoutKeySchema, LayoutMainSchema, LayoutRegionsSchema, PanelPinnedSchema, TabRefSchema, tabId, UsageBannersSchema } from './layout'; // C7: UsageBannersSchema

describe('layout value shapes', () => {
  it('validates its own defaults', () => {
    expect(LayoutRegionsSchema.parse(LAYOUT_DEFAULTS.regions)).toEqual(LAYOUT_DEFAULTS.regions);
    expect(LayoutMainSchema.parse(LAYOUT_DEFAULTS.main)).toEqual(LAYOUT_DEFAULTS.main);
    expect(PanelPinnedSchema.parse(LAYOUT_DEFAULTS.panelPinned)).toEqual([]);
    expect(LAYOUT_DEFAULTS.regions.sidebar.width).toBe(300);
    expect(LAYOUT_DEFAULTS.regions.panel.width).toBe(380);
    expect(LAYOUT_DEFAULTS.main.panes).toEqual([{ tabs: [{ id: 'overview', kind: 'overview', pinned: true }], activeTabId: 'overview' }]);
  });

  it('accepts the key grammar and nothing else', () => {
    for (const key of ['regions', 'main.tabs', 'panel.pinned', 'panel.app-1', 'window.main', 'usage.banners' /* C7 */]) {
      expect(LayoutKeySchema.safeParse(key).success, key).toBe(true);
    }
    for (const key of ['main', 'panel.', 'panel.a.b', 'window.other', 'x', 'usage.other' /* C7 */]) expect(LayoutKeySchema.safeParse(key).success, key).toBe(false);
  });

  it('derives deterministic tab ids', () => {
    expect(tabId({ kind: 'overview' })).toBe('overview');
    expect(tabId({ kind: 'session', appSessionId: 'a1' as never })).toBe('session:a1');
    expect(tabId({ kind: 'agent', appSessionId: 'a1' as never, agentId: 'g1' as never })).toBe('agent:a1:g1');
    expect(tabId({ kind: 'file', path: '/x/y.ts', line: 3, appSessionId: null })).toBe('file:/x/y.ts');
    expect(tabId({ kind: 'diff', appSessionId: 'a1' as never, ref: 'HEAD' })).toBe('diff:a1:HEAD');
    expect(tabId({ kind: 'diagnostics' })).toBe('diagnostics');
  });

  it('rejects an overview tab that is not pinned', () => {
    expect(TabRefSchema.safeParse({ id: 'overview', kind: 'overview', pinned: false }).success).toBe(false);
  });

  it('limits closedTabs to ten and panes to two', () => {
    const tab = { id: 'overview', kind: 'overview', pinned: true } as const;
    const pane = { tabs: [tab], activeTabId: 'overview' };
    expect(LayoutMainSchema.safeParse({ ...LAYOUT_DEFAULTS.main, closedTabs: Array(11).fill(tab) }).success).toBe(false);
    expect(LayoutMainSchema.safeParse({ ...LAYOUT_DEFAULTS.main, panes: [pane, pane, pane] }).success).toBe(false);
    expect(LayoutMainSchema.safeParse({ ...LAYOUT_DEFAULTS.main, panes: [pane, pane] }).success).toBe(true);
  });

  it('owns get, set, list, openExternal and setEnabledActions in main', () => {
    expect(Object.fromEntries(Object.entries(commands).map(([name, spec]) => [name, spec.owner]))).toEqual({
      'layout.get': 'main',
      'layout.set': 'main',
      'layout.list': 'main',
      'layout.openExternal': 'main',
      'layout.setEnabledActions': 'main',
      'layout.pickFiles': 'main', // C7
    });
  });

  // C7 start: the dismissed near-limit banner keys (C7 execution document, Status line popovers and usage)
  it('holds usage.banners to fifty string keys', () => {
    expect(UsageBannersSchema.safeParse(['usage:a1:session:2026-09-28T16:09:59Z']).success).toBe(true);
    expect(UsageBannersSchema.safeParse(Array.from({ length: 51 }, (_, i) => `k${i}`)).success).toBe(false);
    expect(UsageBannersSchema.safeParse([1]).success).toBe(false);
  });
  // C7 end
});
