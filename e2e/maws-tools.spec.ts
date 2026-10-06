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
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { AskAnswer } from '@shared/maws/tools';
import type { JournalRow } from '@shared/wire/journal';
import { TOOL_ERRORS } from '../src/shared/maws/tools';
import { invoke, launchReady, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { sidebarOf, sidebarRow } from './support/sidebar';

const PASS3 = 'spikes/protocol-probe/fixtures/pass3';
const SEND_FILE = `${PASS3}/p1-maws-send-file.jsonl`;
const ASK_BLOCKING = `${PASS3}/p1-maws-ask-blocking.jsonl`;
const ASK_ASYNC = `${PASS3}/p1-maws-ask-async.jsonl`;
const SHOW_PANE = `${PASS3}/p1-maws-show-pane.jsonl`;
const ROUNDTRIP = `${PASS3}/p1-sdk-mcp-roundtrip.jsonl`;

const SHOTS = process.env.MAWS_E1_SHOTS === '1' ? join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e1') : null;
const THEMES = ['light', 'dark'] as const;

test.describe.configure({ timeout: 120_000 });

// ---- fixtures and journals ------------------------------------------------------------------------------------------

type Frame = Record<string, unknown>;
const rowsOf = (path: string): JournalRow[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JournalRow);
const fixtureRows = (fixture: string) => rowsOf(join(REPO_ROOT, fixture));

// The fixture's recorded human prompt (the replay holds at it), and its `spawn` row's working directory.
const firstPrompt = (fixture: string) => ((fixtureRows(fixture).find((r) => r.direction === 'out' && (r.frame as Frame).type === 'user')!.frame as Frame).message as { content: string }).content;
const recordedCwd = (fixture: string) => (fixtureRows(fixture).find((r) => r.direction === 'meta' && (r.frame as Frame).event === 'spawn')!.frame as { cwd: string }).cwd;

// Every row the session's launches journaled (one file per launch, in the session's journal directory).
function journalOf(userData: string, id: string): JournalRow[] {
  const dir = join(userData, 'engine-host', 'journal', id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .flatMap((name) => rowsOf(join(dir, name)));
}

type McpResult = { content: { type: string; text: string }[]; isError?: boolean };
// The tool result the host wrote for the engine's `mcp_message` request `requestId`, or null while none is written.
function mcpResultOf(rows: JournalRow[], requestId: string): McpResult | null {
  for (const row of rows) {
    const frame = row.frame as { type?: string; response?: { request_id?: string; response?: { mcp_response?: { result?: McpResult } } } };
    if (row.direction === 'out' && frame.type === 'control_response' && frame.response?.request_id === requestId) return frame.response.response?.mcp_response?.result ?? null;
  }
  return null;
}
// The engine's `tools/call` requests of the `maws` server, in order: their request ids and arguments.
function mcpCalls(rows: JournalRow[]): { requestId: string; name: string; args: Record<string, unknown> }[] {
  return rows.flatMap((row) => {
    const frame = row.frame as { type?: string; request_id?: string; request?: { subtype?: string; message?: { method?: string; params?: { name: string; arguments: Record<string, unknown> } } } };
    if (row.direction !== 'in' || frame.type !== 'control_request' || frame.request?.subtype !== 'mcp_message' || frame.request.message?.method !== 'tools/call') return [];
    return [{ requestId: frame.request_id!, name: frame.request.message.params!.name, args: frame.request.message.params!.arguments }];
  });
}
const metaEvents = (rows: JournalRow[]) => rows.filter((r) => r.direction === 'meta').map((r) => (r.frame as { event: string }).event);

// ---- the scene: a scratch project, the product app over the replay ---------------------------------------------------

interface Scene {
  maws: MawsLaunch;
  page: Page;
  root: string;
  repo: string;
  openLog: string;
  ids: string[]; // the seeded sessions' app ids, in the order of `titles`
  pane: Locator; // the main region's first pane
  panel: Locator;
  journal(id: string): JournalRow[];
  events(id: string): Promise<SessionEvent[]>; // every event batch the window received for the session since it was last loaded
}

async function recordEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __e1?: { appSessionId: string; events: unknown[] }[] };
    if (w.__e1) return;
    const log: { appSessionId: string; events: unknown[] }[] = [];
    w.__e1 = log;
    window.maws.on('session.eventBatch', (payload) => log.push(payload as { appSessionId: string; events: unknown[] }));
  });
}

