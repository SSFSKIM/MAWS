// E1's `tools` group (docs/doperpowers/plans/2026-10-05-e1-tool-server.md, M5; P1 spec §9 E1, gates G1 to G7): the
// `maws` tool server end to end in the product app, over the four fixtures M2 recorded live through MAWS's own host
// (`pass3/p1-maws-*`) and E0a's `p1-sdk-mcp-roundtrip`, replayed through C3's replay transport (MAWS_ENGINE_REPLAY=1).
// The host's tool server runs for real against the replay: it answers the engine's handshake and calls, writes the X12
// records, holds a blocking ask until the sheet submits, sends an async ask's steer, and bridges `show_pane` to the
// renderer, which opens the pane and answers. The replay matches a `control_response` by request id and behaviour only
// and a `user` frame by type, so what the sheet submits is asserted on the journal's own rows, never on the model's
// recorded words. Every case seeds a scratch config home with one transcript per session so C4 indexes the scratch
// directory as a project (the sheet's repository list) and the sidebar shows the session; no engine runs.
// The M4b cases: a blocking ask is a question attention item (the Overview card, Needs you) that goes at Submit, and an
// ask from a session not shown never switches the main view; its sheet opens when that session is selected.
// Runs under `pnpm e2e:tools` (a harness build, MAWS_HARNESS=1 for playwright.config.ts's list). MAWS_E1_SHOTS=1 also
// writes the replay's screenshots in both themes under docs/doperpowers/evidence/p1-e1/ (`e1-replay-<surface>-<theme>`).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import type { AskAnswer } from '@shared/maws/tools';
import { TOOL_ERRORS } from '../src/shared/maws/tools';
import { invoke, value } from './support/c7-replay';
import { REPO_ROOT } from './support/launch';
import {
  allowNext, clearToasts, fixtureRows, idle, mcpCalls, mcpResultOf, metaEvents, ofKind, PASS3, recordedCwd, recordEvents, replay, resultText, scene as sharedScene, shootThemes, show,
  unfoldWork, type Frame, type McpResult, type Scene,
} from './support/maws-tools';
import { sidebarOf } from './support/sidebar';

const SEND_FILE = `${PASS3}/p1-maws-send-file.jsonl`;
const ASK_BLOCKING = `${PASS3}/p1-maws-ask-blocking.jsonl`;
const ASK_ASYNC = `${PASS3}/p1-maws-ask-async.jsonl`;
const SHOW_PANE = `${PASS3}/p1-maws-show-pane.jsonl`;
const ROUNDTRIP = `${PASS3}/p1-sdk-mcp-roundtrip.jsonl`;

const SHOTS = process.env.MAWS_E1_SHOTS === '1' ? join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e1') : null;

test.describe.configure({ timeout: 120_000 });

// ---- the scene (support/maws-tools.ts): a scratch project with an `assets` folder, the product app over the replay ----

const scene = (opts: { titles: string[]; repo?: string }, body: (s: Scene) => Promise<void>) => sharedScene({ ...opts, folders: ['assets'], label: 'e1-tools' }, body);

// `e1-replay-<surface>-<theme>.png` under docs/doperpowers/evidence/p1-e1/ when MAWS_E1_SHOTS=1.
async function shoot(s: Scene, surface: string): Promise<void> {
  if (SHOTS === null) return;
  await shootThemes(s.page, (theme) => join(SHOTS, `e1-replay-${surface}-${theme}.png`));
}

// ---- the Question sheet ---------------------------------------------------------------------------------------------

const sheetOf = (s: Scene) => s.panel.locator('[data-ask-sheet]');
const sectionOf = (sheet: Locator, questionId: string) => sheet.locator(`section[data-question-id="${questionId}"]`);
const capsuleOf = (s: Scene) => s.pane.locator('section.transcript-ask');

// The folder the next native pick answers (main's e2e pick seam, read at each pick).
const setPick = (s: Scene, path: string) => s.maws.app.evaluate((_electron, dir) => void (process.env.MAWS_E2E_PICK_PATHS = dir), path);

