// P3-F wave S, F3 (docs/doperpowers/plans/2026-10-18-p3-f-finish.md, Wave S triage c37, c40, obs 9): what an editor's
// toolbar holds in a narrow panel, read from the page. Its row wraps by whole controls (the deck family) or scrolls as
// one strip (the document's), and never squeezes a control: the owner saw a deck's labels stand one letter a line over
// the canvas ("Text style", "Comment" over "Comments 3", the zoom reading "Fi").
import { expect, type Locator, type Page } from '@playwright/test';

export interface ControlBounds {
  /** The box no control may reach past sideways (the panel); none for a strip that scrolls its controls out of view. */
  within?: Locator;
  /** The tallest a control may be: one row's. */
  maxHeight?: number;
  /** The narrowest a select may be (it draws no text node, so its squeezed label cannot be read). */
  minSelect?: number;
}

/**
 * Every control (button, select) of the toolbar's own row, not an open menu's or a form's, that is squeezed, each named
 * with what it measured: a label that is not one line inside its button (its text runs, Range rects of its text nodes,
 * which a fixed-height button's clipping does not hide, spanning more than one line's height or reaching past the
 * button's sides), a control taller than one row or scrolling its own content (scrollWidth over clientWidth, or
 * scrollHeight over clientHeight), a select narrower than its label needs, two controls overlapping, or a control past
 * `within`'s sides. None, when every control keeps its own width and its label on one line.
 */
export async function squeezedControls(toolbar: Locator, bounds: ControlBounds = {}): Promise<string[]> {
  const within = bounds.within ? await bounds.within.boundingBox() : null;
  return toolbar.evaluate(
    (bar, { within, maxHeight, minSelect }) => {
      const found: string[] = [];
      const controls = Array.from(bar.querySelectorAll<HTMLElement>('button, select')).filter((c) => !c.closest('[role="menu"], [role="dialog"], form') && c.getClientRects().length > 0);
      const name = (c: HTMLElement) => c.getAttribute('aria-label') ?? (c.textContent?.trim() || c.tagName.toLowerCase());
      const boxes = controls.map((c) => c.getBoundingClientRect());
      controls.forEach((control, i) => {
        const box = boxes[i]!;
        const what = name(control);
        if (control.clientHeight > maxHeight) found.push(`${what}: ${control.clientHeight} px tall`);
        if (control.scrollWidth > control.clientWidth + 1 || control.scrollHeight > control.clientHeight + 1) found.push(`${what}: content ${control.scrollWidth}×${control.scrollHeight} in ${control.clientWidth}×${control.clientHeight}`);
        if (control.tagName === 'SELECT' && box.width < minSelect) found.push(`${what}: a select ${Math.round(box.width)} px wide`);
        if (within && (box.left < within.x - 1 || box.right > within.x + within.width + 1)) found.push(`${what}: ${Math.round(box.left)}–${Math.round(box.right)} past ${Math.round(within.x)}–${Math.round(within.x + within.width)}`);
        const rects: DOMRect[] = [];
        const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim() || node.parentElement?.closest('option')) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          rects.push(...Array.from(range.getClientRects()).filter((r) => r.width > 0));
        }
        if (rects.length > 0) {
          const line = Math.max(...rects.map((r) => r.height));
          const lines = Math.round((Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top))) / line);
          const [left, right] = [Math.min(...rects.map((r) => r.left)), Math.max(...rects.map((r) => r.right))];
          if (lines > 1 || left < box.left - 0.5 || right > box.right + 0.5) found.push(`${what}: label ${lines} lines, text ${Math.round(left)}–${Math.round(right)} in ${Math.round(box.left)}–${Math.round(box.right)}`);
        }
        for (let j = i + 1; j < controls.length; j++) {
          const other = boxes[j]!;
          const [w, h] = [Math.min(box.right, other.right) - Math.max(box.left, other.left), Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top)];
          if (w > 1 && h > 1) found.push(`${what} overlaps ${name(controls[j]!)}`);
        }
      });
      return found;
    },
    { within, maxHeight: bounds.maxHeight ?? 36, minSelect: bounds.minSelect ?? 56 },
  );
}

/** The right panel dragged to `width` by its divider (it grows as the divider moves left), the panel's 280 px minimum included. */
export async function resizePanel(page: Page, width: number): Promise<void> {
  const divider = page.locator('[data-region="panel"]').getByRole('separator', { name: 'Resize right panel' });
  const now = Number(await divider.getAttribute('aria-valuenow'));
  const grip = (await divider.boundingBox())!;
  const [x, y] = [grip.x + grip.width / 2, grip.y + grip.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - (width - now), y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Number(await divider.getAttribute('aria-valuenow'))).toBe(width);
}
