// Two tabs of one browser share one memory (M4; T19): a draft typed in one is in a second opened on the same address;
// two tabs editing different cards do not undo each other, however late each hears of the other; a tab whose model is
// older than another tab's draft leaves that draft alone; a Send's stored entry keeps its keys through the other tab's
// writes, and a reload sends those same keys again; unpairing in one shows the pairing screen in the other, and an
// upload that answers after the Unpair writes nothing.
import type { BrowserContext, Page, Route } from '@playwright/test';
import { expect, storedKeys, test } from './fixtures';
import { inboxOf, question, questionRecord, stateOf, writeState } from './records';
import { startMawsd, until, type Mawsd } from './rig';

const S = '5eed0000-0000-4000-8000-0000000000e1';
const card = (page: Page, id: string) => page.locator(`[data-sheet-question="${id}"]`);
const foot = (page: Page) => page.locator('[data-sheet-foot]');
const field = (page: Page, id: string) => card(page, id).getByLabel(`Your answer to ${id}`);

// Each page of the context can hold back the storage events it is told of, and let them through later in order
async function holdableStorage(context: BrowserContext) {
  await context.addInitScript(() => {
    const queue: [EventListenerOrEventListenerObject, Event][] = [];
    const wrapped = new WeakMap<object, EventListener>();
    let holding = false;
    const call = (listener: EventListenerOrEventListenerObject, event: Event) => (typeof listener === 'function' ? listener.call(window, event) : listener.handleEvent(event));
    (globalThis as { __holdStorage?: (on: boolean) => void }).__holdStorage = (on) => {
      holding = on;
      if (!on) for (const [listener, event] of queue.splice(0)) call(listener, event);
    };
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      if (type !== 'storage' || listener === null) return add(type, listener, options);
      const through: EventListener = (event) => (holding ? void queue.push([listener, event]) : call(listener, event));
      wrapped.set(listener, through);
      return add(type, through, options);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) =>
      remove(type, (type === 'storage' && wrapped.get(listener)) || listener, options)) as typeof window.removeEventListener;
  });
}
const hold = (page: Page, on: boolean) => page.evaluate((value) => (globalThis as { __holdStorage?: (on: boolean) => void }).__holdStorage!(value), on);
const draftOf = (page: Page, id: string) => page.evaluate((key) => localStorage.getItem(key), `maws.sheet.draft.${S}.${id}`);
const sendEntries = (page: Page) => page.evaluate((session) => Object.entries(localStorage).filter(([key]) => key.startsWith(`maws.sheet.send.${session}.`)), S);

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='; // one pixel
const paste = (page: Page, id: string) =>
  field(page, id).evaluate((element, data64) => {
    const bytes = Uint8Array.from(atob(data64), (char) => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, PNG);
// An upload's answer held in the browser once mawsd has saved the image (CDP Fetch, at the response stage), until let go
async function holdUploadAnswers(page: Page): Promise<{ held(): number; release(): Promise<void> }> {
  const cdp = await page.context().newCDPSession(page);
  const held: string[] = [];
  cdp.on('Fetch.requestPaused', (event: { requestId: string }) => void held.push(event.requestId));
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/uploads', requestStage: 'Response' }] });
  return {
    held: () => held.length,
    async release() {
      for (const requestId of held.splice(0)) await cdp.send('Fetch.continueResponse', { requestId });
    },
  };
}

async function twoTabs(context: BrowserContext, page: Page, mawsd: Mawsd): Promise<[Page, Page]> {
  questionRecord(mawsd.home, S, [question(1), question(2), question(3)]);
  await page.goto(`${mawsd.url}/s/${S}`);
  await mawsd.pair(page);
  await expect(card(page, 'q1')).toBeVisible();
  const second = await context.newPage();
  await second.goto(`${mawsd.url}/s/${S}`);
  await expect(card(second, 'q1')).toBeVisible({ timeout: 20_000 });
  return [page, second];
}

test('a draft typed in one tab is in a second opened on the same address', async ({ page, context, mawsd }) => {
  questionRecord(mawsd.home, S, [question(1), question(2)]);
  await page.goto(`${mawsd.url}/s/${S}`);
  await mawsd.pair(page);
  await field(page, 'q2').fill('As the harbour office does it');
  const second = await context.newPage();
  await second.goto(`${mawsd.url}/s/${S}`);
  await expect(field(second, 'q2')).toHaveValue('As the harbour office does it', { timeout: 20_000 });
});

test('two tabs typing on different cards, each hearing of the other late, both keep both, after a reload too', async ({ page, context, mawsd }) => {
  await holdableStorage(context);
  const [first, second] = await twoTabs(context, page, mawsd);
  await hold(first, true);
  await hold(second, true);
  await field(first, 'q1').fill('typed in the first');
  await field(second, 'q2').fill('typed in the second');
  await hold(first, false);
  await hold(second, false);
  for (const tab of [first, second]) {
    await expect(field(tab, 'q1')).toHaveValue('typed in the first');
    await expect(field(tab, 'q2')).toHaveValue('typed in the second');
  }
  await first.reload();
  await expect(field(first, 'q1')).toHaveValue('typed in the first', { timeout: 20_000 });
  await expect(field(first, 'q2')).toHaveValue('typed in the second');
});

test('a tab whose model is older than another tab’s leaves what the newer one wrote alone, and neither undoes the other in turn; it shows it all once its read comes', async ({ page, context, mawsd }) => {
  const [first, second] = await twoTabs(context, page, mawsd);
  const held: Route[] = [];
  let holding = true;
  await second.route(`**/api/sheets/${S}`, (route) => (holding ? void held.push(route) : route.continue())); // the second tab's model stays from before
  // meanwhile, in the record: q2 revised under a new header, q3 withdrawn, and q4 asked
  const state = stateOf(mawsd.home, S);
  const revised = { ...state.questions.find((entry) => entry.id === 'q2')!, revision: 2, header: 'Harbour office', question: 'Which way should part 2 go now?' };
  writeState(mawsd.home, S, {
    ...state,
    questions: [...state.questions.filter((entry) => entry.id === 'q1'), revised, question(4)],
    closed: { q3: { how: 'withdrawn', at: '2026-11-24T10:00:00.000Z', revision: 1, asker: 'main', question: 'Which way should part 3 go?' } },
  });
  await expect(card(first, 'q4')).toBeVisible({ timeout: 20_000 });
  await expect(card(first, 'q3')).toHaveCount(0);
  await until(() => held.length > 0, 20_000, 'the second tab’s read of the change');
  await field(first, 'q4').fill('on the new card');
  await until(async () => (await draftOf(first, 'q4')) !== null, 10_000, 'the draft’s entry');
  await second.waitForTimeout(1_000); // the second tab has heard the entries and reconciled them against its older model
  await expect(card(second, 'q4')).toHaveCount(0);
  await expect(card(second, 'q3')).toBeVisible();
  const entry = (tab: Page, kind: string, id: string) => tab.evaluate((key) => localStorage.getItem(key), `maws.sheet.${kind}.${S}.${id}`);
  // what the newer tab wrote stands: the new card's draft, the revised header, the withdrawn question's entries gone
  expect(JSON.parse((await draftOf(second, 'q4'))!)).toMatchObject({ draft: { text: 'on the new card' } });
  expect(JSON.parse((await entry(second, 'header', 'q2'))!)).toMatchObject({ header: 'Harbour office' });
  expect(await entry(second, 'seen', 'q3')).toBeNull();
  expect(await entry(second, 'header', 'q3')).toBeNull();
  // and the two tabs are quiet: neither writes back what the other wrote
  const heard = (tab: Page) => tab.evaluate(() => (globalThis as { __heard?: number }).__heard ?? 0);
  for (const tab of [first, second]) await tab.evaluate(() => addEventListener('storage', () => void ((globalThis as { __heard?: number }).__heard = ((globalThis as { __heard?: number }).__heard ?? 0) + 1)));
  await first.waitForTimeout(1_500);
  expect([await heard(first), await heard(second)]).toEqual([0, 0]);

  holding = false;
  for (const route of held.splice(0)) await route.continue();
  await expect(field(second, 'q4')).toHaveValue('on the new card', { timeout: 20_000 });
  await expect(card(second, 'q3')).toHaveCount(0);
  await expect(field(first, 'q4')).toHaveValue('on the new card');
});

test('a Send held at the barrier keeps its stored keys through the other tab’s writes, and a reload sends those same keys again', async ({ browser }) => {
  const mawsd = await startMawsd({ barrier: true });
  const context = await browser.newContext();
  try {
    await holdableStorage(context);
    const [first, second] = await twoTabs(context, await context.newPage(), mawsd);
    // each tab hears the other late. The second types on q3 and pastes an image there before the press, the upload's
    // answer held; the first presses Send (held at the barrier) without having heard of it; then the answer comes, and
    // C3's late attachment writes the second tab's draft while the Send is held (C3 refuses a typed change then, and
    // takes a saved image)
    await hold(first, true);
    await hold(second, true);
    await field(first, 'q1').fill('sent from the first');
    await field(second, 'q3').fill('typed in the second');
    const uploads = await holdUploadAnswers(second);
    await paste(second, 'q3');
    await until(() => uploads.held() === 1, 10_000, 'the upload, saved and its answer held');
    await foot(first).getByRole('button', { name: 'Send 1 answer' }).click();
    await until(async () => (await sendEntries(first)).length === 1, 10_000, 'the Send’s entry, at its press');
    const [[key, entry]] = await sendEntries(first);
    const keys = (JSON.parse(entry) as { lines: { key: string }[] }).lines.map((line) => line.key);
    expect(keys).toHaveLength(1);
    const drafted = JSON.parse((await draftOf(second, 'q3'))!) as { draft: { text: string; images: string[] } };
    expect(drafted.draft.images).toEqual([]);

    await uploads.release();
    await until(async () => (JSON.parse((await draftOf(second, 'q3'))!) as typeof drafted).draft.images.length === 1, 10_000, 'the image joining the draft');
    const after = JSON.parse((await draftOf(second, 'q3'))!) as typeof drafted;
    expect(after.draft).toMatchObject({ text: 'typed in the second', images: [expect.stringMatching(/^uploads\/maws-[0-9a-f]{32}\.png$/)] }); // the draft changed
    expect(await sendEntries(first)).toEqual([[key, entry]]); // and the Send's entry, keys and all, did not
    await hold(first, false);
    await hold(second, false);
    await second.waitForTimeout(500);
    expect(await sendEntries(first)).toEqual([[key, entry]]);
    await first.clock.install();
    await first.reload();
    await expect(foot(first)).toHaveText('Your answers are being sent.', { timeout: 20_000 }); // not this window's: younger than 35 s
    const again = first.waitForRequest((request) => request.url().endsWith('/put'));
    await first.clock.fastForward(36_000);
    await foot(first).getByRole('button', { name: 'Send again' }).click();
    const sent = (await again).postDataJSON() as { lines: { key: string }[] };
    expect(sent.lines.map((line) => line.key)).toEqual(keys); // the same act, for the door
    mawsd.release();
    await until(() => inboxOf(mawsd.home, S).length >= 1, 20_000, 'the lines');
    for (const line of inboxOf(mawsd.home, S)) expect(keys).toContain(line.key);
  } finally {
    await context.close();
    await mawsd.dispose();
  }
});

test('unpairing in one tab shows the pairing screen in the other', async ({ page, context, mawsd }) => {
  const [first, second] = await twoTabs(context, page, mawsd);
  await first.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
  await first.getByRole('menuitem', { name: 'Unpair this browser' }).click();
  await expect(first.getByRole('heading', { name: 'Pair this browser' })).toBeVisible();
  await expect(second.getByRole('heading', { name: 'Pair this browser' })).toBeVisible();
  await expect(second.getByTestId('unpaired')).toHaveText('This browser is not paired.');
});

test('an image whose upload answers after the browser was unpaired is written nowhere: Unpair forgot everything', async ({ page, mawsd }) => {
  questionRecord(mawsd.home, S, [question(1)]);
  await page.goto(`${mawsd.url}/s/${S}`);
  await mawsd.pair(page);
  await field(page, 'q1').fill('with a picture');
  const uploads = await holdUploadAnswers(page); // the answer held, after mawsd saved the image while the browser was still paired
  await paste(page, 'q1');
  await until(() => uploads.held() === 1, 10_000, 'the upload, saved and its answer held');
  await page.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Unpair this browser' }).click();
  await expect(page.getByRole('heading', { name: 'Pair this browser' })).toBeVisible();
  expect(await storedKeys(page)).toEqual([]);
  const answered = page.waitForResponse((response) => response.url().endsWith('/uploads'));
  await uploads.release();
  expect((await answered).ok()).toBe(true); // the page has the saved image's answer
  await page.waitForTimeout(1_000);
  expect(await storedKeys(page)).toEqual([]);
});
