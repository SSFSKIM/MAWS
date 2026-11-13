// C7's request card end to end (C7 execution document, M2 and Acceptance item 2, the card-page half). The harness's
// `#composer` page mounts the X4 card over the app's real stores and C5's real key dispatcher, in front of C3's replay
// transport: every answer the card gives is a frame the engine host writes, and the replay ends on any write the
// fixture did not record, so a matching `*.resolved` event is the journal's own witness. Probe fixtures replay as
// recorded; the SPEC-derived synthetic requests (test/fixtures/requests) replay behind the handshake prelude
// (test/fixtures/engine/replay-handshake.jsonl), each followed by the response the card must write. One case runs the
// real shell on C5's stub scenario: a card on the floating Overview (⌘0) answers with ⌘Enter on its article.
// The real composer's case (M4's gate) runs in the shell too. The card page needs a harness build: `pnpm e2e:requests`
// builds one and runs this file; under a plain `pnpm build && pnpm e2e` the card-page cases skip and the two shell
// cases run.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { CardsHarnessApi, HarnessPane } from '../src/renderer/src/harness/composer/api';
import { addressed } from './support/address';
import { invoke, launchReady, queueInterruptJournal, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { ALLOW_LASTING_KEY, ALLOW_ONCE_KEY, answerByKey, armEarlyPress, DENY_KEY, earlyPress, pastGrace, watchPrompts } from './support/request-keys';
import { sidebarOf, sidebarRow } from './support/sidebar';

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
  await watchPrompts(page);
}

const show = (page: Page, panes: [HarnessPane, HarnessPane]) => page.evaluate((p) => (window as unknown as CardsWindow).__maws_cards.show(p), panes);
const counted = (page: Page) => page.evaluate(() => (window as unknown as CardsWindow).__maws_cards.counted());
const eventsOf = (page: Page, id: string) =>
  page.evaluate((appSessionId) => (window as unknown as CardsWindow).__c7.batches.filter((b) => b.appSessionId === appSessionId).flatMap((b) => b.events), id);
