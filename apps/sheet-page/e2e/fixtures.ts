// The suite's fixtures: a daemon of the rig for each test (§Q), stopped and its scratch removed after it, and what a
// spec reads of a page from outside it: the requests the browser made and the content-policy violations it raised.
import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { startMawsd, type Mawsd } from './rig';

export const test = base.extend<{ mawsd: Mawsd }>({
  // eslint-disable-next-line no-empty-pattern
  mawsd: async ({}, use) => {
    const mawsd = await startMawsd();
    await use(mawsd);
    await mawsd.dispose();
  },
});
export { expect } from '@playwright/test';

export const SESSION = '5eed0000-0000-4000-8000-000000000019';
export const BAR = 'banner'; // the frame's bar, the one header of the page

// The stored keys of the page's origin, read in the page itself
export const storedKeys = (page: Page): Promise<string[]> => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('maws.sheet.')));

// Every content-policy violation the context's pages raise, from a listener the browser installs before any of the
// page's own script runs
export async function violationsOf(context: BrowserContext): Promise<() => Promise<string[]>> {
  await context.addInitScript(() => {
    const seen: string[] = [];
    (globalThis as { __violations?: string[] }).__violations = seen;
    document.addEventListener('securitypolicyviolation', (event) => seen.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  return async () => (await Promise.all(context.pages().map((page) => page.evaluate(() => (globalThis as { __violations?: string[] }).__violations ?? []).catch(() => [])))).flat();
}
