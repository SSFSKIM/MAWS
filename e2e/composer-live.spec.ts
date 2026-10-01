// C7's live acceptance (C7 execution document, M6 and Acceptance item 3), through Playwright against the product build
// with the pinned engine behind ClaudeUsage's relay. Every session lives in a scratch CLAUDE_CONFIG_DIR the run
// creates (support/c7-live.ts), and the app runs over that same home, so C4 discovers the sessions and the terminal's
// history recall reads the scratch home's history.jsonl; never the owner's ~/.claude. Each case resumes a record through
// `session.launch` with the launch the Diagnostics launcher builds (`resumeSpec`, spread from `launchDefaults`), on
// Sonnet with `maxBudgetUsd: 0.5`, then drives the real composer; the journal at `status.journalPath` is the witness of
// what reached the engine. What the engine answered is written to `<scratch>/observations.json` and each case's
// journals are copied under `<scratch>/journals/` before the app's profile goes. Run on purpose only; it spends money:
//   pnpm build && MAWS_C7_LIVE=1 pnpm exec playwright test e2e/composer-live.spec.ts
// (MAWS_C7_LIVE_SCRATCH=<an earlier run's scratch root> reuses its home and sessions.)
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SessionRecord } from '@shared/graph/session';
import type { JournalRow } from '@shared/wire/journal';
import { LiveLedger } from '../test/live/support/live';
import { framesOf, journal, liveScratch, liveSkipReason, mainResults, printSession, recordOf, resumeLive, statusOf, terminalSession, userWrites, type LiveScratch } from './support/c7-live';
import { invoke, value } from './support/c7-replay';
import { launchMaws, type MawsLaunch } from './support/launch';

const skip = liveSkipReason();
test.skip(skip !== null, skip ?? '');
test.describe.configure({ timeout: 900_000 });

const CLAUDE_USAGE_DIR = join(process.env.HOME ?? '', 'Library', 'Application Support', 'ClaudeUsage'); // read only
// A slow turn (pass3/steer-next's prompt, shorter): tool boundaries every few seconds for a steer to fold in at.
const SLOW = 'Count to 5 with separate Bash sleep 3 calls: for each number n from 1 to 5, make exactly one Bash call `sleep 3 && echo n`, one call at a time, never in parallel. Then reply COUNTED.';
const ASK_RULE = { permissions: { ask: ['Bash(git log:*)'] } };

let scratch: LiveScratch;
const ledger = new LiveLedger(10);
const observed: Record<string, unknown> = {};
function observe(key: string, v: unknown) {
  observed[key] = v;
  const file = join(scratch.root, 'observations.json');
  const prior = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
  writeFileSync(file, JSON.stringify({ ...prior, [key]: v }, null, 2));
}

test.beforeAll(async () => {
  test.setTimeout(600_000);
  scratch = liveScratch();
  // The terminal session that "created the scratch repository": its prompt is in the scratch home's history.jsonl.
  const terminal = await terminalSession(scratch, 'terminal', 'repo-a', 'Reply with exactly the words SCRATCH A READY and nothing else.', 'SCRATCH A READY');
  observe('scratch', { ...scratch, terminal, history: readFileSync(join(scratch.config, 'history.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as unknown) });
});

// ---- the app, panes and journals ---------------------------------------------------------------------------------

interface Live {
  maws: MawsLaunch;
  page: Page;
  launches: { label: string; appSessionId: string; sessionId: string }[];
}

async function withApp(label: string, fn: (live: Live) => Promise<void>): Promise<void> {
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: scratch.config, MAWS_CLAUDE_USAGE_DIR: CLAUDE_USAGE_DIR } });
  const live: Live = { maws, page: maws.page, launches: [] };
  try {
    await fn(live);
    observe(`${label}.consoleErrors`, maws.consoleErrors());
  } finally {
    for (const l of live.launches) {
      const dir = join(maws.userData, 'engine-host', 'journal', l.appSessionId);
      if (!existsSync(dir)) continue;
      const kept = join(scratch.root, 'journals', `${label}-${l.label}`);
      cpSync(dir, kept, { recursive: true });
      for (const file of readdirJsonl(kept)) ledger.add(`${label}/${l.label}`, file, journal(file), l.sessionId);
    }
    observe('cost', { total: Number(ledger.total.toFixed(4)), summary: ledger.summary(), entries: ledger.entries });
    await maws.page.screenshot({ path: join(scratch.root, `${label}.png`) }).catch(() => undefined);
    await maws.cleanup();
  }
}

function readdirJsonl(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f));
}

const main = (page: Page) => page.locator('[data-region="main"]');
const paneAt = (page: Page, index: 0 | 1) => main(page).locator(`[data-pane="${index}"]`);
const messageIn = (pane: Locator) => pane.getByRole('textbox', { name: 'Message', exact: true }); // exact: an open inline edit is "Edited message"
const controlIn = (pane: Locator) => pane.locator('[data-submit-state]');
const editorText = (pane: Locator) => pane.locator('[contenteditable="true"]').innerText();

async function open(page: Page, record: SessionRecord, pane: Locator): Promise<void> {
  await page.locator(`[role="treeitem"][data-menu="session:${record.appId}"]`).click();
  await expect(pane.locator(`[data-composer="${record.appId}"]`)).toBeVisible();
}

