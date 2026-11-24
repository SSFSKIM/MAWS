// A sheet that changed while the page was away (M4; T14, T15): changes made while a tab was not connected are never
// replayed to it, so at every snapshot the page reads the model of the session it shows again, and Send cannot be
// pressed until that read has been applied. Away is a daemon restarted on the same port, and a tab hidden past its five
// minutes (an injected clock) and shown again.
import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures';
import { question, questionRecord, stateOf, writeState } from './records';
import { until, type Mawsd } from './rig';

const S = '5eed0000-0000-4000-8000-0000000000d1';
const card = (page: Page, id: string) => page.locator(`[data-sheet-question="${id}"]`);
const foot = (page: Page) => page.locator('[data-sheet-foot]');
const draftKey = `maws.sheet.draft.${S}.q2`;

async function drafted(page: Page, mawsd: Mawsd) {
  questionRecord(mawsd.home, S, [question(1), question(2)]);
  await page.goto(`${mawsd.url}/s/${S}`);
  await mawsd.pair(page);
  await card(page, 'q2').getByLabel('Your answer to q2').fill('Way 2b, after the survey');
  await card(page, 'q1').getByRole('radio', { name: 'Way 1a' }).click();
  await expect(foot(page).getByRole('button', { name: 'Send 2 answers' })).toBeEnabled();
  expect(await page.evaluate((key) => localStorage.getItem(key), draftKey)).not.toBeNull();
  await page.evaluate(() => void ((globalThis as { __loaded?: number }).__loaded = 1));
}

// q2 withdrawn in the record, as the agent's tool would
function withdraw(mawsd: Mawsd) {
  const state = stateOf(mawsd.home, S);
  writeState(mawsd.home, S, { ...state, questions: state.questions.filter((entry) => entry.id !== 'q2'), closed: { q2: { how: 'withdrawn', at: '2026-11-24T10:00:00.000Z', revision: 1, asker: 'main', question: 'Which way should part 2 go?' } } });
}

// The session's reads, held until let go
async function holdReads(page: Page): Promise<{ held: Route[]; release(): Promise<void> }> {
  const held: Route[] = [];
  let holding = true;
  await page.route(`**/api/sheets/${S}`, (route) => (holding ? void held.push(route) : route.continue()));
  return {
    held,
    async release() {
      holding = false;
      for (const route of held.splice(0)) await route.continue();
    },
  };
}

async function sentOnlyAfterTheRead(page: Page, reads: { held: Route[]; release(): Promise<void> }) {
  await until(() => reads.held.length > 0, 30_000, 'the read after the snapshot');
  await expect(page.locator('[data-sheet-band]')).toHaveCount(0); // connected again
  await expect(foot(page)).toHaveText('Answers cannot be sent while MAWS is not reachable.');
  await expect(foot(page).getByRole('button')).toHaveCount(0);
  await expect(card(page, 'q2')).toBeVisible(); // the old model, until the read is applied
  await reads.release();
  await expect(card(page, 'q2')).toHaveCount(0);
  await expect(foot(page).getByRole('button', { name: 'Send 1 answer' })).toBeEnabled();
  expect(await page.evaluate((key) => localStorage.getItem(key), draftKey)).toBeNull(); // its draft went with it
  expect(await page.evaluate(() => (globalThis as { __loaded?: number }).__loaded)).toBe(1);
}

test('after a restart on the same port, the tab reconnects by itself, and Send waits for the sheet to be read again', async ({ page, mawsd }) => {
  await drafted(page, mawsd);
  await mawsd.stop();
  withdraw(mawsd);
  const reads = await holdReads(page);
  await mawsd.restart();
  await sentOnlyAfterTheRead(page, reads);
});

test('a tab hidden past its five minutes lets its connection go, and when shown reads the sheet again before Send', async ({ page, mawsd }) => {
  await page.clock.install();
  await drafted(page, mawsd);
  expect(await mawsd.connections()).toBe(1);
  const shown = (state: 'hidden' | 'visible') =>
    page.evaluate((value) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  await shown('hidden');
  await page.clock.fastForward(4 * 60_000);
  expect(await mawsd.connections()).toBe(1); // not yet
  await page.clock.fastForward(60_000 + 1_000);
  await until(async () => (await mawsd.connections()) === 0, 10_000, 'the hidden tab to let its connection go');
  withdraw(mawsd); // while it was not connected: never replayed
  const reads = await holdReads(page);
  await shown('visible');
  await sentOnlyAfterTheRead(page, reads);
});
