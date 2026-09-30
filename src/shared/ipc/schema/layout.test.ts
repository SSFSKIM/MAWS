import { describe, expect, it } from 'vitest';
import { commands, LAYOUT_DEFAULTS, LayoutKeySchema, LayoutMainSchema, LayoutRegionsSchema, PanelPinnedSchema, TabRefSchema, tabId, UsageBannersSchema, QuitWaitSchema } from './layout'; // C7: UsageBannersSchema; C12: QuitWaitSchema

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
      'layout.saveTextFile': 'main', // C11
      'layout.captureChords': 'main', // C11 (M5 fix wave: the chord capture sets the menu aside)
      'layout.quitWait': 'main', // C12: Quit when idle's wait
      'layout.quitWaitAnswer': 'main', // C12: its banner's Quit now and Cancel
    });
  });

  // C12 start: Quit when idle (C12 execution document, Interfaces "The quit question")
  it('carries the busy report main waits on, or null, and the banner’s two answers', () => {
    const report = { midTurn: 1, backgroundWork: 0, busyTerminals: 2, terminalsUnknown: false };
    expect(QuitWaitSchema.safeParse({ waiting: report }).success).toBe(true);
    expect(QuitWaitSchema.safeParse({ waiting: null }).success).toBe(true);
    expect(QuitWaitSchema.safeParse({ waiting: { ...report, busyTerminals: -1 } }).success).toBe(false);
    expect(commands['layout.quitWaitAnswer'].input.safeParse({ action: 'quitNow' }).success).toBe(true);
    expect(commands['layout.quitWaitAnswer'].input.safeParse({ action: 'restart' }).success).toBe(false);
  });
  // C12 end

  // C7 start: the dismissed near-limit banner keys (C7 execution document, Status line popovers and usage)
  it('holds usage.banners to fifty string keys', () => {
    expect(UsageBannersSchema.safeParse(['usage:a1:session:2026-09-28T16:09:59Z']).success).toBe(true);
    expect(UsageBannersSchema.safeParse(Array.from({ length: 51 }, (_, i) => `k${i}`)).success).toBe(false);
    expect(UsageBannersSchema.safeParse([1]).success).toBe(false);
  });
  // C7 end
});
