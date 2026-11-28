// The question sheet's built look (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md, "The look" and M6):
// the states of the sheet's surfaces that the owner's first look at the built app photographs. One module, so that the
// e2e:lane-a cases that assert each state and photograph it (e2e/lane-a.spec.ts) and the words rig's launch 17
// (e2e/words-shots.rig.ts) reach them by the same steps: the same records under the launch's sminos home, the same
// transcripts in its engine store, the same presses. No live model and no terminal: each session is one the engine store
// lists and nothing runs, so it reads stopped. The door is the stand-in (test/support/fake-sminos-cli.mjs) behind a
// launcher of this module's, which can refuse a Send. Every name, path and word is invented.
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';
import { SHEET_WORDS } from '../../src/renderer/src/sheet/copy';
import { SHEET_ROW } from '../../src/renderer/src/transcript/model/copy';
import { FAKE_SMINOS, closedAnswered, closedDismissed, fixtureSession, oneCall, revised, rewriteState, seedRecord, withdrawn } from '../../test/support/sheet-records';
import { addressed } from './address';
import { assistantRecord, userRecord } from './lane-a';
import type { MawsLaunch } from './launch';
import { showSessionCards } from './shell';
import { sidebarOf, sidebarRow } from './sidebar';

/** The words rig's window (its W and H) and theme, so a case's picture is the one the rig's launch takes. */
export const LOOK_WINDOW = { width: 1440, height: 900 } as const;

/**
 * The look's sessions, by their engine ids: `sheet` holds the pin's `batch` record (two of the main conversation's
 * questions and a subagent's); `rows` the same record seeded as its own and made one call's, beside a transcript whose
 * call asked the three; `forms` a transcript alone, its calls each drawing a head line the owner has not seen.
 */
export const LOOK_SESSIONS = { sheet: fixtureSession('batch'), rows: '5eed0000-0000-4000-8000-00000000c301', forms: '5eed0000-0000-4000-8000-00000000c302' } as const;
/** The `rows` call's id: the record's three questions are made this call's. */
const ROWS_CALL = 'toolu_01Look0001';
/** The real door's own words for a line it refuses (sminos_sheet.py's `append`): what the launcher prints for a refused put. */
export const LOOK_REFUSAL = 'sheet put: line 1 refused: a string holds a lone UTF-16 surrogate; nothing appended';
/** What the person types as q3's answer. */
export const Q3_ANSWER = 'Nothing here yet. Connect a calendar to start.';
/** q1's words after its asker rewrote it, while the person's draft stood. */
const REWORDED = 'Which auth method should the beta’s login use?';

/**
 * The launch's door: a launcher in `dir` that runs the stand-in with this process's Node, so a launch whose shell has no
 * Node on its PATH (the rig's) still finds a door that runs; while `refuse(true)` stands, a `put` reads its lines and
 * exits 2 with LOOK_REFUSAL, appending nothing, as the real door refuses a line. Named in MAWS_SMINOS_CLI.
 */
export function lookDoor(dir: string): { cli: string; refuse(on: boolean): void } {
  mkdirSync(dir, { recursive: true });
  const cli = join(dir, 'sminos');
  const refusing = join(dir, 'refuse');
  writeFileSync(cli, [
    '#!/bin/sh',
    `if [ "$2" = put ] && [ -e '${refusing}' ]; then cat >/dev/null; cat '${refusing}' >&2; exit 2; fi`,
    `exec '${process.execPath}' '${FAKE_SMINOS}' "$@"`,
    '',
  ].join('\n'));
  chmodSync(cli, 0o755);
  return { cli, refuse: (on) => (on ? writeFileSync(refusing, `${LOOK_REFUSAL}\n`) : rmSync(refusing, { force: true })) };
}

