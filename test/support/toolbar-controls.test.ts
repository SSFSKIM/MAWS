// P3-F wave S, F3: what e2e/support/toolbar-controls.ts's squeezedControls counts as a squeezed control, judged from the
// page's measurements (e2e/support/toolbar-judge.ts). The document's toolbar at the panel's 280 px holds two scrolling
// strips side by side: a control scrolled out of its strip's view keeps a layout box under the next strip's controls,
// and is not squeezed; nor does the part of a control its strip clips overlap anything. The deck's defect the owner saw
// (labels a letter a line, Comment over Comments, the zoom reading "Fi", a control past the panel) is still named.
import { describe, expect, it } from 'vitest';
import { squeezed, type Box, type MeasuredControl } from '../../e2e/support/toolbar-judge';

const box = (left: number, right: number, top = 8, bottom = 36): Box => ({ left, right, top, bottom });
/** A control laid out at left–right whose label is one 16 px line inside it, shown whole unless `shown` says otherwise. */
function control(name: string, left: number, right: number, extra: Partial<MeasuredControl> = {}): MeasuredControl {
  const b = box(left, right);
  return { name, select: false, box: b, shown: b, clientWidth: right - left, clientHeight: 28, scrollWidth: right - left, scrollHeight: 28, label: [box(left + 6, right - 6, 14, 30)], ...extra };
}
const NARROW = { within: { x: 0, width: 280 }, maxHeight: 36, minSelect: 56 };

describe('a toolbar control is squeezed', () => {
  it('never for the document toolbar at 280 px: controls scrolled out of a strip, or clipped by it, under the next strip', () => {
    // the tools strip shows 8–92, the end strip 96–272 (document/editor/chrome.css's two strips at the panel's minimum)
    const controls = [
      control('Block type', 8, 74, { select: true, label: [] }),
      control('Undo', 76, 104, { shown: box(76, 92) }), // half in the tools strip's view, under Comment's box
      control('Bold', 106, 134, { shown: null }),
      control('Italic', 136, 164, { shown: null }),
      control('Insert', 166, 230, { shown: null }),
      control('Comment', 96, 170),
      control('Comments (2 open)', 172, 254),
      control('Version history', 256, 320, { shown: box(256, 272) }), // the end strip scrolls too
      control('Find', 322, 360, { shown: null }),
    ];
    expect(squeezed(controls, NARROW)).toEqual([]);
    expect(squeezed(controls, { ...NARROW, within: null })).toEqual([]);
  });

  it('still for the deck’s defect: a label a letter a line, Comment over Comments, the zoom select at 22 px, a control past the panel', () => {
    const letters = Array.from('Text style', (_, i) => box(210, 216, 14 + 16 * i, 30 + 16 * i)); // one line box per letter
    const found = squeezed(
      [
        control('Undo', 8, 34),
        control('Text style', 200, 226, { label: letters }),
        control('Comment', 228, 254),
        control('Comments (3 open)', 250, 276),
        control('Zoom', 278, 300, { select: true, label: [] }),
      ],
      NARROW,
    );
    expect(found).toEqual([
      'Text style: label 10 lines, text 210–216 in 200–226',
      'Comment overlaps Comments (3 open)',
      'Zoom: a select 22 px wide',
      'Zoom: 278–300 past 0–280',
    ]);
  });

  it('still where two controls a strip shows overlap there, or a control it shows reaches past the panel', () => {
    expect(squeezed([control('Bold', 8, 40, { shown: box(8, 40) }), control('Italic', 30, 60, { shown: box(30, 60) })], NARROW)).toEqual(['Bold overlaps Italic']);
    expect(squeezed([control('Find', 250, 300, { shown: box(250, 290) })], NARROW)).toEqual(['Find: 250–290 past 0–280']);
  });
});
