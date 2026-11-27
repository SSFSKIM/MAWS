// Pictures of the built page, for a person to look at (the composite's writer's hand-off), taken only where
// SHEET_SHOTS names a directory to write them to: a hand run on a Mac. The gate leaves it unset, so it writes none and
// this spec is skipped there. The screens: the pairing screen; the overview; a sheet of eight questions at 1440 px with
// the outline closed, then open; the drawer at 480 px; the band when MAWS is not reachable; and "Your answers are
// being sent." after a reload while a Send is held.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { copyRecord, question, questionRecord } from './records';
import { startMawsd } from './rig';

const OUT = process.env.SHEET_SHOTS;
const HELD = '5eed0000-0000-4000-8000-0000000000a1';
const NOBODY = '5eed0000-0000-4000-8000-0000000000a2';
const EIGHT = '5eed0000-0000-4000-8000-0000000000b8';

test.skip(!OUT, 'SHEET_SHOTS names no directory');

const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(400); // transitions settle
  await page.screenshot({ path: join(OUT!, `${name}.png`) });
};

test('the page’s screens, pictured', async ({ page }) => {
  mkdirSync(OUT!, { recursive: true });
  const mawsd = await startMawsd({ barrier: true, sessions: [{ session: HELD, title: 'Winter timetable import', held: true }, { session: NOBODY, title: 'Fare table cleanup', held: false }] });
  try {
    copyRecord(mawsd.home, 'references', HELD);
    copyRecord(mawsd.home, 'references', NOBODY);
    questionRecord(mawsd.home, EIGHT, Array.from({ length: 8 }, (_, i) => question(i + 1, i === 3 ? { asker: { agentId: 'a1b2c3', name: 'reviewer' } } : {})));
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(`${mawsd.url}/`);
    await expect(page.getByRole('heading', { name: 'Pair this browser' })).toBeVisible();
    await shot(page, 'pairing');
    await mawsd.pair(page);
    await expect(page.locator(`[data-sheet-session="${NOBODY}"]`)).toBeVisible({ timeout: 20_000 });
    await shot(page, 'overview');

    await page.goto(`${mawsd.url}/s/${EIGHT}`);
    await expect(page.locator('[data-sheet-question="q8"]')).toBeAttached({ timeout: 20_000 });
    await page.getByRole('radio', { name: 'Way 2a' }).click();
    await shot(page, 'sheet-1440-outline-closed');
    await page.getByRole('banner').getByRole('button', { name: 'Show questions' }).click();
    await expect(page.locator('[data-sheet-outline="beside"]')).toBeVisible();
    await shot(page, 'sheet-1440-outline-open');
    await page.getByRole('banner').getByRole('button', { name: 'Hide questions' }).click();

    await page.setViewportSize({ width: 480, height: 860 });
    await page.getByRole('banner').getByRole('button', { name: 'Show questions' }).click();
    await expect(page.locator('[data-sheet-outline="drawer"]')).toBeVisible();
    await shot(page, 'drawer-480');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });

    // a Send held at the barrier, and the page reloaded: this window did not make it, and it is younger than 35 s
    await page.getByLabel('Your answer to q3').fill('As the harbour office does it');
    await page.locator('[data-sheet-foot]').getByRole('button', { name: /^Send/ }).click();
    await page.reload();
    await expect(page.locator('[data-sheet-foot]')).toHaveText('Your answers are being sent.', { timeout: 20_000 });
    await shot(page, 'being-sent');
    mawsd.release();

    await mawsd.stop();
    await expect(page.locator('[data-sheet-band]')).toBeVisible({ timeout: 20_000 });
    await shot(page, 'band-not-connected');
  } finally {
    await mawsd.dispose();
  }
});