// ---- the transcripts, as the engine writes a call of the sminos tool in the sheet's form and its result ----------------
const TOOL = 'mcp__sminos__AskUserQuestion';
type Entry = { question: string; header?: string; id?: string; options?: { label: string }[] };
const options = (...labels: string[]) => labels.map((label) => ({ label }));
function calls(sid: string, cwd: string, at: string, prompt: string, steps: { call: string; input: Record<string, unknown>; result: string; error?: true }[], reply: string): Record<string, unknown>[] {
  const ids = Array.from({ length: steps.length * 2 + 2 }, () => randomUUID());
  const base = { cwd, sessionId: sid, isSidechain: false, userType: 'external' };
  const clock = (n: number) => new Date(Date.parse(at) + n * 1000).toISOString();
  const message = (uuid: string, content: unknown[]) => ({ id: `msg_${uuid.slice(0, 8)}`, type: 'message', role: 'assistant', model: 'claude-demo', content, stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } });
  return [
    userRecord(sid, cwd, ids[0]!, null, prompt, at),
    ...steps.flatMap(({ call, input, result, error }, k) => {
      const [asked, answered] = [ids[2 * k + 1]!, ids[2 * k + 2]!];
      return [
        { ...base, type: 'assistant', uuid: asked, parentUuid: ids[2 * k], timestamp: clock(2 * k + 1), message: message(asked, [{ type: 'tool_use', id: call, name: TOOL, input }]) },
        { ...base, type: 'user', uuid: answered, parentUuid: asked, timestamp: clock(2 * k + 2), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, is_error: error === true, content: result }] } },
      ];
    }),
    assistantRecord(sid, cwd, ids.at(-1)!, ids.at(-2)!, reply, clock(steps.length * 2 + 1)),
  ];
}

/** The `batch` record's main conversation's two calls (q1 and q3; q2 is a subagent's), as the `sheet` session holds them. */
export const sheetCallRecords = (sid: string, cwd: string): Record<string, unknown>[] =>
  calls(sid, cwd, '2026-10-28T10:00:00.000Z', 'Set up the sign-in page.', [
    { call: 'toolu_01Auth0001', input: { ask: [{ question: 'Which auth method should the login use?', header: 'Auth method', options: options('OAuth', 'Passkeys', 'Magic link') }] }, result: 'Added q1.' },
    { call: 'toolu_01Empt0003', input: { ask: [{ question: 'What should the empty state say?', header: 'Empty state' }] }, result: 'Added q3.' },
  ], 'Two questions are on your sheet; going on with the layout.');

/** The `rows` session: one call that asked the record's three questions together. */
export const rowCallRecords = (sid: string, cwd: string): Record<string, unknown>[] =>
  calls(sid, cwd, '2026-11-23T09:00:00.000Z', 'Plan the sign-in page; ask me what you need.', [
    {
      call: ROWS_CALL,
      input: { ask: [
        { question: 'Which auth method should the login use?', header: 'Auth method', options: options('OAuth', 'Passkeys', 'Magic link') },
        { question: 'Ship the migration today?', header: 'Migration', options: options('Yes', 'No') },
        { question: 'What should the empty state say?', header: 'Empty state' },
      ] satisfies Entry[] },
      result: 'Added q1, q2, q3.',
    },
  ], 'Three questions are on your sheet; going on with the layout meanwhile.');

/** The `forms` session: calls that added two questions, revised both, did nothing, and were refused by the engine whole. */
export const formCallRecords = (sid: string, cwd: string): Record<string, unknown>[] =>
  calls(sid, cwd, '2026-11-23T11:00:00.000Z', 'Draft the release notes page.', [
    {
      call: 'toolu_01Form0001',
      input: { ask: [
        { question: 'When should the notes go out?', header: 'Release date', options: options('Friday', 'With the next build') },
        { question: 'Who reads the notes first?', header: 'Audience', options: options('Customers', 'Support') },
      ] satisfies Entry[] },
      result: 'Added q5, q6.',
    },
    {
      call: 'toolu_01Form0002',
      input: { ask: [
        { id: 'q5', question: 'The build slipped a day. Should the notes still go out on Friday?', header: 'Release date', options: options('Friday', 'With the next build') },
        { id: 'q6', question: 'Support has its own page now. Who reads the notes first?', header: 'Audience', options: options('Customers', 'Support') },
      ] satisfies Entry[] },
      result: 'Revised q5 (revision 2), q6 (revision 2).',
    },
    { call: 'toolu_01Form0003', input: { withdraw: ['q3'] }, result: 'Nothing done.\nNot done: q3 is not open (withdrawn at 09:12).' },
    { call: 'toolu_01Form0004', input: { ask: [{ question: 'Publish the notes without a review?', header: 'Review' }] satisfies Entry[] }, result: '<tool_use_error>InputValidationError: ask[0].header is too long</tool_use_error>', error: true },
  ], 'The two questions are revised on your sheet.');

