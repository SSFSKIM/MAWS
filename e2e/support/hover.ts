// A control shown only while something is hovered (a project row's "+", a tab's close, a gutter's comment mark, a user
// bubble's Edit), clicked through that hover. An e2e window still hears the desktop's own pointer: MAWS_E2E_QUIET's
// setIgnoreMouseEvents lets clicks pass through it, but the real cursor crossing the window still reaches the page as a
// mouseover and a document mouseleave at the cursor's position (measured 2026-10-08 on the packaged and the built app
// alike, with the owner at the desktop), and one landing between the hover and the click hides the control for good. So
// the hover is made again until the click lands; a click that landed is never repeated.
import { expect, type Locator } from '@playwright/test';

export async function clickRevealed(hovered: Locator, control: Locator): Promise<void> {
  await expect(async () => {
    await hovered.hover();
    await control.click({ timeout: 3_000 });
  }, 'the hover-revealed control takes the click').toPass({ timeout: 20_000 });
}