const resolved = async <K extends SessionEvent['kind']>(page: Page, id: string, kind: K) =>
  (await eventsOf(page, id)).filter((e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind);

// The fixture's first recorded human prompt, sent as recorded (the replay holds at it).
function firstPrompt(fixture: string): string {
  for (const line of readFileSync(resolve(REPO_ROOT, fixture), 'utf8').split('\n')) {
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

test('a replayed permission renders in the docked frame on the card page, ⌘Enter answers it in the focused pane only', async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  await launchReady(page, 'c7-permission', PERMISSION);
  await show(page, [{ appSessionId: 'c7-permission', placement: 'docked' }, { counter: true }]);
  await sendFirstPrompt(page, 'c7-permission', PERMISSION); // seq 4; the request is seq 49
  const pane0 = page.getByRole('region', { name: 'pane 0' });
  const frame = pane0.getByRole('group', { name: 'Approval needed' });
  await expect(frame).toBeVisible();
  // U1a §D: the card opens on what is asked, in place of the tool's name
  await expect(frame.getByRole('heading', { name: 'Run a command' })).toBeVisible();
  await expect(frame.getByRole('heading', { name: 'Bash' })).toHaveCount(0);
  await expect(frame.getByTestId('request-input')).toHaveText('git log --oneline');
  // decision_reason_type rule: once only, so two answer buttons
  const allow = frame.getByRole('button', { name: 'Allow once', exact: true });
  await expect(frame.getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
  await expect(allow).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Allow for this session' })).toHaveCount(0);
  await expect(frame.getByRole('button', { name: /^Always allow/ })).toHaveCount(0);

  // Past the prompt's first 400 ms, so a key that answers nothing is unbound rather than early: the other pane's keys
  // are that region's (its Enter counts there, and ⌘Enter pressed there answers nothing here), and Enter on the frame
  // answers nothing (a permission prompt is allowed with ⌘Enter).
  await pastGrace(page, frame.locator('[data-request-card]'));
  await page.getByRole('region', { name: 'pane 1' }).getByLabel('counter').focus();
  await page.keyboard.press('Enter');
  expect(await counted(page)).toBe(1);
  await page.keyboard.press(ALLOW_ONCE_KEY);
  await page.waitForTimeout(300);
  expect(await resolved(page, 'c7-permission', 'permission.resolved'), "the other pane's ⌘Enter allows nothing").toEqual([]);
  await frame.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(await resolved(page, 'c7-permission', 'permission.resolved'), 'Enter allows nothing').toEqual([]);
  await answerByKey(page, { focus: frame, control: allow, key: ALLOW_ONCE_KEY, answered: async () => (await resolved(page, 'c7-permission', 'permission.resolved')).length > 0, what: 'c7-permission' });
  await expect.poll(async () => (await resolved(page, 'c7-permission', 'permission.resolved')).map((e) => [e.behavior, e.updatedPermissions])).toEqual([['allow', []]]); // seq 50
  expect(await counted(page), 'the counting pane never saw a key of the card').toBe(1);
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

// U1a §D: the request offers a project rule (the engine's localSettings suggestion), so its buttons are Deny, the rule's
// "Always allow in <project>" and Allow once, the file the rule is written to named under them, and "Allow for this
// session" the one entry of the menu on Allow once. Each key is printed on its button and is not part of its name.
test("a session-scoped allow carries the fixture's updatedPermissions", async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  await launchReady(page, 'c7-grant', GRANT);
  await show(page, [{ appSessionId: 'c7-grant', placement: 'docked' }, null]);
  await sendFirstPrompt(page, 'c7-grant', GRANT); // seq 5; the request is seq 30
  const frame = page.getByRole('group', { name: 'Approval needed' });
  const deny = frame.getByRole('button', { name: 'Deny', exact: true });
  const always = frame.getByRole('button', { name: 'Always allow in this project', exact: true }); // the harness's session has no project
  const once = frame.getByRole('button', { name: 'Allow once', exact: true });
  await expect(once).toBeVisible();
  await expect(deny).toBeVisible();
  await expect(always).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Allow for this session' }), 'the session scope is the menu’s entry, not a button').toHaveCount(0);
  await expect(frame.getByText('Always allow adds touch granted.txt to .claude/settings.local.json in the project.')).toBeVisible();
  for (const [button, keys, hint] of [[deny, 'Escape', '⎋'], [always, 'Meta+Shift+Enter', '⌘⇧↩'], [once, 'Meta+Enter', '⌘↩']] as const) {
    await expect(button).toHaveAttribute('aria-keyshortcuts', keys);
    await expect(button.locator('kbd')).toHaveText(hint);
  }
  await expect(frame.getByText('Matching touch granted.txt commands'), 'a session scope draws no rule text').toHaveCount(0);

  // a digit picks nothing: there is no scope list
  await pastGrace(page, frame.locator('[data-request-card]'));
  await frame.focus();
  await page.keyboard.press('2');
  await page.waitForTimeout(300);
  expect(await resolved(page, 'c7-grant', 'permission.resolved'), 'a digit answers nothing').toEqual([]);

  await frame.getByRole('button', { name: 'More allow options' }).click();
  await page.getByRole('menuitem', { name: 'Allow for this session' }).click();
  await expect
    .poll(async () => (await resolved(page, 'c7-grant', 'permission.resolved')).map((e) => [e.behavior, e.updatedPermissions]))
    .toEqual([['allow', [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'touch granted.txt' }], behavior: 'allow', destination: 'session' }]]]); // seq 32
  expect(cards.consoleErrors()).toEqual([]);
});

// U1a §D (A3): a Read the engine flags nothing on offers the session scope as its third button. ⌘Enter sent inside the
// prompt's first 400 ms answers nothing; ⇧⌘Enter after them gives the scope the third button names.
test('the three keys on their buttons; ⌘Enter inside the first 400 ms answers nothing, ⇧⌘Enter then allows for the session', async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  await armEarlyPress(page, { frame: '[aria-label="pane 0"] [data-docked-frame]', key: 'Enter', meta: true, after: 100 });
  await launchReady(page, 'c7-keys', syntheticJournal('flagged-read', [{ patch: unflag, response: { behavior: 'allow' } }]));
  await show(page, [{ appSessionId: 'c7-keys', placement: 'docked' }, null]);
  const frame = page.getByRole('region', { name: 'pane 0' }).getByRole('group', { name: 'Approval needed' });
  await expect(frame.getByRole('heading', { name: 'Read a file' })).toBeVisible();
  const lasting = frame.getByRole('button', { name: 'Allow for this session', exact: true });
  for (const [name, keys, hint] of [['Deny', 'Escape', '⎋'], ['Allow for this session', 'Meta+Shift+Enter', '⌘⇧↩'], ['Allow once', 'Meta+Enter', '⌘↩']] as const) {
    const button = frame.getByRole('button', { name, exact: true });
    await expect(button).toHaveAttribute('aria-keyshortcuts', keys);
    await expect(button.locator('kbd')).toHaveText(hint);
  }
  const early = await earlyPress(page);
  expect(early.focused, 'the early ⌘Enter went to the frame holding the focus').toBe(true);
  expect(early.after, 'the early ⌘Enter went inside the prompt’s first 400 ms').toBeLessThan(400);
  await page.waitForTimeout(300);
  expect(await resolved(page, 'c7-keys', 'permission.resolved'), 'a key inside the first 400 ms answers nothing').toEqual([]);
  await answerByKey(page, { focus: frame, control: lasting, key: ALLOW_LASTING_KEY, answered: async () => (await resolved(page, 'c7-keys', 'permission.resolved')).length > 0, what: 'c7-keys' });
  await expect
    .poll(async () => (await resolved(page, 'c7-keys', 'permission.resolved')).map((e) => [e.behavior, e.updatedPermissions]))
    .toEqual([['allow', [{ type: 'addRules', rules: [{ toolName: 'Read' }], behavior: 'allow', destination: 'session' }]]]);
  expect(cards.consoleErrors()).toEqual([]);
});

