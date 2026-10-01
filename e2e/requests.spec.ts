// C7's request card end to end (C7 execution document, M2 and Acceptance item 2, the card-page half). The harness's
// `#composer` page mounts the X4 card over the app's real stores and C5's real key dispatcher, in front of C3's replay
// transport: every answer the card gives is a frame the engine host writes, and the replay ends on any write the
// fixture did not record, so a matching `*.resolved` event is the journal's own witness. Probe fixtures replay as
// recorded; the SPEC-derived synthetic requests (test/fixtures/requests) replay behind the handshake prelude
// (test/fixtures/engine/replay-handshake.jsonl), each followed by the response the card must write. One case runs the
// real shell on C5's stub scenario: a card on the floating Overview (⌘0) answers with Enter on its article.
// The real composer's case (M4's gate) runs in the shell too. The card page needs a harness build: `pnpm e2e:requests`
// builds one and runs this file; under a plain `pnpm build && pnpm e2e` the card-page cases skip and the two shell
// cases run.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { CardsHarnessApi, HarnessPane } from '../src/renderer/src/harness/composer/api';
import { invoke, launchReady, queueInterruptJournal, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { sidebarRow } from './support/sidebar';

// A packaged app is built without the harness (`pnpm build:app`), whatever `out/` holds now.
const HARNESS_BUILT = !process.env.MAWS_E2E_EXECUTABLE && existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));

const test = base.extend<{ cards: MawsLaunch }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
  cards: async ({}, use, testInfo) => {
    testInfo.skip(!HARNESS_BUILT, 'the card page needs a harness build (pnpm e2e:requests)');
    const maws = await launchMaws({ env: { MAWS_HARNESS: '1', MAWS_ENGINE_REPLAY: '1' } });
    try {
      await use(maws);
    } finally {
      await maws.cleanup();
    }
  },
});

type CardsWindow = Window & { __maws_cards: CardsHarnessApi; __c7: { batches: { appSessionId: string; events: SessionEvent[] }[] } };

let scratch: string;
test.beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maws-c7-requests-'));
});
test.afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function openCards(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log = { batches: [] as unknown[] };
    (window as unknown as { __c7: typeof log }).__c7 = log;
    window.maws.on('session.eventBatch', (payload) => log.batches.push(payload));
    location.hash = 'composer';
  });
  await page.waitForFunction(() => (window as unknown as Partial<CardsWindow>).__maws_cards !== undefined);
}

const show = (page: Page, panes: [HarnessPane, HarnessPane]) => page.evaluate((p) => (window as unknown as CardsWindow).__maws_cards.show(p), panes);
const counted = (page: Page) => page.evaluate(() => (window as unknown as CardsWindow).__maws_cards.counted());
const eventsOf = (page: Page, id: string) =>
  page.evaluate((appSessionId) => (window as unknown as CardsWindow).__c7.batches.filter((b) => b.appSessionId === appSessionId).flatMap((b) => b.events), id);
