// What a web page can actually send, sent by a real browser from a real second origin (T24, M2; A.e; §8.2's rules 1 to 3
// and T12): a page under the page's own host name on another port (a development server an agent started) and one under
// `localhost`, in the same browser as a paired tab. Each try is judged from outside the stranger's page: by the status
// the browser saw on the wire, by what the browser itself said and drew, and by what mawsd holds after it. And a DNS name
// rebound to loopback gets the Host refusal and no shell.
import type { CDPSession, Page } from '@playwright/test';
import { BAR, expect, storedKeys, test } from './fixtures';
import { inboxBytes, REFERENCES, seedRecord, uploadsOf } from './records';
import { secondOrigin, type Mawsd } from './rig';

const STRANGERS = ['sameName', 'otherName'] as const;

async function liveCode(mawsd: Mawsd): Promise<string> {
  const { code, out } = await mawsd.cli('sheet', 'pair');
  expect(code).toBe(0);
  return out.split('\n')[0]!;
}

// Every request a page made to the daemon's origin, with the status the network answered it: read from the browser's own
// network events, which hold the status of a response the browser then kept from the page (a cross-origin `no-cors`
// answer under `Cross-Origin-Resource-Policy: same-origin` reaches neither the page nor Playwright's response event)
async function wire(page: Page, origin: string) {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const sent = new Map<string, { method: string; path: string }>();
  const seen: { method: string; path: string; status: number }[] = [];
  cdp.on('Network.requestWillBeSent', (event: { requestId: string; request: { method: string; url: string } }) => {
    const url = new URL(event.request.url);
    if (url.origin === origin) sent.set(event.requestId, { method: event.request.method, path: url.pathname });
  });
  cdp.on('Network.responseReceivedExtraInfo', (event: { requestId: string; statusCode: number }) => {
    const request = sent.get(event.requestId);
    if (request) seen.push({ ...request, status: event.statusCode });
  });
  await cdp.send('Network.enable');
  return { seen, sent: () => [...sent.values()] };
}

async function pairWith(page: Page, origin: string, code: string) {
  await page.goto(`${origin}/`);
  await page.getByLabel('Then type the code it prints:').fill(code);
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  await expect(page.getByRole(BAR)).toBeVisible();
}

