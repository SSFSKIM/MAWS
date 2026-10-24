// UX1: output-style text stays unboxed while extraction, attention, navigation and answer delivery remain independent.
// The legacy owner-channel lifecycle is exercised through its commands, not retired transcript-card controls.
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { CONTRACT_HEADER, messageToolHookGroup, NATIVE_TO_HUMAN_ENV, TO_HUMAN_CONTRACT_VERSION, TO_HUMAN_SUPPLEMENT } from '../src/shared/owner/contract';
import { invoke, value } from './support/c7-replay';
import { traceForeground } from './support/foreground-trace';
import { launchMaws } from './support/launch';
import { sessionJournal } from './support/live-turns';
import { clearToasts, metaEvents } from './support/maws-tools';
import { sidebarRow } from './support/sidebar';
import { SUPPLEMENT, supplementJournal, TO_HUMAN, toHumanJournal, toHumanSessionId } from './support/to-human-replay';

test('legacy mark text stays unboxed; attention jumps and owner-channel read/answer lifecycle remain intact', async () => {
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
    const ownerState = async () => value(await invoke(page, 'ownerChannel.state', { appSessionId: asking as never }));

    await (await sidebarRow(page, { appSessionId: asking })).click();
    await page.mouse.move(700, 450);
    const pane = page.locator('[data-region="main"] [data-pane="0"]');
    const composer = pane.getByRole('textbox', { name: 'Message' });
    await expect(pane.locator(`[data-composer="${asking}"]`)).toBeVisible();

    // Turn 1, the first Send starting the session: a must-read.
    await composer.click();
    await page.keyboard.type(TO_HUMAN.first);
    await page.keyboard.press('Enter');
    const must = pane.locator('[data-kind="assistant_text"]').filter({ hasText: TO_HUMAN.essential });
    await expect(must).toContainText(TO_HUMAN.essential, { timeout: 20_000 });
    await expect(pane.getByRole('button', { name: 'Mark read', exact: true })).toBeVisible();
    await expect(pane.locator('[data-owner-card]')).toHaveCount(0);
    await expect.poll(turn, { timeout: 20_000 }).toBeNull();
    // Turn 2: a question, and its tool goes on running.
    await composer.click();
    await page.keyboard.type(TO_HUMAN.second);
    await page.keyboard.press('Enter');
    const question = pane.locator('[data-kind="assistant_text"]').filter({ hasText: TO_HUMAN.question });
    await expect(question).toContainText(TO_HUMAN.question);
    await expect.poll(turn).not.toBeNull();

    // Leaving the tab: the row's glyph is the question's; the compact Needs-you row names the oldest item for assistive tech.
    await (await sidebarRow(page, { appSessionId: other })).click();
    await page.mouse.move(700, 450);
    await expect(pane.locator(`[data-composer="${other}"]`)).toBeVisible();
    await expect((await sidebarRow(page, { appSessionId: asking })).getByRole('img', { name: 'Question waiting' })).toBeVisible();
    await page.mouse.move(700, 450);
    const needs = page.getByRole('list', { name: 'Needs you' }).locator(`[data-needs-you="${asking}"]`);
    await expect(needs).toHaveAccessibleName(`repo · a session that asks · Must read — ${TO_HUMAN.essential}`);
    await expect(needs).not.toContainText(TO_HUMAN.essential);

    // The Needs-you row opens the session at the mark, in the report. P3-F (tracker row 199, the must-read): a focus that
    // never lands reports the page's focus timeline, its frame rate and the window's state.
    const trace = await traceForeground(maws.app, page);
    await trace.step(
      'must-read-focus',
      async () => {
        await needs.click();
        await page.mouse.move(700, 450);
        await expect(pane.locator(`[data-composer="${asking}"]`)).toBeVisible();
        await expect(pane.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Report' })).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => page.evaluate(() => document.activeElement?.textContent?.includes('The migration drops the legacy_users table.') === true)).toBe(true);
      },
      () =>
        page.evaluate(() => {
          const card = Array.from(document.querySelectorAll('[data-kind="assistant_text"]')).find((node) => node.textContent?.includes('The migration drops the legacy_users table.'));
          const row = card?.closest('[id]');
          return { card: card != null, row: row ? `${row.tagName.toLowerCase()}#${row.id} tabindex=${row.getAttribute('tabindex')}` : null, rowConnected: row?.isConnected ?? null, cardInView: card ? card.getBoundingClientRect().top : null };
        }),
    );

    // Preserve per-mark acknowledgement and answer-state coverage independently of transcript presentation.
    const essential = (await ownerState()).marks.find((mark) => mark.kind === 'essential')!;
    const asked = (await ownerState()).marks.find((mark) => mark.kind === 'need-input')!;
    value(await invoke(page, 'ownerChannel.markRead', { appSessionId: asking as never, markIds: [essential.id] }));
    await expect.poll(async () => (await ownerState()).marks.find((mark) => mark.id === essential.id)?.essential?.state).toBe('read');
    await expect(needs).toHaveAccessibleName(`repo · a session that asks · Question — ${TO_HUMAN.question}`);
    await expect(question.getByRole('button')).toHaveCount(0);

    await composer.click();
    await page.keyboard.type('my own draft');
    const content = `Answering "${TO_HUMAN.question}": ${TO_HUMAN.recommended}`;
    const sent = value(await invoke(page, 'session.steer', { appSessionId: asking as never, content, priority: 'next' }));
    value(await invoke(page, 'ownerChannel.answered', { appSessionId: asking as never, markId: asked.id, text: content, origin: 'answer', disposition: 'steered', started: false, messageUuid: sent.messageUuid! }));
    await expect.poll(async () => (await ownerState()).marks.find((mark) => mark.id === asked.id)?.question?.state).toBe('queued');
    await expect(needs).toHaveCount(0);
    value(await invoke(page, 'session.getContextUsage', { appSessionId: asking as never, detail: 'summary' }));
    await expect.poll(async () => (await ownerState()).marks.find((mark) => mark.id === asked.id)?.question?.state).toBe('delivered');
    await expect(pane.getByText(TO_HUMAN.reply)).toBeVisible();
    await expect(composer).toHaveText('my own draft');
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

// P2-C2 start
test('a style declaring contract 4: the supplement once and never contract 1, the native ask withdrawn, unboxed <message> text and a message tool’s call in source order, an async maws ask answered from its sheet, and a native ask on the wire still drawn', async () => {
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

    // Turn 1, the first Send starting the session: an unboxed message.
    await composer.click();
    await page.keyboard.type(SUPPLEMENT.first);
    await page.keyboard.press('Enter');
    const message = (text: string) => pane.locator('.owner-message-ink').filter({ hasText: text });
    await expect(message(SUPPLEMENT.message)).toBeVisible({ timeout: 20_000 });

    // P4-R7: the message tool's call stays in flow, between the authored span and the ask, never the
    // MCP call's row; the host answered it `sent`
    const called = pane.locator(`[data-row-id="to-human:${SUPPLEMENT.toolMessageId}"]`);
    await expect(called.locator('.owner-message-ink')).toHaveText(new RegExp(SUPPLEMENT.toolMessage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout: 20_000 });
    await expect(pane.locator(`[data-cell-id="cell:${SUPPLEMENT.toolMessageId}"]`)).toHaveCount(0);
    const order = await pane.locator('[data-row-id]').evaluateAll((drawn) => drawn.map((row) => row.getAttribute('data-row-id')!));
    const at = (prefix: string) => order.findIndex((rowId) => rowId.startsWith(prefix));
    expect(at('text:msg_01P2c2Message')).toBeGreaterThanOrEqual(0);
    expect(at(`to-human:${SUPPLEMENT.toolMessageId}`)).toBeGreaterThan(at('text:msg_01P2c2Message'));
    expect(at(`to-human:${SUPPLEMENT.toolMessageId}`)).toBeLessThan(at('ask:'));
    const answered = rows().find((r) => r.direction === 'out' && frameOf(r).type === 'control_response' && (r.frame as { response: { request_id: string } }).response.request_id === '5d7f1c2a-0000-4000-8000-0000000000a1');
    expect((answered?.frame as { response: { response: unknown } } | undefined)?.response.response).toEqual({ mcp_response: { jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'sent' }] } } });

    // The launch: the supplement passed once, contract 1 and the full contract never, the lane advertised in the settings
    // env; the decision recorded (no longer pending).
    const spawns = rows().filter((r) => r.direction === 'meta' && frameOf(r).event === 'spawn');
    expect(spawns).toHaveLength(1);
    const { args } = spawns[0]!.frame as { args: string[] };
    expect(args.flatMap((arg, k) => (arg === '--append-system-prompt' ? [args[k + 1]] : []))).toEqual([TO_HUMAN_SUPPLEMENT]);
    expect(args.filter((arg) => arg.includes(CONTRACT_HEADER(1)) || arg.includes(CONTRACT_HEADER(TO_HUMAN_CONTRACT_VERSION)))).toEqual([]); // nor MAWS's full contract
    expect(args.flatMap((arg, k) => (arg === '--disallowedTools' ? [args[k + 1]] : []))).toEqual(['AskUserQuestion']); // Decision Log 33
    expect(args.flatMap((arg, k) => (arg === '--allowedTools' ? [args[k + 1]] : []))).toEqual(['mcp__maws__message']); // P4-R7: never a permission card
    const settings = JSON.parse(args[args.indexOf('--settings') + 1]!) as { env?: Record<string, string>; hooks?: unknown };
    expect(settings.env?.[NATIVE_TO_HUMAN_ENV]).toBe(String(TO_HUMAN_CONTRACT_VERSION));
    expect(settings.hooks).toEqual({ SessionStart: [messageToolHookGroup()] }); // P4-R7y: the context at every start
    await expect.poll(async () => { const row = await lane(); return [row.source, row.pending ?? null]; }).toEqual(['external-style-plus-supplement', null]);

    // The async ask: acknowledged at once, answered from its sheet, the answer written as a `next` steer.
    const capsule = pane.locator('section.transcript-ask');
    await expect(capsule).toHaveAttribute('data-ask-state', 'asked');
    // Decision Log 32: the waiting question is an async_input item, retired at the committed answer
    const waiting = async () => value(await invoke(page, 'attention.list', undefined)).filter((item) => item.appSessionId === id && item.kind === 'async_input' && item.state === 'pending');
    await expect.poll(async () => (await waiting()).length).toBe(1);
    const sheet = page.locator('[data-region="panel"] [data-ask-sheet]');
    await sheet.locator('section[data-question-id="q1"]').getByRole('radio', { name: 'Yes' }).click();
    await clearToasts(page);
    await sheet.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(capsule).toHaveAttribute('data-ask-state', 'answered');
    await expect(capsule.locator('[data-ask-chip]')).toHaveText('Answered');
    await expect.poll(async () => (await waiting()).length).toBe(0);
    const steered = () => rows().some((r) => r.direction === 'out' && frameOf(r).type === 'user' && frameOf(r).priority === 'next' && String(frameOf(r).message?.content).includes(`${SUPPLEMENT.askQuestion} — Yes`));
    await expect.poll(steered).toBe(true);
    expect(metaEvents(rows())).toContain('maws_ask_answered');
    await expect(message(SUPPLEMENT.askReply)).toBeVisible({ timeout: 20_000 });
    await expect.poll(turn, { timeout: 20_000 }).toBeNull();

    // Turn 2: a native AskUserQuestion on the wire (the request-card path kept for transcripts and launches that carry
    // one) arrives as MAWS's question request, and its answer goes back.
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