const resolved = async <K extends SessionEvent['kind']>(page: Page, id: string, kind: K) =>
  (await eventsOf(page, id)).filter((e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind);

// The fixture's first recorded human prompt, sent as recorded (the replay holds at it).
function firstPrompt(fixture: string): string {
  for (const line of readFileSync(join(REPO_ROOT, fixture), 'utf8').split('\n')) {
    if (!line) continue;
    const row = JSON.parse(line) as { direction: string; frame: { type: string; message?: { content: string } } };
    if (row.direction === 'out' && row.frame.type === 'user') return row.frame.message!.content;
  }
  throw new Error(`${fixture} records no prompt`);
}
async function sendFirstPrompt(page: Page, id: string, fixture: string) {
  value(await invoke(page, 'session.send', { appSessionId: id, content: firstPrompt(fixture) }));
}

// A synthetic request replayed behind the handshake prelude: each `requests` entry is the fixture's frame (its request
// patched, its id suffixed) followed by the response the card must write for it.
function syntheticJournal(name: string, requests: { patch?: (request: Record<string, unknown>) => void; response: Record<string, unknown> }[]): string {
  const handshake = readFileSync(join(REPO_ROOT, 'test/fixtures/engine/replay-handshake.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { seq: number });
  const rows: unknown[] = [...handshake];
  let seq = handshake.at(-1)!.seq;
  const at = '2026-09-29T12:00:00.000Z';
  requests.forEach(({ patch, response }, i) => {
    const { frame } = JSON.parse(readFileSync(join(REPO_ROOT, `test/fixtures/requests/${name}.json`), 'utf8')) as { frame: { request_id: string; request: Record<string, unknown> } };
    const requestId = `${frame.request_id}-${i + 1}`;
    patch?.(frame.request);
    rows.push({ seq: ++seq, direction: 'in', at, frame: { ...frame, request_id: requestId } });
    rows.push({ seq: ++seq, direction: 'out', at, frame: { type: 'control_response', response: { subtype: 'success', request_id: requestId, response } } });
  });
  const path = join(scratch, `${name}-${requests.length}-${Date.now()}.jsonl`);
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return path;
}

const PERMISSION = 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl';
const QUESTION = 'spikes/protocol-probe/fixtures/question-roundtrip.jsonl';
const questionWithoutPreviews = () => {
  const path = join(scratch, 'question-without-previews.jsonl');
  const rows = readFileSync(join(REPO_ROOT, QUESTION), 'utf8').trim().split('\n');
  writeFileSync(path, rows.map((line) => JSON.stringify(JSON.parse(line, (key, value) => key === 'preview' ? undefined : value))).join('\n') + '\n');
  return path;
};
const DIALOGS = 'spikes/protocol-probe/fixtures/pass2/dialogs.jsonl';
const GRANT = 'spikes/protocol-probe/fixtures/pass2/grant-reapply-start.jsonl';
const unflag = (request: Record<string, unknown>) => delete request.requires_user_interaction;

test('a replayed permission renders in the docked frame on the card page, Enter answers it in the focused pane only', async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  await launchReady(page, 'c7-permission', PERMISSION);
  await show(page, [{ appSessionId: 'c7-permission', placement: 'docked' }, { counter: true }]);
  await sendFirstPrompt(page, 'c7-permission', PERMISSION); // seq 4; the request is seq 49
  const pane0 = page.getByRole('region', { name: 'pane 0' });
  const frame = pane0.getByRole('group', { name: 'Approval needed' });
  await expect(frame).toBeVisible();
  await expect(frame.getByRole('heading', { name: 'Bash' })).toBeVisible();
  await expect(frame.getByTestId('request-input')).toHaveText('git log --oneline');
  expect(await frame.getByRole('radio').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))), 'decision_reason_type rule: once only').toEqual(['Allow once']);

  // Enter in the other pane's region is that region's; the card's frame answers only from itself.
  await page.getByRole('region', { name: 'pane 1' }).getByLabel('counter').focus();
  await page.keyboard.press('Enter');
  expect(await counted(page)).toBe(1);
  expect(await resolved(page, 'c7-permission', 'permission.resolved')).toEqual([]);
  await frame.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await resolved(page, 'c7-permission', 'permission.resolved')).map((e) => [e.behavior, e.updatedPermissions])).toEqual([['allow', []]]); // seq 50
  expect(await counted(page), 'the counting pane never saw that Enter').toBe(1);
  await expect(pane0.getByText('No request for c7-permission')).toBeVisible(); // confirmed at the tool result (seq 53), then retired
  expect(cards.consoleErrors()).toEqual([]);
});

// W4: one question at a time under a pager; the picks live beside the request, so the same item moved from the docked
// frame to the transcript's inline slot resumes at its question; every answer leaves as the one reply (seq 138).
test('a question card steps one question at a time, keeps its picks across placements, and submits every answer as the fixture recorded', async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  await launchReady(page, 'c7-question', QUESTION);
  await show(page, [{ appSessionId: 'c7-question', placement: 'docked' }, null]);
  await sendFirstPrompt(page, 'c7-question', QUESTION);
  const frame = page.getByRole('group', { name: 'Question' });
  await expect(frame).toContainText('1 of 2');
  await expect(frame.getByText('Which fruits do you like?')).toHaveCount(0);
  await frame.getByRole('radio', { name: 'Red' }).click();
  // The option's preview renders inside the sandboxed srcdoc frame under the app's CSP (no `<pre>` fallback needed).
  await expect(page.frameLocator('iframe[title="Preview of Red"]').locator('body')).toContainText('This is a red preview');
  await frame.getByRole('radio', { name: 'Blue' }).click();
  await expect(frame.getByRole('radio', { name: 'Blue' })).toHaveAttribute('aria-checked', 'true');
  await expect(frame).toContainText('1 of 2');
  await frame.getByRole('radio', { name: 'Red' }).click();
  await frame.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(frame).toContainText('2 of 2');
  await frame.getByRole('checkbox', { name: 'Apple' }).click();

  await show(page, [{ appSessionId: 'c7-question', placement: 'inline' }, null]);
  const card = page.locator('[data-request-card]');
  await expect(card).toContainText('2 of 2');
  await expect(card.getByRole('checkbox', { name: 'Apple' })).toHaveAttribute('aria-checked', 'true');
  expect((await card.boundingBox())!.width, 'inline, the card is 480 px wide at most').toBeLessThanOrEqual(480);
  await card.getByRole('checkbox', { name: 'Pear' }).click();
  expect(await resolved(page, 'c7-question', 'question.answered'), 'nothing leaves before Submit').toEqual([]);
  await card.getByRole('button', { name: 'Submit' }).click();
  await expect.poll(async () => (await resolved(page, 'c7-question', 'question.answered')).map((e) => e.answers)).toEqual([
    { 'Which color do you prefer?': 'Red', 'Which fruits do you like?': 'Apple, Pear' }, // seq 138
  ]);
  expect(cards.consoleErrors()).toEqual([]);
});