// U1a §D (A3, decision 17): a chord held down answers the prompt it was pressed at and not the one that takes its place,
// however long it is held: its key repeats reach no request handler. Released and pressed again, it answers the second.
test('a held ⌘Enter answers the first of two queued prompts and never the second; pressed again, it answers the second', async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  const allowed = { patch: unflag, response: { behavior: 'allow' } };
  await launchReady(page, 'c7-held', syntheticJournal('flagged-read', [allowed, allowed]));
  await show(page, [{ appSessionId: 'c7-held', placement: 'docked' }, null]);
  const frame = page.getByRole('region', { name: 'pane 0' }).getByRole('group', { name: 'Approval needed' });
  const answers = async () => (await resolved(page, 'c7-held', 'permission.resolved')).length;
  const first = frame.locator('[data-request-card]');
  await pastGrace(page, first);
  const firstId = await first.getAttribute('data-request-card');
  await frame.focus();
  await page.keyboard.down('Meta');
  await page.keyboard.down('Enter');
  await expect.poll(answers, { message: 'the held chord answered the first prompt' }).toBe(1);
  const second = frame.locator(`[data-request-card]:not([data-request-card="${firstId}"])`);
  await expect(second.getByRole('button', { name: 'Allow once', exact: true })).toBeEnabled();
  await expect(frame).toBeFocused(); // the next prompt's frame takes the focus
  await pastGrace(page, second);
  for (let k = 0; k < 10; k++) {
    await page.keyboard.down('Enter'); // a key repeat: Playwright marks every down of a key already held as one
    await page.waitForTimeout(50);
  }
  expect(await answers(), 'a key repeat answers nothing, past the second prompt’s 400 ms').toBe(1);
  await page.keyboard.up('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await page.keyboard.up('Meta');
  await expect.poll(answers, { message: 'a fresh press answers the second prompt' }).toBe(2);
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
  await answerByKey(page, {
    focus: article,
    control: article.getByRole('button', { name: 'Allow once', exact: true }),
    key: ALLOW_ONCE_KEY,
    answered: async () => (await resolved(page, 'c7-read-card', 'permission.resolved')).length > 0,
    what: 'c7-read-card',
  });
  await expect.poll(async () => (await resolved(page, 'c7-read-card', 'permission.resolved')).map((e) => e.behavior)).toEqual(['allow']);
  // U1a §C: an answered request is drawn nowhere, and no "Answered" line stands in its place
  await expect(article.locator('[data-request-card]')).toHaveCount(0);
  await expect(article.getByText('Answered')).toHaveCount(0);

  const hover = page.getByRole('dialog', { name: 'hover c7-read-hover' });
  const allow = hover.getByRole('button', { name: 'Allow once', exact: true });
  await allow.focus();
  await page.keyboard.press('Enter'); // a key-synthesised click answers nothing
  await page.waitForTimeout(300);
  expect(await resolved(page, 'c7-read-hover', 'permission.resolved')).toEqual([]);
  await allow.click();
  await expect.poll(async () => (await resolved(page, 'c7-read-hover', 'permission.resolved')).map((e) => e.behavior)).toEqual(['allow']);
  expect(cards.consoleErrors()).toEqual([]);
});