// The answers the blocking fixture's ask got, read from the result the host wrote (the replay matches it by id alone).
async function answersWritten(s: Scene, id: string, requestId: string): Promise<AskAnswer[]> {
  let result: McpResult | null = null;
  await expect.poll(() => (result = mcpResultOf(s.journal(id), requestId)) !== null, { timeout: 20_000 }).toBe(true);
  const parsed = JSON.parse(resultText(result!)) as { status: string; askId: string; answers: AskAnswer[] };
  expect(parsed.status).toBe('answered');
  return parsed.answers;
}

// ---- G2: send_file --------------------------------------------------------------------------------------------------

test('send_file: the delivery row names hello.txt and the caption, its two buttons reach the seams, and the X12 record is written', async () => {
  // The host's send_file stats the path for real, in the recording's working directory (the engine's cwd is the
  // recorded `system/init.cwd`): the directory is recreated with the file before the launch, and the scratch transcript
  // names it so the indexed session's directory (the files allowlist root) is the same path.
  const repo = recordedCwd(SEND_FILE);
  const existed = existsSync(repo);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'hello.txt'), 'HELLO_E1');
  try {
    await scene({ titles: ['E1 tools: send_file'], repo }, async (s) => {
      const [id] = s.ids;
      await show(s, id);
      await replay(s, id, SEND_FILE);
      await allowNext(s, id); // Write (seq 67)
      await allowNext(s, id); // mcp__maws__send_file (seq 99)

      const delivery = s.pane.locator('[data-delivery]');
      await expect(delivery.locator('[data-delivery-heading]')).toHaveText('Delivered hello.txt · the greeting');
      const path = join(repo, 'hello.txt');
      const file = delivery.locator(`[data-path="${path}"]`);
      await file.getByRole('button', { name: 'Open externally' }).click();
      await file.getByRole('button', { name: 'Reveal in Finder' }).click();
      await expect.poll(() => (existsSync(s.openLog) ? readFileSync(s.openLog, 'utf8').trim().split('\n') : [])).toEqual([path, `reveal ${path}`]);

      // the result the host wrote lists the deliverable it recorded, and (P3-L M6b) it is a File artifact of the session,
      // the file in place; the caption is the row's (above), not the artifact's
      const [call] = mcpCalls(s.journal(id));
      expect(call).toMatchObject({ name: 'send_file', args: { files: ['hello.txt'], caption: 'the greeting' } });
      const result = mcpResultOf(s.journal(id), call!.requestId)!;
      expect(result.isError).toBeUndefined();
      const delivered = JSON.parse(resultText(result)) as { status: string; deliverables: { id: string; path: string; name: string }[] };
      expect(delivered).toMatchObject({ status: 'delivered', deliverables: [{ path, name: 'hello.txt' }] });
      const { artifact } = value(await invoke(s.page, 'artifacts.get', { artifactId: delivered.deliverables[0]!.id }));
      expect(artifact).toMatchObject({ id: delivered.deliverables[0]!.id, kind: 'file', linkedPath: path, title: 'hello.txt', createdBy: { kind: 'session', appSessionId: id } });
      expect(existsSync(join(s.maws.userData, 'deliverables'))).toBe(false); // no X12 record
      expect(ofKind(await s.events(id), 'maws.delivery.file')).toMatchObject([{ deliverables: delivered.deliverables, caption: 'the greeting', urgency: 'normal' }]);
      await idle(s, id);
      await shoot(s, 'delivery');
    });
  } finally {
    if (!existed) rmSync(repo, { recursive: true, force: true });
  }
});

// ---- G3 and the attention item: a blocking ask ----------------------------------------------------------------------

