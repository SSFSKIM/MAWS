// The word cut's hidden headings and page titles (`ui/hidden-heading.tsx`, the title bar's W6, New chat's W86): text
// kept for assistive technology and drawn nowhere. Playwright's `toBeVisible` counts Tailwind's sr-only box (one pixel,
// clipped to nothing) as visible, and `getByRole` still finds it, so neither proves the cut. These read the box and its
// computed clip instead. (design-geometry.ts's `visuallyHidden` knows Tailwind 3's `inset(100%)`; Tailwind 4, which the
// app builds with, clips with `inset(50%)`.)
import { expect, type Locator, type Page } from '@playwright/test';

interface Draw {
  w: number;
  h: number;
  clip: string;
  clipPath: string;
}

const CLIPPED_TO_NOTHING = /^rect\(\s*0(px)?\s*,?\s*0(px)?\s*,?\s*0(px)?\s*,?\s*0(px)?\s*\)$/;

function drawnNowhere({ w, h, clip, clipPath }: Draw): boolean {
  return w <= 1 && h <= 1 && (CLIPPED_TO_NOTHING.test(clip.trim()) || /^inset\((50|100)%\)$/.test(clipPath.trim()));
}

const drawOf = (target: Locator): Promise<Draw> =>
  target.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return { w: box.width, h: box.height, clip: style.clip, clipPath: style.clipPath };
  });

/** The one element `target` names is in the document and drawn nowhere: a box of at most one pixel clipped to nothing. */
export async function expectScreenReaderOnly(target: Locator, message = 'kept for a screen reader, drawn nowhere'): Promise<void> {
  await expect(target, message).toHaveCount(1);
  await expect.poll(async () => drawnNowhere(await drawOf(target)), { message }).toBe(true);
}

/** The positive twin: the one element `target` names is visible and drawn, not the screen-reader box `toBeVisible` passes. */
export async function expectDrawn(target: Locator, message = 'drawn, not only kept for a screen reader'): Promise<void> {
  await expect(target, message).toBeVisible();
  await expect.poll(async () => drawnNowhere(await drawOf(target)), { message }).toBe(false);
}

/** New chat's heading (W86): a screen-reader `h1` naming the project, drawn nowhere. */
export function newChatHeading(root: Page | Locator, project: string): Locator {
  return root.getByRole('heading', { name: `New chat in ${project}` });
}

/**
 * The New chat page of `project` is the page in front: its heading is in the accessibility tree of the shown tab (a
 * tab behind has no box at all, so `toBeVisible` still tells the front from the back), and it is drawn nowhere.
 */
export async function expectNewChatInFront(root: Page | Locator, project: string, options?: { timeout?: number; message?: string }): Promise<void> {
  const heading = newChatHeading(root, project);
  await expect(heading, options?.message).toBeVisible({ timeout: options?.timeout });
  await expectScreenReaderOnly(heading, options?.message);
}
