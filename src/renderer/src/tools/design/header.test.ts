// The design's X32 header (P3-E1 M3): Zoom to fit and Theme, each reading and driving the tab's own state; the saved
// word is the deck's.
import { describe, expect, it } from 'vitest';
import { designHeader, type DesignHeaderState } from './header';

const live = { phase: 'live', synced: true, unsaved: 0, readOnly: false } as unknown as DesignHeaderState['document'];
const state = (patch: Partial<DesignHeaderState> = {}): DesignHeaderState => ({ title: 'Launch screens', document: live, saving: false, closeGuard: async () => true, rail: null, ...patch });

describe('the design header', () => {
  it('offers Zoom to fit and Theme, in that order, each driving the tab', () => {
    const calls: string[] = [];
    const header = designHeader(state(), { fitAll: () => calls.push('fit'), toggleRail: (rail) => calls.push(rail) });
    expect(header.actions?.map((a) => [a.id, a.label])).toEqual([
      ['zoom-to-fit', 'Zoom to fit'],
      ['theme', 'Theme'],
    ]);
    for (const action of header.actions ?? []) action.onSelect();
    expect(calls).toEqual(['fit', 'theme']);
    expect([header.title, header.saved]).toEqual(['Launch screens', 'saved']);
  });

  it('shows Theme pressed while its panel is open, read-only as read-only, and no actions before the design opens', () => {
    const header = designHeader(state({ rail: 'theme', document: { ...live!, readOnly: true } }), { fitAll: () => {}, toggleRail: () => {} });
    expect(header.actions!.find((a) => a.id === 'theme')!.pressed).toBe(true);
    expect(header.saved).toBe('readonly');
    expect(designHeader(state()).actions).toBeUndefined();
  });
});
