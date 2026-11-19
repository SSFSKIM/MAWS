// The line "Open in" hands an editor (UX wave U6b-4a, docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4a-open-in.md,
// decision 5): the cursor's line while it is shown, else the first line shown; none with no code view.
import { describe, expect, it } from 'vitest';
import { lineToOpen, registerShownLine, shownLine } from './shown-line';

describe('the line to open', () => {
  it('is the cursor’s line while the cursor is shown, else the first line shown', () => {
    expect(lineToOpen({ cursor: { line: 40, shown: true }, top: 31 })).toBe(40);
    expect(lineToOpen({ cursor: { line: 2, shown: false }, top: 31 })).toBe(31);
    expect(lineToOpen({ cursor: { line: 2, shown: false }, top: null })).toBe(2);
    expect(lineToOpen({ cursor: null, top: null })).toBeNull();
  });

  it('is read from the tab’s mounted view, none once it unmounts, and a later view’s registration outlives an earlier removal', () => {
    expect(shownLine('tab-1')).toBeNull();
    const first = registerShownLine('tab-1', () => ({ cursor: { line: 7, shown: true }, top: 1 }));
    expect(shownLine('tab-1')).toBe(7);
    const second = registerShownLine('tab-1', () => ({ cursor: null, top: 12 }));
    first();
    expect(shownLine('tab-1')).toBe(12);
    second();
    expect(shownLine('tab-1')).toBeNull();
  });
});
