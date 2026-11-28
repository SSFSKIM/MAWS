// A session's sheet on the page (M4; A.c, A.i, and the page's half of Acceptance 1 to 6): C3's cards from the record,
// following it as it changes with no reload; one Send that reaches the door as one call of `by: 'page'` lines; a
// question rewritten under a draft; an answer refused as stale; Dismiss; a stopped session's queued answer and its take
// back; and two browsers answering one question, held at the stand-in's barrier. What became of an act is read from the
// model, which the stand-in door's staged outcome replays (C3's §E), never from the act.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { SHEET_FIXTURES } from '../../../test/support/sheet-records';
import { expect, test } from './fixtures';
import { inboxOf, question, questionRecord, REFERENCES, seedRecord, stageOutcome, stateOf, writeState } from './records';
import { startMawsd, until, type Mawsd } from './rig';

const S = '5eed0000-0000-4000-8000-0000000000c1';
const cards = (page: Page) => page.locator('[data-sheet-question]');
const card = (page: Page, id: string) => page.locator(`[data-sheet-question="${id}"]`);
const foot = (page: Page) => page.locator('[data-sheet-foot]');
const marked = (page: Page) => page.evaluate(() => void ((globalThis as { __loaded?: number }).__loaded = 1));
const notReloaded = async (page: Page) => expect(await page.evaluate(() => (globalThis as { __loaded?: number }).__loaded)).toBe(1);

async function openSheet(page: Page, mawsd: Mawsd, session: string) {
  await page.goto(`${mawsd.url}/s/${session}`);
  await mawsd.pair(page);
  await expect(cards(page).first()).toBeVisible({ timeout: 20_000 });
}

test('shows one card for each listed question in the model’s order, and a reference opens to its captured text', async ({ page, mawsd }) => {
  seedRecord(mawsd.home, 'references');
  await openSheet(page, mawsd, REFERENCES);
  await expect(cards(page)).toHaveCount(2);
  expect(await cards(page).evaluateAll((all) => all.map((element) => element.getAttribute('data-sheet-question')))).toEqual(['q1', 'q2']);
  await card(page, 'q1').getByRole('button', { name: /src\/auth\.ts/ }).click();
  const captured = readFileSync(join(SHEET_FIXTURES, 'references/before/sheet', REFERENCES, 'refs/fe3081828a2fb20f8b0afe735d5327f23f9ffcb7996807a1b5da5714f178cf15'), 'utf8');
  await expect(card(page, 'q1').getByText(captured.split('\n')[0]!)).toBeVisible();
});

test('a session with no record, or a path that names none, says so and leads back to all sessions', async ({ page, mawsd }) => {
  await page.goto(`${mawsd.url}/s/5eed0000-0000-4000-8000-0000000000c0`);
  await mawsd.pair(page);
  await expect(page.getByText('No open questions for this session')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-sheet-foot]')).toHaveCount(0);
  await page.goto(`${mawsd.url}/s/not-a-session`);
  await expect(page.getByText('No open questions for this session')).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-sheet-empty]').getByRole('link', { name: 'All sessions' }).click();
  await expect(page).toHaveURL(`${mawsd.url}/`);
  await expect(page.getByText('No open questions on this Mac')).toBeVisible();
});

test('follows the record: a question added shows, one withdrawn goes, with no reload (A.c)', async ({ page, mawsd }) => {
  questionRecord(mawsd.home, S, [question(1), question(2)]);
  await openSheet(page, mawsd, S);
  await marked(page);
  await expect(cards(page)).toHaveCount(2);
  const state = stateOf(mawsd.home, S);
  writeState(mawsd.home, S, { ...state, questions: [...state.questions, question(3)] });
  await expect(cards(page)).toHaveCount(3);
  await expect(card(page, 'q3')).toBeVisible();
  const added = stateOf(mawsd.home, S);
  writeState(mawsd.home, S, { ...added, questions: added.questions.filter((entry) => entry.id !== 'q1'), closed: { q1: { how: 'withdrawn', at: '2026-11-24T10:00:00.000Z', revision: 1, asker: 'main', question: 'Which way should part 1 go?' } } });
  await expect(card(page, 'q1')).toHaveCount(0);
  await expect(cards(page)).toHaveCount(2);
  await notReloaded(page);
});