// U1a §H (A14): away from its pane a waiting permission may always be denied, and allowed once only when it is a
// read-only tool or a shell command the surface shows whole. On the hover card, a file change offers Deny alone and a
// short command both, each answered by a click.
test('the hover card denies a file change and allows a short command once, by click', async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  const command = (request: Record<string, unknown>) => {
    unflag(request);
    Object.assign(request, { tool_name: 'Bash', display_name: 'Bash', input: { command: 'ls docs' }, description: 'List the notes folder' });
  };
  await launchReady(page, 'c7-hover-edit', syntheticJournal('edit-permission', [{ response: { behavior: 'deny' } }]));
  await launchReady(page, 'c7-hover-command', syntheticJournal('flagged-read', [{ patch: command, response: { behavior: 'allow' } }]));
  await show(page, [
    { appSessionId: 'c7-hover-edit', placement: 'hover' },
    { appSessionId: 'c7-hover-command', placement: 'hover' },
  ]);
  const edit = page.getByRole('dialog', { name: 'hover c7-hover-edit' });
  const shell = page.getByRole('dialog', { name: 'hover c7-hover-command' });
  await expect(edit.getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
  expect(await edit.getByRole('button').allTextContents(), 'a file change: Deny alone').toEqual(['Open session', 'Deny']);
  await expect(shell.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible();
  expect(await shell.getByRole('button').allTextContents(), 'a short command: Allow once and Deny').toEqual(['Open session', 'Deny', 'Allow once']);

  await edit.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect.poll(async () => (await resolved(page, 'c7-hover-edit', 'permission.resolved')).map((e) => e.behavior)).toEqual(['deny']);
  await shell.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect.poll(async () => (await resolved(page, 'c7-hover-command', 'permission.resolved')).map((e) => [e.behavior, e.updatedPermissions])).toEqual([['allow', []]]);
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
  await expect(frame.getByRole('button', { name: /^Allow/ })).toHaveCount(0);
  const hover = page.getByRole('dialog', { name: 'hover c7-flagged' });
  // U1a §H: a flagged request can be denied from outside its pane, never allowed
  await expect(hover.getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
  expect(await hover.getByRole('button').allTextContents()).toEqual(['Open session', 'Deny']);
  await expect(hover.getByRole('group', { name: 'Approval needed: Read' })).toBeVisible();

  await pastGrace(page, frame.locator('[data-request-card]'));
  await frame.focus();
  for (const key of [ALLOW_ONCE_KEY, ALLOW_LASTING_KEY, 'Enter', '1']) await page.keyboard.press(key);
  await page.waitForTimeout(300);
  expect(await resolved(page, 'c7-flagged', 'permission.resolved'), '⌘Enter, ⇧⌘Enter, Enter and digits approve nothing').toEqual([]);
  // Esc denies as usual
  await answerByKey(page, { focus: frame, control: frame.getByRole('button', { name: 'Deny', exact: true }), key: DENY_KEY, answered: async () => (await resolved(page, 'c7-flagged', 'permission.resolved')).length > 0, what: 'c7-flagged' });
  await expect.poll(async () => (await resolved(page, 'c7-flagged', 'permission.resolved')).map((e) => e.behavior)).toEqual(['deny']);
  expect(cards.consoleErrors()).toEqual([]);
});

// L114: each answer waits on the harness's event stream, never on what a card shows. The n-th `dialog.requested` of
// the session names the request; main's attention item for it names its card (`data-request-card`); the key goes to
// that card's frame while its control is enabled, and the answer is the request's `dialog.resolved` on the stream.
// The key is pressed again only while the card shows its control enabled: the card binds its keys in an effect after
// the render that shows it, so a key can land before them, and a key it takes disables the control before the press
// returns (`submit` sets `answering` in the key's handler), so a taken key is never repeated, and never reaches the
// next request's card (which docks only after this one's answer). Every locator read in the loop has a short timeout,
// so a card mid-render is read again rather than waited on. A failure of the case prints the sessions' dialog events
// and attention items, so the gate's log keeps what the next group's run would sweep.
async function answerDialog(page: Page, pane: Locator, appSessionId: string, n: number, control: string, key: 'Enter' | 'Escape'): Promise<void> {
  const requested = () => resolved(page, appSessionId, 'dialog.requested');
  await expect.poll(async () => (await requested()).length, { message: `${appSessionId}: dialog request ${n} on the event stream` }).toBeGreaterThanOrEqual(n);
  const { requestId } = (await requested())[n - 1];
  let itemId: string | undefined;
  await expect
    .poll(async () => (itemId = value(await invoke(page, 'attention.list', undefined)).find((i) => i.request.requestId === requestId)?.id), {
      message: `${appSessionId}: main's attention item for request ${requestId}`,
    })
    .toBeDefined();
  const cardSelector = `[data-request-card="${await addressed(page, itemId!)}"]`; // P5 O6 M2: the page renders the item's address
  const frame = pane.locator('[data-docked-frame]').filter({ has: page.locator(cardSelector) }); // `has` is relative to the frame
  const button = frame.locator(cardSelector).getByRole('button', { name: control, exact: true });
  const answered = async () => (await resolved(page, appSessionId, 'dialog.resolved')).some((e) => e.requestId === requestId);
  await expect(button, `${appSessionId}: request ${n}'s card docked with ${control}`).toBeEnabled();
  await expect(async () => {
    if (await answered()) return;
    if (await button.isEnabled({ timeout: 500 }).catch(() => false)) {
      await frame.focus({ timeout: 1_000 });
      await page.keyboard.press(key);
    }
    expect(await answered(), `${appSessionId}: request ${n} answered by ${key}`).toBe(true);
  }).toPass({ timeout: 15_000 });
}

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
  const context = async () => {
    const dialogs = async (id: string) => (await eventsOf(page, id)).filter((e) => e.kind.startsWith('dialog.')).map((e) => JSON.stringify(e));
    const items = value(await invoke(page, 'attention.list', undefined)).filter((i) => i.appSessionId.startsWith('c7-'));
    return { refusal: await dialogs('c7-refusal'), auto: await dialogs('c7-auto'), attention: items.map((i) => [i.id, i.appSessionId, i.kind, i.state, i.request.requestId]) };
  };

  try {
    const refusal = page.getByRole('region', { name: 'pane 0' });
    await answerDialog(page, refusal, 'c7-refusal', 1, 'Retry with claude-sonnet-5', 'Enter');
    await expect.poll(() => results('c7-refusal'), { message: 'c7-refusal: Enter retries' }).toEqual([['completed', 'retry_fallback']]);
    await answerDialog(page, refusal, 'c7-refusal', 2, 'Cancel', 'Escape');
    await expect
      .poll(() => results('c7-refusal'), { message: 'c7-refusal: Escape cancels the second request' })
      .toEqual([
        ['completed', 'retry_fallback'],
        ['completed', 'cancelled'],
      ]);

    const auto = page.getByRole('region', { name: 'pane 1' });
    await answerDialog(page, auto, 'c7-auto', 1, 'Continue', 'Enter');
    await expect.poll(() => results('c7-auto'), { message: 'c7-auto: Enter continues' }).toEqual([['completed', 'continue']]);
    await answerDialog(page, auto, 'c7-auto', 2, 'Stop', 'Escape');
    await expect
      .poll(() => results('c7-auto'), { message: 'c7-auto: Escape stops the second request' })
      .toEqual([
        ['completed', 'continue'],
        ['completed', 'interrupt'],
      ]);
    expect(cards.consoleErrors(), 'no console error in the card page').toEqual([]);
  } catch (error) {
    console.log(`[L114 context] ${JSON.stringify(await context().catch((e: unknown) => String(e)))}`);
    throw error;
  }
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

// The real shell on C5's stub scenario: the Overview (⌘0) shows the card, whose article holds focus, and ⌘Enter answers
// the card's request there (the stub delivers it, and the card's request and the dock badge's count go).
test('the Overview card answers with ⌘Enter on its article', async () => {
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
    const allow = card.getByRole('button', { name: 'Allow once', exact: true });
    await expect(allow).toBeVisible(); // C7's card, not C5's preview
    const badge = () => app.evaluate(({ app }) => app.dock?.getBadge());
    expect(await badge()).toBe('3');
    await answerByKey(page, { focus: card, control: allow, key: ALLOW_ONCE_KEY, answered: async () => (await card.locator('[data-request-card]').count()) === 0, what: fix });
    await expect(card.locator('[data-request-card]')).toHaveCount(0);
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
    // I2: a plain click replaces the focused pane's session, ⌘-click opens a tab of its own
    const openRow = async (id: string, opts: { newTab?: boolean } = {}) => (await sidebarRow(page, { appSessionId: id })).click(opts.newTab ? { modifiers: ['Meta'] } : {});
    const main = page.locator('[data-region="main"]');
    const left = main.locator('[data-pane="0"]');
    const right = main.locator('[data-pane="1"]');
    const message = (paneLocator: typeof left) => paneLocator.getByRole('textbox', { name: 'Message' });
    await openRow(permissionId);
    await expect(message(left)).toBeVisible();
    await openRow(countingId, { newTab: true });
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('pane.split')?.click());
    await expect(right.locator(`[data-composer="${await addressed(page, countingId)}"]`)).toBeVisible();
    await openRow(permissionId);
    await expect(left.locator(`[data-composer="${await addressed(page, permissionId)}"]`)).toBeVisible();

    // the right pane's session is busy with a slow turn
    await message(right).click();
    await page.keyboard.type('Count to 30 slowly. For each number use a separate Bash call sleep 1; echo NUMBER. Start now.');
    await page.keyboard.press('Enter');
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: countingId })).turn).not.toBeNull();

    // the left one sends the fixture's prompt from its composer, and the editor gives way to the permission card
    await watchPrompts(page);
    await message(left).click();
    await page.keyboard.type(firstPrompt(PERMISSION));
    await page.keyboard.press('Enter');
    const frame = left.getByRole('group', { name: 'Approval needed' });
    await expect(frame).toBeVisible();
    await expect(frame.getByTestId('request-input')).toHaveText('git log --oneline');
    // decision_reason_type rule: two answer buttons
    const allow = frame.getByRole('button', { name: 'Allow once', exact: true });
    await expect(frame.getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
    await expect(allow).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Allow for this session' })).toHaveCount(0);
    await expect(frame.getByRole('button', { name: /^Always allow/ })).toHaveCount(0);
    await expect(message(left)).toBeHidden();
    await expect(frame).toBeFocused(); // the pane held focus

    // Enter, ⌘Enter and ⌘. in the other pane's editor are that pane's: the card is not answered, the counting turn stops
    // (pressed past the prompt's first 400 ms, so a ⌘Enter that reached the card would answer it)
    await pastGrace(page, frame.locator('[data-request-card]'));
    await message(right).click();
    await page.keyboard.press('Enter');
    await page.keyboard.press(ALLOW_ONCE_KEY);
    await page.keyboard.type('typing when I stop');
    await page.keyboard.press('Meta+.');
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: countingId })).turn).toBeNull();
    expect(await resolved(page, permissionId, 'permission.resolved')).toEqual([]);
    expect(value(await invoke(page, 'session.status', { appSessionId: permissionId })).process, 'no interrupt reached the permission session').toBe('ready');

    // ⌘Enter with focus in the card answers it; the composer returns with focus in the editor
    await answerByKey(page, { focus: frame, control: allow, key: ALLOW_ONCE_KEY, answered: async () => (await resolved(page, permissionId, 'permission.resolved')).length > 0, what: 'the gate permission session' });
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