test('a blocking ask: the capsule waits, the sheet holds every modality, the attention item shows on the Overview card and in Needs you, and Submit answers it', async () => {
  await scene({ titles: ['E1 tools: blocking ask'] }, async (s) => {
    const [id] = s.ids;
    await show(s, id);
    await replay(s, id, ASK_BLOCKING);
    // P2-C Design §7 defaults lane-on panes to Report; this case checks transcript follow mode.
    await s.pane.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Transcript', exact: true }).click();
    await allowNext(s, id); // mcp__maws__ask (seq 129)

    const capsule = capsuleOf(s);
    await expect(capsule).toHaveAttribute('data-ask-state', 'pending');
    await expect(capsule).toContainText('Asked 5 questions');
    await expect(capsule.locator('[data-ask-chip]')).toHaveText('Waiting for you');
    const [opened] = ofKind(await s.events(id), 'maws.ask.opened');
    expect(opened).toMatchObject({ blocking: true, questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }, { id: 'q4' }, { id: 'q5' }] });
    await expect(capsule).toHaveAttribute('data-ask-id', opened!.askId);

    // the sheet opened by itself for the shown session, one section per question with its modality's control
    const sheet = sheetOf(s);
    await expect(sheet).toHaveAttribute('data-ask-id', opened!.askId);
    await expect(sheet.locator('section[data-question-id]')).toHaveCount(5);
    await expect(sectionOf(sheet, 'q1').getByRole('radio')).toHaveCount(4); // Red, Green, Blue, Other…
    await expect(sectionOf(sheet, 'q2').getByRole('checkbox')).toHaveCount(4); // Mon, Tue, Wed, Other…
    await expect(sectionOf(sheet, 'q3').getByRole('textbox')).toBeVisible();
    await expect(sectionOf(sheet, 'q4').getByRole('button', { name: 'Choose folder…' })).toBeVisible();
    await expect(sectionOf(sheet, 'q5').getByRole('radio', { name: 'repo' })).toBeVisible(); // the scratch project
    await expect(capsule).toBeInViewport(); // follow mode keeps it in view as the notice grows the composer (E11)
    await shoot(s, 'capsule-pending');

    // the attention item: in Needs you and on the session's Overview card, compact, with its one button
    const needsYou = sidebarOf(s.page).getByRole('list', { name: 'Needs you' });
    await expect(needsYou.getByRole('button').filter({ hasText: 'Question' })).toHaveCount(1);
    await s.maws.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('tab.overview')?.click());
    const overview = s.page.locator('[data-region="main"]').getByRole('dialog', { name: 'Overview' });
    const card = overview.getByRole('article').filter({ hasText: 'Questions from the agent' });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('5 questions');
    await expect(card.getByRole('button', { name: 'Open the Question sheet' })).toBeVisible();
    await shoot(s, 'attention');
    await s.page.keyboard.press('Escape');
    await expect(overview).toHaveCount(0);

    // every modality filled: a radio, checkboxes with Other, a typed text then skipped, the native folder pick, a
    // project picked then delegated
    await sectionOf(sheet, 'q1').getByRole('radio', { name: 'Blue' }).click();
    await sectionOf(sheet, 'q2').getByRole('checkbox', { name: 'Mon' }).click();
    await sectionOf(sheet, 'q2').getByRole('checkbox', { name: 'Wed' }).click();
    await sectionOf(sheet, 'q2').getByRole('checkbox', { name: 'Other…' }).click();
    await sectionOf(sheet, 'q2').getByRole('textbox').fill('Fri');
    await sectionOf(sheet, 'q3').getByRole('textbox').fill('A title I will not send');
    await sectionOf(sheet, 'q3').getByRole('button', { name: 'Skip' }).click();
    const assets = join(s.repo, 'assets');
    await setPick(s, assets);
    await sectionOf(sheet, 'q4').getByRole('button', { name: 'Choose folder…' }).click();
    await expect(sectionOf(sheet, 'q4').getByRole('list')).toHaveText(assets);
    await sectionOf(sheet, 'q5').getByRole('radio', { name: 'repo' }).click();
    await sectionOf(sheet, 'q5').getByRole('button', { name: 'Decide for me' }).click();
    await shoot(s, 'sheet');
    await clearToasts(s.page);
    await sheet.getByRole('button', { name: 'Submit · 1 skipped' }).click();

    const text = (questionId: string) => opened!.questions.find((q) => q.id === questionId)!.question;
    expect(await answersWritten(s, id, opened!.requestId)).toEqual([
      { id: 'q1', question: text('q1'), status: 'answered', value: ['Blue'] },
      { id: 'q2', question: text('q2'), status: 'answered', value: ['Mon', 'Wed'], otherText: 'Fri' },
      { id: 'q3', question: text('q3'), status: 'skipped' },
      { id: 'q4', question: text('q4'), status: 'answered', value: [assets] },
      { id: 'q5', question: text('q5'), status: 'decide_for_me' },
    ]);
    await expect(capsule).toHaveAttribute('data-ask-state', 'answered');
    await expect(capsule.locator('[data-ask-chip]')).toHaveText('Answered');
    await expect(sheet).toContainText('No open questions');
    // the attention item went at Submit
    await expect(needsYou.getByRole('button').filter({ hasText: 'Question' })).toHaveCount(0);
    expect(value(await invoke(s.page, 'attention.list', undefined)).filter((item) => item.appSessionId === id && item.state === 'pending')).toEqual([]);
    await idle(s, id);
    await shoot(s, 'capsule-answered');

    // View answers reopens the ask read-only from the capsule's own data
    await capsule.getByRole('button', { name: 'View answers' }).click();
    const readOnly = sheet.locator('[data-ask-readonly]');
    await expect(readOnly).toBeVisible();
    await expect(sectionOf(readOnly, 'q1')).toContainText('Blue');
    await expect(sectionOf(readOnly, 'q3')).toContainText('Skipped');
    await expect(sheet.getByRole('button', { name: /^Submit/ })).toHaveCount(0);
  });
});