test('three drafts and one Send reach the door as one call of three page lines in one batch; a pick and its text travel in one line (Acceptance 2, 4)', async ({ page, mawsd }) => {
  questionRecord(mawsd.home, S, [question(1), question(2), question(3), question(4), question(5)]);
  await openSheet(page, mawsd, S);
  await card(page, 'q1').getByRole('radio', { name: 'Way 1b' }).click();
  await card(page, 'q2').getByRole('radio', { name: 'Way 2a' }).click();
  await card(page, 'q2').getByLabel('Your answer to q2').fill('and say why in the notes');
  await card(page, 'q4').getByLabel('Your answer to q4').fill('Neither: wait for the survey.');
  await foot(page).getByRole('button', { name: 'Send 3 answers' }).click();
  await until(() => inboxOf(mawsd.home, S).length === 3, 20_000, 'the three lines');
  const lines = inboxOf(mawsd.home, S);
  expect(new Set(lines.map((line) => line.batch)).size).toBe(1); // one call of the door
  expect(lines[0]!.batch).toEqual(expect.any(String));
  expect(lines.map((line) => line.by)).toEqual(['page', 'page', 'page']);
  expect(lines.map((line) => [line.kind, line.id])).toEqual([['answer', 'q1'], ['answer', 'q2'], ['answer', 'q4']]);
  expect(lines[1]).toMatchObject({ picks: ['Way 2a'], text: 'and say why in the notes', revision: 1 });
  expect(lines.every((line) => /^page-[a-z2-7]{26}$/.test(String(line.key)))).toBe(true);

  // the session's step applies them: the cards that remain are the others
  const state = stateOf(mawsd.home, S);
  writeState(mawsd.home, S, { ...state, questions: state.questions.filter((entry) => ['q3', 'q5'].includes(entry.id)), inbox: { ...state.inbox, offset: readFileSync(join(mawsd.home, 'sheet', S, 'inbox.jsonl')).length } });
  await expect(cards(page)).toHaveCount(2);
  expect(await cards(page).evaluateAll((all) => all.map((element) => element.getAttribute('data-sheet-question')))).toEqual(['q3', 'q5']);
  await expect(foot(page).getByRole('button', { name: 'Send' })).toBeDisabled();
});

test('a question rewritten under a draft reads Updated and keeps the draft as carried, after a reload too (Acceptance 3)', async ({ page, mawsd }) => {
  questionRecord(mawsd.home, S, [question(1), question(2)]);
  await openSheet(page, mawsd, S);
  await card(page, 'q1').getByLabel('Your answer to q1').fill('Way 1a, but only on weekdays');
  const state = stateOf(mawsd.home, S);
  writeState(mawsd.home, S, { ...state, questions: [question(1, { revision: 2, question: 'Which way should part 1 go, now that it runs at weekends?' }), state.questions[1]!] });
  await expect(card(page, 'q1').getByText('Updated')).toBeVisible();
  await expect(card(page, 'q1').getByText('You wrote this before the question changed.')).toBeVisible();
  await expect(card(page, 'q1').getByLabel('Your answer to q1')).toHaveValue('Way 1a, but only on weekdays');
  await expect(foot(page).getByRole('button', { name: 'Send' })).toBeDisabled(); // a carried draft is not counted
  await page.reload();
  await expect(card(page, 'q1').getByText('Updated')).toBeVisible();
  await expect(card(page, 'q1').getByText('You wrote this before the question changed.')).toBeVisible();
  await expect(card(page, 'q1').getByLabel('Your answer to q1')).toHaveValue('Way 1a, but only on weekdays');
});

test('an answer refused as stale puts its draft back on a card that says so (answer-stale; Acceptance 3)', async ({ page, mawsd }) => {
  const session = seedRecord(mawsd.home, 'answer-stale');
  stageOutcome(mawsd.home, 'answer-stale', ['page-0301a001']);
  await openSheet(page, mawsd, session);
  await card(page, 'q1').getByLabel('Your answer to q1').fill('Passkeys, with a magic link to fall back on');
  await foot(page).getByRole('button', { name: 'Send 1 answer' }).click();
  await expect(card(page, 'q1').getByText('The question changed before your answer arrived. Your draft is kept.')).toBeVisible({ timeout: 20_000 });
  await expect(card(page, 'q1').getByLabel('Your answer to q1')).toHaveValue('Passkeys, with a magic link to fall back on');
  expect(inboxOf(mawsd.home, session)).toHaveLength(1);
});

