// The app icon's badge (the Badging API; an iPhone's home-screen app from iOS 16.4): the org's waiting count. A push
// sets it from its payload (the service worker); while the app is open it follows the grid, so a request answered
// anywhere clears it here too.
import type { ProjectSummary } from 'desk-hub/protocol';

type Badging = { setAppBadge?(count: number): Promise<void>; clearAppBadge?(): Promise<void> };

/** The grid's waiting count over the org: what a push's `waiting` carries. */
export const orgWaiting = (projects: readonly ProjectSummary[]): number => projects.reduce((n, p) => n + p.waiting, 0);

/** Shows `count` on the icon, clearing it at 0; nothing where the platform has no badge, and a refusal is let go. */
export async function showBadge(nav: Badging, count: number): Promise<void> {
  try {
    if (count === 0 && typeof nav.clearAppBadge === 'function') await nav.clearAppBadge();
    else if (typeof nav.setAppBadge === 'function') await nav.setAppBadge(count);
  } catch {
    // A badge is a hint; the grid itself says the count.
  }
}
