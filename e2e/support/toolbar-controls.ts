// P3-F wave S, F3 (docs/doperpowers/plans/2026-10-18-p3-f-finish.md, Wave S triage c37, c40, obs 9): what an editor's
// toolbar holds in a narrow panel, read from the page. Its row wraps by whole controls (the deck family) or scrolls as
// one strip (the document's), and never squeezes a control: the owner saw a deck's labels stand one letter a line over
// the canvas ("Text style", "Comment" over "Comments 3", the zoom reading "Fi").
import { expect, type Locator, type Page } from '@playwright/test';
import { squeezed, type Box, type MeasuredControl } from './toolbar-judge';

/** The shared deck/design element commands live in Arrange at every editor width. */
export async function openArrange(page: Page, editor: Locator): Promise<Locator> {
  await editor.getByRole('button', { name: 'Arrange', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Arrange', exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

export interface ControlBounds {
  /** The box no control may reach past sideways (the panel); none to read no such bound. */
  within?: Locator;
  /** The tallest a control may be: one row's. */
  maxHeight?: number;
  /** The narrowest a select may be (it draws no text node, so its squeezed label cannot be read). */
  minSelect?: number;
}

/**
 * Every control (button, select) of the toolbar's own row, not an open menu's or a form's, that is squeezed, each named
 * with what it measured (toolbar-judge.ts's `squeezed`): a label that is not one line inside its button (its text runs,
 * Range rects of its text nodes, which a fixed-height button's clipping does not hide), a control taller than one row or
 * scrolling its own content, a select narrower than its label needs, two controls overlapping where they are shown, or a
 * control past `within`'s sides. Where a control is shown is its box clipped to each scrolling or clipping ancestor
 * inside the toolbar (the document's two strips at 280 px: a button scrolled out of the tools strip keeps a layout box
 * under the end strip's), and a control scrolled wholly out of view is not squeezed. None, when every control keeps its
 * own width and its label on one line.
 */
export async function squeezedControls(toolbar: Locator, bounds: ControlBounds = {}): Promise<string[]> {
  const box = bounds.within ? await bounds.within.boundingBox() : null;
  const measured = await toolbar.evaluate((bar): MeasuredControl[] => {
    const edges = (r: { left: number; right: number; top: number; bottom: number }): Box => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    const controls = Array.from(bar.querySelectorAll<HTMLElement>('button, select')).filter((c) => !c.closest('[role="menu"], [role="dialog"], form') && c.getClientRects().length > 0);
    return controls.map((control) => {
      const own = edges(control.getBoundingClientRect());
      // clipped to the client area of each ancestor up to the toolbar that does not let it overflow
      let shown: Box | null = own;
      for (let a = control.parentElement; a && shown && bar.contains(a); a = a.parentElement) {
        if (getComputedStyle(a).overflowX === 'visible') continue;
        const r = a.getBoundingClientRect();
        const view = { left: r.left + a.clientLeft, right: r.left + a.clientLeft + a.clientWidth, top: r.top + a.clientTop, bottom: r.top + a.clientTop + a.clientHeight };
        const cut: Box = { left: Math.max(shown.left, view.left), right: Math.min(shown.right, view.right), top: Math.max(shown.top, view.top), bottom: Math.min(shown.bottom, view.bottom) };
        shown = cut.right - cut.left > 0.5 && cut.bottom - cut.top > 0.5 ? cut : null;
      }
      const label: Box[] = [];
      const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim() || node.parentElement?.closest('option')) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        label.push(...Array.from(range.getClientRects()).filter((r) => r.width > 0).map(edges));
      }
      return {
        name: control.getAttribute('aria-label') ?? (control.textContent?.trim() || control.tagName.toLowerCase()),
        select: control.tagName === 'SELECT',
        box: own,
        shown,
        clientWidth: control.clientWidth,
        clientHeight: control.clientHeight,
        scrollWidth: control.scrollWidth,
        scrollHeight: control.scrollHeight,
        label,
      };
    });
  });
  return squeezed(measured, { within: box && { x: box.x, width: box.width }, maxHeight: bounds.maxHeight ?? 36, minSelect: bounds.minSelect ?? 56 });
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
