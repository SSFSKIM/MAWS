// The phone's load over an emulated mobile connection (the plan's M4 Decision Log records the numbers): Lighthouse's
// mobile network profile through Chromium's DevTools protocol — 150 ms round trip, 1.6 Mbps down, 750 kbps up — with
// the cache off, against the double serving the build gzip-compressed (the Worker's static assets are compressed
// too, with brotli where the browser takes it, so these bytes are an upper bound). Each case prints one `DESK-LOAD`
// line: time from navigation until its screen is drawn, and the bytes and requests it took. Only the first load's
// make-up is asserted — the grid fetches nothing of the project view's Markdown stack, and stays under a byte budget —
// since timings move with the runner.
import type { CDPSession, Page } from '@playwright/test';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, S, stageProject } from './scene';

test.skip(({ browserName }) => browserName !== 'chromium', "the network is throttled through Chromium's DevTools protocol");

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };
const MOBILE = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
/** The grid's first load: the entry, React, the styles, and the page itself, gzip-compressed (about 110 kB in M4). */
const FIRST_LOAD_BUDGET = 160 * 1024;

type Load = { requests: number; bytes: number; urls: string[] };

/** Counts what the page fetches over the throttled connection, from the moment it is called. */
async function throttle(page: Page): Promise<{ cdp: CDPSession; load(): Load }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', MOBILE);
  const urls = new Map<string, string>();
  const sizes = new Map<string, number>();
  cdp.on('Network.requestWillBeSent', (e: { requestId: string; request: { url: string } }) => urls.set(e.requestId, e.request.url));
  cdp.on('Network.loadingFinished', (e: { requestId: string; encodedDataLength: number }) => sizes.set(e.requestId, e.encodedDataLength));
  return {
    cdp,
    load: () => {
      const done = [...sizes].filter(([id]) => urls.has(id) && !urls.get(id)!.startsWith('data:'));
      return { requests: done.length, bytes: done.reduce((n, [, size]) => n + size, 0), urls: done.map(([id]) => new URL(urls.get(id)!).pathname) };
    },
  };
}

/** Navigates and answers how long, from the navigation's start, until `selector` was first in the page. */
async function timeTo(page: Page, url: string, selector: string): Promise<number> {
  await page.addInitScript((sel) => {
    const seen = () => {
      if (document.querySelector(sel)) {
        (window as unknown as { __drawn: number }).__drawn = performance.now();
        return true;
      }
      return false;
    };
    const observer = new MutationObserver(() => seen() && observer.disconnect());
    observer.observe(document, { childList: true, subtree: true, attributes: true });
  }, selector);
  await page.goto(url);
  await expect(page.locator(selector).first()).toBeVisible({ timeout: 60_000 });
  return Math.round(await page.evaluate(() => (window as unknown as { __drawn: number }).__drawn));
}

function report(name: string, ms: number, load: Load): void {
  const line = { case: name, ms, kB: Math.round(load.bytes / 1024), requests: load.requests };
  console.log(`DESK-LOAD ${JSON.stringify(line)}`);
  test.info().annotations.push({ type: 'DESK-LOAD', description: JSON.stringify(line) });
}

const MARKDOWN_STACK = /\/assets\/(ProjectView|markdown|katex|shiki|lang-)/;

test.describe('on a phone', () => {
  test.use(PHONE);
  test.setTimeout(120_000);

  test("the first load draws the grid and fetches none of the project view's Markdown", async ({ page, hub }) => {
    await stageProject(hub);
    await seedKey(page, hub);
    const net = await throttle(page);
    const ms = await timeTo(page, hub.url, '[data-testid="grid"] li');
    const load = net.load();
    report('phone: first load, the grid', ms, load);
    expect(load.urls.filter((u) => MARKDOWN_STACK.test(u))).toEqual([]);
    expect(load.bytes).toBeLessThan(FIRST_LOAD_BUDGET);

    // Opening a project from there fetches the project view and its Markdown stack.
    const before = net.load();
    const opened = Date.now();
    await page.locator(`[data-project="${PROJECT}"]`).click();
    await expect(page.getByText('the migration is merged')).toBeVisible({ timeout: 60_000 });
    const after = net.load();
    report('phone: then open a project (group chat)', Date.now() - opened, { requests: after.requests - before.requests, bytes: after.bytes - before.bytes, urls: [] });
  });

  test("a push's tap, cold: from the notification's URL to its card drawn and verified", async ({ page, hub }) => {
    await stageProject(hub);
    await seedKey(page, hub);
    await hub.raise(PROJECT, 'mini', { request: 'toolu_q1', session: S.asks, tool: 'AskUserQuestion', input: { questions: [{ question: 'Which column do we keep?', header: 'Column', options: [{ label: 'user_id' }, { label: 'owner_id' }], multiSelect: false }] } });
    const net = await throttle(page);
    const ms = await timeTo(page, `${hub.url}/p/${PROJECT}/s/${S.asks}?request=toolu_q1`, '[data-landed] [data-request="toolu_q1"]');
    report("phone: a push's tap to its card", ms, net.load());
  });
});

test.describe('on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test.setTimeout(120_000);

  test('a session channel with the depth column open, over the same connection', async ({ page, hub }) => {
    await stageProject(hub);
    await seedKey(page, hub);
    const net = await throttle(page);
    const ms = await timeTo(page, `${hub.url}/p/${PROJECT}/s/${S.asks}`, '[data-testid="composer"]');
    await expect(page.getByRole('complementary', { name: 'Session depth' })).toBeVisible();
    report('desktop: a session channel, depth column open (its slot is DC6s; the fallback here)', ms, net.load());
  });
});