// ---- the records -------------------------------------------------------------------------------------------------------
/** The `sheet` session's record: the pin's `batch`, as it stands before its Send. */
export const seedSheetRecord = (home: string): string => seedRecord(home, 'batch');
/** The `rows` session's record: `batch` seeded as its own, its three questions made the one call's. */
export function seedRowsRecord(home: string): string {
  seedRecord(home, 'batch', 'before', LOOK_SESSIONS.rows);
  rewriteState(home, LOOK_SESSIONS.rows, oneCall(ROWS_CALL));
  return LOOK_SESSIONS.rows;
}
/** The `rows` call's three outcomes, as the record holds them once delivered: q1 answered OAuth, q2 dismissed, q3 withdrawn. */
export function closeRowsRecord(home: string): void {
  const at = '2026-11-23T09:20:00.000Z';
  type Edit = Parameters<typeof rewriteState>[2];
  const whileOpen = (id: string, edit: Edit): Edit => (state) => (state.questions.some((q) => q.id === id) ? edit(state) : state);
  const steps = [whileOpen('q1', closedAnswered('q1', ['OAuth'], 'maws-c301a001', at)), whileOpen('q2', closedDismissed('q2', 'maws-c301d002', at)), whileOpen('q3', withdrawn('q3', at))];
  rewriteState(home, LOOK_SESSIONS.rows, (state) => steps.reduce((next, step) => step(next), state)); // one write, as the tool's step makes one
}

// ---- where things are -------------------------------------------------------------------------------------------------
export const sheetTool = (page: Page): Locator => page.locator('[data-sheet-tool]');
export const cardOf = (page: Page, id: string): Locator => sheetTool(page).locator(`article[data-sheet-question="${id}"]`);
const sendButton = (page: Page, n: number): Locator => sheetTool(page).getByRole('button', { name: SHEET_WORDS.send(n), exact: true });
export const sheetRows = (page: Page): Locator => page.locator('[data-region="main"] .transcript-row[data-kind="sheet"]');
/** Each line of a sheet row, its cells' words joined by " | " (e2e:lane-a's M5 reading). */
export const rowLines = (row: Locator): Promise<string[]> =>
  row.locator('[data-sheet-line]').evaluateAll((lines) => lines.map((line) => Array.from(line.children, (cell) => cell.textContent).filter((text) => text !== '').join(' | ')));
export const rowHeads = (page: Page): Promise<string[]> => sheetRows(page).locator('.transcript-run-label').allTextContents();
export const needsYouRow = async (page: Page, appId: string): Promise<Locator> => sidebarOf(page).locator(`[data-needs-you="${await addressed(page, appId)}"]`);
const waitingRegion = (cards: Locator): Locator => cards.getByRole('region', { name: 'Waiting for you', exact: true });

// ---- the window --------------------------------------------------------------------------------------------------------
/** The window at the rig's size and in its light theme (the rig's `size` and `light`). */
export async function asTheRigDraws(maws: MawsLaunch): Promise<void> {
  const { width, height } = LOOK_WINDOW;
  await maws.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find((x) => !x.isDestroyed())!.setContentSize(w, h), [width, height] as const);
  await expect.poll(() => maws.page.evaluate(() => [innerWidth, innerHeight]), { message: 'the rig’s window size' }).toEqual([width, height]);
  const set = await maws.page.evaluate(() => window.maws.invoke('settings.set' as never, { theme: 'light' } as never));
  expect((set as { ok: boolean }).ok, 'the light theme set').toBe(true);
  await expect(maws.page.locator('html')).toHaveAttribute('data-theme', 'light');
}

