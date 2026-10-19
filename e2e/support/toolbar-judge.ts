// P3-F wave S, F3 (docs/doperpowers/plans/2026-10-18-p3-f-finish.md, Wave S triage c37, c40, obs 9): the judgement of
// toolbar-controls.ts's `squeezedControls`, made outside the page from what the page measured. Free of Playwright, so
// test/support/toolbar-controls.test.ts checks it.

/** A box in the page's coordinates. */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A toolbar control as the page measured it. */
export interface MeasuredControl {
  name: string;
  select: boolean;
  /** Its layout box (getBoundingClientRect, which no ancestor's clipping narrows). */
  box: Box;
  /** The part of it its toolbar shows: its box clipped to every scrolling or clipping ancestor inside the toolbar (a
   *  strip's view); its whole box when none clips it; null when it is scrolled wholly out of view. */
  shown: Box | null;
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  /** Its label's text runs (the Range rects of its text nodes); none for a select or an icon without text. */
  label: Box[];
}

export interface Judged {
  /** The box no control may reach past sideways (the panel), none to read no such bound. */
  within: { x: number; width: number } | null;
  /** The tallest a control may be: one row's. */
  maxHeight: number;
  /** The narrowest a select may be (it draws no text node, so its squeezed label cannot be read). */
  minSelect: number;
}

/**
 * Every control that is squeezed, each named with what it measured: its label not one line inside it (spanning more than
 * one line's height or reaching past its sides), taller than one row, scrolling its own content, a select narrower than
 * its label needs, overlapping another control where both are shown, or reaching past `within`'s sides where it is
 * shown. A control its strip has scrolled wholly out of view is not squeezed (the strip scrolls it), and the part a strip
 * clips covers nothing. None, when every control keeps its own width and its label on one line.
 */
export function squeezed(controls: MeasuredControl[], { within, maxHeight, minSelect }: Judged): string[] {
  const found: string[] = [];
  const r = Math.round;
  const inView = controls.filter((c): c is MeasuredControl & { shown: Box } => c.shown !== null);
  inView.forEach((c, i) => {
    const { box, shown } = c;
    if (c.clientHeight > maxHeight) found.push(`${c.name}: ${c.clientHeight} px tall`);
    if (c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 1) found.push(`${c.name}: content ${c.scrollWidth}×${c.scrollHeight} in ${c.clientWidth}×${c.clientHeight}`);
    if (c.select && box.right - box.left < minSelect) found.push(`${c.name}: a select ${r(box.right - box.left)} px wide`);
    if (within && (shown.left < within.x - 1 || shown.right > within.x + within.width + 1)) found.push(`${c.name}: ${r(shown.left)}–${r(shown.right)} past ${r(within.x)}–${r(within.x + within.width)}`);
    if (c.label.length > 0) {
      const line = Math.max(...c.label.map((t) => t.bottom - t.top));
      const lines = r((Math.max(...c.label.map((t) => t.bottom)) - Math.min(...c.label.map((t) => t.top))) / line);
      const [left, right] = [Math.min(...c.label.map((t) => t.left)), Math.max(...c.label.map((t) => t.right))];
      if (lines > 1 || left < box.left - 0.5 || right > box.right + 0.5) found.push(`${c.name}: label ${lines} lines, text ${r(left)}–${r(right)} in ${r(box.left)}–${r(box.right)}`);
    }
    for (const other of inView.slice(i + 1)) {
      const [w, h] = [Math.min(shown.right, other.shown.right) - Math.max(shown.left, other.shown.left), Math.min(shown.bottom, other.shown.bottom) - Math.max(shown.top, other.shown.top)];
      if (w > 1 && h > 1) found.push(`${c.name} overlaps ${other.name}`);
    }
  });
  return found;
}
