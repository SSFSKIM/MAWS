// The page while MAWS is not reachable (M4; frame 4; F4; T28): with the daemon stopped the band says so, the cards and
// the drafts stand, and Send is replaced by its reason; when it returns the band goes and Send is back. With an impostor
// on the port instead, a sheet on screen makes no request at all: opening a reference, pasting an image and pressing
// where Send was send nothing that carries the credential.
import type { Page } from '@playwright/test';
import { BAR, expect, test } from './fixtures';
import { REFERENCES, seedRecord, uploadsOf } from './records';
import { impostor, until } from './rig';

const card = (page: Page, id: string) => page.locator(`[data-sheet-question="${id}"]`);
const foot = (page: Page) => page.locator('[data-sheet-foot]');
const band = (page: Page) => page.locator('[data-sheet-band]');
const paste = (page: Page, id: string, base64: string) =>
  card(page, id)
    .getByLabel(`Your answer to ${id}`)
    .evaluate((field, data64) => {
      const bytes = Uint8Array.from(atob(data64), (char) => char.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
      field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, base64);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='; // one pixel

test('with the daemon stopped the band says so once, the cards and drafts stand and Send gives its reason; all comes back with it', async ({ page, mawsd }) => {
  seedRecord(mawsd.home, 'references');
  await page.goto(`${mawsd.url}/s/${REFERENCES}`);
  await mawsd.pair(page);
  await card(page, 'q2').getByLabel('Your answer to q2').fill('Not today');
  await expect(foot(page).getByRole('button', { name: 'Send 1 answer' })).toBeEnabled();
  await mawsd.stop();
  await expect(band(page)).toHaveText('Not connected to MAWS on this Mac. Trying again.');
  await expect(page.getByRole(BAR)).not.toContainText('Not connected'); // said once, in the band (F4)
  await expect(card(page, 'q1')).toBeVisible();
  await expect(card(page, 'q2').getByLabel('Your answer to q2')).toHaveValue('Not today');
  await expect(foot(page)).toHaveText('Answers cannot be sent while MAWS is not reachable.');
  await mawsd.restart();
  await expect(band(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(foot(page).getByRole('button', { name: 'Send 1 answer' })).toBeEnabled();
});

test('with an impostor on the port, a sheet on screen sends nothing that carries the credential: not a reference, not an image, not a Send', async ({ page, mawsd }) => {
  seedRecord(mawsd.home, 'references');
  await page.goto(`${mawsd.url}/s/${REFERENCES}`);
  await mawsd.pair(page);
  await card(page, 'q2').getByLabel('Your answer to q2').fill('Not today');
  // the same paste, while the real daemon answers: scaled, uploaded, and on the draft (T17)
  await paste(page, 'q2', PNG);
  await expect(card(page, 'q2').getByText('Image 1')).toBeVisible();
  expect(uploadsOf(mawsd.home, REFERENCES)).toEqual([expect.stringMatching(/^maws-[0-9a-f]{32}\.png$/)]);
  const credential = await page.evaluate(() => (JSON.parse(localStorage.getItem('maws.sheet.credential')!) as { credential: string }).credential);
  await mawsd.stop();
  const fake = await impostor(mawsd.port, 'silent');
  try {
    await until(() => fake.heard.frames.length >= 1, 20_000, 'the tab’s reconnection');
    const made: string[] = [];
    page.on('request', (request) => void made.push(`${request.method()} ${new URL(request.url()).pathname}`));
    await card(page, 'q1').getByRole('button', { name: /README\.md/ }).click();
    await paste(page, 'q1', PNG);
    await expect(card(page, 'q1').getByText('The image could not be saved.')).toBeVisible();
    await foot(page).click();
    await page.waitForTimeout(1_500);
    expect(made.filter((line) => line.includes('/api/'))).toEqual([]);
    await expect(card(page, 'q1').getByText('No longer available')).toBeVisible(); // the body could not be asked
    expect(uploadsOf(mawsd.home, REFERENCES)).toHaveLength(1);
  } finally {
    await fake.close();
  }
  for (const frame of fake.heard.frames) expect(frame).not.toContain(credential);
  for (const request of fake.heard.requests) {
    expect(request.target.startsWith('/api/')).toBe(false);
    expect(request.headers.join(' ')).not.toContain(credential);
  }
});

test('a sheet whose code was still loading when mawsd went shows once mawsd is back, with no reload', async ({ page, mawsd }) => {
  seedRecord(mawsd.home, 'references');
  await page.goto(`${mawsd.url}/s/${REFERENCES}`);
  await mawsd.pair(page); // the workspace's code is asked for at paired, and mawsd goes at once
  await page.evaluate(() => void ((globalThis as { __loaded?: number }).__loaded = 1));
  await mawsd.stop();
  await mawsd.restart();
  await expect(card(page, 'q1')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => (globalThis as { __loaded?: number }).__loaded)).toBe(1);
});