test('Dismiss sends one dismiss line (Acceptance 5)', async ({ page, mawsd }) => {
  questionRecord(mawsd.home, S, [question(1), question(2)]);
  await openSheet(page, mawsd, S);
  await card(page, 'q2').getByRole('button', { name: 'Dismiss' }).click();
  await until(() => inboxOf(mawsd.home, S).length === 1, 20_000, 'the dismissal');
  expect(inboxOf(mawsd.home, S)[0]).toMatchObject({ v: 1, kind: 'dismiss', id: 'q2', by: 'page' });
  await expect(page.locator('[data-sheet-hidden="q2"]')).toBeVisible(); // hidden while queued
});

test('on a stopped session an answer reads queued, and Take back sends a retract of its key (Acceptance 6)', async ({ page }) => {
  const STOPPED = '5eed0000-0000-4000-8000-0000000000c6';
  const mawsd = await startMawsd({ sessions: [{ session: STOPPED, title: 'Printer proof layout', held: false }] });
  try {
    questionRecord(mawsd.home, STOPPED, [question(1)]);
    await openSheet(page, mawsd, STOPPED);
    await expect(page.getByRole('banner').getByText('stopped', { exact: true })).toBeVisible({ timeout: 30_000 });
    await card(page, 'q1').getByRole('radio', { name: 'Way 1a' }).click();
    await foot(page).getByRole('button', { name: 'Send 1 answer' }).click();
    await expect(card(page, 'q1').getByText('Queued. The session is stopped and gets this when it resumes.')).toBeVisible({ timeout: 20_000 });
    const [answer] = inboxOf(mawsd.home, STOPPED);
    await card(page, 'q1').getByRole('button', { name: 'Take back' }).click();
    await until(() => inboxOf(mawsd.home, STOPPED).length === 2, 20_000, 'the retract');
    expect(inboxOf(mawsd.home, STOPPED)[1]).toMatchObject({ kind: 'retract', target: answer!.key, by: 'page' });
  } finally {
    await mawsd.dispose();
  }
});

test('of two paired browsers whose Sends for one question are held at the barrier, one reads accepted and the other that it was already answered (A.i)', async ({ browser }) => {
  const mawsd = await startMawsd({ barrier: true });
  const one = await browser.newContext();
  const two = await browser.newContext();
  try {
    const session = seedRecord(mawsd.home, 'two-surfaces');
    stageOutcome(mawsd.home, 'two-surfaces', ['page-0401a001', 'cli-0401b002']);
    const pages = [await one.newPage(), await two.newPage()];
    for (const page of pages) await openSheet(page, mawsd, session);
    const puts = pages.map((page) => page.waitForRequest((request) => request.url().endsWith('/put')));
    for (const [n, page] of pages.entries()) {
      await card(page, 'q1').getByRole('radio').nth(n).click();
      await foot(page).getByRole('button', { name: 'Send 1 answer' }).click();
    }
    await Promise.all(puts);
    await pages[0]!.waitForTimeout(1_000); // both doors are at the barrier
    expect(inboxOf(mawsd.home, session)).toEqual([]);
    mawsd.release();
    await until(() => !existsSync(join(mawsd.home, 'sheet', `${session}.next`)), 20_000, 'the staged outcome applied');
    expect(inboxOf(mawsd.home, session)).toHaveLength(2);
    const texts = await Promise.all(
      pages.map(async (page) => {
        await expect(page.locator('[data-sheet-question="q1"]')).toHaveCount(0, { timeout: 20_000 });
        return page.locator('[data-sheet-session]').innerText();
      }),
    );
    expect(texts.filter((text) => text.includes('q1 was already answered'))).toHaveLength(1);
    expect(texts.filter((text) => text.includes('Accepted. Not delivered yet.'))).toHaveLength(2); // the outcome stands on both sheets
  } finally {
    await one.close();
    await two.close();
    await mawsd.dispose();
  }
});