// ---- UX wave U1a: the scenes of M7 ---------------------------------------------------------------------------------

// A plan the replay raises behind the handshake prelude, from a session the prelude starts in Auto: a status frame moves
// it into Plan, so the engine host knows the mode before the plan (`prePlanMode`). The plan's answer is matched by its
// behaviour (the replay's rule), whatever mode it names.
function planJournal(): string {
  const handshake = readFileSync(join(REPO_ROOT, 'test/fixtures/engine/replay-handshake.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { seq: number });
  let seq = handshake.at(-1)!.seq;
  const at = '2026-11-13T12:00:00.000Z';
  const requestId = 'req-plan-next-mode-1';
  const rows: unknown[] = [
    ...handshake,
    { seq: ++seq, direction: 'in', at, frame: { type: 'system', subtype: 'status', status: null, permissionMode: 'plan', uuid: randomUUID() } },
    { seq: ++seq, direction: 'in', at, frame: { type: 'control_request', request_id: requestId, request: { subtype: 'can_use_tool', tool_name: 'ExitPlanMode', display_name: 'ExitPlanMode', input: { plan: '1. Add the release note.\n2. Bump the version.' }, tool_use_id: 'toolu_plan_next_mode_1' } } },
    { seq: seq + 1, direction: 'out', at, frame: { type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { behavior: 'allow' } } } },
  ];
  const path = join(scratch, `plan-next-mode-${Date.now()}.jsonl`);
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return path;
}

// U1a §F (A12): the plan's primary button names the mode the session goes back to (the one before Plan), and its menu
// the other modes an approved plan may name, each sending its own.
test('a replayed plan: Implement names the mode before Plan, and its menu implements in another mode', async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  await launchReady(page, 'c7-plan', planJournal());
  await show(page, [{ appSessionId: 'c7-plan', placement: 'docked' }, null]);
  const frame = page.getByRole('group', { name: 'Plan review' });
  await expect(frame.getByRole('button', { name: 'Implement · Auto', exact: true }), 'the mode before Plan, under this build’s engine host').toBeVisible();
  await frame.getByRole('button', { name: 'More implement options' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Implement · Manual', 'Implement · Accept edits']); // PLAN_NEXT_MODES, never Plan or the button's own
  await page.getByRole('menuitem', { name: 'Implement · Accept edits' }).click();
  await expect.poll(async () => (await resolved(page, 'c7-plan', 'plan.resolved')).map((e) => e.outcome)).toEqual(['implement']);
  // The replay matches an answer by its request and behaviour alone, so the mode is read where the host wrote it: the
  // session's journal holds the allow as sent, with the terminal's own setMode update naming the mode picked
  const { journalPath } = value(await invoke(page, 'session.status', { appSessionId: 'c7-plan' }));
  const sent = () =>
    readFileSync(journalPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { direction: string; frame: { type: string; response?: { request_id?: string; response?: Record<string, unknown> } } })
      .filter((row) => row.direction === 'out' && row.frame.type === 'control_response' && row.frame.response?.request_id === 'req-plan-next-mode-1')
      .map((row) => row.frame.response!.response);
  await expect
    .poll(sent, { message: 'the plan answer as written' })
    .toEqual([expect.objectContaining({ behavior: 'allow', updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] })]);
  expect(cards.consoleErrors()).toEqual([]);
});

// U1a §E (A10): a double-click on a single-choice option picks it and goes on, as Next does.
test('a double-click on a single-choice option of the stepper picks it and goes to the next question', async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  const journal = questionWithoutPreviews();
  await launchReady(page, 'c7-double', journal);
  await show(page, [{ appSessionId: 'c7-double', placement: 'docked' }, null]);
  await sendFirstPrompt(page, 'c7-double', journal);
  const frame = page.getByRole('group', { name: 'Question' });
  await expect(frame).toContainText('1 of 2');
  await frame.getByRole('radio', { name: 'Blue' }).dblclick();
  await expect(frame).toContainText('2 of 2');
  expect(await resolved(page, 'c7-double', 'question.answered'), 'nothing leaves before the last question').toEqual([]);
  expect(cards.consoleErrors()).toEqual([]);
});