// `repo` defaults to a fresh scratch directory; the delivery case names the recording's own (finding 3 of the review).
async function scene(opts: { titles: string[]; repo?: string }, body: (s: Scene) => Promise<void>): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-e1-tools-')));
  const repo = opts.repo ?? join(root, 'repo');
  mkdirSync(join(repo, 'assets'), { recursive: true });
  const config = join(root, 'claude-config');
  const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  const engineIds = opts.titles.map((title, k) => {
    const sessionId = randomUUID();
    const first = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: title }, uuid: randomUUID(), timestamp: `2026-10-06T0${k}:00:00.000Z`, cwd: repo, sessionId, version: '2.1.291' };
    writeFileSync(join(project, `${sessionId}.jsonl`), `${JSON.stringify(first)}\n`);
    return sessionId;
  });
  const openLog = join(root, 'open.txt');
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0', MAWS_ENGINE_REPLAY: '1', CLAUDE_CONFIG_DIR: config, MAWS_E2E_OPEN_LOG: openLog } });
  try {
    const { page } = maws;
    await recordEvents(page);
    let ids: string[] = [];
    await expect
      .poll(async () => {
        const { sessions } = value(await invoke(page, 'session.list', {}));
        ids = engineIds.map((engineId) => sessions.find((s) => s.engineSessionId === engineId)?.appId ?? '');
        return ids.every((id) => id !== '');
      })
      .toBe(true);
    const s: Scene = {
      maws, page, root, repo, openLog, ids,
      pane: page.locator('[data-region="main"] [data-pane="0"]'),
      panel: page.locator('[data-region="panel"]'),
      journal: (id) => journalOf(maws.userData, id),
      events: (id) =>
        page.evaluate((appSessionId) => ((window as unknown as { __e1: { appSessionId: string; events: SessionEvent[] }[] }).__e1 ?? []).filter((b) => b.appSessionId === appSessionId).flatMap((b) => b.events), id),
    };
    await body(s);
    expect(maws.consoleErrors()).toEqual([]);
    // every replay followed its recording: a mismatch ends a replay early, which a case's own waits can miss (`idle`
    // also holds after an exit)
    for (const id of ids) expect(metaEvents(journalOf(maws.userData, id)), `the journal of ${id}`).not.toContain('replay_mismatch');
  } finally {
    await maws.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
}

// The session's row clicked (the main view shows it), the pointer moved off the sidebar so no hover card covers rows.
async function show(s: Scene, id: string): Promise<void> {
  await (await sidebarRow(s.page, { appSessionId: id })).click();
  await s.page.mouse.move(700, 20);
  await expect(s.pane.locator(`[data-composer="${id}"]`)).toBeVisible();
}

// The fixture launched under the session's id (with the scratch directory as its cwd) and its prompt sent as recorded.
async function replay(s: Scene, id: string, fixture: string): Promise<void> {
  await launchReady(s.page, id, fixture, { cwd: s.repo });
  value(await invoke(s.page, 'session.send', { appSessionId: id as never, content: firstPrompt(fixture) }));
}