for (const name of STRANGERS) {
  test(`a stranger under ${name === 'sameName' ? 'the page’s own name on another port' : 'localhost'}, in the same browser as a paired tab, can do none of what it tries`, async ({ page, context, browser, mawsd }) => {
    const stranger = await secondOrigin();
    try {
      await page.goto(`${mawsd.url}/`);
      await mawsd.pair(page);
      const code = await liveCode(mawsd);
      const at = await context.newPage();
      const said: string[] = [];
      at.on('console', (message) => void said.push(message.text()));
      const { seen } = await wire(at, mawsd.url);
      const sockets: string[] = [];
      at.on('websocket', (socket) => socket.on('framesent', () => void sockets.push('a frame was sent')));
      await at.goto(stranger.pageFor(stranger[name], mawsd.url, code));
      await expect(at.locator('body[data-done="1"]')).toBeAttached({ timeout: 20_000 });

      // the exchange is a write, and its Origin is not the page's: 403 on the wire, and the code is still live
      expect(seen.filter((entry) => entry.path === '/api/pair')).toEqual([{ method: 'POST', path: '/api/pair', status: 403 }]);
      // so is unpair, before its credential is even read
      expect(seen.filter((entry) => entry.path === '/api/unpair')).toEqual([{ method: 'POST', path: '/api/unpair', status: 403 }]);
      // the live connection is refused at the upgrade, as the browser itself reports the answer, and nothing was sent on it
      expect(said.some((text) => /\/live' failed: .*Unexpected response code: 403/.test(text)), said.join('\n')).toBe(true);
      expect(sockets).toEqual([]);
      // its frame of the page shows no page: the browser refused to draw it
      const framed = await at.locator('#framed').elementHandle();
      const frame = await framed!.contentFrame();
      expect(frame === null || !frame.url().startsWith(mawsd.url) || (await frame.getByText('Pair this browser').count()) === 0).toBe(true);
      expect(said.some((text) => /violates the following Content Security Policy directive: "frame-ancestors 'none'"/.test(text)), said.join('\n')).toBe(true);
      // nothing the real page stored is readable from it
      expect(await storedKeys(at)).toEqual([]);

      // what mawsd holds after it: the real tab is still paired, and the stranger's code still pairs a browser
      await page.reload();
      await expect(page.getByRole(BAR)).toBeVisible();
      expect(await mawsd.browsers()).toHaveLength(1);
      const other = await browser.newContext();
      await pairWith(await other.newPage(), mawsd.url, code);
      await other.close();
      expect(await mawsd.browsers()).toHaveLength(2);
    } finally {
      await stranger.close();
    }
  });
}

for (const name of STRANGERS) {
  test(`a stranger under ${name === 'sameName' ? 'the page’s own name on another port' : 'localhost'}, at a sheet’s data, is refused on the wire and changes nothing of the record (M4)`, async ({ page, context, mawsd }) => {
    seedRecord(mawsd.home, 'references');
    const stranger = await secondOrigin();
    try {
      await page.goto(`${mawsd.url}/s/${REFERENCES}`);
      await mawsd.pair(page);
      await expect(page.locator('[data-sheet-question]').first()).toBeVisible({ timeout: 20_000 });
      const inbox = inboxBytes(mawsd.home, REFERENCES);
      const uploads = uploadsOf(mawsd.home, REFERENCES);
      const at = await context.newPage();
      const { seen, sent } = await wire(at, mawsd.url);
      await at.goto(stranger.pageFor(stranger[name], mawsd.url, undefined, REFERENCES));
      await expect(at.locator('body[data-done="1"]')).toBeAttached({ timeout: 20_000 });
      await at.waitForTimeout(500);
      const sheet = `/api/sheets/${REFERENCES}`;
      // a read with no credential: 401; one with a credential it made up never gets past its preflight
      // (the browser names both reads; only the first reached mawsd, and was answered 401)
      expect(sent().filter((entry) => entry.path === sheet && entry.method === 'GET')).toHaveLength(2);
      expect(seen.filter((entry) => entry.path === sheet && entry.method === 'GET')).toEqual([{ method: 'GET', path: sheet, status: 401 }]);
      for (const preflight of seen.filter((entry) => entry.path === sheet && entry.method === 'OPTIONS')) expect(preflight.status).toBe(405);
      // a Send's lines and an image's bytes: 403, their Origin is not the page's
      expect(seen.filter((entry) => entry.path === `${sheet}/put`)).toEqual([{ method: 'POST', path: `${sheet}/put`, status: 403 }]);
      expect(seen.filter((entry) => entry.path === `${sheet}/uploads`)).toEqual([{ method: 'POST', path: `${sheet}/uploads`, status: 403 }]);
      // and the record is what it was
      expect(inboxBytes(mawsd.home, REFERENCES)).toBe(inbox);
      expect(uploadsOf(mawsd.home, REFERENCES)).toEqual(uploads);
    } finally {
      await stranger.close();
    }
  });
}

test('a stranger’s links to the page, with a fragment and with a code in the query, open it as / would, and no exchange is made', async ({ browser, mawsd }) => {
  const stranger = await secondOrigin();
  try {
    const code = await liveCode(mawsd);
    for (const link of ['#to-fragment', '#to-query']) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const { sent } = await wire(page, mawsd.url);
      await page.goto(stranger.pageFor(stranger.otherName, mawsd.url, code));
      await expect(page.locator('body[data-done="1"]')).toBeAttached({ timeout: 20_000 }); // its own tries, refused above
      const before = sent().length;
      await page.click(link);
      await expect(page.getByRole('heading', { name: 'Pair this browser' })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe('/');
      await expect(page.getByLabel('Then type the code it prints:')).toHaveValue('');
      await page.waitForTimeout(1_000);
      const after = sent().slice(before);
      expect(after).toContainEqual({ method: 'GET', path: '/' }); // the record holds what the page did after the click
      expect(after.filter((entry) => entry.path.startsWith('/api/'))).toEqual([]);
      await context.close();
    }
    const context = await browser.newContext();
    await pairWith(await context.newPage(), mawsd.url, code); // the code is still live
    await context.close();
  } finally {
    await stranger.close();
  }
});

test('a DNS name rebound to loopback gets the Host refusal, 421, and no shell', async ({ playwright, mawsd }) => {
  const channel = process.env.SHEET_E2E_CHANNEL;
  const rebound = await playwright.chromium.launch({ ...(channel && { channel }), args: ['--host-resolver-rules=MAP rebound.example 127.0.0.1'] });
  try {
    const page = await rebound.newPage();
    const answer = await page.goto(`http://rebound.example:${mawsd.port}/`);
    expect(answer?.status()).toBe(421);
    await expect(page.locator('body')).toHaveText('This server does not answer that host.');
    await expect(page.getByRole('heading', { name: 'Pair this browser' })).toHaveCount(0);
    const asset = await page.goto(`http://rebound.example:${mawsd.port}/s/anything`);
    expect(asset?.status()).toBe(421);
  } finally {
    await rebound.close();
  }
});