// The real shell over C3's replay with `titles` sessions in one scratch repository, each discovered as a record from a
// scratch transcript under the launch's own CLAUDE_CONFIG_DIR (the gate's way, above), so the files service knows the
// session's folder and the sidebar, Needs you and the dock badge read it as any session's.
async function discoveredShell(titles: string[], files: Record<string, string> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-u1a-requests-')));
  const repo = join(root, 'repo');
  const config = join(root, 'claude-config');
  mkdirSync(join(repo, 'src'), { recursive: true });
  for (const [path, text] of Object.entries(files)) writeFileSync(join(repo, path), text);
  const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  const engineIds = titles.map((title) => {
    const sessionId = randomUUID();
    const row = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: title }, uuid: randomUUID(), timestamp: '2026-11-13T10:00:00.000Z', cwd: repo, sessionId, version: '2.1.283' };
    writeFileSync(join(project, `${sessionId}.jsonl`), `${JSON.stringify(row)}\n`);
    return sessionId;
  });
  const shell = await launchMaws({ env: { MAWS_HARNESS: '0', MAWS_ENGINE_REPLAY: '1', CLAUDE_CONFIG_DIR: config } });
  const { page } = shell;
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
  const left = page.locator('[data-region="main"] [data-pane="0"]');
  const open = async (id: string) => {
    await (await sidebarRow(page, { appSessionId: id })).click();
    await expect(left.locator(`[data-composer="${await addressed(page, id)}"]`)).toBeVisible();
  };
  const dispose = async () => {
    await shell.cleanup();
    rmSync(root, { recursive: true, force: true });
  };
  return { shell, repo, ids, left, open, dispose };
}

// The permission round trip cut before the command's result: the replay holds there as an engine whose command runs on.
function resultNeverComes(): string {
  const rows = readFileSync(join(REPO_ROOT, PERMISSION), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { direction: string; frame: { type: string } });
  const answer = rows.findIndex((r) => r.direction === 'out' && r.frame.type === 'control_response');
  const result = rows.findIndex((r, i) => i > answer && r.direction === 'in' && r.frame.type === 'user');
  expect(answer, 'the fixture records the permission’s answer').toBeGreaterThan(0);
  expect(result, 'and the command’s result after it').toBeGreaterThan(answer);
  const path = join(scratch, `permission-result-never-comes-${Date.now()}.jsonl`);
  writeFileSync(path, rows.slice(0, result).map((row) => JSON.stringify(row)).join('\n') + '\n');
  return path;
}

