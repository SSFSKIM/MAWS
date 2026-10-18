// E3 M4: the live dataset acceptance's on-screen judgement of the source sheet's live query block
// (e2e/support/live-data-bounds.ts), over measurements as the spec takes them in the page.
import { describe, expect, it } from 'vitest';
import { boundsProblems, type BlockMeasure } from '../../e2e/support/live-data-bounds';

const SHEET = { left: 900, top: 40, right: 1440, bottom: 860 };
const control = (name: string, box: Partial<BlockMeasure['controls'][number]['box']> = {}, text = { scrollWidth: 60, clientWidth: 60 }) => ({ name, box: { left: 940, top: 300, right: 1000, bottom: 328, ...box }, ...text });
const measure = (controls: BlockMeasure['controls'], over: Partial<BlockMeasure> = {}): BlockMeasure => ({ scrollWidth: 480, clientWidth: 480, sheet: SHEET, viewport: { width: 1440, height: 900 }, controls, ...over });

describe('the live block’s bounds (E3 M4)', () => {
  it('finds nothing when every control lies inside the sheet and the window, within subpixel rounding', () => {
    expect(boundsProblems(measure([control('Allow'), control('Refresh', { left: 1010, right: 1440.5, bottom: 859.6 })]))).toEqual([]);
  });

  it('names a control below or above the visible sheet, and one below the window though the sheet runs on', () => {
    expect(boundsProblems(measure([control('Start session', { top: 850, bottom: 878 })]))).toEqual(['Start session falls below the visible sheet']);
    expect(boundsProblems(measure([control('Revoke', { top: 20, bottom: 48 })]))).toEqual(['Revoke rises above the visible sheet']);
    expect(boundsProblems(measure([control('Refresh', { top: 880, bottom: 908 })], { sheet: { ...SHEET, bottom: 1_200 } }))).toEqual(['Refresh falls below the visible sheet']);
  });

  it('names a control past the sheet’s or the window’s side, a clipped label, and a block that scrolls sideways', () => {
    expect(boundsProblems(measure([control('Allow', { left: 880 })]))).toEqual(['Allow overflows sideways']);
    expect(boundsProblems(measure([control('Allow', { right: 1460 })], { sheet: { ...SHEET, right: 1500 } }))).toEqual(['Allow overflows sideways']);
    expect(boundsProblems(measure([control('Show latest', {}, { scrollWidth: 90, clientWidth: 60 })]))).toEqual(['Show latest clips its text']);
    expect(boundsProblems(measure([], { scrollWidth: 520 }))).toEqual(['the block scrolls sideways (520 > 480)']);
  });
});