// A scratch session resumed live, as the launcher would, and opened in the pane.
async function start(live: Live, label: string, repo: string, pane: 0 | 1, fields: Parameters<typeof resumeLive>[2] = {}) {
  const session = printSession(scratch, label, repo);
  const record = await recordOf(live.page, session.sessionId);
  await open(live.page, record, paneAt(live.page, pane));
  const status = await resumeLive(live.page, record, fields);
  live.launches.push({ label, appSessionId: record.appId, sessionId: session.sessionId });
  return { session, record, id: record.appId, journalPath: status.journalPath, cwd: record.directory };
}

async function type(page: Page, pane: Locator, text: string): Promise<void> {
  await messageIn(pane).click();
  await page.keyboard.insertText(text);
}
async function send(page: Page, pane: Locator, text: string, key = 'Enter'): Promise<void> {
  await type(page, pane, text);
  await page.keyboard.press(key);
}

const turnOf = async (page: Page, id: string) => (await statusOf(page, id)).turn;
const idle = (page: Page, id: string, timeout = 240_000) => expect.poll(() => turnOf(page, id), { timeout, intervals: [500] }).toBeNull();
const busy = (page: Page, id: string, timeout = 60_000) => expect.poll(() => turnOf(page, id), { timeout, intervals: [200] }).not.toBeNull();

// The journal, read fresh: every launch of one app session writes its own file in the same directory.
const rowsOf = (path: string): JournalRow[] => journal(path);
const writesOf = (path: string) => userWrites(rowsOf(path)).map(({ seq, frame }) => ({ seq, uuid: frame.uuid as string, content: frame.message?.content, priority: (frame.priority as string | undefined) ?? null }));
const textOf = (content: unknown) => (typeof content === 'string' ? content : JSON.stringify(content));
const toolUses = (path: string) =>
  framesOf(rowsOf(path), 'in').filter(({ frame }) => frame.type === 'assistant' && Array.isArray(frame.message?.content) && (frame.message.content as { type: string }[]).some((b) => b.type === 'tool_use'));
const resultsOf = (path: string) =>
  mainResults(rowsOf(path)).map(({ seq, frame }) => ({ seq, subtype: frame.subtype, terminalReason: frame.terminal_reason ?? null, result: frame.result ?? null, userMessageUuids: frame.user_message_uuids ?? null, cost: frame.total_cost_usd }));
const controlRequests = (path: string, subtype: string) => framesOf(rowsOf(path), 'in').filter(({ frame }) => frame.type === 'control_request' && frame.request?.subtype === subtype);
const controlResponsesTo = (path: string, ids: string[]) =>
  framesOf(rowsOf(path), 'out').filter(({ frame }) => frame.type === 'control_response' && ids.includes((frame.response as { request_id?: string } | undefined)?.request_id ?? ''));
const toolUsesSeen = async (path: string, n: number) => expect.poll(() => toolUses(path).length, { timeout: 90_000, intervals: [250] }).toBeGreaterThanOrEqual(n);

// ---- 1. auto mode: the five submit states ------------------------------------------------------------------------

test('auto mode: send, queue and steer behave as labelled', async () => {
  await withApp('submit', async (live) => {
    const { page } = live;
    const pane = paneAt(page, 0);
    const { id, journalPath } = await start(live, 'submit', 'repo-a', 0, { permissionMode: 'auto' });

    await test.step('send', async () => {
      await expect(controlIn(pane)).toHaveText('Send');
      await send(page, pane, 'Reply with exactly: LIVE ONE');
      await busy(page, id);
      await idle(page, id);
      await expect(pane.getByText('LIVE ONE', { exact: true }).last()).toBeVisible();
    });

    await test.step('queue: a second message during a slow turn waits and goes at its end', async () => {
      await send(page, pane, SLOW);
      await busy(page, id);
      await toolUsesSeen(journalPath, 1);
      await type(page, pane, 'Reply with exactly: QUEUED ONE');
      await expect(controlIn(pane)).toHaveText('Queue');
      await page.keyboard.press('Enter');
      const list = pane.getByRole('region', { name: 'Queued messages' });
      await expect(list).toContainText('1 queued');
      expect(writesOf(journalPath).some((w) => textOf(w.content).includes('QUEUED ONE')), 'held in the app queue while the turn runs').toBe(false);
      await expect.poll(() => writesOf(journalPath).some((w) => textOf(w.content).includes('QUEUED ONE')), { timeout: 180_000 }).toBe(true);
      await expect(list).toHaveCount(0);
      await idle(page, id);
      const results = resultsOf(journalPath);
      observe('submit.queue', { writes: writesOf(journalPath).slice(-2), results: results.slice(-2) });
    });

    await test.step('steer: ⌥Enter writes priority next and the message folds into the running turn', async () => {
      await send(page, pane, SLOW);
      await busy(page, id);
      const before = toolUses(journalPath).length;
      await toolUsesSeen(journalPath, before + 1);
      await type(page, pane, 'Also, end your final reply with the word STEERED.');
      await page.keyboard.down('Alt');
      await expect(controlIn(pane)).toHaveText('Steer');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Alt');
      await expect.poll(() => writesOf(journalPath).find((w) => textOf(w.content).includes('STEERED'))?.priority ?? null).toBe('next');
      await idle(page, id);
      const writes = writesOf(journalPath);
      const slow = writes.filter((w) => textOf(w.content) === SLOW).at(-1)!;
      const steer = writes.find((w) => textOf(w.content).includes('STEERED'))!;
      const results = resultsOf(journalPath).filter((r) => r.seq > slow.seq);
      observe('submit.steer', { slow, steer, results });
      expect(results.some((r) => Array.isArray(r.userMessageUuids) && r.userMessageUuids.includes(slow.uuid) && r.userMessageUuids.includes(steer.uuid)), 'one result names both prompts').toBe(true);
      await page.screenshot({ path: join(scratch.root, 'submit-steer.png') });
    });
  });
});