// U1a A1: a request stops waiting at its answer. Allowed once, a command whose result never comes leaves nothing to
// answer anywhere, while the session works on.
test('an allowed command whose result never comes: no card, no "Answered", the composer and Stop back, the session Working, out of Needs you and the badge', async () => {
  const scene = await discoveredShell(['a command that runs on']);
  try {
    const { shell, left, open, ids } = scene;
    const { app, page } = shell;
    const [id] = ids as [string];
    const journal = resultNeverComes();
    await launchReady(page, id, journal, { cwd: scene.repo });
    await open(id);
    const message = left.getByRole('textbox', { name: 'Message' });
    await message.click();
    await page.keyboard.type(firstPrompt(PERMISSION));
    await page.keyboard.press('Enter');
    const frame = left.getByRole('group', { name: 'Approval needed' });
    await expect(frame).toBeVisible();
    const badge = () => app.evaluate(({ app }) => app.dock?.getBadge() ?? '');
    await expect.poll(badge, { message: 'the dock badge counts the waiting request' }).not.toBe('');
    const before = Number(await badge());
    await expect(sidebarOf(page).getByRole('list', { name: 'Needs you' }).locator(`[data-needs-you="${await addressed(page, id)}"]`)).toHaveCount(1);

    await frame.getByRole('button', { name: 'Allow once', exact: true }).click();
    await expect.poll(async () => (await resolved(page, id, 'permission.resolved')).map((e) => e.behavior)).toEqual(['allow']);
    await expect(left.locator('[data-request-card]'), 'no card from the click').toHaveCount(0);
    await expect(frame).toHaveCount(0);
    await expect(left.getByText(/^Answered/), 'no "Answered" line in the pane').toHaveCount(0);
    await expect(message, 'the composer is back').toBeVisible();
    await expect(left.locator('[data-composer]').getByRole('button', { name: 'Stop', exact: true }), 'and Stop, the turn running on').toBeVisible();
    expect(value(await invoke(page, 'session.status', { appSessionId: id as never })).turn, 'the command’s result never came').not.toBeNull();
    await expect((await sidebarRow(page, { appSessionId: id })).getByRole('img', { name: 'Working' }), 'the row reads Working').toBeVisible();
    await expect(sidebarOf(page).getByRole('list', { name: 'Needs you' }).locator(`[data-needs-you="${await addressed(page, id)}"]`), 'Needs you does not list it').toHaveCount(0);
    await expect.poll(badge, { message: 'the badge is one lower' }).toBe(before - 1 === 0 ? '' : String(before - 1));
    expect(shell.consoleErrors()).toEqual([]);
  } finally {
    await scene.dispose();
  }
});