// ---- G6: the host holds the ask across a renderer reload ------------------------------------------------------------

test('a reload mid-ask: the sheet lists the ask again from the host and Submit answers it; after another reload View answers reopens it read-only', async () => {
  await scene({ titles: ['E1 tools: reload'] }, async (s) => {
    const [id] = s.ids;
    await show(s, id);
    await replay(s, id, ASK_BLOCKING);
    await allowNext(s, id);
    const capsule = capsuleOf(s);
    await expect(capsule).toHaveAttribute('data-ask-state', 'pending');
    const askId = (await capsule.getAttribute('data-ask-id'))!;
    await expect(sheetOf(s)).toHaveAttribute('data-ask-id', askId);

    await s.page.reload();
    await recordEvents(s.page);
    const sheet = sheetOf(s);
    await expect(sheet).toHaveAttribute('data-ask-id', askId, { timeout: 20_000 }); // the restored tab reads maws.asks.list
    await expect(capsuleOf(s)).toHaveAttribute('data-ask-state', 'pending');
    const [pending] = value(await invoke(s.page, 'maws.asks.list', { appSessionId: id as never })).asks;
    expect(pending).toMatchObject({ askId, blocking: true });

    // this time the text is typed and the project chosen; the rest delegated or skipped
    await sectionOf(sheet, 'q1').getByRole('button', { name: 'Decide for me' }).click();
    await sectionOf(sheet, 'q3').getByRole('textbox').fill('Release notes');
    await sectionOf(sheet, 'q5').getByRole('radio', { name: 'repo' }).click();
    await clearToasts(s.page);
    await sheet.getByRole('button', { name: 'Submit · 2 skipped' }).click();
    const text = (questionId: string) => pending!.questions.find((q) => q.id === questionId)!.question;
    expect(await answersWritten(s, id, pending!.requestId)).toEqual([
      { id: 'q1', question: text('q1'), status: 'decide_for_me' },
      { id: 'q2', question: text('q2'), status: 'skipped' },
      { id: 'q3', question: text('q3'), status: 'answered', value: 'Release notes' },
      { id: 'q4', question: text('q4'), status: 'skipped' },
      { id: 'q5', question: text('q5'), status: 'answered', value: s.repo, name: 'repo' },
    ]);
    await expect(capsuleOf(s)).toHaveAttribute('data-ask-state', 'answered');
    await idle(s, id);

    await s.page.reload();
    const capsule2 = capsuleOf(s);
    await expect(capsule2).toHaveAttribute('data-ask-state', 'answered', { timeout: 20_000 });
    await capsule2.getByRole('button', { name: 'View answers' }).click();
    const readOnly = sheetOf(s).locator('[data-ask-readonly]');
    await expect(readOnly).toBeVisible();
    await expect(sectionOf(readOnly, 'q3')).toContainText('Release notes');
    await expect(sectionOf(readOnly, 'q5')).toContainText('repo');
    await expect(sheetOf(s).getByRole('button', { name: /^Submit/ })).toHaveCount(0);
  });
});

// ---- G6: a stop with an ask pending cancels it ---------------------------------------------------------------------

