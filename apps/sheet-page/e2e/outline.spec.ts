// The sheet's width and the outline (M4; §P, "How SessionSheet is laid out"; F9). The section takes the whole width the
// outline leaves, its foot's band that whole width, and the cards and Send one centred column of the transcript's
// measure (768 px) inside C3's own 12 px; below 768 px the column is the window. The outline lists every open question
// in the cards' order, reads a draft as its receipt as it is typed, leads to a card and puts the keyboard on it, marks
// the card at the column's top, is remembered open for every sheet, and below 1120 px is a drawer that a choice or
// Escape closes. It has no control but its lines.
import type { Page } from '@playwright/test';
import { BAR, expect, test } from './fixtures';
import { question, questionRecord } from './records';

const S = '5eed0000-0000-4000-8000-0000000000b8';
const T = '5eed0000-0000-4000-8000-0000000000b9';
const MEASURE = 768;
const PAD = 12; // C3's own, inside the column
const outline = (page: Page) => page.locator('[data-sheet-outline]');
const lines = (page: Page) => page.locator('[data-outline-line]');
const toggle = (page: Page, name: 'Show questions' | 'Hide questions') => page.getByRole(BAR).getByRole('button', { name }).click();

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;
const gutterOf = (page: Page) => page.locator('[data-sheet-scroll]').evaluate((element) => (element as HTMLElement).offsetWidth - (element as HTMLElement).clientWidth);

async function eight(page: Page, mawsd: { home: string; url: string; pair(page: Page): Promise<void> }) {
  questionRecord(mawsd.home, S, Array.from({ length: 8 }, (_, i) => question(i + 1, { context: 'A line of context.\n\n'.repeat(6) })));
  questionRecord(mawsd.home, T, [question(1), question(2)]);
  await page.goto(`${mawsd.url}/s/${S}`);
  await mawsd.pair(page);
  await expect(page.locator('[data-sheet-question]')).toHaveCount(8, { timeout: 20_000 });
}

test('the sheet’s width: one centred column of the measure, Send at the cards’ right edge, the foot’s band the section’s width; at 480 px the window', async ({ page, mawsd }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await eight(page, mawsd);
  await page.locator('[data-sheet-question="q1"]').getByRole('radio', { name: 'Way 1a' }).click();
  for (const open of [false, true]) {
    if (open) await toggle(page, 'Show questions');
    const section = await box(page, '[data-sheet-session]');
    const card = await box(page, '[data-sheet-question="q1"]');
    const footBand = await box(page, '[data-sheet-foot]');
    const send = await box(page, '[data-sheet-foot] button');
    const gutter = await gutterOf(page);
    expect(section.width).toBe(1440 - (open ? 300 : 0));
    expect(section.x).toBe(open ? 300 : 0);
    expect(card.width).toBeCloseTo(MEASURE - 2 * PAD - gutter, 0);
    expect(card.x - section.x).toBeCloseTo((section.width - MEASURE) / 2 + PAD, 0);
    expect(send.x + send.width).toBeCloseTo(card.x + card.width, 0);
    expect(footBand.width).toBe(section.width);
  }
  await page.setViewportSize({ width: 480, height: 800 });
  await expect(outline(page)).toHaveCount(0); // a drawer below 1120 px, and closed
  const card = await box(page, '[data-sheet-question="q1"]');
  const send = await box(page, '[data-sheet-foot] button');
  const gutter = await gutterOf(page);
  expect(card.x).toBeCloseTo(PAD, 0);
  expect(480 - gutter - (card.x + card.width)).toBeCloseTo(PAD, 0);
  expect(send.x + send.width).toBeCloseTo(card.x + card.width, 0);
});

test('the outline lists the questions, follows a draft, leads to a card and marks the one at the top; it is remembered open', async ({ page, mawsd }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await eight(page, mawsd);
  await expect(outline(page)).toHaveCount(0); // closed on a first visit
  await toggle(page, 'Show questions');
  await expect(page.getByRole(BAR).getByRole('button', { name: 'Hide questions' })).toBeVisible();
  await expect(outline(page)).toHaveAttribute('data-sheet-outline', 'beside');
  await expect(lines(page)).toHaveCount(8);
  expect(await lines(page).evaluateAll((all) => all.map((element) => element.getAttribute('data-outline-line')))).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8']);
  await expect(outline(page).getByText('8 questions', { exact: true })).toBeVisible();
  await expect(outline(page).getByRole('button')).toHaveCount(8); // no control but its lines

  // a draft made on a card is its line's receipt, with no reload
  await expect(lines(page).nth(1)).toContainText('Which way should part 2 go?');
  await page.locator('[data-sheet-question="q2"]').getByRole('radio', { name: 'Way 2b' }).click();
  await expect(lines(page).nth(1).locator('[data-outline-second]')).toHaveText('→Way 2b');
  await expect(outline(page).getByText('8 questions · 1 drafted')).toBeVisible();

  // choosing the seventh brings its card into the window with the keyboard on it, and the mark follows the column
  await expect(lines(page).nth(0)).toHaveAttribute('aria-current', 'true');
  await lines(page).nth(6).click();
  const seventh = page.locator('[data-sheet-question="q7"]');
  await expect(seventh).toBeFocused();
  await expect(seventh).toBeInViewport();
  await expect(lines(page).nth(0)).not.toHaveAttribute('aria-current', 'true');
  await page.locator('[data-sheet-scroll]').evaluate((element) => element.scrollTo({ top: 0 }));
  await expect(lines(page).nth(0)).toHaveAttribute('aria-current', 'true');

  // remembered: after a reload, and on another sheet
  await page.reload();
  await expect(outline(page)).toBeVisible({ timeout: 20_000 });
  await page.goto(`${mawsd.url}/s/${T}`);
  await expect(outline(page)).toBeVisible({ timeout: 20_000 });
  await expect(lines(page)).toHaveCount(2);
  await toggle(page, 'Hide questions');
  await expect(outline(page)).toHaveCount(0);
});

test('below 1120 px the outline is a drawer over the sheet that a choice, Escape or the scrim closes, and leaves the wide choice alone', async ({ page, mawsd }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await eight(page, mawsd);
  await toggle(page, 'Show questions');
  await expect(outline(page)).toHaveAttribute('data-sheet-outline', 'drawer');
  await lines(page).nth(4).click();
  await expect(outline(page)).toHaveCount(0);
  await expect(page.locator('[data-sheet-question="q5"]')).toBeFocused();
  await toggle(page, 'Show questions');
  await page.keyboard.press('Escape');
  await expect(outline(page)).toHaveCount(0);
  await toggle(page, 'Show questions');
  await page.locator('[data-sheet-scrim]').click({ position: { x: 440, y: 400 } });
  await expect(outline(page)).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(outline(page)).toHaveCount(0); // what is remembered for wide windows did not change
});