// W4: the Overview card answers a question from its article: a digit picks, Enter moves on, and Skip on the last
// question sends the reply without it (the replay matches the response by request id and behavior, so the recorded
// question round trip carries the partial reply; the engine reads an absent answer as unanswered).
test('the Overview card steps a question with digits and Enter, and Skip leaves the last question out of the reply', async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  const journal = questionWithoutPreviews();
  await launchReady(page, 'c7-question-card', journal);
  await show(page, [{ appSessionId: 'c7-question-card', placement: 'card' }, null]);
  await sendFirstPrompt(page, 'c7-question-card', journal);
  const article = page.getByRole('article', { name: 'card c7-question-card' });
  await expect(article).toContainText('1 of 2');
  await article.focus();
  await page.keyboard.press('2');
  await expect(article.getByRole('radio', { name: 'Blue' })).toHaveAttribute('aria-checked', 'true');
  await page.waitForTimeout(250); // beyond the removed auto-advance delay, even without previews
  await expect(article).toContainText('1 of 2');
  await page.keyboard.press('1');
  await expect(article.getByRole('radio', { name: 'Red' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('2');
  await page.keyboard.press('Enter');
  await expect(article).toContainText('2 of 2');
  await expect(article).toBeFocused();
  await article.getByRole('button', { name: 'Skip' }).click();
  await expect.poll(async () => (await resolved(page, 'c7-question-card', 'question.answered')).map((e) => e.answers)).toEqual([{ 'Which color do you prefer?': 'Blue' }]);
  expect(cards.consoleErrors()).toEqual([]);
});

test("an elicitation form accepts the fixture's content", async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  await launchReady(page, 'c7-elicit', DIALOGS);
  await show(page, [{ appSessionId: 'c7-elicit', placement: 'docked' }, null]);
  await sendFirstPrompt(page, 'c7-elicit', DIALOGS); // seq 5; the elicitation is seq 41
  const frame = page.getByRole('group', { name: 'Input requested' });
  await expect(frame.getByText('MAWS probe: pick a color')).toBeVisible();
  await frame.getByRole('textbox', { name: 'Color (required)' }).fill('teal');
  await frame.getByRole('button', { name: 'Accept' }).click();
  await expect.poll(async () => (await resolved(page, 'c7-elicit', 'elicitation.resolved')).map((e) => [e.action, e.content])).toEqual([['accept', { color: 'teal' }]]); // seq 43
  expect(cards.consoleErrors()).toEqual([]);
});

test("a session-scoped allow carries the fixture's updatedPermissions", async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  await launchReady(page, 'c7-grant', GRANT);
  await show(page, [{ appSessionId: 'c7-grant', placement: 'docked' }, null]);
  await sendFirstPrompt(page, 'c7-grant', GRANT); // seq 5; the request is seq 30
  const frame = page.getByRole('group', { name: 'Approval needed' });
  await expect(frame.getByRole('radio', { name: 'Allow for this session' })).toContainText('Matching touch granted.txt commands');
  await frame.focus();
  await page.keyboard.press('2'); // digits pick a scope
  await expect(frame.getByRole('radio', { name: 'Allow for this session' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await resolved(page, 'c7-grant', 'permission.resolved')).map((e) => [e.behavior, e.updatedPermissions]))
    .toEqual([['allow', [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'touch granted.txt' }], behavior: 'allow', destination: 'session' }]]]); // seq 32
  expect(cards.consoleErrors()).toEqual([]);
});

