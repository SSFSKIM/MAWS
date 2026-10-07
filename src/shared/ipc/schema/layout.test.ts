import { describe, expect, it } from 'vitest';
import { commands, events, LAYOUT_DEFAULTS, type LayoutMainV1, LayoutKeySchema, LayoutMainSchema, LayoutRegionsSchema, PanelPinnedSchema, StoredMainSchema, StoredRegionsSchema, TabRefSchema, tabId, UsageBannersSchema, QuitWaitSchema } from './layout'; // C7: UsageBannersSchema; C12: QuitWaitSchema

describe('layout value shapes', () => {
  it('validates its own defaults', () => {
    expect(LayoutRegionsSchema.parse(LAYOUT_DEFAULTS.regions)).toEqual(LAYOUT_DEFAULTS.regions);
    expect(LayoutMainSchema.parse(LAYOUT_DEFAULTS.main)).toEqual(LAYOUT_DEFAULTS.main);
    expect(PanelPinnedSchema.parse(LAYOUT_DEFAULTS.panelPinned)).toEqual([]);
    expect(LAYOUT_DEFAULTS.regions.sidebar.width).toBe(300);
    expect(LAYOUT_DEFAULTS.regions.panel.width).toBe(380);
    // W5: the Overview floats over the main area rather than being a tab, so a fresh layout opens on one empty pane and
    // the panel in its default place.
    // W12: one tab set per project; nothing open is the no-project set's one empty pane.
    expect(LAYOUT_DEFAULTS.main).toEqual({ version: 2, current: 'none', sets: { none: { panes: [{ tabs: [], activeTabId: '' }], focusedPane: 0, splitRatio: 0.5 } }, closedTabs: [] });
    expect(LAYOUT_DEFAULTS.regions.overview).toBeNull();
  });

  // W12: `main.tabs` version 2 holds a set per project; version 1 is still read (the store files it by project).
  it('reads main.tabs version 2 as it is and version 1 as version 1; a set keyed by a project or none', () => {
    const set = { panes: [{ tabs: [{ id: 'session:a', kind: 'session', appSessionId: 'a', pinned: false }], activeTabId: 'session:a' }], focusedPane: 0, splitRatio: 0.5 };
    const v2 = { version: 2, current: 'proj-x', sets: { 'proj-x': set, none: LAYOUT_DEFAULTS.main.sets.none }, closedTabs: [] };
    expect(StoredMainSchema.parse(v2)).toEqual(v2);
    const v1 = { version: 1, ...set, closedTabs: [] };
    expect(StoredMainSchema.parse(v1)).toEqual(v1);
    expect(LayoutMainSchema.safeParse(v1).success).toBe(false);
    expect(StoredMainSchema.safeParse({ ...v2, sets: { 'proj-x': { ...set, extra: 1 } } }).success).toBe(false);
    expect(StoredMainSchema.safeParse({ ...v2, current: '' }).success).toBe(false);
  });

  // W11: version 3's expanded projects replace version 2's open page and version 1's collapsed lists; an earlier value
  // keeps its sizes, sort and Overview rect.
  it('reads a version-1 or version-2 regions value as version 3', () => {
    const v1 = {
      version: 1,
      sidebar: { width: 240, collapsed: true, sort: 'recency', collapsedProjects: ['proj-a'], collapsedSections: ['pinned'] },
      panel: { width: 320, collapsed: false, maximized: false },
    };
    expect(StoredRegionsSchema.parse(v1)).toEqual({ version: 3, sidebar: { width: 240, collapsed: true, sort: 'recency', expandedProjects: [] }, panel: v1.panel, overview: null });
    const v2 = { version: 2, sidebar: { width: 260, collapsed: false, sort: 'priority', openProject: 'other' }, panel: v1.panel, overview: { x: 40, y: 12, width: 880, height: 640 } };
    expect(StoredRegionsSchema.parse(v2)).toEqual({ version: 3, sidebar: { width: 260, collapsed: false, sort: 'priority', expandedProjects: ['other'] }, panel: v1.panel, overview: v2.overview });
    expect(StoredRegionsSchema.parse({ ...v2, sidebar: { ...v2.sidebar, openProject: null } }).sidebar.expandedProjects).toEqual([]);
    const v3 = { ...LAYOUT_DEFAULTS.regions, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, expandedProjects: ['proj-a', 'other'] } };
    expect(StoredRegionsSchema.parse(v3)).toEqual(v3);
    expect(StoredRegionsSchema.safeParse({ ...v3, sidebar: { ...v3.sidebar, openProject: null } }).success).toBe(false);
  });

  it('accepts the key grammar and nothing else', () => {
    for (const key of ['regions', 'main.tabs', 'panel.pinned', 'panel.app-1', 'window.main', 'usage.banners' /* C7 */]) {
      expect(LayoutKeySchema.safeParse(key).success, key).toBe(true);
    }
    for (const key of ['main', 'panel.', 'panel.a.b', 'window.other', 'x', 'usage.other' /* C7 */]) expect(LayoutKeySchema.safeParse(key).success, key).toBe(false);
  });

  it('derives deterministic tab ids', () => {
    expect(tabId({ kind: 'session', appSessionId: 'a1' as never })).toBe('session:a1');
    expect(tabId({ kind: 'agent', appSessionId: 'a1' as never, agentId: 'g1' as never })).toBe('agent:a1:g1');
    expect(tabId({ kind: 'file', path: '/x/y.ts', line: 3, appSessionId: null })).toBe('file:/x/y.ts');
    expect(tabId({ kind: 'diff', appSessionId: 'a1' as never, ref: 'HEAD' })).toBe('diff:a1:HEAD');
    expect(tabId({ kind: 'diagnostics' })).toBe('diagnostics');
    // E2 (X14): one tab per record, whatever version it was opened at
    expect(tabId({ kind: 'deliverable', appSessionId: 'App-1' as never, deliverableId: '0b6c2f2e-6b1a-4d55-9a57-3f1f6f0c2a11' })).toBe('deliverable:App-1:0b6c2f2e-6b1a-4d55-9a57-3f1f6f0c2a11');
  });

  // E2 (X14): the deliverable tab, appended to the union; its session is required (it restores to the record by id)
  it('admits a deliverable tab with its session and record', () => {
    const tab = { id: 'deliverable:a1:d1', kind: 'deliverable', appSessionId: 'a1', deliverableId: 'd1', pinned: false };
    expect(TabRefSchema.parse(tab)).toEqual(tab);
    expect(TabRefSchema.safeParse({ ...tab, appSessionId: null }).success).toBe(false);
    expect(TabRefSchema.safeParse({ ...tab, version: 2 }).success).toBe(false);
  });

  // E4a (X14): a browser tab as a main tab, appended after E2's; one per browser tab, keyed by its session and tab id
  it('admits a browser tab with its session and a well-formed browser tab id, and derives its id', () => {
    const tab = { id: 'browser:a1:b_0123456789ab', kind: 'browser', appSessionId: 'a1', browserTabId: 'b_0123456789ab', pinned: false };
    expect(TabRefSchema.parse(tab)).toEqual(tab);
    expect(TabRefSchema.safeParse({ ...tab, browserTabId: 'tab-1' }).success).toBe(false);
    expect(TabRefSchema.safeParse({ ...tab, appSessionId: null }).success).toBe(false);
    expect(TabRefSchema.safeParse({ ...tab, url: 'https://example.com/' }).success).toBe(false);
    expect(TabRefSchema.options.map((option) => option.shape.kind.value).at(-1)).toBe('browser');
    expect(tabId({ kind: 'browser', appSessionId: 'App-1' as never, browserTabId: 'b_0123456789ab' })).toBe('browser:App-1:b_0123456789ab');
  });

  // E4a (X15): Settings › Browser is a section the settings tab opens at (the partition pill's click)
  it('opens the settings tab at its browser section', () => {
    const settings = { id: 'settings', kind: 'settings', section: 'browser', pinned: false };
    expect(TabRefSchema.parse(settings)).toEqual(settings);
    expect(TabRefSchema.safeParse({ ...settings, section: 'web' }).success).toBe(false);
  });

  // W5: only `StoredMainSchema` still knows the Overview's tab, to drop it from a layout saved before the panel.
  it('rejects an overview tab', () => {
    expect(TabRefSchema.safeParse({ id: 'overview', kind: 'overview', pinned: true }).success).toBe(false);
  });

  it('limits closedTabs to ten and panes to two', () => {
    const tab = { id: 'diagnostics', kind: 'diagnostics', pinned: false } as const;
    const pane = { tabs: [tab], activeTabId: 'diagnostics' };
    expect(LayoutMainSchema.safeParse({ ...LAYOUT_DEFAULTS.main, closedTabs: Array(11).fill(tab) }).success).toBe(false);
    const withPanes = (panes: unknown[]) => ({ ...LAYOUT_DEFAULTS.main, sets: { none: { ...LAYOUT_DEFAULTS.main.sets.none, panes } } });
    expect(LayoutMainSchema.safeParse(withPanes([pane, pane, pane])).success).toBe(false);
    expect(LayoutMainSchema.safeParse(withPanes([pane, pane])).success).toBe(true);
  });

  // W5: every layout saved before the floating Overview holds its tab, first and pinned, in one of its panes (and in the
  // ⌘⇧T history if a hand-edit closed it). Hydration reads `main.tabs` through `StoredMainSchema`, which drops that tab
  // rather than failing the whole value back to the default and losing the user's tabs.
  describe('a stored main.tabs from before the floating Overview', () => {
    const overview = { id: 'overview', kind: 'overview', pinned: true };
    const session = (n: number) => ({ id: `session:a${n}`, kind: 'session', appSessionId: `a${n}`, pinned: false });
    const stored = (over: object) => ({ version: 1, panes: [], focusedPane: 0, splitRatio: 0.4, closedTabs: [], ...over });

    it('drops the Overview leading an active pane, activating the pane’s first remaining tab', () => {
      const main = stored({ panes: [{ tabs: [overview, session(1), session(2)], activeTabId: 'overview' }] });
      expect(LayoutMainSchema.safeParse(main).success).toBe(false);
      expect(StoredMainSchema.parse(main)).toEqual(stored({ panes: [{ tabs: [session(1), session(2)], activeTabId: 'session:a1' }] }));
      // a pane whose active tab was another keeps it
      const other = stored({ panes: [{ tabs: [overview, session(1), session(2)], activeTabId: 'session:a2' }] });
      expect((StoredMainSchema.parse(other) as LayoutMainV1).panes).toEqual([{ tabs: [session(1), session(2)], activeTabId: 'session:a2' }]);
    });

    it('drops a pane the Overview was the only tab of, focusing pane 0', () => {
      const main = stored({ panes: [{ tabs: [session(1)], activeTabId: 'session:a1' }, { tabs: [overview], activeTabId: 'overview' }], focusedPane: 1 });
      expect(StoredMainSchema.parse(main)).toEqual(stored({ panes: [{ tabs: [session(1)], activeTabId: 'session:a1' }], focusedPane: 0 }));
      // the split's other pane takes the emptied pane 0's place
      const first = stored({ panes: [{ tabs: [overview], activeTabId: 'overview' }, { tabs: [session(2)], activeTabId: 'session:a2' }], focusedPane: 1 });
      expect(StoredMainSchema.parse(first)).toEqual(stored({ panes: [{ tabs: [session(2)], activeTabId: 'session:a2' }], focusedPane: 0 }));
    });

    it('leaves one empty pane when the Overview was all there was (the old default)', () => {
      const main = stored({ panes: [{ tabs: [overview], activeTabId: 'overview' }] });
      expect(StoredMainSchema.parse(main)).toEqual(stored({ panes: [{ tabs: [], activeTabId: '' }] }));
    });

    it('drops the Overview from the closed-tab history', () => {
      const main = stored({ panes: [{ tabs: [session(1)], activeTabId: 'session:a1' }], closedTabs: [session(2), overview, session(3)] });
      expect(StoredMainSchema.parse(main).closedTabs).toEqual([session(2), session(3)]);
    });

    it('reads a layout without the Overview unchanged, and still rejects what LayoutMainSchema rejects', () => {
      const main = stored({ panes: [{ tabs: [session(1)], activeTabId: 'session:a1' }, { tabs: [session(2)], activeTabId: 'session:a2' }], focusedPane: 1 });
      expect(StoredMainSchema.parse(main)).toEqual(main);
      const pane = { tabs: [session(1)], activeTabId: 'session:a1' };
      expect(StoredMainSchema.safeParse(stored({ panes: [pane, pane, pane] })).success).toBe(false);
      expect(StoredMainSchema.safeParse(stored({ panes: [pane], closedTabs: [{ ...session(2), kind: 'nope' }] })).success).toBe(false);
    });

    // A throw would reject hydration's reads as a whole, so the store would never hydrate (nor persist); a malformed
    // value must fail validation and fall back to the default like any other invalid value.
    it('rejects a malformed value without throwing', () => {
      for (const value of [stored({ panes: [null] }), stored({ panes: [{ tabs: [null], activeTabId: 'x' }] }), stored({ panes: [{ tabs: [null, 'x', 3], activeTabId: 'x' }, 'pane'] }), stored({ panes: 'x' }), null]) {
        expect(StoredMainSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
      }
    });
  });

  // W6 (E1): the Accounts tab retired into the top bar's usage popover; a layout that held it reads without it.
  it('drops the retired Accounts tab from a stored main.tabs, panes and closed-tab history alike', () => {
    const accounts = { id: 'accounts', kind: 'accounts', pinned: false };
    const session = { id: 'session:a1', kind: 'session', appSessionId: 'a1', pinned: false };
    expect(TabRefSchema.safeParse(accounts).success).toBe(false);
    const main = { version: 1, panes: [{ tabs: [session, accounts], activeTabId: 'accounts' }], focusedPane: 0, splitRatio: 0.5, closedTabs: [accounts, session] };
    expect(StoredMainSchema.parse(main)).toEqual({ ...main, panes: [{ tabs: [session], activeTabId: 'session:a1' }], closedTabs: [session] });
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
      'layout.unsavedFiles': 'main', // E5: a window's dirty file tabs, for the quit question
      'layout.saveAllDone': 'main', // E5: a window's answer to the quit question's Save all
    });
  });

  // Edit ▸ Select All (sitting finding, 2026-09-30): the application menu's own item tells the page, with nothing to add
  it('carries the menu’s Select All to the page with an empty payload', () => {
    expect(events['layout.selectAll'].safeParse({}).success).toBe(true);
    expect(events['layout.selectAll'].safeParse({ target: 'terminal' }).success).toBe(false);
  });

  // C12 start: Quit when idle (C12 execution document, Interfaces "The quit question")
  it('carries the busy report main waits on, or null, and the banner’s two answers', () => {
    const report = { midTurn: 1, backgroundWork: 0, busyTerminals: 2, terminalsUnknown: false, unsavedFiles: [] /* E5 */ };
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
