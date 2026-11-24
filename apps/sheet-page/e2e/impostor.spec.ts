// A paired tab left open while something else takes the port gives that something nothing (T28, M2): over two of the
// tab's own reconnections the impostor hears hellos and nothing else, whatever part it plays; a refusal it plays sends
// the tab to the pairing screen and deletes nothing (T19); and once the real daemon has the port again the tab comes back
// to the frame by itself, with no reload and no new pairing. Unpair pressed under an impostor tells it nothing.
import type { Page } from '@playwright/test';
import { BAR, expect, SESSION, storedKeys, test } from './fixtures';
import { PAIRING } from '../src/copy';
import { impostor, until, type Heard, type ImpostorPlay, type Mawsd } from './rig';

const PLAYS: ImpostorPlay[] = ['silent', 'wrong-mac', 'replay', 'paired-unproven', 'refuses'];

const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('maws.sheet.credential') ?? 'null') as { id: string; credential: string } | null);
const hellos = (heard: Heard) => heard.frames.filter((frame) => (JSON.parse(frame) as { t?: string }).t === 'hello').length;

// Nothing the impostor heard carries the credential: every frame a hello of this browser, no request with an
// Authorization header, the credential in no frame, no request line and no header
function heardNothing(heard: Heard, pairing: { id: string; credential: string }) {
  for (const frame of heard.frames) {
    expect(JSON.parse(frame)).toEqual({ t: 'hello', v: 1, id: pairing.id, nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(frame).not.toContain(pairing.credential);
  }
  for (const request of heard.requests) {
    expect(request.headers.filter((_, i) => i % 2 === 0).map((name) => name.toLowerCase())).not.toContain('authorization');
    expect(`${request.target} ${request.headers.join(' ')}`).not.toContain(pairing.credential);
  }
}

async function pairedTab(page: Page, mawsd: Mawsd) {
  await page.goto(`${mawsd.url}/s/${SESSION}`);
  await mawsd.pair(page);
  await page.evaluate(() => void ((globalThis as { __loaded?: number }).__loaded = 1)); // gone after any reload
  const pairing = await stored(page);
  expect(pairing).not.toBeNull();
  return pairing!;
}

for (const play of PLAYS) {
  test(`an impostor on the port that plays ${play} hears hellos and nothing else, and the tab returns once mawsd does`, async ({ page, mawsd }) => {
    const pairing = await pairedTab(page, mawsd);
    expect(await mawsd.connections()).toBe(1);
    // what M4's memory keeps beside the credential: a refusal deletes neither (T19)
    const draft = `maws.sheet.draft.${SESSION}.q1`;
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ v: 1, touchedAt: Date.now(), draft: { revision: 1, picks: [], text: 'kept', images: [] } })), draft);
    const recorded = play === 'replay' ? await mawsd.proofFor(pairing.id) : undefined;
    await mawsd.stop();
    const fake = await impostor(mawsd.port, play, recorded);
    try {
      await until(() => hellos(fake.heard) >= 2, 30_000, 'two of the tab’s reconnections');
      heardNothing(fake.heard, pairing);
      if (play === 'refuses') {
        await expect(page.getByRole('heading', { name: 'Pair this browser' })).toBeVisible();
        await expect(page.getByTestId('unpaired')).toHaveText(PAIRING.notPaired);
      } else await expect(page.getByRole(BAR)).toBeVisible();
      expect(await stored(page)).toEqual(pairing); // a refusal, or anything else it says, deletes nothing
      expect(await storedKeys(page)).toEqual(expect.arrayContaining(['maws.sheet.credential', draft]));
    } finally {
      await fake.close();
    }
    heardNothing(fake.heard, pairing);
    await mawsd.restart();
    // the tab came back: the fresh mawsd counts its connection once it was proven and paired (the bar alone stayed up
    // through four plays), and this tab is the only one there that could be
    await until(async () => (await mawsd.connections()) >= 1, 20_000, 'the tab’s connection to be paired again');
    await expect(page.getByRole(BAR)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pair this browser' })).toHaveCount(0);
    expect(await page.evaluate(() => (globalThis as { __loaded?: number }).__loaded)).toBe(1); // no reload
    expect(await stored(page)).toEqual(pairing); // and no new pairing
    expect(await page.evaluate((key) => localStorage.getItem(key), draft)).not.toBeNull();
    expect((await mawsd.browsers()).map((browser) => browser.id)).toEqual([pairing.id]);
  });
}

test('Unpair pressed under an impostor clears the keys and sends it nothing; mawsd still lists the browser when it is back', async ({ page, mawsd }) => {
  const pairing = await pairedTab(page, mawsd);
  await mawsd.stop();
  const fake = await impostor(mawsd.port, 'silent');
  try {
    await until(() => hellos(fake.heard) >= 1, 20_000, 'the tab’s reconnection');
    await page.getByRole(BAR).getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Unpair this browser' }).click();
    await expect(page.getByRole('heading', { name: 'Pair this browser' })).toBeVisible();
    await expect(page.getByTestId('unpaired')).toHaveText(`${PAIRING.notPaired} ${PAIRING.unpairLocal}`); // forgotten here alone
    expect(await storedKeys(page)).toEqual([]);
    await page.waitForTimeout(1_500);
  } finally {
    await fake.close();
  }
  heardNothing(fake.heard, pairing);
  expect(fake.heard.requests.filter((request) => request.method === 'POST')).toEqual([]);
  await mawsd.restart();
  expect((await mawsd.browsers()).map((browser) => browser.id)).toEqual([pairing.id]);
});