test('the Overview card answers with focus on its article and the hover card answers by its own controls', async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  await launchReady(page, 'c7-read-card', syntheticJournal('flagged-read', [{ patch: unflag, response: { behavior: 'allow' } }]));
  await launchReady(page, 'c7-read-hover', syntheticJournal('flagged-read', [{ patch: unflag, response: { behavior: 'allow' } }]));
  await show(page, [
    { appSessionId: 'c7-read-card', placement: 'card' },
    { appSessionId: 'c7-read-hover', placement: 'hover' },
  ]);
  const article = page.getByRole('article', { name: 'card c7-read-card' });
  await expect(article.getByTestId('request-input')).toHaveText('/tmp/maws-c7-scratch/README.md');
  await article.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await resolved(page, 'c7-read-card', 'permission.resolved')).map((e) => e.behavior)).toEqual(['allow']);
  await expect(article.getByRole('status')).toHaveText('Answered · Allowed once');

  const hover = page.getByRole('dialog', { name: 'hover c7-read-hover' });
  const approve = hover.getByRole('button', { name: 'Approve' });
  await approve.focus();
  await page.keyboard.press('Enter'); // a key-synthesised click answers nothing
  await page.waitForTimeout(300);
  expect(await resolved(page, 'c7-read-hover', 'permission.resolved')).toEqual([]);
  await approve.click();
  await expect.poll(async () => (await resolved(page, 'c7-read-hover', 'permission.resolved')).map((e) => e.behavior)).toEqual(['allow']);
  expect(cards.consoleErrors()).toEqual([]);
});

test('a Read request flagged requires_user_interaction offers no quick approval anywhere', async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  await launchReady(page, 'c7-flagged', syntheticJournal('flagged-read', [{ response: { behavior: 'deny' } }]));
  await show(page, [
    { appSessionId: 'c7-flagged', placement: 'docked' },
    { appSessionId: 'c7-flagged', placement: 'hover' },
  ]);
  // pane 0 holds the docked frame; the hover card in pane 1 is a group named for the kind too ("Approval needed: Read", or the kind alone while unread)
  const frame = page.getByRole('region', { name: 'pane 0' }).getByRole('group', { name: 'Approval needed', exact: true });
  await expect(frame.getByText(/Read needs its own approval surface, which MAWS does not have/)).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Allow' })).toHaveCount(0);
  await expect(frame.getByRole('radiogroup')).toHaveCount(0);
  const hover = page.getByRole('dialog', { name: 'hover c7-flagged' });
  expect(await hover.getByRole('button').allTextContents()).toEqual(['Open session']);
  await expect(hover.getByRole('group', { name: 'Approval needed: Read' })).toBeVisible();

  await frame.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  expect(await resolved(page, 'c7-flagged', 'permission.resolved'), 'Enter and digits approve nothing').toEqual([]);
  await page.keyboard.press('Escape'); // Esc denies as usual
  await expect.poll(async () => (await resolved(page, 'c7-flagged', 'permission.resolved')).map((e) => e.behavior)).toEqual(['deny']);
  expect(cards.consoleErrors()).toEqual([]);
});

test('the two declared dialogs answer with the pinned result strings', async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  const completed = { behavior: 'completed' };
  await launchReady(page, 'c7-refusal', syntheticJournal('refusal-fallback-dialog', [{ response: completed }, { response: completed }]));
  await launchReady(page, 'c7-auto', syntheticJournal('auto-mode-fallback-dialog', [{ response: completed }, { response: completed }]));
  await show(page, [
    { appSessionId: 'c7-refusal', placement: 'docked' },
    { appSessionId: 'c7-auto', placement: 'docked' },
  ]);
  const results = async (id: string) => (await resolved(page, id, 'dialog.resolved')).map((e) => [e.behavior, e.result]);

  const refusal = page.getByRole('region', { name: 'pane 0' }).getByRole('group', { name: 'Dialog' });
  await expect(refusal.getByRole('button', { name: 'Retry with claude-sonnet-5' })).toBeVisible();
  await refusal.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => results('c7-refusal')).toEqual([['completed', 'retry_fallback']]);
  await expect(refusal.getByRole('button', { name: 'Cancel' })).toBeVisible(); // the second request (the answered one has no controls)
  await refusal.focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => results('c7-refusal')).toEqual([
    ['completed', 'retry_fallback'],
    ['completed', 'cancelled'],
  ]);

  const auto = page.getByRole('region', { name: 'pane 1' }).getByRole('group', { name: 'Dialog' });
  await expect(auto.getByRole('button', { name: 'Continue' })).toBeVisible();
  await auto.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => results('c7-auto')).toEqual([['completed', 'continue']]);
  await expect(auto.getByRole('button', { name: 'Stop' })).toBeEnabled(); // the second request
  await auto.focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => results('c7-auto')).toEqual([
    ['completed', 'continue'],
    ['completed', 'interrupt'],
  ]);
  expect(cards.consoleErrors()).toEqual([]);
});

