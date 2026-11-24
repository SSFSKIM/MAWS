// The overview on the page (M4; A.b, A.g; §P's empty states; F8): with no app attached, the daemon's own discovery
// tells a held session from one nobody holds (T29), and the overview lists the first with the running and the second
// under "Stopped"; a row is a link to its sheet; the tab's title carries the count; a record made while no daemon ran is
// on the page when it starts, with no reload.
import { BAR, expect, test } from './fixtures';
import { copyRecord } from './records';
import { startMawsd, type Mawsd } from './rig';

const HELD = '5eed0000-0000-4000-8000-0000000000a1';
const NOBODY = '5eed0000-0000-4000-8000-0000000000a2';
const LATE = '5eed0000-0000-4000-8000-0000000000a3';

async function seeded(): Promise<Mawsd> {
  const mawsd = await startMawsd({
    sessions: [
      { session: HELD, title: 'Winter timetable import', held: true },
      { session: NOBODY, title: 'Fare table cleanup', held: false },
    ],
  });
  return mawsd;
}

test('lists a held session with the running and one nobody holds under Stopped, each row a link to its sheet', async ({ page }) => {
  const mawsd = await seeded();
  try {
    copyRecord(mawsd.home, 'references', HELD);
    copyRecord(mawsd.home, 'references', NOBODY);
    await page.goto(`${mawsd.url}/`);
    await mawsd.pair(page);
    const running = page.getByRole('list', { name: 'Running' });
    const stopped = page.getByRole('list', { name: 'Stopped' });
    await expect(stopped.locator(`[data-sheet-session="${NOBODY}"]`)).toBeVisible({ timeout: 30_000 }); // once the index holds both
    await expect(running.locator(`[data-sheet-session="${HELD}"]`)).toBeVisible();
    await expect(running.locator('li')).toHaveCount(1);
    await expect(stopped.locator('li')).toHaveCount(1);
    await expect(page).toHaveTitle('(4) Sheet');

    const row = running.getByRole('link');
    await expect(row).toHaveAttribute('href', `/s/${HELD}`);
    await row.click();
    await expect(page).toHaveURL(`${mawsd.url}/s/${HELD}`);
    const bar = page.getByRole(BAR);
    await expect(bar.getByText('Winter timetable import')).toBeVisible();
    await expect(bar.getByText('stopped', { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-sheet-question]')).toHaveCount(2);
    await expect(page).toHaveTitle('(2) Winter timetable import · Sheet');

    await bar.getByRole('link', { name: 'All sessions' }).click();
    await stopped.getByRole('link').click();
    await expect(page.getByRole(BAR).getByText('Fare table cleanup')).toBeVisible();
    await expect(page.getByRole(BAR).getByText('stopped', { exact: true })).toBeVisible();
  } finally {
    await mawsd.dispose();
  }
});

test('with nothing on it, the overview says so in its own words and the tab has no count', async ({ page, mawsd }) => {
  await page.goto(`${mawsd.url}/`);
  await mawsd.pair(page);
  await expect(page.getByText('No open questions on this Mac')).toBeVisible();
  await expect(page.getByText('A session’s questions appear here when it asks.')).toBeVisible();
  await expect(page.locator('[data-sheet-overview]')).toHaveCount(0);
  await expect(page).toHaveTitle('Sheet');
});

test('a record made while no daemon ran is on the page when it starts, with no reload (A.g)', async ({ page, mawsd }) => {
  await page.goto(`${mawsd.url}/`);
  await mawsd.pair(page);
  await expect(page.getByText('No open questions on this Mac')).toBeVisible();
  await page.evaluate(() => void ((globalThis as { __loaded?: number }).__loaded = 1));
  await mawsd.stop();
  copyRecord(mawsd.home, 'references', LATE);
  await mawsd.restart();
  await expect(page.locator(`[data-sheet-session="${LATE}"]`)).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => (globalThis as { __loaded?: number }).__loaded)).toBe(1);
});
