import { describe, expect, it } from 'vitest';
import { LAYOUT_DEFAULTS, StoredMainSchema } from '@shared/ipc/schema/layout';
import { activeTab, currentSet, openTab, togglePinned } from '../stores/layout-model';

describe('app destinations', () => {
  it('reopens Customize at the requested section without duplicating or pinning it', () => {
    let main = openTab(LAYOUT_DEFAULTS.main, { kind: 'customize', section: 'plugins' });
    main = openTab(main, { kind: 'projects' });
    main = openTab(main, { kind: 'customize', section: 'mcp' });
    expect(currentSet(main).panes[0].tabs.map((tab) => tab.id)).toEqual(['customize', 'projects']);
    expect(activeTab(main)).toEqual({ id: 'customize', kind: 'customize', section: 'mcp', pinned: false });
    expect(togglePinned(main, 'customize')).toBe(main);
    expect(togglePinned(main, 'projects')).toBe(main);
    expect(StoredMainSchema.parse(main)).toEqual(main);
  });
});
