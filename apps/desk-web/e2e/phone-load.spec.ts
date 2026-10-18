// The phone's load over an emulated mobile connection (the plan's M4 Decision Log records the numbers): Lighthouse's
// mobile network profile through Chromium's DevTools protocol — 150 ms round trip, 1.6 Mbps down, 750 kbps up — with
// the cache off, against the double serving the build gzip-compressed (the Worker's static assets are compressed
// too, with brotli where the browser takes it, so these bytes are an upper bound). Each case prints one `DESK-LOAD`
// line: time from navigation until its screen is drawn, and the bytes and requests it took. Only the loads' make-up is
// asserted — the grid fetches nothing of the project view's Markdown stack, and stays under a byte budget; no chunk of
// MAWS's transcript is fetched until a session channel opens, and then the session view's alone, never the depth
// column's (DC9.G3 as amended 2026-10-18) — since timings move with the runner.
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
/** The chunks of the session view and the depth column, which carry MAWS's transcript (`Transcript`, its rows, its store). */
const TRANSCRIPT_CHUNKS = /\/assets\/(SessionView|TranscriptPane|DepthColumn|ReviewView)-/;
/** The depth column's chunks: desktop-only, so a phone never fetches them, a session channel open or not. */
const DEPTH_CHUNKS = /\/assets\/(DepthColumn|ReviewView)-/;

/** The scripts of a load, and the chunk names they print for the record. */
async function scriptsOf(page: Page, hub: { url: string }, load: Load, label: string): Promise<Array<{ url: string; text: string }>> {
  const scripts = load.urls.filter((u) => u.endsWith('.js'));
  const chunks = scripts.map((u) => u.replace(/^\/assets\//, '')).join(' ');
  console.log(`DESK-LOAD-CHUNKS ${label}: ${chunks}`);
  test.info().annotations.push({ type: `DESK-LOAD chunks, ${label}`, description: chunks });
  return Promise.all(scripts.map(async (url) => ({ url, text: await (await page.request.get(`${hub.url}${url}`)).text() })));
}

/** What a load fetched since `before`. */
const since = (before: Load, after: Load): Load => ({ requests: after.requests - before.requests, bytes: after.bytes - before.bytes, urls: after.urls.slice(before.urls.length) });

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
    expect(load.urls.filter((u) => TRANSCRIPT_CHUNKS.test(u))).toEqual([]);
    expect(load.bytes).toBeLessThan(FIRST_LOAD_BUDGET);

    // Opening a project from there fetches the project view and its Markdown stack.
    const before = net.load();
    const opened = Date.now();
    await page.locator(`[data-project="${PROJECT}"]`).click();
    await expect(page.getByRole('navigation', { name: 'Channels' }).locator(`[data-session="${S.asks}"]`)).toBeVisible({ timeout: 60_000 });
    const after = net.load();
    report('phone: then open a project (its channel list)', Date.now() - opened, { requests: after.requests - before.requests, bytes: after.bytes - before.bytes, urls: [] });
  });

  test('no chunk of MAWS\'s transcript until a session channel opens: none for the channel list or the group chat; the session view\'s then, and never the depth column\'s', async ({ page, hub }) => {
    // The phone draws a session channel as the session view, as a desktop does (the owner, 2026-10-18, reversing §4's
    // "the phone never mounts the transcript"); the transcript's code stays out of everything before it.
    await stageProject(hub);
    await seedKey(page, hub);
    const net = await throttle(page);
    await timeTo(page, `${hub.url}/p/${PROJECT}`, '[aria-label="Channels"]');
    const list = page.getByRole('navigation', { name: 'Channels' });
    await list.getByRole('button', { name: /MAWS/ }).click();
    await expect(page.getByRole('region', { name: 'Channel' }).getByText('the migration is merged')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1000); // nothing fetched late
    const groupChat = net.load();
    expect(groupChat.urls.filter((u) => TRANSCRIPT_CHUNKS.test(u))).toEqual([]);
    // Nor does any chunk it fetched carry MAWS's transcript view (its list's jump control is that view's alone).
    for (const { url, text } of await scriptsOf(page, hub, groupChat, 'the channel list and the group chat')) expect(text, url).not.toContain('transcript-jump');

    await page.getByRole('button', { name: 'Back to MAWS' }).click();
    const opened = Date.now();
    await list.locator(`[data-session="${S.asks}"]`).click();
    await expect(page.getByTestId('session-view')).toHaveAttribute('data-session', S.asks, { timeout: 60_000 });
    report('phone: then open a session channel (the session view)', Date.now() - opened, since(groupChat, net.load()));
    await page.waitForTimeout(1000);
    const channel = since(groupChat, net.load());
    expect(channel.urls.filter((u) => /\/assets\/SessionView-/.test(u))).toHaveLength(1);
    expect(channel.urls.filter((u) => DEPTH_CHUNKS.test(u))).toEqual([]);
    const scripts = await scriptsOf(page, hub, channel, 'then a session channel');
    expect(scripts.some(({ text }) => text.includes('transcript-jump'))).toBe(true);
  });

  test('a direct channel, cold, on an online machine: its session view, and none of the depth column', async ({ page, hub }) => {
    await stageProject(hub);
    await seedKey(page, hub);
    const net = await throttle(page);
    const ms = await timeTo(page, `${hub.url}/p/${PROJECT}/s/${S.asks}`, '[data-testid="session-view"]');
    await expect(page.getByTestId('composer')).toBeVisible();
    await page.waitForTimeout(1000); // nothing fetched late
    const load = net.load();
    report('phone: a direct channel, cold', ms, load);
    expect(load.urls.filter((u) => DEPTH_CHUNKS.test(u))).toEqual([]);
    await scriptsOf(page, hub, load, 'a direct channel, cold');
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
