// P2-C (the P2-C document, M6; G4, G5's actions, G6's surfaces) end to end over the replay transport: no engine runs.
// A session leaves a must-read, then a question whose turn goes on running a tool (e2e/support/to-human-replay.ts).
// Leaving its tab, the sidebar row shows the question's glyph and Needs you reads the oldest item's summary; the row
// opens the session at the mark, in the report. Mark read reads the must-read, and Needs you moves on to the question. A
// click on the recommended choice while the tool runs sends the answer through the seam as a `next` steer: the card
// reads Queued with Cancel until the engine starts that prompt (its `command_lifecycle` `started`), then Answered, and
// the composer's draft is untouched.
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { invoke, value } from './support/c7-replay';
import { launchMaws } from './support/launch';
import { sidebarRow } from './support/sidebar';
import { TO_HUMAN, toHumanJournal, toHumanSessionId } from './support/to-human-replay';

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