// A synthetic file prompt behind the handshake prelude (the edit fixture's frame, its input replaced); the replay holds
// at its answer, which no scene here gives.
function filePromptJournal(name: string, tool: 'Edit' | 'Write', input: Record<string, unknown>): string {
  const handshake = readFileSync(join(REPO_ROOT, 'test/fixtures/engine/replay-handshake.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { seq: number });
  const { frame } = JSON.parse(readFileSync(join(REPO_ROOT, 'test/fixtures/requests/edit-permission.json'), 'utf8')) as { frame: { request_id: string; request: Record<string, unknown> } };
  Object.assign(frame.request, { tool_name: tool, display_name: tool, input, tool_use_id: `toolu_${name}` });
  const path = join(scratch, `${name}-${Date.now()}.jsonl`);
  writeFileSync(path, [...handshake, { seq: handshake.at(-1)!.seq + 1, direction: 'in', at: '2026-11-13T12:00:00.000Z', frame: { ...frame, request_id: `req-${name}` } }].map((row) => JSON.stringify(row)).join('\n') + '\n');
  return path;
}

// The notes file the prompts below change (invented content), forty numbered lines.
const NOTES = Array.from({ length: 40 }, (_, i) => `note ${i + 1}: the release checklist entry`);
const notesText = NOTES.join('\n') + '\n';

// U1a §I (A11): a file prompt says Create or Edit as the file read from the session's folder says, shows the path
// relative to the working folder and the change as the transcript draws an edit; a change past twelve lines is clipped
// to twelve, and "Show all" lifts the card's bound and the diff's own, within 60vh.
test('a file change as a diff: Edit with numbered lines, Create for a missing file, Show all past twelve lines', async () => {
  test.setTimeout(150_000);
  const scene = await discoveredShell(['an edit', 'a new file', 'a long change', 'twelve lines'], { 'src/notes.ts': notesText });
  try {
    const { shell, left, open, ids, repo } = scene;
    const { page } = shell;
    const [edit, create, long, twelve] = ids as [string, string, string, string];
    const notes = join(repo, 'src/notes.ts');
    const prompt = async (id: string, journal: string) => {
      await open(id);
      await launchReady(page, id, journal, { cwd: repo });
      const frame = left.getByRole('group', { name: 'Approval needed' });
      await expect(frame).toBeVisible({ timeout: 20_000 });
      return frame;
    };
    const lines = (region: Locator, kind?: 'add' | 'del') => region.locator(kind === undefined ? '.transcript-diff-line' : `.transcript-diff-line[data-diff="${kind}"]`);

    // an edit of a file that exists: "Edit <name>", the path relative to the working folder, numbered lines with three of context
    let frame = await prompt(edit, filePromptJournal('u1a-edit', 'Edit', { file_path: notes, old_string: NOTES[19], new_string: 'note 20: the checklist entry, reworded', replace_all: false }));
    let region = frame.locator('[data-proposed-diff]');
    await expect(region, 'the diff drawn against the file as read').toBeVisible();
    await expect(frame.getByRole('heading', { name: 'Edit notes.ts' })).toBeVisible();
    await expect(frame.getByTestId('request-input')).toHaveText('src/notes.ts');
    await expect(lines(region)).toHaveCount(8); // three of context, the line removed, the line added, three of context
    await expect(lines(region, 'del')).toHaveText([/note 20: the release checklist entry/]);
    await expect(lines(region, 'add')).toHaveText([/note 20: the checklist entry, reworded/]);
    expect(await lines(region).first().locator('[data-line-number]').allTextContents(), 'numbered against the file').toEqual(['17']);
    await expect(frame.getByRole('button', { name: 'Show all' })).toHaveCount(0);

    // a write of a file that does not exist: "Create <name>", every line added
    frame = await prompt(create, filePromptJournal('u1a-create', 'Write', { file_path: join(repo, 'src/fresh.ts'), content: 'export const fresh = true;\nexport const count = 2;\n' }));
    region = frame.locator('[data-proposed-diff]');
    await expect(region).toBeVisible();
    await expect(frame.getByRole('heading', { name: 'Create fresh.ts' })).toBeVisible();
    await expect(lines(region, 'add')).toHaveCount(2);
    await expect(lines(region, 'del')).toHaveCount(0);

    // exactly twelve lines (three of context, three removed, three added, three of context): all shown, no "Show all"
    frame = await prompt(twelve, filePromptJournal('u1a-twelve', 'Edit', { file_path: notes, old_string: NOTES.slice(9, 12).join('\n'), new_string: ['note 10: first', 'note 11: second', 'note 12: third'].join('\n'), replace_all: false }));
    region = frame.locator('[data-proposed-diff]');
    await expect(lines(region)).toHaveCount(12);
    await expect(frame.getByRole('button', { name: 'Show all' })).toHaveCount(0);
    expect(await region.evaluate((e) => e.scrollHeight <= e.clientHeight), 'twelve lines fit the collapsed bound').toBe(true);
    expect(await region.locator('.transcript-diff').evaluate((e) => e.scrollHeight <= e.clientHeight + 1), 'and the diff inside it does not scroll').toBe(true);

    // a longer change: collapsed to twelve lines, the region alone holding the bound; Show all lifts it within 60vh
    const added = Array.from({ length: 20 }, (_, i) => `note 30: the rewritten entry, part ${i + 1}`);
    frame = await prompt(long, filePromptJournal('u1a-long', 'Edit', { file_path: notes, old_string: NOTES.slice(29, 33).join('\n'), new_string: added.join('\n'), replace_all: false }));
    region = frame.locator('[data-proposed-diff]');
    const inner = region.locator('.transcript-diff');
    await expect(region).toHaveAttribute('data-proposed-diff', 'collapsed');
    await expect(lines(region)).toHaveCount(30);
    const style = (target: Locator) => target.evaluate((e) => {
      const s = getComputedStyle(e);
      return { maxHeight: s.maxHeight, overflow: s.overflow, overflowY: s.overflowY, height: e.getBoundingClientRect().height, scrolls: e.scrollHeight > e.clientHeight };
    });
    expect(await style(inner), 'collapsed, the diff inside lifts its own 240 px').toMatchObject({ maxHeight: 'none', overflowY: 'visible' });
    expect(await style(region), 'and the region clips').toMatchObject({ overflowY: 'hidden', scrolls: true });
    const shown = await region.evaluate((e) => {
      const bottom = e.getBoundingClientRect().top + e.clientHeight + 1;
      return Array.from(e.querySelectorAll('.transcript-diff-line')).filter((line) => line.getBoundingClientRect().bottom <= bottom).length;
    });
    expect(shown, 'the collapsed region holds twelve lines').toBe(12);
    await frame.getByRole('button', { name: 'Show all' }).click();
    await expect(region).toHaveAttribute('data-proposed-diff', 'whole');
    const whole = await style(region);
    const vh60 = await page.evaluate(() => 0.6 * window.innerHeight);
    expect(whole.overflow, 'expanded, the region scrolls').toBe('auto');
    expect(Math.abs(parseFloat(whole.maxHeight) - vh60), 'under 60vh').toBeLessThanOrEqual(1);
    expect(whole.height).toBeLessThanOrEqual(vh60 + 1);
    const wholeInner = await style(inner);
    expect(wholeInner, 'the diff inside is drawn whole, and does not scroll on its own').toMatchObject({ maxHeight: 'none', overflowY: 'visible', scrolls: false });
    expect(wholeInner.height, 'taller than the transcript’s 240 px').toBeGreaterThan(240);
    await expect(region.locator('[data-omitted]')).toHaveCount(0);

    // the transcript's own diff keeps its bound: the card's utilities are scoped to its region (M4's fix). The scene's
    // transcripts hold no edit row, so the transcript's class is read on an element of the pane outside the card.
    const transcriptDiff = await left.evaluate((pane) => {
      const probe = document.createElement('div');
      probe.className = 'transcript-diff';
      pane.append(probe);
      const s = getComputedStyle(probe);
      const read = { maxHeight: s.maxHeight, overflowY: s.overflowY };
      probe.remove();
      return read;
    });
    expect(transcriptDiff).toEqual({ maxHeight: '240px', overflowY: 'auto' });
    expect(shell.consoleErrors()).toEqual([]);
  } finally {
    await scene.dispose();
  }
});

// U1a l4-approvals-02: a one-line command with no description is a compact card: its own box is at most 200 px tall at
// the docked width.
test('a one-line command with no description: the card is at most 200 px tall', async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  const bare = (request: Record<string, unknown>) => {
    unflag(request);
    delete request.description;
    Object.assign(request, { tool_name: 'Bash', display_name: 'Bash', input: { command: 'make lint' } });
  };
  await launchReady(page, 'c7-compact', syntheticJournal('flagged-read', [{ patch: bare, response: { behavior: 'deny' } }]));
  await show(page, [{ appSessionId: 'c7-compact', placement: 'docked' }, null]);
  const card = page.getByRole('region', { name: 'pane 0' }).locator('[data-request-card]');
  await expect(card.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible();
  const height = (await card.boundingBox())!.height;
  expect(height, `the card's box is ${height} px tall`).toBeLessThanOrEqual(200);
  expect(cards.consoleErrors()).toEqual([]);
});