test('an undeclared dialog kind stays pending and unanswered', async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  // The response row is what the card must never write: the replay would match it only if the card answered.
  await launchReady(page, 'c7-undeclared', syntheticJournal('undeclared-dialog', [{ response: { behavior: 'cancelled' } }]));
  await show(page, [{ appSessionId: 'c7-undeclared', placement: 'docked' }, null]);
  const pane = page.getByRole('region', { name: 'pane 0' });
  await expect(pane.getByRole('heading', { name: 'cost_threshold' })).toBeVisible();
  await expect(pane.getByText(/MAWS did not declare this dialog kind and cannot answer it/)).toBeVisible();
  await expect(pane.getByRole('group')).toHaveCount(0); // no docked frame: it never takes the composer's place
  await pane.getByRole('button', { name: 'pane 0' }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  expect(await resolved(page, 'c7-undeclared', 'dialog.resolved')).toEqual([]);
  expect(value(await invoke(page, 'attention.list', undefined)).filter((i) => i.appSessionId === 'c7-undeclared').map((i) => [i.kind, i.state])).toEqual([['dialog', 'pending']]);
  expect(cards.consoleErrors()).toEqual([]);
});

// The real shell on C5's stub scenario: the Overview (⌘0) shows the card, whose article holds focus, and Enter answers
// the card's request there (the stub delivers it, and the card's request and the dock badge's count go).
test('the Overview card answers with Enter on its article', async () => {
  const shell = await launchMaws({ env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/nine-sessions.json', MAWS_SCENARIO_CLOCK: 'manual' } });
  try {
    const { app, page } = shell;
    const fix = 'Fix sidebar drag';
    await expect(page.locator('[data-region="sidebar"] [data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });
    // ⌘0 (View › Overview), once the page has registered it: the item is disabled until then
    const openOverview = () =>
      app.evaluate(({ Menu }) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById('tab.overview');
        if (!item?.enabled) return false;
        item.click();
        return true;
      });
    await expect.poll(openOverview, { message: 'View › Overview is enabled' }).toBe(true);
    await expect(page.locator('[data-region="main"]').getByRole('dialog', { name: 'Overview' })).toBeVisible();
    const card = page.locator('[data-region="main"]').getByRole('article', { name: fix });
    await expect(card.getByRole('radio', { name: 'Allow once' })).toBeVisible(); // C7's card, not C5's preview
    const badge = () => app.evaluate(({ app }) => app.dock?.getBadge());
    expect(await badge()).toBe('3');
    await card.focus();
    await page.keyboard.press('Enter');
    await expect(card.getByRole('radio', { name: 'Allow once' })).toHaveCount(0);
    await expect.poll(badge).toBe('2');
    expect(shell.consoleErrors()).toEqual([]);
  } finally {
    await shell.cleanup();
  }
});

// The real composer's gate (C7 execution document, M4, moved from M2): the shell itself, not the card page, over C3's
// replay and outside C5's stub scenario (which answers `session.answer` itself). The two sessions are discovered as
// records from scratch transcripts under the launch's own CLAUDE_CONFIG_DIR (M3's route; main is unchanged), and each
// replay launches under its record's app id, so C4 applies C3's status to the record and the pane shows the composer.
// The left pane holds the permission session, the right one a session counting through a slow turn; the split opens
// after the first composer mounted, so registration order runs against focus.
test('the real composer gives way to the card and returns with focus in the editor', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-c7-gate-')));
  const repo = join(root, 'repo');
  const config = join(root, 'claude-config');
  mkdirSync(repo);
  const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  const titles = ['gate permission session', 'gate counting session'];
  const engineIds = titles.map((title) => {
    const sessionId = randomUUID();
    const row = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: title }, uuid: randomUUID(), timestamp: '2026-09-29T10:00:00.000Z', cwd: repo, sessionId, version: '2.1.283' };
    writeFileSync(join(project, `${sessionId}.jsonl`), `${JSON.stringify(row)}\n`);
    return sessionId;
  });
  const shell = await launchMaws({ env: { MAWS_HARNESS: '0', MAWS_ENGINE_REPLAY: '1', CLAUDE_CONFIG_DIR: config } });
  try {
    const { app, page } = shell;
    await page.evaluate(() => {
      const log = { batches: [] as unknown[] };
      (window as unknown as { __c7: typeof log }).__c7 = log;
      window.maws.on('session.eventBatch', (payload) => log.batches.push(payload));
    });
    let ids: string[] = [];
    await expect
      .poll(async () => {
        const { sessions } = value(await invoke(page, 'session.list', {}));
        ids = engineIds.map((engineId) => sessions.find((s) => s.engineSessionId === engineId)?.appId ?? '');
        return ids.every((id) => id !== '');
      })
      .toBe(true);
    const [permissionId, countingId] = ids;
    await launchReady(page, permissionId, PERMISSION, { cwd: repo });
    await launchReady(page, countingId, queueInterruptJournal(root, 'gate'), { cwd: repo });

    // A launched replay reports the fixture's engine session id, so the record keeps its app id but no longer its
    // title (C4 files the transcript under a record of its own again): the rows are found by app id.
    const openRow = async (id: string) => (await sidebarRow(page, { appSessionId: id })).click();
    const main = page.locator('[data-region="main"]');
    const left = main.locator('[data-pane="0"]');
    const right = main.locator('[data-pane="1"]');
    const message = (paneLocator: typeof left) => paneLocator.getByRole('textbox', { name: 'Message' });
    await openRow(permissionId);
    await expect(message(left)).toBeVisible();
    await openRow(countingId);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('pane.split')?.click());
    await expect(right.locator(`[data-composer="${countingId}"]`)).toBeVisible();
    await openRow(permissionId);
    await expect(left.locator(`[data-composer="${permissionId}"]`)).toBeVisible();

    // the right pane's session is busy with a slow turn
    await message(right).click();
    await page.keyboard.type('Count to 30 slowly. For each number use a separate Bash call sleep 1; echo NUMBER. Start now.');
    await page.keyboard.press('Enter');
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: countingId })).turn).not.toBeNull();

    // the left one sends the fixture's prompt from its composer, and the editor gives way to the permission card
    await message(left).click();
    await page.keyboard.type(firstPrompt(PERMISSION));
    await page.keyboard.press('Enter');
    const frame = left.getByRole('group', { name: 'Approval needed' });
    await expect(frame).toBeVisible();
    await expect(frame.getByTestId('request-input')).toHaveText('git log --oneline');
    expect(await frame.getByRole('radio').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual(['Allow once']);
    await expect(message(left)).toBeHidden();
    await expect(frame).toBeFocused(); // the pane held focus

    // Enter and ⌘. in the other pane's editor are that pane's: the card is not answered, the counting turn stops
    await message(right).click();
    await page.keyboard.press('Enter');
    await page.keyboard.type('typing when I stop');
    await page.keyboard.press('Meta+.');
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: countingId })).turn).toBeNull();
    expect(await resolved(page, permissionId, 'permission.resolved')).toEqual([]);
    expect(value(await invoke(page, 'session.status', { appSessionId: permissionId })).process, 'no interrupt reached the permission session').toBe('ready');

    // Enter with focus in the card answers it; the composer returns with focus in the editor
    await frame.focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await resolved(page, permissionId, 'permission.resolved')).map((e) => [e.behavior, e.updatedPermissions])).toEqual([['allow', []]]); // seq 50
    await expect(message(left)).toBeVisible();
    await expect(message(left)).toBeFocused();
    await expect(frame).toHaveCount(0);

    // ⌘. from this editor now resolves this pane's session: idle, so nothing is written (an unrecorded interrupt would end its replay)
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: permissionId })).turn).toBeNull();
    await page.keyboard.press('Meta+.');
    await page.waitForTimeout(300);
    expect(value(await invoke(page, 'session.status', { appSessionId: permissionId })).process).toBe('ready');
    expect(shell.consoleErrors()).toEqual([]);
  } finally {
    await shell.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});