test('auto mode: interrupt and send, stop and resume behave as labelled', async () => {
  await withApp('interrupt', async (live) => {
    const { page } = live;
    const pane = paneAt(page, 0);
    const { id, journalPath } = await start(live, 'interrupt', 'repo-a', 0, { permissionMode: 'auto' });

    await test.step('interrupt and send: the caret menu writes priority now, the turn ends aborted_streaming, the message runs as its own turn', async () => {
      await send(page, pane, SLOW);
      await busy(page, id);
      await toolUsesSeen(journalPath, 1);
      await type(page, pane, 'Reply with exactly: INTERRUPTED AND SENT');
      await pane.getByRole('button', { name: 'More ways to send' }).click();
      await page.getByRole('menuitem', { name: /Interrupt and send/ }).click();
      await expect.poll(() => writesOf(journalPath).find((w) => textOf(w.content).includes('INTERRUPTED AND SENT'))?.priority ?? null).toBe('now');
      await expect.poll(() => resultsOf(journalPath).some((r) => typeof r.result === 'string' && r.result.includes('INTERRUPTED AND SENT')), { timeout: 120_000 }).toBe(true);
      await idle(page, id);
      const now = writesOf(journalPath).find((w) => textOf(w.content).includes('INTERRUPTED AND SENT'))!;
      const results = resultsOf(journalPath);
      observe('interrupt.now', { write: now, results });
      expect(results.some((r) => r.terminalReason === 'aborted_streaming'), 'the running turn ended aborted_streaming').toBe(true);
      const own = results.find((r) => typeof r.result === 'string' && r.result.includes('INTERRUPTED AND SENT'))!;
      expect(own.userMessageUuids, 'the message ran as its own turn').toEqual([now.uuid]);
    });

    await test.step('stop: ⌘. ends the turn and pauses the queue; Resume releases the head', async () => {
      await send(page, pane, SLOW);
      await busy(page, id);
      const before = toolUses(journalPath).length;
      await toolUsesSeen(journalPath, before + 1);
      await send(page, pane, 'Reply with exactly: RESUMED ONE');
      const list = pane.getByRole('region', { name: 'Queued messages' });
      await expect(list).toContainText('1 queued');
      await messageIn(pane).click();
      await page.keyboard.press('Meta+.');
      await expect(list.locator('header')).toHaveText(/Queue paused because you interrupted/);
      await idle(page, id);
      await expect(controlIn(pane)).toHaveText('Resume');
      expect(writesOf(journalPath).some((w) => textOf(w.content).includes('RESUMED ONE')), 'nothing released while paused').toBe(false);
      const interrupts = framesOf(rowsOf(journalPath), 'out').filter(({ frame }) => frame.type === 'control_request' && frame.request?.subtype === 'interrupt');
      await list.getByRole('button', { name: 'Resume' }).click();
      await expect.poll(() => writesOf(journalPath).some((w) => textOf(w.content).includes('RESUMED ONE')), { timeout: 60_000 }).toBe(true);
      await idle(page, id);
      await expect(list).toHaveCount(0);
      observe('interrupt.stop', { interrupts, results: resultsOf(journalPath).slice(-2) });
    });
  });
});

// ---- 2. the ask rule in auto mode, in the focused pane only -------------------------------------------------------

test('auto mode with an ask rule: the card replaces the composer, offers Allow once, and Enter answers in the focused pane only', async () => {
  await withApp('ask', async (live) => {
    const { page, maws } = live;
    // As the gate in requests.spec.ts: the ask session's tab first, then the other one split into the right pane, then
    // the ask session's tab again on the left.
    const ask = await start(live, 'ask', 'repo-b', 0, { permissionMode: 'auto', extraSettings: ASK_RULE });
    const other = await start(live, 'ask-other', 'repo-b', 0, { permissionMode: 'auto' });
    await maws.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('pane.split')?.click());
    const left = paneAt(page, 0);
    const right = paneAt(page, 1);
    await expect(right.locator(`[data-composer="${other.id}"]`)).toBeVisible();
    await open(page, ask.record, left);

    await send(page, left, 'Use the Bash tool to run exactly `git log --oneline` and tell me what it printed.');
    const frame = left.getByRole('group', { name: 'Approval needed' });
    await expect(frame).toBeVisible({ timeout: 90_000 });
    await expect(messageIn(left)).toBeHidden();
    await expect(frame).toBeFocused();
    const radios = await frame.getByRole('radio').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    const requests = controlRequests(ask.journalPath, 'can_use_tool');
    observe('ask.request', { radios, requests, input: await frame.getByTestId('request-input').innerText().catch(() => null) });
    expect(radios).toEqual(['Allow once']);

    await messageIn(right).click();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const ids = requests.map((r) => (r.frame as { request_id: string }).request_id);
    expect(controlResponsesTo(ask.journalPath, ids), 'the other pane’s Enter answered nothing').toEqual([]);

    await frame.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => controlResponsesTo(ask.journalPath, ids).length).toBe(1);
    await expect(messageIn(left)).toBeVisible();
    await expect(messageIn(left)).toBeFocused();
    await idle(page, ask.id);
    observe('ask.answer', { response: controlResponsesTo(ask.journalPath, ids), results: resultsOf(ask.journalPath).slice(-1) });
  });
});