const ofKind = <K extends SessionEvent['kind']>(events: SessionEvent[], kind: K) => events.filter((e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind);

// The next permission the session asks, allowed once through the real request card docked in the composer (the
// replay compares the response's behaviour: every fixture recorded `allow`).
async function allowNext(s: Scene, id: string): Promise<void> {
  const answered = ofKind(await s.events(id), 'permission.resolved').length;
  await expect.poll(async () => ofKind(await s.events(id), 'permission.requested').length, { timeout: 30_000 }).toBeGreaterThan(answered);
  const frame = s.pane.getByRole('group', { name: 'Approval needed' });
  await frame.getByRole('radio', { name: 'Allow once' }).click();
  await frame.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect.poll(async () => ofKind(await s.events(id), 'permission.resolved').length, { timeout: 30_000 }).toBe(answered + 1);
}

const turnOf = async (s: Scene, id: string) => value(await invoke(s.page, 'session.status', { appSessionId: id as never })).turn;
const idle = (s: Scene, id: string) => expect.poll(() => turnOf(s, id), { timeout: 60_000 }).toBeNull();

// The work of a completed turn folds behind its divider; the cells are read with it open.
async function unfoldWork(pane: Locator): Promise<void> {
  const divider = pane.locator('[data-kind="divider"]').last().locator('button[aria-expanded]').first();
  await expect(divider).toBeVisible();
  if ((await divider.getAttribute('aria-expanded')) === 'false') await divider.click();
}

// A toast ("<session> needs you") lands over the panel's bottom edge, where the sheet's Submit bar sits: cleared first.
// Every open toast dismissed, then none left open (a closing one still animates out over the bar), so the next click
// lands on the sheet.
async function clearToasts(page: Page): Promise<void> {
  const region = page.getByRole('region', { name: /^Notifications/ });
  const open = region.locator('li[data-state="open"]');
  await expect(async () => {
    for (const dismiss of await open.getByRole('button', { name: 'Dismiss' }).all()) await dismiss.click({ timeout: 2_000 }).catch(() => undefined);
    await expect(region.locator('li')).toHaveCount(0, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

async function shoot(s: Scene, surface: string): Promise<void> {
  if (SHOTS === null) return;
  await clearToasts(s.page);
  for (const theme of THEMES) {
    value(await invoke(s.page, 'settings.set', { theme }));
    await expect(s.page.locator('html')).toHaveAttribute('data-theme', theme);
    await s.page.waitForTimeout(150);
    await s.page.screenshot({ path: join(SHOTS, `e1-replay-${surface}-${theme}.png`) });
  }
  value(await invoke(s.page, 'settings.set', { theme: 'light' }));
  await expect(s.page.locator('html')).toHaveAttribute('data-theme', 'light');
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
  const parsed = JSON.parse(result!.content[0]!.text) as { status: string; askId: string; answers: AskAnswer[] };
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

      // the result the host wrote lists the deliverable it recorded, and the record is X12's
      const [call] = mcpCalls(s.journal(id));
      expect(call).toMatchObject({ name: 'send_file', args: { files: ['hello.txt'], caption: 'the greeting' } });
      const result = mcpResultOf(s.journal(id), call!.requestId)!;
      expect(result.isError).toBeUndefined();
      const delivered = JSON.parse(result.content[0]!.text) as { status: string; deliverables: { id: string; path: string; name: string }[] };
      expect(delivered).toMatchObject({ status: 'delivered', deliverables: [{ path, name: 'hello.txt' }] });
      const record = JSON.parse(readFileSync(join(s.maws.userData, 'deliverables', id, `${delivered.deliverables[0]!.id}.json`), 'utf8')) as Record<string, unknown>;
      expect(record).toMatchObject({ id: delivered.deliverables[0]!.id, appSessionId: id, kind: 'file', path, title: 'hello.txt', caption: 'the greeting', versions: [{ path }] });
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
    await capsule.scrollIntoViewIfNeeded();
    await expect(capsule).toBeVisible();
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

test('a stop with a blocking ask pending: the capsule reads cancelled and the journal holds maws_ask_cancelled before the exit', async () => {
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
    const meta = metaEvents(s.journal(id));
    expect(meta).toContain('maws_ask_cancelled');
    expect(meta.indexOf('maws_ask_cancelled')).toBeLessThan(meta.lastIndexOf('exit'));
    expect(meta).not.toContain('replay_mismatch');
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

test('an async ask: acknowledged at once, Submit sends the recorded steer, and the capsule turns answered across the second turn', async () => {
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
    expect(JSON.parse(mcpResultOf(s.journal(id), opened!.requestId)!.content[0]!.text)).toEqual({ status: 'asked', askId: opened!.askId });
    // no attention item for an async ask
    expect(value(await invoke(s.page, 'attention.list', undefined)).filter((item) => item.appSessionId === id)).toEqual([]);

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

test('show_pane: the Terminal opens in the panel, a pane this build lacks and an unknown pane are error cells', async () => {
  await scene({ titles: ['E1 tools: show_pane'] }, async (s) => {
    const [id] = s.ids;
    await show(s, id);
    await replay(s, id, SHOW_PANE);
    await allowNext(s, id); // terminal (seq 68)
    const terminalTab = s.panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /Terminal/ });
    await expect(terminalTab).toHaveAttribute('aria-selected', 'true');
    await allowNext(s, id); // deliverable (seq 85)
    await allowNext(s, id); // nope (seq 100)
    await idle(s, id);

    // what the host answered: the renderer's Terminal, the renderer's "not available", the host's unknown pane
    const calls = mcpCalls(s.journal(id));
    expect(calls.map((c) => c.args)).toEqual([{ pane: 'terminal' }, { pane: 'deliverable', target: 'none' }, { pane: 'nope' }]);
    const results = calls.map((c) => mcpResultOf(s.journal(id), c.requestId)!);
    expect(JSON.parse(results[0]!.content[0]!.text)).toMatchObject({ status: 'shown', pane: 'terminal', opened: { kind: 'panel-tool', toolId: 'terminal', title: 'Terminal' } });
    expect(results[1]).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.paneUnavailable('deliverable') }], isError: true });
    expect(results[2]).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.unknownPane('nope') }], isError: true });
    expect(ofKind(await s.events(id), 'maws.pane.shown').map((e) => [e.pane, e.opened?.kind ?? null, e.error])).toEqual([
      ['terminal', 'panel-tool', null],
      ['deliverable', null, TOOL_ERRORS.paneUnavailable('deliverable')],
    ]);

    // the cells: what opened, and why nothing did twice
    await unfoldWork(s.pane);
    await expect(s.pane.getByText('Opened Terminal')).toBeVisible();
    await expect(s.pane.getByText('Could not open pane: the deliverable pane is not available in this build of MAWS')).toBeVisible();
    await expect(s.pane.getByText(/Could not open pane: unknown pane "nope"/)).toBeVisible();
    await shoot(s, 'pane');
  });
});

// ---- G1 and G7 in the app: E0a's round trip ------------------------------------------------------------------------

test('the SDK MCP round trip: the app answers the engine’s handshake with the three tools and refuses the probe’s own tool', async () => {
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
    ]);
    const [echo] = mcpCalls(rows);
    expect(mcpResultOf(rows, echo!.requestId)).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.unknownTool('echo_file') }], isError: true });
    const [init] = ofKind(await s.events(id), 'session.init');
    expect(init!.mcpServers).toContainEqual({ name: 'maws', status: 'connected', source: 'sdk' });
  });
});