/** A whole-window picture as the rig takes one: the pointer at the corner, fonts and finite animations done, no caret. */
export async function lookShot(page: Page): Promise<Buffer> {
  await page.mouse.move(LOOK_WINDOW.width - 2, LOOK_WINDOW.height - 2);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish();
  });
  return page.screenshot({ animations: 'disabled', caret: 'hide' });
}

// ---- the steps and what each draws -------------------------------------------------------------------------------------
/** A session in front: its sidebar row pressed, the pointer moved off it before its hover card opens. */
export async function openLookSession(page: Page, appId: string): Promise<void> {
  await (await sidebarRow(page, { appSessionId: appId })).click();
  await page.mouse.move(LOOK_WINDOW.width - 2, LOOK_WINDOW.height - 2);
  await expect(page.locator('[data-region="main"] .transcript-row[data-kind]').first(), 'the session’s transcript').toBeVisible({ timeout: 20_000 });
}

/**
 * The sidebar's Needs you row of a session whose waiting items are all sheet questions: its mark calm, in the info tone;
 * and so every mark that counts the same fact (L5, the composite's writer, 2026-11-27): its project row's waiting count
 * and the toolbar's Overview badge.
 */
export async function calmRow(page: Page, appId: string): Promise<void> {
  await calmMark((await needsYouRow(page, appId)).locator('[data-tone]'), 'the Needs you row’s mark');
  await calmMark(sidebarOf(page).locator('[data-kind="project"] [data-tone]'), 'the project row’s waiting count');
  await calmMark(page.locator('[data-toolbar] [data-tone]'), 'the toolbar’s Overview badge');
}
async function calmMark(mark: Locator, what: string): Promise<void> {
  await expect(mark, what).toHaveAttribute('data-tone', 'calm', { timeout: 15_000 });
  const tones = await mark.evaluate((el) => {
    const probe = (tone: string) => {
      const span = document.createElement('span');
      span.className = tone;
      document.body.append(span);
      const color = getComputedStyle(span).color;
      span.remove();
      return color;
    };
    return { drawn: getComputedStyle(el).color, info: probe('text-info'), warning: probe('text-warning') };
  });
  expect(tones.drawn, `${what}, drawn in the info tone`).toBe(tones.info);
  expect(tones.drawn, `${what}, not the warning tone`).not.toBe(tones.warning);
}

/** The `sheet` session in front with its cards: "Waiting for you" lists its three questions, the subagent's "from reviewer". */
export async function showWaitingLines(page: Page, appId: string): Promise<void> {
  await openLookSession(page, appId);
  await showSessionCards(page);
}
export async function waitingLines(page: Page): Promise<void> {
  const lines = waitingRegion(await showSessionCards(page)).locator('[data-waiting-card-line]');
  await expect(lines).toHaveCount(3, { timeout: 15_000 });
  await expect(lines.nth(1), 'the subagent’s question').toContainText('Ship the migration today?');
  await expect(lines.nth(1)).toContainText(SHEET_WORDS.from('reviewer'));
  await expect(lines.nth(1), 'the line names its asker whole').toHaveAttribute('title', new RegExp(`${SHEET_WORDS.from('reviewer')}$`));
  // "from <agent>" is shown whole or not at all: in the line's first row beside the question, or wrapped below it where the row clips it
  const from = await lines.nth(1).locator('[data-waiting-from]').evaluate((asker) => {
    const row = asker.parentElement!.getBoundingClientRect();
    const box = asker.getBoundingClientRect();
    return { shown: box.top >= row.top && box.bottom <= row.bottom && box.right <= row.right, hidden: box.top >= row.bottom };
  });
  expect(from.shown || from.hidden, 'from <agent> neither cut nor half shown').toBe(true);
}