// The ask lost with the process is counted as a question lost (exit parity with an AskUserQuestion; M5 fix): on the
// transcript's exit row and in the session's interrupted attention item.
test('a stop with a blocking ask pending: the capsule reads cancelled, the exit names a question lost, and the journal holds maws_ask_cancelled before the exit', async () => {
  await scene({ titles: ['E1 tools: stop'] }, async (s) => {
    const [id] = s.ids;
    await show(s, id);
    await replay(s, id, ASK_BLOCKING);
    await allowNext(s, id);
    const capsule = capsuleOf(s);
    await expect(capsule).toHaveAttribute('data-ask-state', 'pending');
    value(await invoke(s.page, 'session.stop', { appSessionId: id as never, reason: 'stop' }));
    await expect(capsule).toHaveAttribute('data-ask-state', 'cancelled');
    await expect(capsule.locator('[data-ask-chip]')).toHaveText('Cancelled, the session ended');
    await expect(sheetOf(s)).toContainText('This session ended before you answered');
    await expect(s.pane.locator('[data-scope="exit"]')).toHaveText('Session process exited (stop) · 1 question lost');
    await expect
      .poll(async () => value(await invoke(s.page, 'attention.list', undefined)).filter((item) => item.appSessionId === id).map((item) => [item.kind, item.summary]))
      .toEqual([['interrupted', 'Session interrupted, 1 question lost']]);
    const meta = metaEvents(s.journal(id));
    expect(meta).toContain('maws_ask_cancelled');
    expect(meta.indexOf('maws_ask_cancelled')).toBeLessThan(meta.lastIndexOf('exit'));
  });
});

// ---- the architect's ruling 2: an ask from a session not shown -----------------------------------------------------

test('an ask from a session not shown never switches the main view; its sheet opens when that session is selected', async () => {
  await scene({ titles: ['E1 tools: shown', 'E1 tools: asking'] }, async (s) => {
    const [shown, asking] = s.ids;
    await show(s, shown);
    await replay(s, asking, ASK_BLOCKING);
    // the asking session's permission, answered through its card on the Overview (it is not docked anywhere shown)
    await expect.poll(async () => ofKind(await s.events(asking), 'permission.requested').length, { timeout: 30_000 }).toBe(1);
    await s.maws.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('tab.overview')?.click());
    const overview = s.page.locator('[data-region="main"]').getByRole('dialog', { name: 'Overview' });
    const approval = overview.getByRole('article').filter({ has: s.page.getByRole('radio', { name: 'Allow once' }) });
    await approval.getByRole('radio', { name: 'Allow once' }).click();
    await approval.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect.poll(async () => ofKind(await s.events(asking), 'maws.ask.opened').length, { timeout: 30_000 }).toBe(1);
    await expect(overview.getByRole('article').filter({ hasText: 'Questions from the agent' })).toHaveCount(1);
    await s.page.keyboard.press('Escape');

    // nothing moved: the main view still shows the first session, and no sheet opened for the other
    const [opened] = ofKind(await s.events(asking), 'maws.ask.opened');
    await s.page.waitForTimeout(500);
    await expect(s.pane.locator(`[data-composer="${shown}"]`)).toBeVisible();
    await expect(s.pane.locator(`[data-composer="${asking}"]`)).toHaveCount(0);
    await expect(sheetOf(s)).toHaveCount(0);
    await expect(sidebarOf(s.page).getByRole('list', { name: 'Needs you' }).getByRole('button').filter({ hasText: 'Question' })).toHaveCount(1);

    // the person goes to the asking session: its sheet opens on the ask
    await show(s, asking);
    await expect(sheetOf(s)).toHaveAttribute('data-ask-id', opened!.askId);
    await expect(capsuleOf(s)).toHaveAttribute('data-ask-state', 'pending');
    await clearToasts(s.page);
    await sheetOf(s).getByRole('button', { name: 'Submit · 5 skipped' }).click();
    await expect(capsuleOf(s)).toHaveAttribute('data-ask-state', 'answered');
    await idle(s, asking);
  });
});

// ---- G4: an async ask -----------------------------------------------------------------------------------------------

