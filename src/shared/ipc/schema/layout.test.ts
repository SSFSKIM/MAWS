import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, events, LAYOUT_DEFAULTS, type LayoutMainV1, LayoutKeySchema, LayoutMainSchema, LayoutRegionsSchema, PanelPinnedSchema, StoredMainSchema, StoredRegionsSchema, TabRefSchema, tabId, UNPINNABLE_KINDS, UsageBannersSchema, QuitWaitSchema } from './layout'; // C7: UsageBannersSchema; C12: QuitWaitSchema

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
  // keeps its sizes, sort and Overview rect. P3-G (§D1.1): version 4 adds the floating state and the card's sizes; every
  // earlier version reads as version 4, not floating and with no card sizes.
  it('reads a version-1, version-2 or version-3 regions value as version 4', () => {
    const v1 = {
      version: 1,
      sidebar: { width: 240, collapsed: true, sort: 'recency', collapsedProjects: ['proj-a'], collapsedSections: ['pinned'] },
      panel: { width: 320, collapsed: false, maximized: true },
    };
    const panel = { ...v1.panel, floating: false };
    expect(StoredRegionsSchema.parse(v1)).toEqual({ version: 4, sidebar: { width: 240, collapsed: true, sort: 'recency', expandedProjects: [] }, panel, overview: null, floatingCard: {} });
    const v2 = { version: 2, sidebar: { width: 260, collapsed: false, sort: 'priority', openProject: 'other' }, panel: v1.panel, overview: { x: 40, y: 12, width: 880, height: 640 } };
    expect(StoredRegionsSchema.parse(v2)).toEqual({ version: 4, sidebar: { width: 260, collapsed: false, sort: 'priority', expandedProjects: ['other'] }, panel, overview: v2.overview, floatingCard: {} });
    expect(StoredRegionsSchema.parse({ ...v2, sidebar: { ...v2.sidebar, openProject: null } }).sidebar.expandedProjects).toEqual([]);
    const v3 = { version: 3, sidebar: { width: 280, collapsed: false, sort: 'recency', expandedProjects: ['proj-a', 'other'] }, panel: { width: 500, collapsed: true, maximized: false }, overview: v2.overview };
    expect(StoredRegionsSchema.parse(v3)).toEqual({ ...v3, version: 4, panel: { ...v3.panel, floating: false }, floatingCard: {} });
    expect(StoredRegionsSchema.safeParse({ ...v3, sidebar: { ...v3.sidebar, openProject: null } }).success).toBe(false);
    // An older shape never carries the newer fields
    expect(StoredRegionsSchema.safeParse({ ...v3, panel: { ...v3.panel, floating: true } }).success).toBe(false);
    expect(StoredRegionsSchema.safeParse({ ...v3, floatingCard: {} }).success).toBe(false);
  });

  it('reads version 4 as it is: the floating state and the card sizes per panel tab', () => {
    const v4 = { ...LAYOUT_DEFAULTS.regions, panel: { width: 420, collapsed: false, maximized: false, floating: true }, floatingCard: { summary: { w: 420, h: 380 }, 'browser:t1': { w: 500, h: 600 } } };
    expect(StoredRegionsSchema.parse(v4)).toEqual(v4);
    expect(LayoutRegionsSchema.safeParse({ ...v4, panel: { ...v4.panel, floating: undefined } }).success).toBe(false);
    expect(LayoutRegionsSchema.safeParse({ ...v4, floatingCard: { summary: { w: 420.5, h: 380 } } }).success).toBe(false);
    expect(LayoutRegionsSchema.safeParse({ ...v4, floatingCard: { summary: { w: 420, h: 380, x: 0 } } }).success).toBe(false);
    expect(LAYOUT_DEFAULTS.regions).toMatchObject({ version: 4, panel: { floating: false }, floatingCard: {} });
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
    expect(tabId({ kind: 'artifact', artifactId: '0b6c2f2e-6b1a-4d55-9a57-3f1f6f0c2a11' })).toBe('artifact:0b6c2f2e-6b1a-4d55-9a57-3f1f6f0c2a11'); // P3-L
  });

  // P3-L (M6b; Decision Log 10, 18d): the `deliverable` kind is gone from the union; `main.tabs` stays at version 2 and
  // its reader turns a stored deliverable tab into the artifact tab of the same id (the record's id is the artifact's),
  // so the owner's open tabs survive the upgrade
  describe('a stored main.tabs holding a deliverable tab (before P3-L’s cutover)', () => {
    const ID = '0b6c2f2e-6b1a-4d55-9a57-3f1f6f0c2a11';
    const session = (n: number) => ({ id: `session:a${n}`, kind: 'session', appSessionId: `a${n}`, pinned: false });
    const deliverable = (id = ID, pinned = false) => ({ id: `deliverable:App-1:${id}`, kind: 'deliverable', appSessionId: 'App-1', deliverableId: id, pinned });
    const artifact = (id = ID, pinned = false) => ({ id: `artifact:${id}`, kind: 'artifact', artifactId: id, pinned });
    const v2 = (panes: unknown[], closedTabs: unknown[] = []) => ({ version: 2, current: 'proj-x', sets: { 'proj-x': { panes, focusedPane: 0, splitRatio: 0.4 }, none: LAYOUT_DEFAULTS.main.sets.none }, closedTabs });

    it('is no tab kind of this build', () => {
      expect(TabRefSchema.safeParse(deliverable()).success).toBe(false);
      expect(TabRefSchema.options.map((option) => option.shape.kind.value)).not.toContain('deliverable');
    });

    it('reads as the artifact tab of the same id, pinned as it was, active where it was, in the panes and the history alike', () => {
      const other = '1c7d3f3f-7c2b-4e66-8b68-4f2f7f1d3b22';
      const main = v2([{ tabs: [session(1), deliverable(ID, true)], activeTabId: `deliverable:App-1:${ID}` }, { tabs: [deliverable(other)], activeTabId: `deliverable:App-1:${other}` }], [deliverable(other), session(2)]);
      expect(StoredMainSchema.parse(main)).toEqual(
        v2([{ tabs: [session(1), artifact(ID, true)], activeTabId: `artifact:${ID}` }, { tabs: [artifact(other)], activeTabId: `artifact:${other}` }], [artifact(other), session(2)]),
      );
    });

    it('keeps one tab when the artifact is open as both, the artifact tab kept, the pane’s active tab following it', () => {
      const main = v2([{ tabs: [artifact(), session(1), deliverable()], activeTabId: `deliverable:App-1:${ID}` }]);
      expect(StoredMainSchema.parse(main)).toEqual(v2([{ tabs: [artifact(), session(1)], activeTabId: `artifact:${ID}` }]));
      const across = v2([{ tabs: [deliverable()], activeTabId: `deliverable:App-1:${ID}` }, { tabs: [artifact(), session(1)], activeTabId: 'session:a1' }]);
      const read = StoredMainSchema.parse(across) as { sets: Record<string, { panes: { tabs: { id: string }[] }[] }> };
      expect(read.sets['proj-x']!.panes.flatMap((pane) => pane.tabs.map((tab) => tab.id))).toEqual([`artifact:${ID}`, 'session:a1']);
    });
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
      expect(StoredMainSchema.safeParse(stored({ panes: [pane], closedTabs: [{ ...session(2), pinned: 'yes' }] })).success).toBe(false); // P3-G (§D5): a tab of an unknown kind is dropped instead
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

  // P3-G (§D5): the Artifacts tab, a singleton like Settings that the pin control never applies to.
  it('admits the Artifacts tab as an unpinnable singleton', () => {
    const artifacts = { id: 'artifacts', kind: 'artifacts', pinned: false };
    expect(TabRefSchema.parse(artifacts)).toEqual(artifacts);
    expect(TabRefSchema.safeParse({ ...artifacts, pinned: true }).success).toBe(false);
    expect(TabRefSchema.safeParse({ ...artifacts, id: 'artifacts:2' }).success).toBe(false);
    expect(tabId({ kind: 'artifacts' })).toBe('artifacts');
    expect(UNPINNABLE_KINDS.has('artifacts')).toBe(true);
  });

  // P3-L (Decision Log 7, 8): one artifact in its kind's editor, one tab per artifact, pinnable like a file tab.
  it('admits an artifact tab with its artifact id, pinnable, and derives its id from the artifact', () => {
    const tab = { id: 'artifact:0b6f7d52-1c1f-4c4e-9a37-5d0e7a0d1a01', kind: 'artifact', artifactId: '0b6f7d52-1c1f-4c4e-9a37-5d0e7a0d1a01', pinned: true };
    expect(TabRefSchema.parse(tab)).toEqual(tab);
    expect(TabRefSchema.safeParse({ ...tab, appSessionId: 'a1' }).success, 'no session: the tab is the workspace’s').toBe(false);
    expect(TabRefSchema.safeParse({ ...tab, artifactId: undefined }).success).toBe(false);
    expect(tabId({ kind: 'artifact', artifactId: tab.artifactId })).toBe(tab.id);
    expect(UNPINNABLE_KINDS.has('artifact')).toBe(false);
    // a stored main.tabs holding one reads as it is, in a pane and in the closed-tab history
    const main = { ...LAYOUT_DEFAULTS.main, sets: { none: { panes: [{ tabs: [tab], activeTabId: tab.id }], focusedPane: 0, splitRatio: 0.5 } }, closedTabs: [{ ...tab, pinned: false }] };
    expect(StoredMainSchema.parse(main)).toEqual(main);
  });

  // P3-G (§D5; the coordinator's condition, 2026-10-12): `main.tabs` keeps version 2 when a tab kind is added, so its
  // reader drops a tab of a kind it does not know (a later build's, after a downgrade) rather than failing the whole
  // value back to the default; the rest of the layout is kept, and the read warns once.
  describe('a stored main.tabs holding a tab of a kind this build does not know', () => {
    const session = (n: number) => ({ id: `session:a${n}`, kind: 'session', appSessionId: `a${n}`, pinned: false });
    const later = (n: number) => ({ id: `library:${n}`, kind: 'library', shelf: n, pinned: false });
    const v2 = (panes: unknown[], over: object = {}) => ({ version: 2, current: 'proj-x', sets: { 'proj-x': { panes, focusedPane: 0, splitRatio: 0.4, ...over }, none: LAYOUT_DEFAULTS.main.sets.none }, closedTabs: [] });
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    it('drops the tab from a pane, keeping the pane’s active tab', () => {
      const main = v2([{ tabs: [session(1), later(1), session(2)], activeTabId: 'session:a2' }]);
      expect(StoredMainSchema.parse(main)).toEqual(v2([{ tabs: [session(1), session(2)], activeTabId: 'session:a2' }]));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('[layout] dropped 1 tab(s) of unknown kind: library');
    });

    it('activates the pane’s first remaining tab when the dropped tab was the active one', () => {
      const main = v2([{ tabs: [session(1), later(1), session(2)], activeTabId: 'library:1' }]);
      expect(StoredMainSchema.parse(main)).toEqual(v2([{ tabs: [session(1), session(2)], activeTabId: 'session:a1' }]));
    });

    it('drops a pane the tab was alone in, focusing pane 0, and leaves one empty pane when nothing else was open', () => {
      const split = v2([{ tabs: [session(1)], activeTabId: 'session:a1' }, { tabs: [later(1)], activeTabId: 'library:1' }], { focusedPane: 1 });
      expect(StoredMainSchema.parse(split)).toEqual(v2([{ tabs: [session(1)], activeTabId: 'session:a1' }]));
      const alone = v2([{ tabs: [later(1)], activeTabId: 'library:1' }]);
      expect(StoredMainSchema.parse(alone)).toEqual(v2([{ tabs: [], activeTabId: '' }]));
    });

    it('drops the tab from the closed-tab history', () => {
      const main = { ...v2([{ tabs: [session(1)], activeTabId: 'session:a1' }]), closedTabs: [session(2), later(1), session(3)] };
      expect(StoredMainSchema.parse(main).closedTabs).toEqual([session(2), session(3)]);
    });

    it('warns once per read, naming every unknown kind, across sets, panes and the history', () => {
      const other = (n: number) => ({ id: `canvas:${n}`, kind: 'canvas', pinned: false });
      const main = {
        version: 2,
        current: 'proj-x',
        sets: {
          'proj-x': { panes: [{ tabs: [later(1), session(1)], activeTabId: 'session:a1' }, { tabs: [other(1), session(2)], activeTabId: 'canvas:1' }], focusedPane: 1, splitRatio: 0.4 },
          none: { panes: [{ tabs: [later(3)], activeTabId: 'library:3' }], focusedPane: 0, splitRatio: 0.5 },
        },
        closedTabs: [later(2)],
      };
      expect(StoredMainSchema.parse(main)).toEqual({
        version: 2,
        current: 'proj-x',
        closedTabs: [],
        sets: {
          'proj-x': { panes: [{ tabs: [session(1)], activeTabId: 'session:a1' }, { tabs: [session(2)], activeTabId: 'session:a2' }], focusedPane: 1, splitRatio: 0.4 },
          none: { panes: [{ tabs: [], activeTabId: '' }], focusedPane: 0, splitRatio: 0.5 },
        },
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('[layout] dropped 4 tab(s) of unknown kind: library, canvas');
    });

    it('reads version 1 the same way', () => {
      const main = { version: 1, panes: [{ tabs: [later(1), session(1)], activeTabId: 'library:1' }], focusedPane: 0, splitRatio: 0.5, closedTabs: [later(2)] };
      expect(StoredMainSchema.parse(main)).toEqual({ ...main, panes: [{ tabs: [session(1)], activeTabId: 'session:a1' }], closedTabs: [] });
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('stays silent for a layout with only known kinds, and still fails a known kind that breaks its schema', () => {
      const main = v2([{ tabs: [session(1)], activeTabId: 'session:a1' }]);
      expect(StoredMainSchema.parse(main)).toEqual(main);
      expect(StoredMainSchema.safeParse(v2([{ tabs: [{ ...session(1), pinned: 'yes' }], activeTabId: 'session:a1' }])).success).toBe(false);
      expect(StoredMainSchema.safeParse({ ...main, closedTabs: [{ id: 'settings', kind: 'settings', pinned: false }] }).success).toBe(false);
      // a tab with no kind at all is malformed, not of an unknown kind
      expect(StoredMainSchema.safeParse(v2([{ tabs: [{ id: 'x', pinned: false }], activeTabId: 'x' }])).success).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    });
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
      'layout.captureRegion': 'main', // P3-G: Mark-up's still of a region the window draws
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