/** The app's notices closed (the toast region's own dismiss buttons), so none stands over a picture. */
export async function closeNotices(page: Page): Promise<void> {
  const dismiss = page.locator('[data-toast-viewport] li > button:last-child:has(> span[aria-hidden])');
  await dismiss.first().waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined);
  for (let i = 0; i < 5 && (await dismiss.count()) > 0; i++) await dismiss.first().click({ timeout: 2_000 }).catch(() => undefined);
}

/** The `sheet` session's side sheet in view: when it is not, the session opened and its waiting card's q1 line chosen. */
export async function ensureSheet(page: Page, appId: string): Promise<void> {
  if (await sheetTool(page).isVisible()) return;
  await showWaitingLines(page, appId);
  await openSheetAt(page, 'q1');
  await expect(cardOf(page, 'q1')).toBeVisible({ timeout: 10_000 });
}

/** A line of the waiting card chosen: the side sheet shows the session's sheet at that question. */
export async function openSheetAt(page: Page, id: string): Promise<void> {
  await waitingRegion(await showSessionCards(page)).locator(`[data-waiting-card-line$=":${id}"]`).click();
}
export async function sheetAt(page: Page, id: string): Promise<void> {
  await expect(cardOf(page, id), `the keyboard on ${id}’s card`).toBeFocused({ timeout: 10_000 });
  await expect(cardOf(page, id), `${id}’s card shows where the keyboard is`).toHaveAttribute('data-focus-ring', '');
  await expect(sheetTool(page).locator('article[data-sheet-question]'), 'every open question a card').toHaveCount(3);
}

/**
 * A draft typed on q1 (Passkeys picked), then q1 rewritten by its asker: the card carries the draft, marked, and Send
 * counts nothing until the person keeps it. Done once: a second call finds q1 already rewritten and leaves it.
 */
export async function carryDraft(page: Page, home: string): Promise<void> {
  const card = cardOf(page, 'q1');
  if ((await card.getByText(REWORDED, { exact: true }).count()) > 0) return;
  await card.getByRole('radio', { name: 'Passkeys', exact: true }).click();
  await expect(sendButton(page, 1), 'the draft counted').toBeEnabled();
  rewriteState(home, LOOK_SESSIONS.sheet, revised('q1', REWORDED));
  await expect(card.getByText(REWORDED, { exact: true }), 'the rewritten question').toBeVisible({ timeout: 15_000 });
  await card.scrollIntoViewIfNeeded();
}
export async function carriedDraft(page: Page): Promise<void> {
  const card = cardOf(page, 'q1');
  await expect(card.getByText(SHEET_WORDS.updated, { exact: true }), 'the Updated mark').toBeVisible();
  await expect(card.getByText(SHEET_WORDS.carried, { exact: true }), 'the carried draft’s line').toBeVisible();
  await expect(card.getByRole('button', { name: SHEET_WORDS.keep, exact: true }), 'its Keep control').toBeEnabled();
  await expect(card.getByText(SHEET_WORDS.updated, { exact: true }), 'the mark in sight').toBeInViewport();
  await expect(card.getByRole('button', { name: SHEET_WORDS.keep, exact: true }), 'the Keep control in sight').toBeInViewport();
  await expect(card.getByRole('radio', { name: 'Passkeys', exact: true }), 'the pick carried, not chosen').toHaveAttribute('data-carried', '');
  await expect(card.getByRole('radio', { name: 'Passkeys', exact: true })).toHaveAttribute('aria-checked', 'false');
  await expect(sendButton(page, 0), 'Send counts no carried draft').toBeDisabled();
}

