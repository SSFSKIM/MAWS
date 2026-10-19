// The design's X32 header (P3-E1 M3, M4): Version history, Comments, Zoom to fit and Theme, each reading and driving the
// tab's own state, in the X32 row's order; the open threads counted; the saved word is the deck's.
import { describe, expect, it } from 'vitest';
import { designHeader, type DesignHeaderState } from './header';

const live = { phase: 'live', synced: true, unsaved: 0, readOnly: false } as unknown as DesignHeaderState['document'];
const state = (patch: Partial<DesignHeaderState> = {}): DesignHeaderState => ({ title: 'Launch screens', document: live, saving: false, closeGuard: async () => true, rail: null, ...patch });

describe('the design header', () => {
  it('offers Version history, Comments, Zoom to fit and Theme, in that order, each driving the tab', () => {
    const calls: string[] = [];
    const header = designHeader(state({ history: true, unresolved: 2 }), { fitAll: () => calls.push('fit'), toggleRail: (rail) => calls.push(rail) });
    expect(header.actions?.map((a) => [a.id, a.label])).toEqual([
      ['history', 'Version history'],
      ['comments', 'Comments'],
      ['zoom-to-fit', 'Zoom to fit'],
      ['theme', 'Theme'],
    ]);
    for (const action of header.actions ?? []) action.onSelect();
    expect(calls).toEqual(['history', 'comments', 'fit', 'theme']);
    expect([header.title, header.saved, header.unresolved]).toEqual(['Launch screens', 'saved', 2]);
  });

  it('offers no Version history without the tab’s history, and shows the open rail pressed', () => {
    const header = designHeader(state({ rail: 'comments' }), { fitAll: () => {}, toggleRail: () => {} });
    expect(header.actions?.map((a) => a.id)).toEqual(['comments', 'zoom-to-fit', 'theme']);
    expect(header.actions!.find((a) => a.id === 'comments')!.pressed).toBe(true);
    expect(header.unresolved).toBeUndefined();
  });

  it('M5: carries the tab’s Export entries as given', () => {
    const exports = [{ id: 'png', label: 'PNG (selected board)', onSelect: () => {} }];
    expect(designHeader(state({ exports }), { fitAll: () => {}, toggleRail: () => {} }).exports).toBe(exports);
    expect(designHeader(state()).exports).toBeUndefined();
  });

  it('shows Theme pressed while its panel is open, read-only as read-only, and no actions before the design opens', () => {
    const header = designHeader(state({ rail: 'theme', document: { ...live!, readOnly: true } }), { fitAll: () => {}, toggleRail: () => {} });
    expect(header.actions!.find((a) => a.id === 'theme')!.pressed).toBe(true);
    expect(header.saved).toBe('readonly');
    expect(designHeader(state()).actions).toBeUndefined();
  });

  it('(design-workbench scalpel-2#2) offers Zoom to fit disabled while the history shows a version in place of the live world', () => {
    const zoom = (previewing?: boolean) => designHeader(state({ previewing }), { fitAll: () => {}, toggleRail: () => {} }).actions!.find((a) => a.id === 'zoom-to-fit')!;
    expect(zoom(true).disabled).toBe(true);
    expect(zoom(false).disabled).toBeFalsy();
    expect(zoom().disabled).toBeFalsy();
  });
});