// ---- 3. the grant case in default mode ---------------------------------------------------------------------------

test('default mode: Allow for this session grants the exact command and a second identical command prompts nothing', async () => {
  await withApp('grant', async (live) => {
    const { page } = live;
    const pane = paneAt(page, 0);
    const g = await start(live, 'grant', 'repo-g', 0, { permissionMode: 'default' });
    const rules = value(await invoke(page, 'session.listPermissionRules', { appSessionId: g.id as never }));
    const target = `maws-grant-${randomUUID().slice(0, 8)}.txt`;
    const command = `touch ${target}`;
    observe('grant.rules', { rules, target });
    const allow = JSON.stringify(rules).match(/"allow":\[[^\]]*\]/g) ?? [];
    expect(allow.join(''), 'no inherited allow rule matches the touch').not.toMatch(/Bash\(touch|Bash\(\*|"Bash"/);

    await send(page, pane, `Use the Bash tool to run exactly this command and nothing else: ${command}`);
    const frame = pane.getByRole('group', { name: 'Approval needed' });
    await expect(frame).toBeVisible({ timeout: 90_000 });
    const radios = await frame.getByRole('radio').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    await frame.getByRole('radio', { name: 'Allow for this session' }).click();
    await frame.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect.poll(async () => (await statusOf(page, g.id)).grants, { timeout: 30_000 }).toContain(`Bash(${command})`);
    await idle(page, g.id);
    const first = controlRequests(g.journalPath, 'can_use_tool');
    const response = controlResponsesTo(g.journalPath, first.map((r) => (r.frame as { request_id: string }).request_id));

    await send(page, pane, `Run exactly the same Bash command once more: ${command}`);
    await busy(page, g.id);
    await idle(page, g.id);
    const second = controlRequests(g.journalPath, 'can_use_tool');
    observe('grant.answer', { radios, grants: (await statusOf(page, g.id)).grants, response, requestsAfterSecond: second.length, results: resultsOf(g.journalPath).slice(-2), toolUses: toolUses(g.journalPath).length });
    expect(second.length, 'the second identical touch prompted nothing').toBe(first.length);
    expect(existsSync(join(g.cwd, target))).toBe(true);
  });
});

// ---- 4. a two-question form --------------------------------------------------------------------------------------

test('auto mode: a two-question AskUserQuestion form submits both answers and the tool result names them', async () => {
  await withApp('question', async (live) => {
    const { page } = live;
    const pane = paneAt(page, 0);
    const q = await start(live, 'question', 'repo-q', 0, { permissionMode: 'auto' });
    await send(
      page,
      pane,
      'Use the AskUserQuestion tool once, with both questions in the one call: "Which color do you prefer?" (options Red and Blue, single choice) and "Which fruits do you like?" (options Apple, Pear and Plum, multiSelect true). Then reply with my answers.',
    );
    const frame = pane.getByRole('group', { name: 'Question' });
    await expect(frame).toBeVisible({ timeout: 90_000 });
    await frame.getByRole('radio', { name: 'Red' }).click();
    await frame.getByRole('checkbox', { name: 'Apple' }).click();
    await frame.getByRole('checkbox', { name: 'Pear' }).click();
    await frame.getByRole('button', { name: 'Submit' }).click();
    await idle(page, q.id);
    const asked = controlRequests(q.journalPath, 'can_use_tool');
    const answers = controlResponsesTo(q.journalPath, asked.map((r) => (r.frame as { request_id: string }).request_id));
    const toolResults = framesOf(rowsOf(q.journalPath), 'in').filter(({ frame }) => frame.type === 'user' && JSON.stringify(frame.message?.content).includes('tool_result'));
    observe('question', { answers, toolResults: toolResults.map((t) => JSON.stringify(t.frame.message?.content).slice(0, 600)), results: resultsOf(q.journalPath).slice(-1) });
    const named = toolResults.map((t) => JSON.stringify(t.frame.message?.content)).join(' ');
    expect(named).toContain('Red');
    expect(named).toMatch(/Apple, Pear/);
  });
});

// ---- 5. plans ----------------------------------------------------------------------------------------------------

const PLAN = 'Plan adding a file named hello.txt that contains the word hi. Keep the plan to one or two short steps.';

async function toPlanMode(page: Page, pane: Locator) {
  await pane.getByRole('button', { name: /^Permission mode / }).click();
  await page.getByRole('menuitemradio', { name: /^plan/ }).click();
  await expect(pane.getByRole('button', { name: /^Permission mode plan/ })).toBeVisible();
}

test('plan mode from the mode chip: Keep planning returns a second plan, Implement restores the pre-plan mode', async () => {
  await withApp('plan', async (live) => {
    const { page } = live;
    const pane = paneAt(page, 0);
    const p = await start(live, 'plan', 'repo-p', 0, { permissionMode: 'auto' });
    await toPlanMode(page, pane);
    await send(page, pane, PLAN);
    const frame = pane.getByRole('group', { name: 'Plan review' });
    await expect(frame).toBeVisible({ timeout: 120_000 });
    await frame.getByRole('button', { name: 'Keep planning' }).click();
    await frame.getByRole('textbox', { name: 'What should change in the plan' }).fill('Also add a file bye.txt that contains the word bye.');
    await frame.getByRole('button', { name: 'Send feedback' }).click();
    await expect.poll(() => controlRequests(p.journalPath, 'can_use_tool').filter((r) => JSON.stringify(r.frame).includes('ExitPlanMode')).length, { timeout: 180_000 }).toBe(2);
    await expect(pane.getByRole('group', { name: 'Plan review' })).toBeVisible();
    await expect(pane.getByRole('group', { name: 'Plan review' })).toContainText('bye.txt');
    await pane.getByRole('group', { name: 'Plan review' }).getByRole('button', { name: 'Implement', exact: true }).click();
    await idle(page, p.id);
    const afterImplement = { status: (await statusOf(page, p.id)).permissionMode, chip: await pane.getByRole('button', { name: /^Permission mode / }).getAttribute('aria-label') };
    // the implementation runs inside the approving turn; the next prompt's turn carries the next init
    await send(page, pane, 'Reply with exactly: AFTER PLAN');
    await busy(page, p.id);
    await idle(page, p.id);
    const inits = framesOf(rowsOf(p.journalPath), 'in').filter(({ frame }) => frame.type === 'system' && frame.subtype === 'init').map(({ seq, frame }) => ({ seq, permissionMode: frame.permissionMode }));
    const plans = controlRequests(p.journalPath, 'can_use_tool').filter((r) => JSON.stringify(r.frame).includes('ExitPlanMode'));
    const responses = controlResponsesTo(p.journalPath, plans.map((r) => (r.frame as { request_id: string }).request_id));
    const chip = await pane.getByRole('button', { name: /^Permission mode / }).getAttribute('aria-label');
    observe('plan.keep-and-implement', { inits, responses, files: { hello: existsSync(join(p.cwd, 'hello.txt')), bye: existsSync(join(p.cwd, 'bye.txt')) }, afterImplement, status: (await statusOf(page, p.id)).permissionMode, chip });
    expect(afterImplement.status.effective, 'Implement restores the pre-plan mode').toBe('auto');
    expect(inits.at(-1)?.permissionMode, 'the next init carries the pre-plan mode').toBe('auto');
  });
});

test('plan mode: Clear context and implement yields a reset boundary and a turn beginning "Implement this plan:"', async () => {
  await withApp('plan-clear', async (live) => {
    const { page } = live;
    const pane = paneAt(page, 0);
    const p = await start(live, 'plan-clear', 'repo-p2', 0, { permissionMode: 'auto' });
    await toPlanMode(page, pane);
    await send(page, pane, PLAN);
    const frame = pane.getByRole('group', { name: 'Plan review' });
    await expect(frame).toBeVisible({ timeout: 120_000 });
    await frame.getByRole('button', { name: 'Clear context and implement' }).click();
    await frame.getByRole('button', { name: 'Clear and implement' }).click();
    await expect.poll(() => JSON.stringify(rowsOf(p.journalPath)).includes('Implement this plan:'), { timeout: 120_000 }).toBe(true);
    await idle(page, p.id);
    const rows = rowsOf(p.journalPath);
    const seeded = rows.filter((r) => JSON.stringify(r.frame).includes('Implement this plan:')).map((r) => ({ seq: r.seq, direction: r.direction, frame: JSON.stringify(r.frame).slice(0, 300) }));
    const resets = framesOf(rows, 'in').filter(({ frame }) => frame.type === 'conversation_reset' || (frame.type === 'system' && /clear|reset/.test(String(frame.subtype)))).map(({ seq, frame }) => ({ seq, frame }));
    const kinds = await pane.locator('.transcript-row').evaluateAll((els) => els.map((el) => `${el.getAttribute('data-kind')}${el.getAttribute('data-kind') === 'boundary' ? `: ${(el as HTMLElement).innerText}` : ''}`));
    const turnStart = writesOf(p.journalPath).find((w) => textOf(w.content).startsWith('Implement this plan:'));
    observe('plan.clear', { seeded, resets, transcriptRows: kinds, turnStart: turnStart ? { seq: turnStart.seq, uuid: turnStart.uuid } : null, results: resultsOf(p.journalPath) });
    expect(resets.length, 'a reset boundary').toBeGreaterThan(0);
    expect(turnStart, 'a turn beginning "Implement this plan:"').toBeTruthy();
    await page.screenshot({ path: join(scratch.root, 'plan-clear.png') });
  });
});

// ---- 6. modes, memory, paste, history, the palette, the status line, + dir -----------------------------------------

test('bash, memory, paste, history recall, the palette, the status line and + dir against the live engine', async () => {
  await withApp('misc', async (live) => {
    const { page, maws } = live;
    const pane = paneAt(page, 0);
    const m = await start(live, 'misc', 'repo-a', 0, { permissionMode: 'auto' });

    await test.step('usage from ClaudeUsage (the M1 console read) and the context ring (W2: no status line)', async () => {
      await send(page, pane, 'Reply with exactly: STATUS ONE');
      await idle(page, m.id);
      const all = value(await invoke(page, 'settings.usage', { engineSessionIds: [] }));
      const mine = value(await invoke(page, 'settings.usage', { engineSessionIds: [m.session.sessionId as never] }));
      const ring = pane.getByRole('button', { name: /^Context window/ });
      await expect(ring).toHaveAttribute('aria-label', /^Context window \d+% full of /, { timeout: 30_000 }).catch(() => undefined);
      observe('misc.status', {
        line: await ring.getAttribute('aria-label'),
        available: all.available,
        accounts: all.accounts.map((a) => ({ uuid: a.uuid.slice(0, 8), fiveHour: a.windows.fiveHour?.percent ?? null, sevenDay: a.windows.sevenDay?.percent ?? null })),
        drainTarget: all.drainTarget?.slice(0, 8) ?? null,
        pinnedTo: mine.pinsFor[m.session.sessionId]?.slice(0, 8) ?? null,
      });
    });

    await test.step('! runs through the engine and the model sees its output', async () => {
      await send(page, pane, '!printf MAWS_BASH_LIVE');
      await expect.poll(() => framesOf(rowsOf(m.journalPath), 'out').some(({ frame }) => frame.type === 'bash_command')).toBe(true);
      await expect(pane.getByText('MAWS_BASH_LIVE').first()).toBeVisible({ timeout: 30_000 });
      await idle(page, m.id);
      await send(page, pane, 'What did my ! command print? Reply with only the printed text.');
      await expect.poll(() => resultsOf(m.journalPath).at(-1)?.result ?? '', { timeout: 120_000 }).toContain('MAWS_BASH_LIVE');
      await idle(page, m.id);
    });

    await test.step('! while a turn runs', async () => {
      await send(page, pane, SLOW);
      await busy(page, m.id);
      await toolUsesSeen(m.journalPath, toolUses(m.journalPath).length + 1);
      await type(page, pane, '!echo MAWS_MIDTURN');
      const label = await controlIn(pane).innerText();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3_000);
      const bash = framesOf(rowsOf(m.journalPath), 'out').filter(({ frame }) => frame.type === 'bash_command').map(({ seq, frame }) => ({ seq, command: frame.command }));
      const notices = await page.locator('[role="status"], [role="alert"]').allInnerTexts();
      const queue = await pane.getByRole('region', { name: 'Queued messages' }).innerText().catch(() => null);
      await messageIn(pane).click();
      await page.keyboard.press('Meta+.');
      await idle(page, m.id);
      await page.waitForTimeout(2_000);
      const after = framesOf(rowsOf(m.journalPath), 'out').filter(({ frame }) => frame.type === 'bash_command').map(({ seq, frame }) => ({ seq, command: frame.command }));
      const inAfter = rowsOf(m.journalPath).filter((r) => r.direction === 'in' && JSON.stringify(r.frame).includes('MAWS_MIDTURN')).map((r) => ({ seq: r.seq, frame: JSON.stringify(r.frame).slice(0, 400) }));
      observe('misc.bash-midturn', { controlLabel: label, bashWritesAtEnter: bash, notices, queue, bashWritesAfterStop: after, engineEchoes: inAfter, editor: await editorText(pane) });
      const list = pane.getByRole('region', { name: 'Queued messages' });
      if (await list.count()) {
        await list.getByRole('button', { name: 'Resume' }).click().catch(() => undefined);
        await page.waitForTimeout(3_000);
        await idle(page, m.id);
      }
    });

    await test.step('# appends to the project memory file', async () => {
      await type(page, pane, '#MAWS live test note');
      const chip = pane.getByRole('button', { name: /^Memory · / });
      await expect(chip).toBeVisible();
      const initial = await chip.innerText();
      await chip.click();
      const items = page.getByRole('menuitem');
      await expect(items.first()).toBeVisible();
      const menu = await items.allInnerTexts();
      await items.filter({ hasText: /project/i }).filter({ hasNotText: /local/i }).first().click();
      const chosen = await chip.innerText();
      await messageIn(pane).click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      const file = join(m.cwd, 'CLAUDE.md');
      await expect.poll(() => (existsSync(file) ? readFileSync(file, 'utf8') : ''), { timeout: 30_000 }).toContain('- MAWS live test note');
      observe('misc.memory', { initial, menu, chosen, file, content: readFileSync(file, 'utf8') });
    });

    const body = Array.from({ length: 40 }, (_, i) => `live paste line ${i + 1}`).join('\n');
    await test.step('a 40-line paste renders as a chip with its body and recalls with it after a reload', async () => {
      await messageIn(pane).click();
      await page.evaluate((text) => {
        const target = document.querySelector('[data-region="main"] [data-pane="0"] [contenteditable="true"]') as HTMLElement;
        const data = new DataTransfer();
        data.setData('text/plain', text);
        target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      }, body);
      await expect(pane.locator('[contenteditable="true"]').getByText('Pasted text #1 +40 lines')).toBeVisible();
      await page.keyboard.insertText(' How many lines did I paste? Reply with only the number.');
      await page.keyboard.press('Enter');
      await idle(page, m.id);
      const pasted = writesOf(m.journalPath).at(-1)!;
      expect(textOf(pasted.content)).toMatch(/<pasted_content id="[0-9a-f]{4}">\n/);
      const bubble = pane.getByRole('region', { name: 'Your message' }).last();
      await expect(bubble).toContainText('Pasted text #1');
      await page.screenshot({ path: join(scratch.root, 'misc-paste.png') });
      observe('misc.paste', { write: textOf(pasted.content).slice(0, 200), bubble: await bubble.innerText(), reply: resultsOf(m.journalPath).at(-1)?.result });

      await page.reload();
      await expect(messageIn(pane)).toBeVisible({ timeout: 30_000 });
      await messageIn(pane).click();
      await page.keyboard.press('ArrowUp');
      const chipAfter = pane.locator('[contenteditable="true"] [data-pasted]');
      await expect(chipAfter).toHaveAttribute('data-pasted', 'text');
      expect(await chipAfter.getAttribute('title')).toContain('live paste line 1\nlive paste line 2');
    });

    await test.step('ArrowUp recalls this session’s prompts, then the terminal session’s', async () => {
      const recalled: string[] = [await editorText(pane)];
      for (let k = 0; k < 12; k++) {
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(250);
        const text = await editorText(pane);
        if (text === recalled.at(-1)) break;
        recalled.push(text);
      }
      observe('misc.history', recalled);
      const terminal = recalled.findIndex((t) => t.includes('SCRATCH A READY'));
      const own = recalled.findIndex((t) => t.includes('STATUS ONE'));
      expect(own, 'this session’s prompts recall').toBeGreaterThanOrEqual(0);
      expect(terminal, 'then the terminal session’s').toBeGreaterThan(own);
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Backspace');
    });

    await test.step('/compact and /model haiku from the palette', async () => {
      await messageIn(pane).click();
      await page.keyboard.type('/compact');
      const commands = page.getByRole('listbox', { name: 'Commands' });
      // C11 start: /compact and /model open C11's widgets (a registered widget wins over the headless text path), and the
      // palette groups its rows, so the case reads the chosen row and then drives each widget's own flow
      const chosen = commands.locator('[role="option"][aria-selected="true"]');
      await expect(chosen).toContainText('/compact');
      const compactRow = await chosen.innerText();
      await page.keyboard.press('Enter'); // the compact widget opens
      await page.locator('[data-widget="compact"]').getByRole('button', { name: 'Compact now' }).click(); // sends /compact
      // C11 end
      await expect.poll(() => framesOf(rowsOf(m.journalPath), 'in').some(({ frame }) => frame.type === 'system' && frame.subtype === 'compact_boundary'), { timeout: 180_000 }).toBe(true);
      await idle(page, m.id);
      const compact = framesOf(rowsOf(m.journalPath), 'in').filter(({ frame }) => frame.type === 'system' && frame.subtype === 'compact_boundary').map(({ seq, frame }) => ({ seq, meta: frame.compact_metadata }));

      const modelBefore = await pane.getByRole('button', { name: /^Model / }).getAttribute('aria-label');
      await messageIn(pane).click();
      await page.keyboard.type('/model');
      // C11 start: the model widget opens; Haiku is chosen and applied there (set_model), not typed as a prompt
      await expect(chosen).toContainText('/model');
      const modelRow = await chosen.innerText();
      await page.keyboard.press('Enter');
      const modelWidget = page.locator('[data-widget="model"]'); // W3: the selector in the model chip's menu; a pick applies at once
      await modelWidget.getByRole('menuitemradio', { name: /^Haiku/ }).click();
      await page.keyboard.press('Escape');
      // C11 end
      await page.waitForTimeout(5_000);
      await idle(page, m.id);
      // C11 start: the widget sets the model with the set_model control, not a `/model` prompt answered by a synthetic
      // assistant frame, so the observation is that control's request and the engine's answer to it
      const setModelRequest = framesOf(rowsOf(m.journalPath), 'out')
        .filter(({ frame }) => frame.type === 'control_request' && (frame.request as { subtype?: string } | undefined)?.subtype === 'set_model')
        .at(-1);
      const setModelAnswer = framesOf(rowsOf(m.journalPath), 'in').find(
        ({ frame }) => frame.type === 'control_response' && (frame.response as { request_id?: string } | undefined)?.request_id === setModelRequest?.frame.request_id,
      );
      const setModel = { request: setModelRequest ? { seq: setModelRequest.seq, request: setModelRequest.frame.request } : null, answer: setModelAnswer ? { seq: setModelAnswer.seq, response: setModelAnswer.frame.response } : null };
      // C11 end
      const modelAfter = await pane.getByRole('button', { name: /^Model / }).getAttribute('aria-label');
      const statusAfter = (await statusOf(page, m.id)).model;
      // the engine applies the model from its next turn: one more prompt, then its init and the chip
      await send(page, pane, 'Reply with exactly: HAIKU ONE');
      await busy(page, m.id);
      await idle(page, m.id);
      const lastInit = framesOf(rowsOf(m.journalPath), 'in').filter(({ frame }) => frame.type === 'system' && frame.subtype === 'init').at(-1)?.frame.model;
      const modelNextTurn = await pane.getByRole('button', { name: /^Model / }).getAttribute('aria-label');
      observe('misc.palette', { compactRow, compact, modelRow, modelBefore, setModel /* C11: was the synthetic answer */, modelAfter, statusAfter, lastInit, modelNextTurn, statusNextTurn: (await statusOf(page, m.id)).model });
    });

    await test.step('requesting auto after Haiku', async () => {
      const chip = pane.getByRole('button', { name: /^Permission mode / });
      const before = await chip.getAttribute('aria-label');
      await chip.click();
      const autoItem = page.getByRole('menuitemradio', { name: /^auto/ });
      await expect(autoItem).toBeVisible();
      const autoText = await autoItem.innerText();
      const autoDisabled = await autoItem.isDisabled();
      if (!autoDisabled) {
        await autoItem.click();
        await page.waitForTimeout(3_000);
      }
      await page.keyboard.press('Escape');
      const after = await chip.getAttribute('aria-label');
      const line = await pane.getByRole('toolbar', { name: 'Composer tools' }).innerText(); // W2: the mode reads on its chip
      observe('misc.auto-after-haiku', { before, autoText, autoDisabled, after, line, models: value(await invoke(page, 'session.listModels', { appSessionId: m.id as never })) });
    });

    await test.step('+ dir through flag settings', async () => {
      const extra = join(scratch.root, 'extra-dir');
      mkdirSync(extra, { recursive: true });
      await maws.app.evaluate((_electron, dir) => {
        process.env.MAWS_E2E_PICK_PATHS = dir; // C10: main's e2e pick seam answers it; no native panel under MAWS_E2E
      }, extra);
      const before = value(await invoke(page, 'session.listPermissionRules', { appSessionId: m.id as never }));
      await pane.getByRole('button', { name: 'Add a directory' }).click();
      await page.waitForTimeout(3_000);
      const after = value(await invoke(page, 'session.listPermissionRules', { appSessionId: m.id as never }));
      const flag = framesOf(rowsOf(m.journalPath), 'out').filter(({ frame }) => frame.type === 'control_request' && frame.request?.subtype === 'apply_flag_settings').map(({ seq, frame }) => ({ seq, request: frame.request }));
      const notices = await page.locator('[role="status"], [role="alert"]').allInnerTexts();
      observe('misc.add-dir', { extra, before: (before as { state?: { workspaceDirectories?: unknown } }).state?.workspaceDirectories, after: (after as { state?: { workspaceDirectories?: unknown } }).state?.workspaceDirectories, flag, chip: await pane.getByRole('button', { name: 'Add a directory' }).innerText(), notices });
    });
  });
});

