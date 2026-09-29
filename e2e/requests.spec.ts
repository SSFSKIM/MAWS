// C7's request card end to end (C7 execution document, M2 and Acceptance item 2, the card-page half). The harness's
// `#composer` page mounts the X4 card over the app's real stores and C5's real key dispatcher, in front of C3's replay
// transport: every answer the card gives is a frame the engine host writes, and the replay ends on any write the
// fixture did not record, so a matching `*.resolved` event is the journal's own witness. Probe fixtures replay as
// recorded; the SPEC-derived synthetic requests (test/fixtures/requests) replay behind the handshake prelude
// (test/fixtures/engine/replay-handshake.jsonl), each followed by the response the card must write. One case runs the
// real shell on C5's stub scenario: the Overview card reached from the Needs-you row answers with Enter on its article.
// The real composer's case is M4's gate (skipped until MAWS_C7_M4). The card page needs a harness build: `pnpm
// e2e:requests` builds one and runs this file; under a plain `pnpm build && pnpm e2e` the card-page cases skip and the
// shell case runs.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import type { CardsHarnessApi, HarnessPane } from '../src/renderer/src/harness/composer/api';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';

const HARNESS_BUILT = existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));

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

function invoke<N extends CommandName>(page: Page, name: N, input: CommandInput<N>): Promise<CommandResult<N>> {
  return page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const) as Promise<CommandResult<N>>;
}
function value<N extends CommandName>(result: CommandResult<N>) {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function launchReady(page: Page, appSessionId: string, replay: string): Promise<void> {
  const spec = {
    appSessionId, cwd: '/tmp/maws-e2e-replay', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway' as const, subagentModel: null,
    resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay,
  };
  expect(value(await invoke(page, 'session.launch', { spec }))).toMatchObject({ status: 'launching' });
  await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId })).process).toBe('ready');
}

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

test('a question form submits every answer as the fixture recorded', async ({ cards }) => {
  const { page } = cards;
  await openCards(page);
  await launchReady(page, 'c7-question', QUESTION);
  await show(page, [{ appSessionId: 'c7-question', placement: 'docked' }, null]);
  await sendFirstPrompt(page, 'c7-question', QUESTION);
  const frame = page.getByRole('group', { name: 'Question' });
  await frame.getByRole('radio', { name: 'Red' }).click();
  // The option's preview renders inside the sandboxed srcdoc frame under the app's CSP (no `<pre>` fallback needed).
  await expect(page.frameLocator('iframe[title="Preview of Red"]').locator('body')).toContainText('This is a red preview');
  await frame.getByRole('checkbox', { name: 'Apple' }).click();
  await frame.getByRole('checkbox', { name: 'Pear' }).click();
  await frame.getByRole('button', { name: 'Submit' }).click();
  await expect.poll(async () => (await resolved(page, 'c7-question', 'question.answered')).map((e) => e.answers)).toEqual([
    { 'Which color do you prefer?': 'Red', 'Which fruits do you like?': 'Apple, Pear' }, // seq 138
  ]);
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
  const frame = page.getByRole('group', { name: 'Approval needed' });
  await expect(frame.getByText(/Read needs its own approval surface, which MAWS does not have/)).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Allow' })).toHaveCount(0);
  await expect(frame.getByRole('radiogroup')).toHaveCount(0);
  const hover = page.getByRole('dialog', { name: 'hover c7-flagged' });
  expect(await hover.getByRole('button').allTextContents()).toEqual(['Open session']);

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

// The real shell on C5's stub scenario: the sidebar's Needs-you row deep-links to the Overview card, whose article then
// holds focus, and Enter answers the card's request there (the stub delivers it and the row leaves Needs you).
test('the Overview card reached from the Needs-you row answers with Enter on its article', async () => {
  const shell = await launchMaws({ env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/nine-sessions.json', MAWS_SCENARIO_CLOCK: 'manual' } });
  try {
    const { page } = shell;
    const fix = 'Fix sidebar drag';
    const row = page.locator(`[aria-label="Needs you"] > li[data-title="${fix}"] > button`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    const card = page.locator('[data-region="main"]').getByRole('article', { name: fix });
    await expect(card.getByRole('radio', { name: 'Allow once' })).toBeVisible(); // C7's card, not C5's preview
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(card).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator(`[aria-label="Needs you"] > li[data-title="${fix}"]`)).toHaveCount(0);
    expect(shell.consoleErrors()).toEqual([]);
  } finally {
    await shell.cleanup();
  }
});

test('the real composer gives way to the card and returns with focus in the editor', async () => {
  test.skip(!process.env.MAWS_C7_M4, 'M4 gate: the docked swap in the real composer');
});
