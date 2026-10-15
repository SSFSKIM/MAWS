// M4 of the DC5 plan (DC5.G4), in a phone's viewport against the DX3 double: the grid, the group chat, a direct
// channel, and request cards in the phone's layouts (one column, the channel list a tap away, no depth); and a push's
// path to its card — the service worker draws the notification from the payload alone, with no Allow or Deny, and the
// URL a tap opens lands on the card once it verified, from which the answer reaches the machine authenticated.
//
// The layout cases (tagged @layout) also run in WebKit on the Linux lane (playwright.config.ts); the service worker's
// cases need Chromium's DevTools protocol to deliver a push, so they run there alone. Installing to an iPhone's home
// screen, Access, the passkey, and a real push service are the owner's walk (the plan's M4).
import { inputSha256, seal, verifyRpc, importOrgKey, type PushNotice, type Raised } from 'desk-hub/protocol';
import type { BrowserContext, Page } from '@playwright/test';
import { DOUBLE_MEMBER, type HubDouble } from '../test/double/hub-double';
import { VECTOR_KEY } from '../test/vectors';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, S, stageProject } from './scene';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

const center = (page: Page) => page.getByRole('region', { name: 'Channel' });
const QUESTIONS = [{ question: 'Which column do we keep?', header: 'Column', options: [{ label: 'user_id', description: 'what the API reads' }, { label: 'owner_id', description: 'the new name' }], multiSelect: false }];
const raiseQuestion = (hub: HubDouble, request = 'toolu_q1') => hub.raise(PROJECT, 'mini', { request, session: S.asks, tool: 'AskUserQuestion', input: { questions: QUESTIONS } });
const notice = (request: string): PushNotice => ({ v: 1, project: PROJECT, session: S.asks, alias: 'maws-45', kind: 'question', request });

/** Nothing on the page is wider than the phone: no sideways scrolling anywhere. */
async function fitsTheWidth(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => el.getBoundingClientRect().right > width + 1 && getComputedStyle(el).position !== 'fixed').map((el) => `${el.tagName}.${el.className}`.slice(0, 80));
  });
  expect(overflow).toEqual([]);
}