/** q3 answered in its text field and sent while the door refuses: the Send is released, its note at the sheet's head. */
export async function refusedSend(page: Page, door: { refuse(on: boolean): void }): Promise<void> {
  door.refuse(true);
  await sheetTool(page).getByRole('textbox', { name: SHEET_WORDS.answerName('q3'), exact: true }).fill(Q3_ANSWER);
  await sendButton(page, 1).click();
}
export async function refusedNote(page: Page): Promise<void> {
  await expect(sheetTool(page).locator('[data-sheet-note]'), 'the refusal’s note').toContainText(SHEET_WORDS.notSentNote(LOOK_REFUSAL), { timeout: 15_000 });
  await expect(sheetTool(page).locator('[data-sheet-note]'), 'the note in sight').toBeInViewport();
  await expect(sendButton(page, 1), 'the Send released, its draft kept').toBeEnabled();
}

/** The note closed and the same answer sent again with the door taking it: q3's card reads queued for a stopped session. */
export async function queueAnswer(page: Page, door: { refuse(on: boolean): void }): Promise<void> {
  door.refuse(false);
  const notes = sheetTool(page).locator('[data-sheet-note]');
  while ((await notes.count()) > 0) await notes.first().getByRole('button', { name: SHEET_WORDS.closeNote, exact: true }).click();
  const field = sheetTool(page).getByRole('textbox', { name: SHEET_WORDS.answerName('q3'), exact: true });
  if ((await field.inputValue()) === '') await field.fill(Q3_ANSWER); // reached alone: the refused Send never typed it
  await sendButton(page, 1).click();
  const takeBack = cardOf(page, 'q3').getByRole('button', { name: SHEET_WORDS.takeBack, exact: true });
  await takeBack.waitFor({ state: 'visible', timeout: 15_000 });
  await takeBack.scrollIntoViewIfNeeded(); // q3 is the sheet's last card: its queued answer stands under the column's fold
}
export async function queuedStopped(page: Page): Promise<void> {
  const card = cardOf(page, 'q3');
  await expect(card.getByText(SHEET_WORDS.queuedStopped, { exact: true }), 'queued, the session stopped').toBeInViewport({ timeout: 15_000 });
  await expect(card.getByRole('button', { name: SHEET_WORDS.takeBack, exact: true }), 'Take back in sight').toBeInViewport();
  await expect(card.getByRole('button', { name: SHEET_WORDS.takeBack, exact: true })).toBeEnabled();
}

/** The `rows` session's call at rest: its head line, and each question's line with Open. */
export async function rowAtRest(page: Page): Promise<void> {
  await expect(sheetRows(page)).toHaveCount(1, { timeout: 15_000 });
  expect(await rowHeads(page)).toEqual(['Asked 3 questions']);
  await expect.poll(() => rowLines(sheetRows(page)), { timeout: 15_000, message: 'each line with Open' }).toEqual([
    `q1 | Auth method | Which auth method should the login use? | ${SHEET_ROW.open}`,
    `q2 | Migration | Ship the migration today? | ${SHEET_ROW.open}`,
    `q3 | Empty state | What should the empty state say? | ${SHEET_ROW.open}`,
  ]);
}
/** The same call once its outcomes are in: an answer's receipt, a dismissal, a withdrawal, and no Open. */
export async function rowReceipts(page: Page): Promise<void> {
  await expect.poll(() => rowLines(sheetRows(page)), { timeout: 15_000, message: 'the receipts' }).toEqual([
    `q1 | Auth method | ${SHEET_ROW.arrow} OAuth`,
    `q2 | Migration | ${SHEET_ROW.arrow} ${SHEET_ROW.dismissed}`,
    `q3 | Empty state | ${SHEET_ROW.arrow} ${SHEET_ROW.withdrawn}`,
  ]);
}
/** The `forms` session's head lines: two questions asked and both revised, a call that did nothing, one refused whole. */
export async function rowForms(page: Page): Promise<void> {
  await expect(sheetRows(page)).toHaveCount(4, { timeout: 15_000 });
  expect(await rowHeads(page)).toEqual(['Asked 2 questions', 'Revised q5, q6', SHEET_ROW.nothing, SHEET_ROW.refused]);
  await expect(sheetRows(page).nth(2)).toContainText('Not done: q3 is not open (withdrawn at 09:12).');
  await expect(sheetRows(page).nth(3)).toContainText('InputValidationError: ask[0].header is too long');
}