test('an async ask: acknowledged at once, an async_input item while it waits (P2-C2), Submit sends the recorded steer and retires the item, and the capsule turns answered across the second turn', async () => {
  await scene({ titles: ['E1 tools: async ask'] }, async (s) => {
    const [id] = s.ids;
    await show(s, id);
    await replay(s, id, ASK_ASYNC);
    await allowNext(s, id); // mcp__maws__ask (seq 97)

    const capsule = capsuleOf(s);
    await expect(capsule).toHaveAttribute('data-ask-state', 'asked');
    await expect(capsule.locator('[data-ask-chip]')).toHaveText('Asked, answer when ready');
    const [opened] = ofKind(await s.events(id), 'maws.ask.opened');
    expect(opened).toMatchObject({ blocking: false });
    // the acknowledgement was the host's answer at once
    expect(JSON.parse(resultText(mcpResultOf(s.journal(id), opened!.requestId)!))).toEqual({ status: 'asked', askId: opened!.askId });
    // P2-C2 (the P2 spec's Decision Log 32, reversing E1's "no item for an async ask"): the question waits as an
    // `async_input` item, anchored to the ask by its request, until the answer is committed
    const items = async () => value(await invoke(s.page, 'attention.list', undefined)).filter((item) => item.appSessionId === id);
    await expect.poll(async () => (await items()).map((item) => [item.kind, item.state, item.request.requestId])).toEqual([['async_input', 'pending', opened!.requestId]]);

    const sheet = sheetOf(s);
    await expect(sheet).toHaveAttribute('data-ask-id', opened!.askId);
    await sectionOf(sheet, 'q1').getByRole('radio', { name: 'Yes' }).click();
    await clearToasts(s.page);
    await sheet.getByRole('button', { name: 'Submit', exact: true }).click();

    // the steer written is the recorded one, word for word, at priority next
    const recorded = fixtureRows(ASK_ASYNC).find((r) => r.direction === 'out' && (r.frame as Frame).type === 'user' && (r.frame as Frame).priority === 'next')!.frame as { message: { content: string } };
    let steer: Frame | undefined;
    await expect
      .poll(() => (steer = s.journal(id).find((r) => r.direction === 'out' && (r.frame as Frame).type === 'user' && (r.frame as Frame).priority === 'next')?.frame as Frame | undefined) !== undefined, { timeout: 20_000 })
      .toBe(true);
    expect((steer!.message as { content: string }).content).toBe(recorded.message.content);
    expect(metaEvents(s.journal(id))).toContain('maws_ask_answered');
    await expect(capsule).toHaveAttribute('data-ask-state', 'answered');
    await expect.poll(items).toEqual([]); // P2-C2: retired at the committed answer
    expect(ofKind(await s.events(id), 'maws.ask.answered')).toMatchObject([{ askId: opened!.askId, delivery: 'steer', answers: [{ id: 'q1', status: 'answered', value: ['Yes'] }] }]);

    // two main turns (the recording's model ended its first before the answer arrived; Surprises): the reply is the second's
    await expect(s.pane.getByText(/ANSWER: Yes/).first()).toBeVisible({ timeout: 30_000 });
    await idle(s, id);
    const mainTurns = ofKind(await s.events(id), 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt);
    expect(mainTurns).toHaveLength(2);
    expect(mainTurns[1]!.resultText).toMatch(/^ANSWER: Yes/);
    await expect(capsule).toHaveAttribute('data-ask-state', 'answered');
  });
});

// ---- G5: show_pane --------------------------------------------------------------------------------------------------

test('show_pane: the Terminal opens in the panel, an artifact no record answers to and an unknown pane are error cells', async () => {
  await scene({ titles: ['E1 tools: show_pane'] }, async (s) => {
    const [id] = s.ids;
    await show(s, id);
    await replay(s, id, SHOW_PANE);
    await allowNext(s, id); // terminal (seq 68)
    const terminalTab = s.panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /Terminal/ });
    await expect(terminalTab).toHaveAttribute('aria-selected', 'true');
    await allowNext(s, id); // artifact (seq 85; E2's deliverable, the recording renamed by P3-L M6b)
    await allowNext(s, id); // nope (seq 100)
    await idle(s, id);

    // what the host answered: the renderer's Terminal, the renderer's "no artifact" (E2: the recording's target `none`
    // names no record; the recording itself carried "not available", and the replay compares no bodies), the host's
    // unknown pane
    const calls = mcpCalls(s.journal(id));
    expect(calls.map((c) => c.args)).toEqual([{ pane: 'terminal' }, { pane: 'artifact', target: 'none' }, { pane: 'nope' }]);
    const results = calls.map((c) => mcpResultOf(s.journal(id), c.requestId)!);
    expect(JSON.parse(resultText(results[0]!))).toMatchObject({ status: 'shown', pane: 'terminal', opened: { kind: 'panel-tool', toolId: 'terminal', title: 'Terminal' } });
    expect(results[1]).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.artifactNotFound('none') }], isError: true });
    expect(results[2]).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.unknownPane('nope') }], isError: true });
    expect(ofKind(await s.events(id), 'maws.pane.shown').map((e) => [e.pane, e.opened?.kind ?? null, e.error])).toEqual([
      ['terminal', 'panel-tool', null],
      ['artifact', null, TOOL_ERRORS.artifactNotFound('none')],
    ]);

    // the cells: what opened, and why nothing did twice
    await unfoldWork(s.pane);
    await expect(s.pane.getByText('Opened Terminal')).toBeVisible();
    // the cell reads the engine's tool_result, which the replay plays as recorded (E1's build answered "not available")
    await expect(s.pane.getByText('Could not open pane: the artifact pane is not available in this build of MAWS')).toBeVisible();
    await expect(s.pane.getByText(/Could not open pane: unknown pane "nope"/)).toBeVisible();
    await shoot(s, 'pane');
  });
});

