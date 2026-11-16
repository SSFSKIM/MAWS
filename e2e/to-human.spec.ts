// UX1: output-style text stays unboxed while extraction, attention, navigation and answer delivery remain independent.
// The legacy owner-channel lifecycle is exercised through its commands, not retired transcript-card controls.
// UX wave U2b (M6): the record line's summary where MAWS draws, read from the to-human mod's file (the last scenes).
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { CONTRACT_HEADER, NATIVE_TO_HUMAN_ENV, TO_HUMAN_MIRROR_VERSION, TO_HUMAN_SUPPLEMENT } from '../src/shared/owner/contract';
import { addressed } from './support/address';
import { invoke, value } from './support/c7-replay';
import { traceForeground } from './support/foreground-trace';
import { launchMaws } from './support/launch';
import { installToHumanPlugin } from '../test/support/to-human-plugin'; // P4-R7z
import { sessionJournal } from './support/live-turns';
import { clearToasts, metaEvents } from './support/maws-tools';
import { sidebarRow } from './support/sidebar';
import { SUMMARY, summaryJournal, SUPPLEMENT, supplementJournal, TO_HUMAN, toHumanJournal, toHumanSessionId } from './support/to-human-replay';
import { foldsFileOf } from '../src/shared/owner/folds'; // UX wave U2b: the mod's file of fold summaries, by session

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
  // P4-R7z: the lane runs where the to-human plugin registers its tool: its style selected (declaring 6), the plugin on
  installToHumanPlugin(config);
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
    await expect(pane.locator(`[data-composer="${await addressed(page, asking)}"]`)).toBeVisible();

    // Turn 1, the first Send starting the session: a must-read.
    await composer.click();
    await page.keyboard.type(TO_HUMAN.first);
    await page.keyboard.press('Enter');
    const must = pane.locator('[data-kind="assistant_text"]').filter({ hasText: TO_HUMAN.essential });
    await expect(must).toContainText(TO_HUMAN.essential, { timeout: 20_000 });
    // UX wave U2b (decisions 20 and 21): the bar went with its unread count and its Mark read; "Mark all read" is a
    // command of the palette, and a must-read's own Mark read is its card's in Needs you
    await expect(pane.getByRole('button', { name: 'Mark read', exact: true })).toHaveCount(0);
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
    await expect(pane.locator(`[data-composer="${await addressed(page, other)}"]`)).toBeVisible();
    await expect((await sidebarRow(page, { appSessionId: asking })).getByRole('img', { name: 'Question waiting' })).toBeVisible();
    await page.mouse.move(700, 450);
    const needs = page.getByRole('list', { name: 'Needs you' }).locator(`[data-needs-you="${await addressed(page, asking)}"]`);
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
        await expect(pane.locator(`[data-composer="${await addressed(page, asking)}"]`)).toBeVisible();
        // UX wave U2b: the report is the to-human view, its switch above the composer offering the full transcript; the
        // mark is a message, in sight, so no record had to open for it (a jump into a record: e2e/transcript.spec.ts)
        await expect(pane.locator('[data-view-switch]').getByRole('button', { name: 'full transcript ›', exact: true })).toBeVisible();
        await expect(pane.getByRole('group', { name: 'Session view' })).toHaveCount(0);
        await expect(pane.getByRole('button', { name: '‹ fold to report', exact: true })).toHaveCount(0);
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
test('a style declaring the plugin’s message tool (6): the supplement once and no contract, the native ask withdrawn, unboxed <message> text and the plugin’s message call in source order, an async maws ask answered in its capsule’s row, and a native ask on the wire still drawn', async () => {
  test.setTimeout(150_000);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-p2c2-supplement-')));
  const repo = join(root, 'repo');
  const config = join(root, 'claude-config');
  mkdirSync(repo);
  const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  writeFileSync(join(config, '.claude.json'), `${JSON.stringify({ projects: { [repo]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  // The scratch settings home selects the to-human plugin's style (contract 6) with the plugin on; the replay records no
  // mode change.
  writeFileSync(join(config, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
  installToHumanPlugin(config);
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
    await expect(pane.locator(`[data-composer="${await addressed(page, id)}"]`)).toBeVisible();
    // Before any launch, the lane reads what the next launch would do.
    expect(await lane()).toMatchObject({ source: 'external-style-plus-supplement', pending: 'next-launch' });

    // Turn 1, the first Send starting the session: an unboxed message.
    await composer.click();
    await page.keyboard.type(SUPPLEMENT.first);
    await page.keyboard.press('Enter');
    const message = (text: string) => pane.locator('.owner-message-ink').filter({ hasText: text });
    await expect(message(SUPPLEMENT.message)).toBeVisible({ timeout: 20_000 });

    // P4-R7z: the plugin's message call stays in flow, between the authored span and the ask, never the MCP call's row;
    // the plugin answered it `sent` inside the engine, so MAWS answered nothing for it
    const called = pane.locator(`[data-row-id="to-human:${SUPPLEMENT.toolMessageId}"]`);
    await expect(called.locator('.owner-message-ink')).toHaveText(new RegExp(SUPPLEMENT.toolMessage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout: 20_000 });
    await expect(pane.locator(`[data-cell-id="cell:${SUPPLEMENT.toolMessageId}"]`)).toHaveCount(0);
    const order = await pane.locator('[data-row-id]').evaluateAll((drawn) => drawn.map((row) => row.getAttribute('data-row-id')!));
    const at = (prefix: string) => order.findIndex((rowId) => rowId.startsWith(prefix));
    expect(at('text:msg_01P2c2Message')).toBeGreaterThanOrEqual(0);
    expect(at(`to-human:${SUPPLEMENT.toolMessageId}`)).toBeGreaterThan(at('text:msg_01P2c2Message'));
    expect(at(`to-human:${SUPPLEMENT.toolMessageId}`)).toBeLessThan(at('ask:'));
    const answeredByMaws = rows().filter((r) => r.direction === 'out' && frameOf(r).type === 'control_response' && JSON.stringify(r.frame).includes('"text":"sent"'));
    expect(answeredByMaws).toEqual([]);

    // The launch: the supplement passed once, no contract of MAWS's, the lane advertised in the settings env and no hook
    // of MAWS's there; the decision recorded (no longer pending). UX wave U2b: the installation carries no declaration
    // (test/support/to-human-plugin.ts writes none unless asked), so MAWS draws the view and the launch carries the
    // mirror's number.
    const spawns = rows().filter((r) => r.direction === 'meta' && frameOf(r).event === 'spawn');
    expect(spawns).toHaveLength(1);
    const { args } = spawns[0]!.frame as { args: string[] };
    expect(args.flatMap((arg, k) => (arg === '--append-system-prompt' ? [args[k + 1]] : []))).toEqual([TO_HUMAN_SUPPLEMENT]);
    expect(args.filter((arg) => arg.includes(CONTRACT_HEADER(0).slice(0, -3)))).toEqual([]); // no contract of MAWS's, of any version
    expect(args.flatMap((arg, k) => (arg === '--disallowedTools' ? [args[k + 1]] : []))).toEqual(['AskUserQuestion']); // Decision Log 33
    expect(args.flatMap((arg, k) => (arg === '--allowedTools' ? [args[k + 1]] : []))).toEqual(['mcp__maws__ask']); // P4-R7z: the ask alone; the plugin's message tool asks no permission
    const settings = JSON.parse(args[args.indexOf('--settings') + 1]!) as { env?: Record<string, string>; hooks?: unknown };
    expect(settings.env?.[NATIVE_TO_HUMAN_ENV]).toBe(String(TO_HUMAN_MIRROR_VERSION));
    expect(settings.hooks).toBeUndefined(); // P4-R7z: P4-R7y's SessionStart alias is gone
    await expect.poll(async () => { const row = await lane(); return [row.source, row.pending ?? null]; }).toEqual(['external-style-plus-supplement', null]);

    // The async ask: acknowledged at once, answered in its capsule's row (UX wave U1b: its form stands there, and no sheet
    // opens by itself), the answer written as a `next` steer.
    const capsule = pane.locator('section.transcript-ask');
    await expect(capsule).toHaveAttribute('data-ask-state', 'asked');
    // Decision Log 32: the waiting question is an async_input item, retired at the committed answer
    const waiting = async () => value(await invoke(page, 'attention.list', undefined)).filter((item) => item.appSessionId === id && item.kind === 'async_input' && item.state === 'pending');
    await expect.poll(async () => (await waiting()).length).toBe(1);
    const form = capsule.locator('.transcript-ask-form [data-hover-ask]');
    await form.locator('section[data-question-id="q1"]').getByRole('radio', { name: 'Yes' }).click();
    await expect(page.locator('[data-region="panel"] [data-ask-sheet]'), 'no sheet opened by itself').toHaveCount(0);
    await clearToasts(page);
    await form.getByRole('button', { name: 'Submit', exact: true }).click();
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

// UX wave U2b (M6; docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md, §M): where MAWS draws the view (the
// launch carries 8: the installation declares nothing), a record line reads what the to-human mod's file of fold
// summaries holds for its stretch, a stretch still growing its newest call, and `working record` where there is
// neither. The scratch configuration directory holds an invented file for the recorded session in the mod's form (a
// temporary beside it, then a rename over it); the file is then replaced, by a rename, with one that holds one more run,
// and the line changes with no reload, at the round's next read or at the window's return of focus. MAWS reads shape 2
// alone: the same runs at shape 1, as releases before the mod's pull request write them, read as no summaries.
for (const shape of [2, 1] as const) {
  const title = shape === 2
    ? 'a record line reads its stored summary, a growing one its newest call, and working record where there is neither'
    : 'a folds file of shape 1 holding the same runs reads as no summaries: every closed record line reads working record';
  test(title, async () => {
    test.setTimeout(180_000);
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-u2b-summary-')));
    const repo = join(root, 'repo');
    const config = join(root, 'claude-config');
    mkdirSync(repo);
    const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
    mkdirSync(project, { recursive: true });
    writeFileSync(join(config, '.claude.json'), `${JSON.stringify({ projects: { [repo]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
    writeFileSync(join(config, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
    installToHumanPlugin(config); // the plugin's style (6) and the plugin, no declaration: the lane on, MAWS draws
    const engineId = toHumanSessionId();
    const first = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: 'a session whose work is summarised' }, uuid: randomUUID(), timestamp: '2026-11-16T08:00:00.000Z', cwd: repo, sessionId: engineId, version: '2.1.322' };
    writeFileSync(join(project, `${engineId}.jsonl`), `${JSON.stringify(first)}\n`);
    // The mod's file, as the mod keeps it: written whole to a temporary in the same folder, then moved over the file
    const folds = foldsFileOf(config, engineId)!;
    mkdirSync(dirname(folds), { recursive: true });
    const keep = (runs: [string, string, string][]) => {
      const temporary = `${folds}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify({ shape, runs }));
      renameSync(temporary, folds);
    };
    const tree: [string, string, string] = [SUMMARY.calls.tree, SUMMARY.calls.tree, SUMMARY.stored.tree];
    const list: [string, string, string] = [SUMMARY.calls.list, SUMMARY.calls.list, SUMMARY.stored.list];
    keep([tree]);
    const journal = summaryJournal(root, Date.now() + 5 * 60_000);
    const maws = await launchMaws({ env: { MAWS_HARNESS: '0', MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: journal, CLAUDE_CONFIG_DIR: config } });
    try {
      const { page } = maws;
      value(await invoke(page, 'settings.set', { gateway: { defaultRoute: 'direct' } })); // no relay in the run
      let id = '';
      await expect.poll(async () => (id = value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === engineId)?.appId ?? ''), { timeout: 20_000 }).not.toBe('');
      const turn = async () => value(await invoke(page, 'session.status', { appSessionId: id as never })).turn;
      const stored = async () => value(await invoke(page, 'ownerChannel.folds', { appSessionId: id as never })).runs;
      await (await sidebarRow(page, { appSessionId: id })).click();
      await page.mouse.move(700, 450);
      const pane = page.locator('[data-region="main"] [data-pane="0"]');
      const composer = pane.getByRole('textbox', { name: 'Message' });
      await expect(pane.locator(`[data-composer="${await addressed(page, id)}"]`)).toBeVisible();
      const line = (call: string) => pane.locator(`[data-row-id="record-fold:closed:${call}"]`).getByRole('button');
      const message = (text: string) => pane.locator('.owner-message-ink').filter({ hasText: text });
      const NONE = '› working record';

      // Turn 1: two stretches close. The view's first read takes the file whole: the first stretch reads its summary,
      // the second, which the file does not hold, `working record`.
      await composer.click();
      await page.keyboard.type(SUMMARY.first);
      await page.keyboard.press('Enter');
      await expect(message(SUMMARY.messages.list)).toBeVisible({ timeout: 20_000 });
      await expect.poll(turn, { timeout: 20_000 }).toBeNull();
      await expect(pane.locator('[data-view-switch]')).toHaveText('to-human view · full transcript ›'); // MAWS draws: the mirror and its switch
      expect(await stored(), 'what the owner service reads of the file').toEqual(shape === 2 ? [{ first: tree[0], last: tree[1], summary: tree[2] }] : null);
      await expect(line(SUMMARY.calls.tree)).toHaveText(shape === 2 ? `› ${SUMMARY.stored.tree}` : NONE, { timeout: 20_000 });
      await expect(line(SUMMARY.calls.list)).toHaveText(NONE);

      // Turn 2: the stretch grows while its call runs: its line is its newest call's, whatever the file holds
      await composer.click();
      await page.keyboard.type(SUMMARY.second);
      await page.keyboard.press('Enter');
      await expect.poll(turn, { timeout: 20_000 }).not.toBeNull();
      await expect(line(SUMMARY.calls.suite)).toHaveText(`› ${SUMMARY.lines.suite}`, { timeout: 20_000 });
      value(await invoke(page, 'session.getContextUsage', { appSessionId: id as never, detail: 'summary' })); // the replay goes on
      await expect(message(SUMMARY.messages.suite)).toBeVisible({ timeout: 20_000 });
      await expect.poll(turn, { timeout: 20_000 }).toBeNull();
      await expect(line(SUMMARY.calls.suite), 'closed, with no run in the file').toHaveText(NONE);

      // The file replaced by a rename with one more run, then the window's focus returns: the line changes in place
      keep([tree, list]);
      expect(await stored()).toEqual(shape === 2 ? [tree, list].map(([first, last, summary]) => ({ first, last, summary })) : null);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      if (shape === 2) {
        // the focus's read, or the round's next one (3, 8, 20 or 45 s after the last close or end)
        await expect(line(SUMMARY.calls.list)).toHaveText(`› ${SUMMARY.stored.list}`, { timeout: 50_000 });
        await expect(line(SUMMARY.calls.tree)).toHaveText(`› ${SUMMARY.stored.tree}`);
      } else {
        await expect(line(SUMMARY.calls.list)).toHaveText(NONE);
        await expect(line(SUMMARY.calls.tree)).toHaveText(NONE);
      }
      await expect(line(SUMMARY.calls.suite)).toHaveText(NONE);
      await expect(pane.getByRole('button', { name: NONE, exact: true })).toHaveCount(shape === 2 ? 1 : 3);
      expect(metaEvents(sessionJournal(maws.userData, id))).not.toContain('replay_mismatch');
      expect(maws.consoleErrors()).toEqual([]);
    } finally {
      await maws.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  });
}
