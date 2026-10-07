// browser_snapshot's page read (E4c execution document, Design §5; A-33 item 5; Decision Log 14): Playwright's
// ai-mode aria snapshot of the whole page, or rooted at one element: a ref (counted first), or the first element of a
// landmark role (how many there are is the header's `rootMatches`; one root only, since each snapshot replaces its
// frame's ref table and several would invalidate each other's refs). The cut is the pure `cutSnapshot`.
import type { Locator, Page } from 'playwright-core';
import { BROWSER_TOOL_ERRORS, LANDMARK_ROLES, type BrowserSnapshotInput, type LandmarkRole } from '@shared/maws/browser';
import { BrowserToolError } from './errors';
import { isGoneFrame } from './locate';

export interface TakenSnapshot {
  text: string;
  rootMatches: number | null; // a landmark root's match count
}

export async function takeSnapshot(page: Page, root: BrowserSnapshotInput['root'], signal: AbortSignal): Promise<TakenSnapshot> {
  const options = { mode: 'ai' as const, signal };
  if (root === undefined) return { text: await page.ariaSnapshot(options), rootMatches: null };
  const notFound = () => new BrowserToolError(BROWSER_TOOL_ERRORS.rootNotFound(root));
  if (isLandmark(root)) {
    const landmarks = page.getByRole(root);
    const rootMatches = await landmarks.count();
    if (rootMatches === 0) throw notFound();
    return { text: await landmarks.first().ariaSnapshot(options), rootMatches };
  }
  const element = page.locator(`aria-ref=${root}`);
  if ((await countOrZero(element)) === 0) throw notFound();
  return { text: await element.ariaSnapshot(options), rootMatches: null };
}

const isLandmark = (root: string): root is LandmarkRole => (LANDMARK_ROLES as readonly string[]).includes(root);

// A ref whose frame is gone resolves nothing either (`Invalid frame in aria-ref selector`).
async function countOrZero(locator: Locator): Promise<number> {
  try {
    return await locator.count();
  } catch (error) {
    if (isGoneFrame(error)) return 0;
    throw error;
  }
}