// ---- G1 and G7 in the app: E0a's round trip ------------------------------------------------------------------------

test('the SDK MCP round trip: the app answers the engine’s handshake with the twelve tools and refuses the probe’s own tool', async () => {
  // The probe's journal: its scratch directory is the engine cwd, and from seq 96 on it holds at the probe's own writes,
  // which the app never makes (M1's decisions), so the case ends after the first turn.
  await scene({ titles: ['E1 tools: round trip'] }, async (s) => {
    const [id] = s.ids;
    await show(s, id);
    await replay(s, id, ROUNDTRIP);
    await allowNext(s, id); // mcp__maws__echo_file (seq 63)
    await idle(s, id);

    const rows = s.journal(id);
    const handshake = rows.filter((r) => r.direction === 'out' && (r.frame as Frame).type === 'control_response').map((r) => (r.frame as { response: { response?: { mcp_response?: { result?: { tools?: { name: string; annotations: unknown }[]; serverInfo?: { name: string } } } } } }).response.response?.mcp_response?.result).filter((r) => r !== undefined);
    expect(handshake.find((r) => r.serverInfo)?.serverInfo?.name).toBe('maws');
    expect(handshake.find((r) => r.tools)?.tools?.map((t) => [t.name, t.annotations])).toEqual([
      ['send_file', { title: 'Send file', readOnlyHint: true, openWorldHint: false }],
      ['ask', { title: 'Ask questions', readOnlyHint: true, openWorldHint: false }],
      ['show_pane', { title: 'Show pane', readOnlyHint: true, openWorldHint: false }],
      // E2: the artifact tools, listed from the first `tools/list`; the two writers are not read-only, so the engine never
      // batches them (E2 execution document, Decision Logs 3 and 4)
      ['artifact_create', { title: 'Create artifact', readOnlyHint: false, openWorldHint: false }],
      ['artifact_list', { title: 'List artifacts', readOnlyHint: true, openWorldHint: false }],
      ['artifact_screenshot', { title: 'Screenshot artifact', readOnlyHint: true, openWorldHint: false }],
      // E4c's six browser tools left on 2026-10-08 (P1 A-54): none listed. P3-A (M6): artifact_update retired into
      // artifact_publish, and the namespace's other tools appended
      ['artifact_describe_type', { title: 'Describe artifact kind', readOnlyHint: true, openWorldHint: false }],
      ['artifact_read', { title: 'Read artifact', readOnlyHint: true, openWorldHint: false }],
      ['artifact_publish', { title: 'Publish artifact', readOnlyHint: false, openWorldHint: false }],
      ['artifact_upload_asset', { title: 'Upload artifact asset', readOnlyHint: false, openWorldHint: false }],
      ['artifact_list_assets', { title: 'List artifact assets', readOnlyHint: true, openWorldHint: false }],
      ['artifact_export', { title: 'Export artifact', readOnlyHint: false, openWorldHint: false }],
    ]);
    const [echo] = mcpCalls(rows);
    expect(mcpResultOf(rows, echo!.requestId)).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.unknownTool('echo_file') }], isError: true });
    const [init] = ofKind(await s.events(id), 'session.init');
    expect(init!.mcpServers).toContainEqual({ name: 'maws', status: 'connected', source: 'sdk' });
  });
});