test('@layout the grid draws in one column and a project opens on its group chat, the channel list a tap away and no depth', async ({ page, hub }) => {
  await stageProject(hub);
  await seedKey(page, hub);
  await page.goto(hub.url);
  const tiles = page.getByTestId('grid').locator('li');
  await expect(tiles).toHaveCount(2);
  const [first, second] = [await tiles.nth(0).boundingBox(), await tiles.nth(1).boundingBox()];
  expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1); // stacked, not side by side
  expect(first!.width).toBeGreaterThan(300);
  await expect(page.getByTestId('menu')).toBeVisible();
  await fitsTheWidth(page);

  await page.locator(`[data-project="${PROJECT}"]`).click();
  const view = page.getByTestId('project-view');
  await expect(view).toHaveAttribute('data-layout', 'phone');
  await expect(center(page)).toContainText('the migration is merged');
  await expect(page.getByRole('navigation', { name: 'Channels' })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Session depth' })).toHaveCount(0); // depth stays desktop-only
  await expect(page.getByTestId('channels')).toContainText('1'); // one session waits on the owner
  await expect(page.getByRole('textbox', { name: 'Message #MAWS' })).toBeVisible();
  await fitsTheWidth(page);

  await page.getByTestId('channels').click();
  const sheet = page.getByTestId('channel-sheet');
  await expect(sheet.locator('[data-group="waiting"]')).toContainText('maws-45');
  await sheet.locator(`[data-session="${S.asks}"]`).click();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/p/${PROJECT}/s/${S.asks}$`));
  await expect(page.getByTestId('channel-header')).toContainText('maws-45');
  // The working record stays folded: the transcript is desktop-only.
  await expect(center(page).getByTestId('working-record').first()).toContainText('on the desktop');
  await expect(center(page).getByRole('button', { name: '[ working record ]' })).toHaveCount(0);
  // The verbs that move a turn keep the row; model and compact sit behind More.
  await expect(page.locator('[data-verb="send"]')).toBeVisible();
  await expect(page.locator('[data-verb="model"]')).toHaveCount(0);
  await page.locator('[data-verb="more"]').click();
  await expect(page.locator('[data-verb="model"]')).toBeVisible();
  await expect(page.locator('[data-verb="compact"]')).toBeVisible();
  await fitsTheWidth(page);

  await page.getByRole('button', { name: 'Projects' }).click();
  await expect(page.getByTestId('grid')).toBeVisible();
});

test('@layout request cards fit the phone: a question answerable in place, a permission prompt with Allow and Deny', async ({ page, hub }) => {
  await stageProject(hub);
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
  await expect(page.getByTestId('composer')).toBeVisible();
  await raiseQuestion(hub);
  await hub.raise(PROJECT, 'mini', { request: 'toolu_b1', session: S.asks, tool: 'Bash', input: { command: 'pnpm --filter desk-web e2e -- --grep "a very long argument that wraps on a phone"', description: 'Run the browser suites' } });
  const question = center(page).locator('[data-request="toolu_q1"]');
  await expect(question).toContainText('Which column do we keep?');
  await expect(question.getByRole('radio', { name: 'user_id' })).toBeVisible();
  const permission = center(page).locator('[data-request="toolu_b1"]');
  await expect(permission.getByRole('button', { name: 'Allow' })).toBeVisible();
  await expect(permission.getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
  await fitsTheWidth(page);
});

type Shown = { title: string; options: { body?: string; tag?: string; data?: { url?: string }; actions?: unknown[] } };

/**
 * The running service worker, with each notification it asks the platform for recorded as it asks (headless Chromium
 * may display none, and what the worker asked for is what is proved), and a push delivered to it through Chromium's
 * DevTools protocol, as a push service's would arrive.
 */
async function serviceWorker(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  const registrations = new Map<string, string>();
  cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations: updated }) => {
    for (const r of updated as Array<{ registrationId: string; scopeURL: string; isDeleted: boolean }>) if (!r.isDeleted) registrations.set(r.scopeURL, r.registrationId);
  });
  await cdp.send('ServiceWorker.enable');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => registrations.size).toBeGreaterThan(0);
  const [scope, registrationId] = [...registrations][0];
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(() => {
    const scope = self as unknown as { registration: { showNotification(title: string, options?: object): Promise<void> }; __shown: unknown[] };
    const show = scope.registration.showNotification.bind(scope.registration);
    scope.__shown = [];
    scope.registration.showNotification = (title, options) => {
      scope.__shown.push({ title, options });
      return show(title, options).catch(() => {});
    };
  });
  return {
    deliver: async (data: string) => void (await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(scope).origin, registrationId, data })),
    shown: () => worker.evaluate(() => (self as unknown as { __shown: Shown[] }).__shown),
  };
}

test('a pushed question draws from its payload alone, with no Allow or Deny, and its tap lands on the verified card', async ({ browserName, context, page, hub }) => {
  test.skip(browserName !== 'chromium', "a push is delivered through Chromium's DevTools protocol");
  await stageProject(hub);
  await seedKey(page, hub);
  await context.grantPermissions(['notifications'], { origin: hub.url });
  await page.goto(hub.url);
  await expect(page.getByTestId('grid')).toBeVisible();
  const worker = await serviceWorker(context, page);

  await raiseQuestion(hub);
  await worker.deliver(JSON.stringify(notice('toolu_q1')));
  await expect.poll(worker.shown).toHaveLength(1);
  const [notification] = await worker.shown();
  expect(notification.title).toBe('maws-45 has a question');
  expect(notification.options.body).toBe('Open the desk to answer it.');
  expect(notification.options.actions).toBeUndefined(); // no Allow, no Deny: the worker holds no key to answer with
  const url = notification.options.data!.url!;
  expect(url).toBe(`/p/${PROJECT}/s/${S.asks}?request=toolu_q1`);

  // A payload it cannot read still draws a notification (a silent push costs the subscription on iOS), opening the grid.
  await worker.deliver('not json');
  await expect.poll(async () => (await worker.shown()).map((n) => n.title)).toEqual(['maws-45 has a question', 'The desk']);

  // A tap with no window open opens one at the card's URL (what `clients.openWindow` is handed): the card lands once
  // it verified, and the answer from the phone reaches the machine sealed, with the digest of what was drawn.
  const phone = await context.newPage();
  await phone.goto(`${hub.url}${url}`);
  const landed = center(phone).locator('[data-landed]');
  await expect(landed).toContainText('Which column do we keep?');
  await expect(landed.locator('[data-request="toolu_q1"]')).toBeVisible();
  await expect(phone).toHaveURL(new RegExp(`/p/${PROJECT}/s/${S.asks}$`)); // the landing is read once, then dropped
  await landed.getByRole('radio', { name: 'user_id' }).click();
  await landed.getByRole('button', { name: 'Submit' }).click();
  await expect.poll(() => hub.rpcs(PROJECT).length).toBe(1);
  const [answer] = hub.rpcs(PROJECT);
  expect(await verifyRpc(await importOrgKey(VECTOR_KEY), answer, PROJECT)).toBe(true);
  expect(answer.member).toBe(DOUBLE_MEMBER.id);
  expect(answer.args).toEqual({ session: S.asks, answers: { 'Which column do we keep?': 'user_id' }, digest: { session: S.asks, request: 'toolu_q1', tool: 'AskUserQuestion', input_sha256: await inputSha256({ questions: QUESTIONS }) } });
});

test('a tap with the app already open sends that window to the card, in place', async ({ page, hub }) => {
  await stageProject(hub);
  await seedKey(page, hub);
  await page.goto(hub.url);
  await expect(page.getByTestId('grid')).toBeVisible();
  await raiseQuestion(hub, 'toolu_q2');
  // What the worker posts to the window it brings forward (`OPEN_MESSAGE`; handlers.test.ts proves the worker's side).
  await page.evaluate((url) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'desk-open', url } })), `/p/${PROJECT}/s/${S.asks}?request=toolu_q2`);
  await expect(center(page).locator('[data-landed]')).toContainText('Which column do we keep?');
  await expect(page).toHaveURL(new RegExp(`/p/${PROJECT}/s/${S.asks}$`));
});

test('a card the push named says why it is not drawn: settled before the tap, or failing verification', async ({ page, hub }) => {
  await stageProject(hub);
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}?request=toolu_settled_hours_ago`);
  await expect(page.getByTestId('landing')).toHaveText(/This request is no longer waiting: it was answered or withdrawn before you opened it\./);

  const forged: Raised = { ...(await seal(await importOrgKey(VECTOR_KEY), 'raised', PROJECT, { request: 'toolu_forged', session: S.asks, tool: 'AskUserQuestion', input: { questions: QUESTIONS } })) };
  hub.raiseRaw(PROJECT, 'mini', { ...forged, input: { questions: [{ ...QUESTIONS[0], question: 'Delete the database?' }] } });
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}?request=toolu_forged`);
  await expect(page.getByTestId('landing')).toContainText('This request failed verification, so it is not shown.');
  await expect(center(page)).not.toContainText('Delete the database?');
});

test("a project holds back its member's pushes only while the owner can read it: not locked, not hidden", async ({ page, hub }) => {
  await stageProject(hub);
  const visibility = () => hub.up.filter((u) => u.frame.t === 'visibility').map((u) => (u.frame as { visible: boolean }).visible);
  await page.goto(`${hub.url}/p/${PROJECT}`);
  await expect(page.getByTestId('locked')).toBeVisible();
  await expect.poll(visibility).toContain(false);
  expect(visibility()).not.toContain(true); // locked, the owner reads nothing there

  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}`);
  await expect(center(page)).toContainText('the migration is merged');
  await expect.poll(() => visibility().at(-1)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => visibility().at(-1)).toBe(false); // the phone locked, or the app sent to the background
});
