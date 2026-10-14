// P2-C (the P2-C document, M6; G4, G5's actions, G6's surfaces) end to end over the replay transport: no engine runs.
// A session leaves a must-read, then a question whose turn goes on running a tool (e2e/support/to-human-replay.ts).
// Leaving its tab, the sidebar row shows the question's glyph and Needs you reads the oldest item's summary; the row
// opens the session at the mark, in the report. Mark read reads the must-read, and Needs you moves on to the question. A
// click on the recommended choice while the tool runs sends the answer through the seam as a `next` steer: the card
// reads Queued with Cancel until the engine starts that prompt (its `command_lifecycle` `started`), then Answered, and
// the composer's draft is untouched.
// P2-C2: a user output style declaring contract 4 (`<message>` the one mark, questions through a tool) gets MAWS's
// supplement once and the full contract never, the launch advertising MAWS_NATIVE_TO_HUMAN and recording the decision;
// a `<message>` draws as the message card, an async `mcp__maws__ask` is answered from its sheet, and the native
// AskUserQuestion, which a headless launch keeps, still arrives as MAWS's question request.
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { CONTRACT_HEADER, NATIVE_TO_HUMAN_ENV, TO_HUMAN_CONTRACT_VERSION, TO_HUMAN_SUPPLEMENT } from '../src/shared/owner/contract';
import { invoke, value } from './support/c7-replay';
import { launchMaws } from './support/launch';
import { sessionJournal } from './support/live-turns';
import { clearToasts, metaEvents } from './support/maws-tools';
import { sidebarRow } from './support/sidebar';
import { SUPPLEMENT, supplementJournal, TO_HUMAN, toHumanJournal, toHumanSessionId } from './support/to-human-replay';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('M6 a question answered from its card: queued while the agent works, answered when the engine starts it; the must-read read; Needs you opens the mark', async () => {
  test.setTimeout(150_000);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-p2c-answer-')));
  const repo = join(root, 'repo');
  const config = join(root, 'claude-config');
  mkdirSync(repo);
  const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  writeFileSync(join(config, '.claude.json'), `${JSON.stringify({ projects: { [repo]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  writeFileSync(join(config, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`); // the replay records no mode change
  // Two sessions on disk: the one that asks (the replay's engine session, which its first Send resumes), and another
  // to leave its tab for.
  const seed = (engineId: string, content: string, at: string) => {
    const first = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content }, uuid: randomUUID(), timestamp: at, cwd: repo, sessionId: engineId, version: '2.1.295' };
    writeFileSync(join(project, `${engineId}.jsonl`), `${JSON.stringify(first)}\n`);
    return engineId;
  };
  const askingEngine = seed(toHumanSessionId(), 'a session that asks', '2026-10-10T08:00:00.000Z');
  const otherEngine = seed(randomUUID(), 'another session', '2026-10-10T08:01:00.000Z');
  const journal = toHumanJournal(root, Date.now() + 5 * 60_000); // after the launch below: past the session's watermark
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0', MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: journal, CLAUDE_CONFIG_DIR: config } });
  try {
    const { page } = maws;
    value(await invoke(page, 'settings.set', { gateway: { defaultRoute: 'direct' } })); // no relay in the run
    const appOf = async (engineId: string) => {
      let id = '';
      await expect.poll(async () => (id = value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === engineId)?.appId ?? ''), { timeout: 20_000 }).not.toBe('');
      return id;
    };
    const asking = await appOf(askingEngine);
    const other = await appOf(otherEngine);
    const turn = async () => value(await invoke(page, 'session.status', { appSessionId: asking as never })).turn;

    await (await sidebarRow(page, { appSessionId: asking })).click();
    await page.mouse.move(700, 450);
    const pane = page.locator('[data-region="main"] [data-pane="0"]');
    const composer = pane.getByRole('textbox', { name: 'Message' });
    await expect(pane.locator(`[data-composer="${asking}"]`)).toBeVisible();

    // Turn 1, the first Send starting the session: a must-read.
    await composer.click();
    await page.keyboard.type(TO_HUMAN.first);
    await page.keyboard.press('Enter');
    const must = pane.locator('[data-owner-card="essential"]');
    await expect(must).toHaveAttribute('data-state', 'unread', { timeout: 20_000 });
    await expect.poll(turn, { timeout: 20_000 }).toBeNull();
    // Turn 2: a question, and its tool goes on running.
    await composer.click();
    await page.keyboard.type(TO_HUMAN.second);
    await page.keyboard.press('Enter');
    const question = pane.locator('[data-owner-card="need-input"]');
    await expect(question).toContainText(TO_HUMAN.question);
    await expect.poll(turn).not.toBeNull();

    // Leaving the tab: the row's glyph is the question's; Needs you reads the oldest item, turn 1's must-read.
    await (await sidebarRow(page, { appSessionId: other })).click();
    await page.mouse.move(700, 450);
    await expect(pane.locator(`[data-composer="${other}"]`)).toBeVisible();
    await expect((await sidebarRow(page, { appSessionId: asking })).getByRole('img', { name: 'Question waiting' })).toBeVisible();
    await page.mouse.move(700, 450);
    const needs = page.getByRole('list', { name: 'Needs you' }).locator(`[data-needs-you="${asking}"]`);
    await expect(needs).toContainText(`Must read — ${TO_HUMAN.essential}`);

    // The Needs-you row opens the session at the mark, in the report.
    await needs.click();
    await page.mouse.move(700, 450);
    await expect(pane.locator(`[data-composer="${asking}"]`)).toBeVisible();
    await expect(pane.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Report' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => document.activeElement?.querySelector('[data-owner-card="essential"]') !== null)).toBe(true);

    // Mark read: the must-read reads Read, and Needs you moves on to the question.
    await must.getByRole('button', { name: 'Mark read' }).click();
    await expect(must).toHaveAttribute('data-state', 'read');
    await expect(must).toContainText('Read');
    await expect(needs).toContainText(`Question — ${TO_HUMAN.question}`);

    // A choice while the tool runs: Queued with Cancel, the draft untouched; Answered once the engine starts the prompt.
    await composer.click();
    await page.keyboard.type('my own draft');
    await question.getByRole('group', { name: 'Choices' }).getByRole('button', { name: new RegExp(`^${escape(TO_HUMAN.recommended)}`) }).click();
    await expect(question).toContainText('Queued — sends when the agent reaches a pause');
    await expect(question.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(needs).toHaveCount(0); // nothing waits on the person any more
    value(await invoke(page, 'session.getContextUsage', { appSessionId: asking as never, detail: 'summary' })); // the engine goes on
    await expect(question.locator('[data-answered]')).toHaveText(`Answered: ${TO_HUMAN.recommended}`);
    await expect(question.getByRole('group', { name: 'Choices' })).toHaveCount(0);
    await expect(pane.getByText(TO_HUMAN.reply)).toBeVisible();
    await expect(composer).toHaveText('my own draft');
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

// P2-C2 start
test('a style declaring contract 4: the supplement once and never contract 1, a <message> card, an async maws ask answered from its sheet, and the native AskUserQuestion still asked', async () => {
  test.setTimeout(150_000);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-p2c2-supplement-')));
  const repo = join(root, 'repo');
  const config = join(root, 'claude-config');
  mkdirSync(repo);
  const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  writeFileSync(join(config, '.claude.json'), `${JSON.stringify({ projects: { [repo]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  // The scratch settings home selects a user output style declaring contract 4; the replay records no mode change.
  writeFileSync(join(config, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' }, outputStyle: SUPPLEMENT.style })}\n`);
  mkdirSync(join(config, 'output-styles'));
  writeFileSync(join(config, 'output-styles', `${SUPPLEMENT.style}.md`), `---\nname: ${SUPPLEMENT.style}\ndescription: Messages only, questions through a tool\nmaws-to-human-contract: 4\n---\n\nWrap what is for the human in <message>.\n`);
  const engineId = toHumanSessionId();
  const first = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: 'a session under a message-only style' }, uuid: randomUUID(), timestamp: '2026-10-13T08:00:00.000Z', cwd: repo, sessionId: engineId, version: '2.1.295' };
  writeFileSync(join(project, `${engineId}.jsonl`), `${JSON.stringify(first)}\n`);
  const journal = supplementJournal(root, Date.now() + 5 * 60_000);
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0', MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: journal, CLAUDE_CONFIG_DIR: config } });
  try {
    const { page } = maws;
    value(await invoke(page, 'settings.set', { gateway: { defaultRoute: 'direct' } })); // no relay in the run
    let id = '';
    await expect.poll(async () => (id = value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === engineId)?.appId ?? ''), { timeout: 20_000 }).not.toBe('');
    const turn = async () => value(await invoke(page, 'session.status', { appSessionId: id as never })).turn;
    const lane = async () => value(await invoke(page, 'mods.list', { appSessionId: id as never }))[0]!;
    const rows = () => sessionJournal(maws.userData, id);
    type Frame = { type?: string; event?: string; priority?: string; message?: { content?: unknown } };
    const frameOf = (row: { frame: unknown }) => row.frame as Frame;

    await (await sidebarRow(page, { appSessionId: id })).click();
    await page.mouse.move(700, 450);
    const pane = page.locator('[data-region="main"] [data-pane="0"]');
    const composer = pane.getByRole('textbox', { name: 'Message' });
    await expect(pane.locator(`[data-composer="${id}"]`)).toBeVisible();
    // Before any launch, the lane reads what the next launch would do.
    expect(await lane()).toMatchObject({ source: 'external-style-plus-supplement', pending: 'next-launch' });

    // Turn 1, the first Send starting the session: a message card.
    await composer.click();
    await page.keyboard.type(SUPPLEMENT.first);
    await page.keyboard.press('Enter');
    const message = (text: string) => pane.locator('[data-owner-card="to-human"]').filter({ hasText: text });
    await expect(message(SUPPLEMENT.message)).toBeVisible({ timeout: 20_000 });

    // The launch: the supplement passed once, contract 1 and the full contract never, the lane advertised in the settings
    // env; the decision recorded (no longer pending).
    const spawns = rows().filter((r) => r.direction === 'meta' && frameOf(r).event === 'spawn');
    expect(spawns).toHaveLength(1);
    const { args } = spawns[0]!.frame as { args: string[] };
    expect(args.flatMap((arg, k) => (arg === '--append-system-prompt' ? [args[k + 1]] : []))).toEqual([TO_HUMAN_SUPPLEMENT]);
    expect(args.filter((arg) => arg.includes(CONTRACT_HEADER(1)) || arg.includes(CONTRACT_HEADER(TO_HUMAN_CONTRACT_VERSION)))).toEqual([]); // nor MAWS's full contract
    const settings = JSON.parse(args[args.indexOf('--settings') + 1]!) as { env?: Record<string, string> };
    expect(settings.env?.[NATIVE_TO_HUMAN_ENV]).toBe(String(TO_HUMAN_CONTRACT_VERSION));
    await expect.poll(async () => { const row = await lane(); return [row.source, row.pending ?? null]; }).toEqual(['external-style-plus-supplement', null]);

    // The async ask: acknowledged at once, answered from its sheet, the answer written as a `next` steer.
    const capsule = pane.locator('section.transcript-ask');
    await expect(capsule).toHaveAttribute('data-ask-state', 'asked');
    const sheet = page.locator('[data-region="panel"] [data-ask-sheet]');
    await sheet.locator('section[data-question-id="q1"]').getByRole('radio', { name: 'Yes' }).click();
    await clearToasts(page);
    await sheet.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(capsule).toHaveAttribute('data-ask-state', 'answered');
    await expect(capsule.locator('[data-ask-chip]')).toHaveText('Answered');
    const steered = () => rows().some((r) => r.direction === 'out' && frameOf(r).type === 'user' && frameOf(r).priority === 'next' && String(frameOf(r).message?.content).includes(`${SUPPLEMENT.askQuestion} — Yes`));
    await expect.poll(steered).toBe(true);
    expect(metaEvents(rows())).toContain('maws_ask_answered');
    await expect(message(SUPPLEMENT.askReply)).toBeVisible({ timeout: 20_000 });
    await expect.poll(turn, { timeout: 20_000 }).toBeNull();

    // Turn 2: the native AskUserQuestion arrives as MAWS's question request, and its answer goes back.
    await composer.click();
    await page.keyboard.type(SUPPLEMENT.second);
    await page.keyboard.press('Enter');
    const request = pane.locator('[data-request-card]').filter({ hasText: SUPPLEMENT.question });
    await expect(request).toBeVisible({ timeout: 20_000 });
    await request.getByRole('radio', { name: SUPPLEMENT.choices[0] }).click();
    await request.getByRole('button', { name: 'Submit' }).click();
    await expect(message(SUPPLEMENT.reply)).toBeVisible({ timeout: 20_000 });
    await expect.poll(turn, { timeout: 20_000 }).toBeNull();
    expect(metaEvents(rows())).not.toContain('replay_mismatch');
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});
// P2-C2 end