// ---- 6b. auto requested on Haiku -----------------------------------------------------------------------------------

test('the mode chip after switching the model to Haiku and requesting auto', async () => {
  await withApp('haiku', async (live) => {
    const { page } = live;
    const pane = paneAt(page, 0);
    const h = await start(live, 'haiku', 'repo-h', 0, { permissionMode: 'default' });
    await send(page, pane, '/model haiku'); // a local command: no model turn
    await idle(page, h.id);
    const chip = pane.getByRole('button', { name: /^Permission mode / });
    await chip.click();
    const autoItem = page.getByRole('menuitemradio', { name: /^auto/ });
    await expect(autoItem).toBeVisible();
    const menu = { text: await autoItem.innerText(), disabled: await autoItem.isDisabled() };
    if (!menu.disabled) await autoItem.click();
    await page.waitForTimeout(3_000);
    await page.keyboard.press('Escape');
    const requests = framesOf(rowsOf(h.journalPath), 'out').filter(({ frame }) => frame.type === 'control_request' && frame.request?.subtype === 'set_permission_mode');
    const answers = framesOf(rowsOf(h.journalPath), 'in').filter(({ frame }) => frame.type === 'control_response' && requests.some((r) => (r.frame as { request_id: string }).request_id === (frame.response as { request_id?: string }).request_id));
    observe('haiku-auto', {
      menu,
      requests: requests.map((r) => r.frame.request),
      answers: answers.map((a) => a.frame.response),
      status: { model: (await statusOf(page, h.id)).model, permissionMode: (await statusOf(page, h.id)).permissionMode },
      chip: await chip.getAttribute('aria-label'),
      chipTitle: await chip.getAttribute('title'),
      line: await pane.getByRole('toolbar', { name: 'Composer tools' }).innerText(), // W2: no status line
      alerts: await page.locator('[role="alert"]').allInnerTexts(),
    });
  });
});

// ---- 7. a Direct session ------------------------------------------------------------------------------------------

test('a session resumed Direct reads its windows from session.getUsage, or shows —', async () => {
  await withApp('direct', async (live) => {
    const { page } = live;
    const pane = paneAt(page, 0);
    const d = await start(live, 'direct', 'repo-d', 0, { permissionMode: 'auto', direct: true });
    const status = await statusOf(page, d.id);
    const usage = await invoke(page, 'session.getUsage', { appSessionId: d.id as never });
    await page.waitForTimeout(3_000);
    const windows = () => page.evaluate((id) => window.maws.invoke('session.getUsage', { appSessionId: id as never }), d.id); // W2: no status line shows them
    const line = await windows();
    await send(page, pane, 'Reply with exactly: DIRECT ONE');
    await expect.poll(() => resultsOf(d.journalPath).length, { timeout: 120_000 }).toBeGreaterThan(0);
    await idle(page, d.id);
    observe('direct', { gateway: status.gateway, usage, line, lineAfter: await windows(), results: resultsOf(d.journalPath) });
  });
});

