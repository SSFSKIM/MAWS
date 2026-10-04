// C12's §10 pre-run (C12 execution document, M6, Acceptance item 12 and Concrete Steps "M6"): every §10 item an agent
// may run, driven through Playwright over the owner build (`pnpm e2e:packaged` names `dist/mac-arm64/MAWS.app`, which
// `launchMaws` honours) with the pinned engine behind ClaudeUsage's relay, under a scratch config home. Playwright
// drives only MAWS's own window: a blur, a focus and a native menu item's click go through Electron's API on that
// window, never desktop input. Each test records its numbers into `<scratch>/prerun-run.json` (copied into the pack as
// `docs/doperpowers/evidence/c12/prerun-run.json`) and its screenshots as `prerun-<item>-<surface>-<theme>.png`.
// Tests share one scratch and pass the sessions they make on through `<scratch>/prerun-state.json`, so one `-g` at a
// time reruns an item without the rest. Run on purpose only; it spends usage (the M6 limit is US$15, read from the
// journals and the terminal runs; MAWS_C12_PRERUN_MAX_USD, default 14, stops a test before it starts over that):
//   export C12=/private/tmp/maws-c12-prerun-$(date +%s) && export CLAUDE_CONFIG_DIR=$C12/config
//   mkdir -p $CLAUDE_CONFIG_DIR $C12/userData $C12/userData-real && printf '{}\n' > $CLAUDE_CONFIG_DIR/settings.json
//   pnpm build:app && MAWS_C12_PRERUN=1 MAWS_USER_DATA=$C12/userData pnpm e2e:packaged e2e/c12-prerun.spec.ts
//   MAWS_C12_PRERUN=1 MAWS_C12_REALSTORE=1 MAWS_USER_DATA=$C12/userData-real pnpm e2e:packaged e2e/c12-prerun.spec.ts -g 'real store, read only'
// The real-store case is the one read-only observation of the owner's store: it copies launchMaws's environment
// (MAWS_E2E=1 kept, so Chromium stays on a mock keychain) and deletes only CLAUDE_CONFIG_DIR; it launches no engine and
// mutates no session, commits only counts and timing, and keeps its screenshot under the scratch root.
import { hookStartedCommand, terminalPwdCommand } from '../test/support/prerun-commands';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { ENGINE_BIN as ENGINE_BIN_PATH } from '../test/support/engine-pin'; // W13: the fixtures' engine
import { writeScratchShellHome } from '../test/support/shell-home';
import { synthesise } from '../test/support/synth-transcript';
import { invoke, value } from './support/c7-replay';
import { collectConsoleErrors, launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { taskEnded, type TaskEventLike } from './support/c12-task-end';
import { newChatIn, openProject, projectRow, showProjectList, sidebarRow } from './support/sidebar';
import {
  captureLoginShell, EVIDENCE, journalSpend, lsPin, ownerFileCheck, prerunScratch, prerunSkipReason, printRun, ptyEngine, recorder, scratchRepo, shoot, stateOf,
  terminalEnv, transcriptFile, transcriptUsdEstimate, trustInScratch, git,
  type PrerunScratch,
} from './support/c12-prerun';

const skip = prerunSkipReason();
test.skip(skip !== null, skip ?? '');
test.describe.configure({ timeout: 1_800_000 });

const REALSTORE = process.env.MAWS_C12_REALSTORE === '1';
const MAX_USD = Number(process.env.MAWS_C12_PRERUN_MAX_USD ?? '14');

let scratch: PrerunScratch;
let rec: ReturnType<typeof recorder>;
let state: ReturnType<typeof stateOf>;

// What the run spent so far: every journal under the profile plus each terminal run's reported cost.
function spent(): { usd: number; journalsUsd: number; terminalUsd: number } {
  const journals = journalSpend(scratch.userData).usd;
  const terminal = Object.values((rec.read().terminalUsd ?? {}) as Record<string, number>).reduce((s, c) => s + c, 0);
  return { usd: Number((journals + terminal).toFixed(4)), journalsUsd: journals, terminalUsd: Number(terminal.toFixed(4)) };
}
function terminalCost(label: string, usd: number): void {
  const costs = (rec.read().terminalUsd ?? {}) as Record<string, number>;
  let key = label;
  for (let n = 2; key in costs; n++) key = `${label} (run ${n})`; // a rerun adds, never replaces
  rec.note('terminalUsd', { ...costs, [key]: usd });
}

test.beforeAll(async () => {
  scratch = prerunScratch();
  rec = recorder(scratch.root, REALSTORE ? 'prerun-realstore.json' : 'prerun-run.json');
  state = stateOf(scratch.root);
  if (!REALSTORE) rec.note('terminalLoginShellClaudeKeys', await captureLoginShell());
});

// The owner-file check and the pin's `ls -l` around every test, each read recorded; `[]` both times is the pass.
// eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
test.beforeEach(async ({}, testInfo) => {
  const before = ownerFileCheck(scratch.root);
  const checks = (rec.read().ownerFileCheck ?? {}) as Record<string, unknown>;
  rec.note('ownerFileCheck', { ...checks, [testInfo.title]: { before, after: null, pinBefore: lsPin(), pinAfter: null } });
  expect(before, 'no scratch path in the owner’s ~/.claude.json before the test').toEqual([]);
  if (!REALSTORE) {
    const s = spent();
    expect(s.usd, `spend limit: US$${s.usd} of US$${MAX_USD} already`).toBeLessThan(MAX_USD);
  }
});

// eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
test.afterEach(async ({}, testInfo) => {
  const after = ownerFileCheck(scratch.root);
  const checks = (rec.read().ownerFileCheck ?? {}) as Record<string, { before: string[] }>;
  rec.note('ownerFileCheck', { ...checks, [testInfo.title]: { ...checks[testInfo.title], after, pinAfter: lsPin() } });
  if (!REALSTORE) rec.note('spend', spent());
  // every window this test opened, closed or not: its console errors and uncaught errors from its first load on
  const errors = launches.splice(0).flatMap((read) => read());
  rec.note(`result:${testInfo.title}`, { status: testInfo.status, durationMs: testInfo.duration, consoleErrors: errors, error: testInfo.error?.message?.split('\n').slice(0, 4).join(' / ') ?? null });
  rec.publish();
  expect(after, 'no scratch path in the owner’s ~/.claude.json after the test').toEqual([]);
  expect(errors, 'no console error in any window the test opened').toEqual([]);
});

// The console-error readers of every launch in the current test, checked in afterEach.
const launches: (() => string[])[] = [];

// ---- the app -------------------------------------------------------------------------------------------------------

const main = (page: Page) => page.locator('[data-region="main"]');
const sidebar = (page: Page) => page.locator('[data-region="sidebar"]');
const panel = (page: Page) => page.locator('[data-region="panel"]');
const statusOf = async (page: Page, id: string) => value(await invoke(page, 'session.status', { appSessionId: id as AppSessionId }));
async function statusOrNull(page: Page, id: string): Promise<EngineSessionStatus | null> {
  const r = await invoke(page, 'session.status', { appSessionId: id as AppSessionId });
  return r.ok ? r.value : null;
}
const digests = async (page: Page) => value(await invoke(page, 'session.digests', undefined)).digests;
const digestOf = async (page: Page, id: string) => (await digests(page)).find((d) => d.appSessionId === id) ?? null;
const records = async (page: Page, includeArchived = false) => value(await invoke(page, 'session.list', { includeArchived })).sessions;

// A session's row (W11: its project expanded first), once the index lists the record: a fresh launch reads
// the store a moment after the window shows.
async function rowOf(page: Page, id: string): Promise<Locator> {
  await expect.poll(async () => (await records(page, true)).some((r) => r.appId === id), { timeout: 30_000 }).toBe(true);
  return sidebarRow(page, { appSessionId: id });
}

// A session row's hover card (W5: the row is one line; who holds a foreign session, the activity and the last answer
// are in its card), opened with the pointer from a neutral point: now and then Chromium keeps a stale hover state and
// the row sees no pointerenter, which a fresh move in fixes.
async function hoverCardOf(page: Page, id: string): Promise<Locator> {
  const row = await rowOf(page, id);
  const card = page.getByRole('dialog', { name: (await row.getAttribute('aria-label'))!, exact: true });
  await expect(async () => {
    await page.mouse.move(700, 400);
    await row.hover();
    await expect(card).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 10_000 });
  return card;
}

// The floating Overview (W5: no tab; the toolbar's button floats it over the main area), opened when it is not.
async function openOverview(page: Page): Promise<Locator> {
  const overview = main(page).getByRole('dialog', { name: 'Overview' });
  if (!(await overview.isVisible())) await page.getByRole('banner').getByRole('button', { name: /^Overview/ }).click();
  await expect(overview).toBeVisible();
  return overview;
}

// The owner build over the run's profile and scratch home, the window's console errors collected; the subagent model is
// Haiku in this profile (the settings row the owner's Settings › Engine carries), since no item needs the owner's model
// for its children.
async function open(extraEnv: Record<string, string> = {}): Promise<MawsLaunch> {
  const maws = await launchMaws({ userData: scratch.userData, env: { MAWS_E2E_ENGINE_BIN: ENGINE_BIN_PATH, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: scratch.config, ...extraEnv } });
  launches.push(maws.consoleErrors);
  await expect(main(maws.page)).toBeVisible({ timeout: 60_000 });
  value(await invoke(maws.page, 'settings.set', { engine: { subagentModel: 'haiku' } }));
  rec.note('build', { packaged: maws.packaged, executable: process.env.MAWS_E2E_EXECUTABLE ?? 'out/main/index.js' });
  return maws;
}

// The record C4 filed for an engine session in the scratch home.
async function recordOf(page: Page, sessionId: string, timeout = 30_000): Promise<SessionRecord> {
  let found: SessionRecord | undefined;
  await expect.poll(async () => (found = (await records(page, true)).find((r) => r.engineSessionId === sessionId)) !== undefined, { timeout }).toBe(true);
  return found!;
}

// A project's session rows in the sidebar (W11: the project expanded in place; at most eight show).
async function projectRows(page: Page, projectName: string): Promise<string[]> {
  await showProjectList(page);
  await expect(projectRow(page, projectName)).toBeVisible({ timeout: 30_000 });
  await openProject(page, projectName);
  return projectRow(page, projectName)
    .locator('[role="treeitem"][data-kind="session"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-menu')!.replace(/^session:/, '')));
}

// ---- §10.1 ---------------------------------------------------------------------------------------------------------

test('§10.1 terminal-started sessions show under their projects, the live one foreign-live', async () => {
  test.skip(REALSTORE, 'the real-store run takes only its own case');
  const north = scratchRepo(scratch.root, 'north');
  const south = scratchRepo(scratch.root, 'south');
  const made: Record<string, { sessionId: string; how: string; cwd: string }> = {};
  const a = printRun(scratch.config, north, 'Reply with exactly: NORTH ONE READY');
  terminalCost('10.1 north-one (-p)', a.costUsd);
  made.northOne = { sessionId: a.sessionId, how: 'claude -p', cwd: north };
  const b = printRun(scratch.config, south, 'Reply with exactly: SOUTH ONE READY');
  terminalCost('10.1 south-one (-p)', b.costUsd);
  made.southOne = { sessionId: b.sessionId, how: 'claude -p', cwd: south };
  const term = await ptyEngine(scratch.config, north, [], join(scratch.root, 'terminal-10.1.txt'));
  let maws: MawsLaunch | null = null;
  try {
    await term.say('Reply with exactly: NORTH LIVE READY');
    await term.replied(/NORTH LIVE READY/, 120_000);
    made.northLive = { sessionId: term.sessionId(), how: 'claude (interactive, in a PTY, kept live)', cwd: north };
    rec.note('10.1.sessions', made);
    for (const [k, v] of Object.entries(made)) state.set(`10.1.${k}`, v.sessionId);

    maws = await open();
    const { page } = maws;
    const ids = Object.fromEntries(await Promise.all(Object.entries(made).map(async ([k, v]) => [k, (await recordOf(page, v.sessionId)).appId] as const)));
    for (const [k, id] of Object.entries(ids)) state.set(`10.1.${k}.appId`, id);
    const northRows = await projectRows(page, 'north');
    const southRows = await projectRows(page, 'south');
    expect(northRows.sort()).toEqual([ids.northOne!, ids.northLive!].sort());
    expect(southRows).toEqual([ids.southOne!]);
    const liveRow = await rowOf(page, ids.northLive!);
    await expect(liveRow.getByRole('img', { name: 'Live in terminal' })).toBeVisible({ timeout: 20_000 });
    // W5: the holder line left the one-line row for its hover card.
    const liveCard = await hoverCardOf(page, ids.northLive!);
    await expect(liveCard.getByTestId('hover-activity')).toHaveText(`Terminal · pid ${term.pid}`);
    await main(page).hover({ position: { x: 400, y: 300 } });
    await expect(liveCard).toHaveCount(0);
    await expect.poll(async () => (await digestOf(page, ids.northLive!))?.phase, { timeout: 20_000 }).toBe('foreign');
    const phases = Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([k, id]) => [k, (await digestOf(page, id))?.phase ?? null] as const)));
    const board = (await openOverview(page)).getByRole('list', { name: 'Overview' });
    await expect(board.locator(`[data-card="${ids.northLive}"]`).getByTestId('card-activity')).toHaveText(`Terminal · pid ${term.pid}`);
    rec.note('10.1', {
      projects: { north: northRows.length, south: southRows.length }, phases, liveRowLine: `Terminal · pid ${term.pid}`, overviewCard: 'foreign card with the holder line',
      screenshots: await shoot(page, '10.1-overview'),
      consoleErrors: maws.consoleErrors(),
    });
  } finally {
    await maws?.cleanup();
    await term.exit();
  }
});

// ---- §10.1, the owner's store, read only ------------------------------------------------------------------------------

test('§10.1 real store, read only', async () => {
  test.skip(!REALSTORE, 'the real-store case runs alone, under MAWS_C12_REALSTORE=1 with its own userData');
  const executable = process.env.MAWS_E2E_EXECUTABLE ? resolve(REPO_ROOT, process.env.MAWS_E2E_EXECUTABLE) : null;
  expect(executable, 'the real-store case runs over the owner build (pnpm e2e:packaged)').not.toBeNull();
  // launchMaws's environment (e2e/support/launch.ts), with only CLAUDE_CONFIG_DIR deleted.
  const env: Record<string, string> = {};
  for (const [key, v] of Object.entries(process.env)) if (v !== undefined) env[key] = v;
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  env.MAWS_E2E = '1';
  env.MAWS_USER_DATA = scratch.userData;
  env.MAWS_CLAUDE_USAGE_DIR = join(scratch.userData, 'claude-usage');
  Object.assign(env, writeScratchShellHome(join(scratch.userData, 'shell-home')).env);
  env.MAWS_HARNESS = '0';
  delete env.CLAUDE_CONFIG_DIR;
  const outside = join(scratch.root, 'realstore');
  mkdirSync(outside, { recursive: true });

  const launchedAt = Date.now();
  const app: ElectronApplication = await _electron.launch({ executablePath: executable!, env, cwd: REPO_ROOT });
  try {
    const page = await app.firstWindow();
    const firstWindowMs = Date.now() - launchedAt;
    const errors = await collectConsoleErrors(page);
    launches.push(errors);
    await expect(main(page)).toBeVisible({ timeout: 60_000 });
    const shellMs = Date.now() - launchedAt;
    // W5: the app opens with no Overview shown; the first card is timed on the panel opened as soon as the shell shows.
    const board = (await openOverview(page)).getByRole('list', { name: 'Overview' });
    await expect(board.getByRole('article').first()).toBeVisible({ timeout: 120_000 });
    const firstCardMs = Date.now() - launchedAt;
    const projectList = sidebar(page).locator('[data-kind="project"]');
    await expect(projectList.first()).toBeVisible({ timeout: 120_000 });
    const firstProjectMs = Date.now() - launchedAt;
    // The index settles: the session count stops moving for 5 s.
    let last = -1;
    let stableSince = Date.now();
    const settleStart = Date.now();
    while (Date.now() - settleStart < 180_000) {
      const n = (await records(page)).length;
      if (n !== last) {
        last = n;
        stableSince = Date.now();
      }
      else if (Date.now() - stableSince >= 5_000) break;
      await page.waitForTimeout(500);
    }
    const settledMs = stableSince - launchedAt;
    const sessions = await records(page);
    const projects = value(await invoke(page, 'session.projects.list', undefined)).projects;
    const ds = await digests(page);
    const foreign = ds.filter((d) => d.phase === 'foreign').length;
    await showProjectList(page); // W11: five projects, then the rest behind "Show more"
    const projectRowsShown = await sidebar(page).locator('[data-kind="project"][data-menu^="project:"]').count(); // not Other sessions' row
    const cards = await board.getByRole('article').count();
    // W11: session rows show inside each expanded project (eight at most), so the foreign glyphs are counted project by
    // project (Other sessions too), each reached by its row's id, taken once: the list reorders as the owner's sessions
    // work. Each project is collapsed again after its count.
    let foreignGlyphs = 0;
    for (const key of await projectList.evaluateAll((els) => els.map((el) => el.getAttribute('data-tree-id')!))) {
      const project = sidebar(page).locator(`[data-kind="project"][data-tree-id="${key}"]`);
      const line = project.locator('[data-project-line]');
      const wasOpen = (await project.getAttribute('aria-expanded')) === 'true';
      if (!wasOpen) await line.click();
      await expect(project).toHaveAttribute('aria-expanded', 'true');
      foreignGlyphs += await project.getByRole('img', { name: /^Live (in terminal|as background job)$/ }).count();
      if (!wasOpen) await line.click();
    }
    await page.screenshot({ path: join(outside, 'prerun-10.1-realstore-light.png') });
    const engineSessions = value(await invoke(page, 'engine.sessions', undefined));
    rec.note('10.1.realstore', {
      counts: {
        projects: projects.length, projectsVisible: projects.filter((p) => !(p as { hidden?: boolean }).hidden).length, projectRowsShown, sessions: sessions.length,
        foreignLive: foreign, foreignGlyphsInSidebar: foreignGlyphs, overviewCards: cards,
      },
      timingMs: { firstWindow: firstWindowMs, shellVisible: shellMs, firstOverviewCard: firstCardMs, firstProjectRow: firstProjectMs, indexSettled: settledMs },
      engineSessionsAtEnd: engineSessions.length,
      screenshotOutsideRepo: 'realstore/prerun-10.1-realstore-light.png under the scratch root (shows the owner’s titles; not committed)',
      consoleErrors: errors().length,
    });
    expect(engineSessions, 'no engine launched').toEqual([]);
  } finally {
    await app.close().catch(() => app.process().kill('SIGKILL'));
  }
});

// ---- the composer, the "+" path and the cards ---------------------------------------------------------------------------

async function send(page: Page, text: string): Promise<void> {
  await main(page).getByRole('textbox', { name: 'Message' }).click();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
}

async function idle(page: Page, id: string, timeout = 240_000): Promise<void> {
  await expect
    .poll(async () => {
      const s = await statusOf(page, id);
      return s.process === 'ready' && s.turn === null && !s.busy && s.pendingRequests === 0;
    }, { timeout, intervals: [500] })
    .toBe(true);
}

async function addProject(page: Page, repo: string): Promise<void> {
  const known = value(await invoke(page, 'session.projects.list', undefined)).projects.some((p) => p.directory === repo);
  if (!known) value(await invoke(page, 'session.projects.add', { directory: repo }));
}

// "+" on the project, the unstarted tab's intent (Sonnet in the given mode, as the widgets write it), optionally a new
// worktree from the Location chip, the first message sent from the composer, the trust card answered when the folder is
// not yet trusted (a screenshot of it first when asked), and the session waited to `ready`.
async function plus(page: Page, repo: string, first: string, o: { mode?: string; worktree?: string; shootTrust?: string; requireTrust?: boolean; wait?: boolean } = {}): Promise<string> {
  const s = spent();
  if (s.usd >= MAX_USD) throw new Error(`spend limit: US$${s.usd} of US$${MAX_USD}`);
  await addProject(page, repo);
  const name = repo.split('/').at(-1)!;
  const known = new Set(value(await invoke(page, 'session.intent.list', undefined)).intents.map((i) => i.appSessionId));
  await newChatIn(page, name); // W11: the "+" on the project's row, on hover
  await expect(page.getByRole('heading', { name: `New chat in ${name}` })).toBeVisible();
  let id: AppSessionId | undefined;
  await expect.poll(async () => (id = value(await invoke(page, 'session.intent.list', undefined)).intents.find((i) => !known.has(i.appSessionId))?.appSessionId)).toBeDefined();
  value(await invoke(page, 'session.intent.patch', { appSessionId: id!, patch: { model: 'sonnet', permissionMode: (o.mode ?? 'default') as 'default' } }));
  if (o.worktree) {
    // New chat (2026-10-01): the Worktree checkbox names its worktree itself, so this named one is set on the intent
    value(await invoke(page, 'session.intent.patch', { appSessionId: id!, patch: { location: { kind: 'newWorktree', repoRoot: repo, name: o.worktree, branch: { kind: 'new', name: `worktree-${o.worktree}`, base: 'HEAD' } } } }));
    await expect(page.locator('[data-project-row]').getByRole('checkbox', { name: 'Worktree' })).toBeChecked();
  }
  await send(page, first);
  const card = page.getByRole('group', { name: 'Trust this folder?' });
  await expect.poll(async () => (await card.isVisible()) || (await statusOrNull(page, id!)) !== null, { timeout: 60_000 }).toBe(true);
  if (o.requireTrust) {
    // a fresh launch that passes through the card: no engine process for this session before Trust and start
    await expect(card, 'the trust card for an untrusted folder').toBeVisible();
    expect(await statusOrNull(page, id!), 'no launch before the trust card is answered').toBeNull();
  }
  if (await card.isVisible()) {
    if (o.shootTrust) rec.note(`${o.shootTrust}.screenshots`, await shoot(page, o.shootTrust));
    await card.getByRole('button', { name: 'Trust and start' }).click();
  }
  if (o.wait !== false) await expect.poll(async () => (await statusOrNull(page, id!))?.process ?? null, { timeout: 180_000 }).toBe('ready');
  return id!;
}

async function openRow(page: Page, id: string): Promise<void> {
  await (await rowOf(page, id)).click();
  await expect(main(page).locator(`[data-composer="${id}"]`)).toBeVisible({ timeout: 20_000 });
}

// The session's event log through `session.events`, read incrementally (C8b's live driver, trimmed): waits on events,
// and every permission request nobody else holds allowed once (children's scratch writes) and recorded.
type Ev = { id: string; kind: string; seq: number | null; at: string; agentId: string | null } & Record<string, unknown>;
class EventLog {
  events: Ev[] = [];
  private lastSeq: number | null = null;
  readonly stray: { toolName: string; agentId: string | null }[] = [];
  private answered = new Set<string>();
  constructor(readonly page: Page, readonly appId: string, readonly allowStray = true) {}
  async pull(): Promise<Ev[]> {
    const r = await invoke(this.page, 'session.events', { appSessionId: this.appId as AppSessionId, afterSeq: this.lastSeq, limit: null });
    if (!r.ok) return this.events;
    const v = r.value as unknown as { events: Ev[]; lastSeq: number | null };
    this.events.push(...v.events.filter((e) => e.seq === null || this.lastSeq === null || e.seq > this.lastSeq));
    if (v.lastSeq !== null) this.lastSeq = v.lastSeq;
    if (this.allowStray) {
      const resolved = new Set(this.events.filter((e) => e.kind === 'permission.resolved').map((e) => e.requestId as string));
      for (const e of this.events) {
        if (e.kind !== 'permission.requested' || resolved.has(e.requestId as string) || this.answered.has(e.requestId as string)) continue;
        this.answered.add(e.requestId as string);
        this.stray.push({ toolName: e.toolName as string, agentId: e.agentId });
        await invoke(this.page, 'session.answer', { appSessionId: this.appId as AppSessionId, requestId: e.requestId as never, answer: { kind: 'permission', decision: 'allow', scope: 'once' } as never });
      }
    }
    return this.events;
  }
  get seq(): number {
    return this.lastSeq ?? 0;
  }
  async until<T>(what: string, find: (events: Ev[]) => T | undefined | null | false, timeout = 180_000): Promise<T> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const found = find(await this.pull());
      if (found !== undefined && found !== null && found !== false) return found;
      if (Date.now() > deadline) throw new Error(`timed out after ${timeout / 1000} s waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  async idle(timeout = 300_000, quiet = 3_000): Promise<void> {
    const deadline = Date.now() + timeout;
    let since: number | null = null;
    for (;;) {
      await this.pull();
      const s = await statusOf(this.page, this.appId);
      if (s.turn === null && s.pendingRequests === 0 && !s.busy) {
        since ??= Date.now();
        if (Date.now() - since >= quiet) return;
      } else since = null;
      if (Date.now() > deadline) throw new Error('timed out waiting for the session to go idle');
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

const tabOf = (page: Page, name: string) => panel(page).locator('[role="tab"]').filter({ hasText: new RegExp(`^${name}`) });
async function showTool(page: Page, name: 'Subagents' | 'Background work' | 'Review' | 'Files' | 'Terminal' | 'Session info'): Promise<void> {
  if (name !== 'Terminal' && (await tabOf(page, name).count()) > 0) return tabOf(page, name).first().click();
  await panel(page).getByRole('button', { name: 'Add a tool' }).click();
  await page.getByRole('menuitem', { name }).click();
  await expect(tabOf(page, name).first()).toBeVisible();
}

function readJournal(path: string): { direction: string; frame: Record<string, unknown> }[] {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { direction: string; frame: Record<string, unknown> });
}
const initOf = (path: string) => readJournal(path).find((r) => r.direction === 'in' && r.frame.type === 'system' && r.frame.subtype === 'init')?.frame ?? null;

// What an init frame says loaded, in the terms §10.2 compares (C10's sentinel recipe's extraction, plus plugins).
function loaded(init: Record<string, unknown> | null) {
  if (!init) return null;
  const mcp = (init.mcp_servers as { name: string; status: string }[] | undefined) ?? [];
  const plugins = (init.plugins as { name: string }[] | undefined) ?? [];
  return {
    mcp: mcp.map((m) => `${m.name}:${m.status}`).sort(),
    commands: [...((init.slash_commands as string[] | undefined) ?? [])].sort(),
    agents: [...((init.agents as string[] | undefined) ?? [])].sort(),
    plugins: plugins.map((p) => p.name).sort(),
    mcpTools: ((init.tools as string[] | undefined) ?? []).filter((t) => t.startsWith('mcp__')).sort(),
    workflowTool: ((init.tools as string[] | undefined) ?? []).includes('Workflow'),
  };
}

function findFile(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    } else if (entry.name === name) return path;
  }
  return null;
}

// ---- §10.2 ---------------------------------------------------------------------------------------------------------

// C10's sentinel recipe (C10 execution document, Acceptance Setup), in a scratch repository: a project MCP server, a
// SessionStart hook, an allow rule, a plugin from a directory marketplace, all committed so every worktree carries them;
// workflows enabled for §10.4's workflow (project settings; the usage warning is a local setting, committed likewise).
function sentinelRepo(): string {
  const market = join(scratch.root, 'marketplace');
  if (!existsSync(market)) {
    mkdirSync(join(market, '.claude-plugin'), { recursive: true });
    writeFileSync(join(market, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'c12-market', owner: { name: 'C12' }, plugins: [{ name: 'c12-plugin', source: './c12-plugin', description: 'C12 sentinel plugin' }] }));
    mkdirSync(join(market, 'c12-plugin/.claude-plugin'), { recursive: true });
    writeFileSync(join(market, 'c12-plugin/.claude-plugin/plugin.json'), JSON.stringify({ name: 'c12-plugin', version: '0.0.1' }));
    mkdirSync(join(market, 'c12-plugin/commands'), { recursive: true });
    writeFileSync(join(market, 'c12-plugin/commands/c12-plugin-ping.md'), '---\ndescription: C12 plugin sentinel\n---\nReply with the word PLUGIN.\n');
    mkdirSync(join(scratch.root, 'hooks'), { recursive: true });
  }
  const settings = {
    permissions: { allow: ['Bash(echo C12_SENTINEL:*)'] },
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: hookStartedCommand(scratch.root) }] }] },
    enableAllProjectMcpServers: true,
    enableWorkflows: true,
    extraKnownMarketplaces: { 'c12-market': { source: { source: 'directory', path: market } } },
    enabledPlugins: { 'c12-plugin@c12-market': true },
  };
  return scratchRepo(scratch.root, 'deep', {
    'README.md': '# Deep (C12 pre-run scratch)\n\nThe relay agent reads this file between its sleeps.\n',
    'one.txt': 'ONE\n',
    '.claude/settings.json': `${JSON.stringify(settings, null, 2)}\n`,
    '.claude/settings.local.json': '{"skipWorkflowUsageWarning":true}\n',
    '.mcp.json': `${JSON.stringify({ mcpServers: { 'c12-sentinel': { command: process.execPath, args: [join(REPO_ROOT, 'spikes/protocol-probe/scenarios/pass2/elicit-mcp-server.mjs')] } } }, null, 2)}\n`,
  });
}

test('§10.2 a new worktree from "+", trust attested, project settings load as in the terminal', async () => {
  test.skip(REALSTORE, 'the real-store run takes only its own case');
  const repo = sentinelRepo();
  const maws = await open();
  const { page } = maws;
  try {
    await page.evaluate(() => {
      const log: unknown[] = [];
      (window as unknown as { __setup: unknown[] }).__setup = log;
      window.maws.on('session.setup', (e) => log.push(e));
    });
    const name = `deep-${Date.now().toString(36).slice(-4)}`; // a fresh worktree per run
    const markers = () => (existsSync(join(scratch.root, 'hooks')) ? readdirSync(join(scratch.root, 'hooks')) : []);
    const markersBefore = new Set(markers());
    const trustBefore = value(await invoke(page, 'session.trust.check', { directory: repo }));
    expect(trustBefore.trusted, 'the sentinel repository starts untrusted (a fresh scratch root)').toBe(false);
    const id = await plus(page, repo, 'Reply with exactly: DEEP READY', { mode: 'auto', worktree: name, shootTrust: '10.2-trust-card', requireTrust: true });
    await idle(page, id);
    const status = await statusOf(page, id);
    const worktree = join(repo, '.claude/worktrees', name);
    state.set('deep.branch', `worktree-${name}`);
    state.set('deep.appId', id);
    state.set('deep.worktree', worktree);
    state.set('deep.repo', repo);
    const record = value(await invoke(page, 'session.get', { appSessionId: id as AppSessionId }))!;
    state.set('deep.engineSessionId', record.engineSessionId ?? '');
    const mawsInit = loaded(initOf(status.journalPath));
    const mawsHooks = markers().filter((m) => !markersBefore.has(m)); // before the terminal runs
    // the terminal in the same worktree under the same home, after MAWS's trust step
    const terminal = printRun(scratch.config, worktree, 'Reply with exactly: TERMINAL OK', ['--setting-sources', 'user,project,local']);
    terminalCost('10.2 terminal compare (-p)', terminal.costUsd);
    const termInit = loaded(terminal.init);
    const setup = await page.evaluate(() => (window as unknown as { __setup: { appSessionId: string; phase: string }[] }).__setup);
    const worktrees = git(repo, 'worktree', 'list', '--porcelain');
    const hooks = markers().filter((m) => !markersBefore.has(m));
    const rules = value(await invoke(page, 'session.listPermissionRules', { appSessionId: id as AppSessionId }));
    // the attestation: main's trust read now finds the repository trusted in the scratch home's global config, and a
    // launch of this session carried `initialize.workspaceTrust` (C10's bootstrap carries it; the engine persists it)
    const trustAfter = value(await invoke(page, 'session.trust.check', { directory: worktree }));
    const journalDir = join(status.journalPath, '..');
    const attested = readdirSync(journalDir)
      .filter((f) => f.endsWith('.jsonl'))
      .flatMap((f) => readJournal(join(journalDir, f)))
      .filter((r) => r.direction === 'out' && r.frame.type === 'control_request' && (r.frame.request as { subtype?: string } | undefined)?.subtype === 'initialize')
      .map((r) => (r.frame.request as { workspaceTrust?: { accepted: boolean; directory: string } }).workspaceTrust ?? null)
      .filter((t) => t !== null);
    rec.note('10.2', {
      appSessionId: id, cwd: status.cwd, worktreeListed: worktrees.includes(worktree), branch: /branch refs\/heads\/(\S+)/.exec(worktrees.split('\n\n').find((b) => b.includes(worktree)) ?? '')?.[1] ?? null,
      setupPhases: setup.filter((e) => e.appSessionId === id).map((e) => e.phase), maws: mawsInit, terminal: termInit,
      same: { mcp: JSON.stringify(mawsInit?.mcp) === JSON.stringify(termInit?.mcp), commands: JSON.stringify(mawsInit?.commands) === JSON.stringify(termInit?.commands), agents: JSON.stringify(mawsInit?.agents) === JSON.stringify(termInit?.agents), plugins: JSON.stringify(mawsInit?.plugins) === JSON.stringify(termInit?.plugins) },
      commandsOnlyInMaws: mawsInit?.commands.filter((c) => !termInit?.commands.includes(c)) ?? [], commandsOnlyInTerminal: termInit?.commands.filter((c) => !mawsInit?.commands.includes(c)) ?? [],
      hookMarkers: { afterMaws: mawsHooks.length, afterTerminal: hooks.length }, allowRuleListed: JSON.stringify(rules).includes('Bash(echo C12_SENTINEL:*)'),
      trust: { before: { trusted: trustBefore.trusted }, after: { trusted: trustAfter.trusted, keyKind: trustAfter.keyKind, configInScratch: trustAfter.configPath.startsWith(scratch.config) }, workspaceTrustSent: attested },
      screenshots: await shoot(page, '10.2-session'),
      consoleErrors: maws.consoleErrors(),
    });
    expect(status.cwd).toBe(worktree);
    expect.soft(trustAfter.trusted, 'the repository reads trusted after Trust and start').toBe(true);
    expect.soft(trustAfter.configPath.startsWith(scratch.config), 'the trust was written to the scratch home').toBe(true);
    expect.soft(attested.some((t) => t.accepted === true), 'a launch carried initialize.workspaceTrust accepted').toBe(true);
    expect.soft(mawsHooks.length, 'the project SessionStart hook ran for MAWS’s launch').toBeGreaterThanOrEqual(1);
    expect.soft(hooks.length, 'and once more for the terminal run').toBeGreaterThan(mawsHooks.length);
    expect.soft(JSON.stringify(rules), 'the project allow rule is listed').toContain('Bash(echo C12_SENTINEL:*)');
    expect.soft(mawsInit?.mcp, 'MCP servers as the terminal loads them').toEqual(termInit?.mcp);
    expect.soft(mawsInit?.mcp).toContain('c12-sentinel:connected');
    expect.soft(mawsInit?.plugins, 'plugins as the terminal loads them').toEqual(termInit?.plugins);
    expect.soft(mawsInit?.agents, 'agents as the terminal loads them').toEqual(termInit?.agents);
    expect.soft(mawsInit?.commands, 'commands as the terminal loads them').toEqual(termInit?.commands);
  } finally {
    await maws.cleanup();
  }
});

// ---- §10.3 ---------------------------------------------------------------------------------------------------------

test('§10.3 from Overview cards: approve P, answer Q; R asks while the window is blurred (fallback notification); attention.next lands on R', async () => {
  test.skip(REALSTORE, 'the real-store run takes only its own case');
  const repos = { P: scratchRepo(scratch.root, 'proj-p'), Q: scratchRepo(scratch.root, 'proj-q'), R: scratchRepo(scratch.root, 'proj-r') };
  const maws = await open();
  const { page, app } = maws;
  try {
    await page.evaluate(() => {
      const log: unknown[] = [];
      (window as unknown as { __notified: unknown[] }).__notified = log;
      window.maws.on('attention.notified', (n) => log.push({ ...n, receivedAt: Date.now() }));
    });
    const P = await plus(page, repos.P, 'Use the Bash tool to run exactly this command and nothing else: touch c12-p.txt');
    await expect.poll(async () => (await statusOf(page, P)).pendingRequests, { timeout: 120_000 }).toBe(1);
    const Q = await plus(page, repos.Q, 'Use the AskUserQuestion tool to ask me which colour to use, with exactly two options, Red and Blue. Then reply with exactly the colour I chose.');
    await expect.poll(async () => (await statusOf(page, Q)).pendingRequests, { timeout: 120_000 }).toBe(1);

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.blur());
    const blurred = !(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isFocused())));
    const R = await plus(page, repos.R, 'Use the Bash tool to run exactly this command and nothing else: mkdir c12-r');
    await expect.poll(async () => (await statusOf(page, R)).pendingRequests, { timeout: 120_000 }).toBe(1);
    type Notified = { appSessionId: string; delivery: string };
    const notifiedNow = () => page.evaluate(() => (window as unknown as { __notified: { appSessionId: string; delivery: string }[] }).__notified);
    await expect.poll(async () => (await notifiedNow()).some((n: Notified) => n.appSessionId === R), { timeout: 20_000 }).toBe(true);
    const notified = await notifiedNow();

    const overview = await openOverview(page);
    const board = overview.getByRole('list', { name: 'Overview' });
    const cardP = board.locator(`[data-card="${P}"]`);
    const cardQ = board.locator(`[data-card="${Q}"]`);
    await expect(cardP.getByRole('button', { name: 'Allow', exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(cardQ.getByRole('button', { name: 'Submit' })).toBeVisible();
    const shotsCards = await shoot(page, '10.3-overview-cards');
    await cardP.getByRole('radio', { name: 'Allow once' }).click();
    await cardP.getByRole('button', { name: 'Allow', exact: true }).click();
    await cardQ.getByRole('radio', { name: 'Red' }).click();
    await cardQ.getByRole('button', { name: 'Submit' }).click();
    await idle(page, P);
    await idle(page, Q);
    const answeredP = existsSync(join(repos.P, 'c12-p.txt'));
    const qReply = (await digestOf(page, Q))?.lastAssistantLine ?? null;
    // W5: the Overview closed first, since it floats over the pane and its own card for R answers to the same names.
    await overview.getByRole('button', { name: 'Close Overview' }).click();
    await expect(overview).toHaveCount(0);

    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('attention.next')?.click());
    await expect(main(page).locator(`[data-composer="${R}"]`)).toBeVisible({ timeout: 10_000 });
    await expect(main(page).getByRole('group', { name: 'Approval needed' })).toBeVisible();
    const shotsNext = await shoot(page, '10.3-attention-next-r');
    const who = (id: string) => (id === R ? 'R' : id === P ? 'P' : id === Q ? 'Q' : 'other');
    rec.note('10.3', {
      sessions: { P, Q, R }, blurredBeforeR: blurred, notified: notified.map((n: Notified) => ({ session: who(n.appSessionId), delivery: n.delivery })),
      pTouched: answeredP, qReply, landedOn: 'R (its composer and approval card shown after the attention.next menu item)',
      attention: value(await invoke(page, 'attention.list', undefined)).map((i) => ({ session: who(i.appSessionId), kind: i.kind, state: i.state })),
      screenshots: [...shotsCards, ...shotsNext], consoleErrors: maws.consoleErrors(),
    });
    expect(blurred, 'the blur took').toBe(true);
    expect(notified.find((n: Notified) => n.appSessionId === R)?.delivery).toBe('fallback');
    expect(answeredP, 'P ran its approved command').toBe(true);
    expect(qReply ?? '').toMatch(/Red/i);
    // R's approval is denied so nothing is left pending at quit
    await main(page).getByRole('group', { name: 'Approval needed' }).getByRole('button', { name: 'Deny', exact: true }).click();
    await idle(page, R);
  } finally {
    await maws.cleanup();
  }
});

// ---- §10.4 ---------------------------------------------------------------------------------------------------------

// An item's record; a rerun of some pieces (MAWS_C12_PRERUN_PIECES) adds to the earlier record rather than replacing it.
function noteItem(item: string, v: Record<string, unknown>): void {
  const earlier = process.env.MAWS_C12_PRERUN_PIECES ? ((rec.read()[item] ?? {}) as Record<string, unknown>) : {};
  rec.note(item, { ...earlier, ...v, ...(process.env.MAWS_C12_PRERUN_PIECES ? { rerunPieces: process.env.MAWS_C12_PRERUN_PIECES } : {}) });
}

// Runs one piece of a multi-part item: a failure is recorded and the item goes on, so one live run reports every piece;
// the test fails at its end if any piece did.
function pieces(item: string) {
  const failures: string[] = [];
  return {
    failures,
    async step(name: string, body: () => Promise<void>): Promise<void> {
      // MAWS_C12_PRERUN_PIECES (a pattern) reruns only the matching pieces of an item
      const only = process.env.MAWS_C12_PRERUN_PIECES;
      if (only && !new RegExp(only).test(name)) return;
      try {
        await test.step(name, body);
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n').slice(0, 6).join(' / ') : String(error);
        failures.push(`${name}: ${message}`);
        rec.note(`${item}.failed:${name}`, message);
      }
    },
  };
}

// The session live again when it is not: the row's Resume (C10's resume path), the trust card answered if it shows.
async function ensureLive(page: Page, id: string): Promise<void> {
  const s = await statusOrNull(page, id);
  if (s && s.process === 'ready') return;
  await (await rowOf(page, id)).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Resume', exact: true }).click();
  const card = page.getByRole('group', { name: 'Trust this folder?' });
  await expect.poll(async () => (await card.isVisible()) || (await statusOrNull(page, id))?.process === 'ready', { timeout: 120_000 }).toBe(true);
  if (await card.isVisible()) await card.getByRole('button', { name: 'Trust and start' }).click();
  await expect.poll(async () => (await statusOrNull(page, id))?.process ?? null, { timeout: 180_000 }).toBe('ready');
}

const MONITOR_PROMPT = 'Use the Monitor tool (load it with ToolSearch if it is not listed) to watch the output of this command: for i in $(seq 1 60); do echo tick $i; sleep 5; done. Start it and reply with exactly the word WATCHING; do not wait for it. If the Monitor tool is not available, do nothing else and reply with exactly the words MONITOR UNAVAILABLE.';

const WORKFLOW_SCRIPT = `export const meta = { name: 'c12-prerun', description: 'Two echo agents in one phase', phases: [{ title: 'Echo' }] }
phase('Echo')
const out = await parallel([() => agent('Reply with exactly ALPHA and nothing else.', {label: 'alpha', effort: 'low'}), () => agent('Reply with exactly BETA and nothing else.', {label: 'beta', effort: 'low'})])
return out`;

test('§10.4 one deep session: a relay to a running background child, Review with This branch (G3), a Terminal in the worktree, a viewer tab, a workflow; Session info in the panel', async () => {
  test.skip(REALSTORE, 'the real-store run takes only its own case');
  const id = state.get('deep.appId');
  const worktree = state.get('deep.worktree');
  const branch = state.get('deep.branch');
  expect(id && worktree && branch, 'run §10.2 first: it makes the deep session').toBeTruthy();
  const maws = await open();
  const { page } = maws;
  const { step, failures } = pieces('10.4');
  const out: Record<string, unknown> = {};
  try {
    await ensureLive(page, id!);
    await openRow(page, id!);
    const log = new EventLog(page, id!);
    await log.pull();
    await page.evaluate(() => {
      const w = window as unknown as { __relay: { t: number; v: string }[]; __follow: unknown[] };
      w.__relay = [];
      w.__follow = [];
      window.maws.on('fs.followState', (e) => w.__follow.push({ ...e, t: Date.now() }));
      const scan = () => {
        const line = document.querySelector('[data-region="panel"] [data-part="relay-line"]');
        const v = line?.textContent?.trim() ?? '';
        if (w.__relay.at(-1)?.v !== v) w.__relay.push({ t: Date.now(), v });
      };
      new MutationObserver(scan).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    });

    await step('C8 gap 1: Session info is listed by "+" and opens from the summary’s model row', async () => {
      await panel(page).getByRole('button', { name: 'Add a tool' }).click();
      const items = await page.getByRole('menuitem').allTextContents();
      await page.keyboard.press('Escape');
      const env = panel(page).getByRole('region', { name: 'Environment' });
      await expect(env).toBeVisible({ timeout: 15_000 });
      await env.getByRole('button', { name: 'Session info' }).click();
      await expect(panel(page).locator(`[data-session-info="${id}"]`)).toBeVisible({ timeout: 15_000 });
      out.sessionInfo = { plusMenu: items, opensFromModelRow: true, screenshots: await shoot(page, '10.4-session-info') };
      expect(items).toContain('Session info');
    });

    const stop = join(scratch.root, `relay-stop-${Date.now().toString(36)}`);
    const inbox = join(scratch.root, 'relay-inbox.txt');
    let agentId = '';
    await step('the relay to a running background child', async () => {
      const from = log.seq;
      await send(page, `Dispatch one general-purpose agent in the background, model haiku, with this task: repeat rounds of Read README.md then "sleep 3" with Bash until the file ${stop} exists; whenever you receive a message from the user, append it to the file ${inbox} with Bash. Then reply DISPATCHED.`);
      const started = await log.until('the background child’s start', (ev) => ev.find((e) => e.seq !== null && e.seq > from && e.kind === 'subagent.started' && e.isBackground === true));
      agentId = started.taskId as string;
      await log.idle(180_000, 3_000);
      await showTool(page, 'Subagents');
      await panel(page).locator(`[data-agent-row="${agentId}"]`).click();
      const box = panel(page).locator('[data-view="agent"] textarea');
      await expect(box).toBeEnabled({ timeout: 15_000 });
      const text = `RELAY-C12-${Date.now().toString(36)}`;
      await box.fill(text);
      const sentFrom = log.seq;
      const sentAt = Date.now();
      await panel(page).locator('[data-view="agent"]').getByRole('button', { name: 'Send', exact: true }).click();
      const sendMessage = await log.until('the parent’s SendMessage', (ev) => ev.find((e) => e.seq !== null && e.seq > sentFrom && e.kind === 'tool.use' && e.agentId === null && e.toolName === 'SendMessage'), 240_000);
      const lines = () => page.evaluate(() => (window as unknown as { __relay: { t: number; v: string }[] }).__relay);
      const childEndedAt = () => log.events.find((e) => (e.kind === 'subagent.finished' || e.kind === 'task.notification') && e.taskId === agentId)?.at ?? null;
      // delivered: the forwarded line is cleared while the child still runs (a delivered relay is dismissed at once)
      let deliveredAt: number | null = null;
      let inboxAt: number | null = null;
      for (const until = Date.now() + 180_000; Date.now() < until; await page.waitForTimeout(1_000)) {
        await log.pull();
        if (inboxAt === null && existsSync(inbox) && readFileSync(inbox, 'utf8').includes(text)) inboxAt = Date.now();
        const h = (await lines()).filter((l) => l.t >= sentAt);
        const fwd = h.findIndex((l) => /sent it with SendMessage/.test(l.v));
        const cleared = fwd >= 0 ? h.slice(fwd + 1).find((l) => l.v === '') : undefined;
        if (cleared && deliveredAt === null) {
          const ended = childEndedAt();
          if (ended === null || Date.parse(ended) > cleared.t) deliveredAt = cleared.t;
        }
        if (deliveredAt !== null && inboxAt !== null) break;
        if (inboxAt !== null && Date.now() - inboxAt > 60_000) break;
      }
      const transcript = findFile(join(scratch.config, 'projects'), `agent-${agentId}.jsonl`);
      const attachment = transcript
        ? readFileSync(transcript, 'utf8').split('\n').filter((l) => l.includes(text)).map((l) => JSON.parse(l) as { type?: string; attachment?: { type?: string; origin?: unknown } }).map((r) => ({ type: r.type, attachment: r.attachment?.type ?? null, origin: r.attachment?.origin ?? null }))
        : null;
      const follow = (await page.evaluate(() => (window as unknown as { __follow: { agentId: string | null; state: string; t: number }[] }).__follow)).filter((f) => f.agentId === agentId).map((f) => ({ state: f.state, afterSendMs: f.t - sentAt }));
      const history = (await lines()).filter((l) => l.t >= sentAt - 1_000).map((l) => ({ ms: l.t - sentAt, v: l.v.replace(/ · \d+[smh][^·]*(?= · |$)/, ' · <elapsed>') }));
      out.relay = {
        agentId, text, sendMessageAfterMs: Date.parse(sendMessage.at) - sentAt, lineHistory: history, reached: deliveredAt !== null ? 'delivered' : 'forwarded',
        deliveredAfterMs: deliveredAt === null ? null : deliveredAt - sentAt, inboxAfterMs: inboxAt === null ? null : inboxAt - sentAt, childTranscriptAttachment: attachment, followStates: follow,
        childEndedAt: childEndedAt(), screenshots: await shoot(page, '10.4-relay'),
      };
      writeFileSync(stop, '');
      await log.until('the child finished', () => childEndedAt(), 240_000);
      await log.idle(240_000);
      expect(inboxAt, 'the child received the relayed message (its inbox)').not.toBeNull();
      // C8-R: delivered live, or the permitted fallback: forwarded, with the child's disk attachment and the follow's state
      const forwardedLine = history.some((l) => /sent it with SendMessage/.test(l.v));
      const diskAttachment = (attachment ?? []).some((a) => a.attachment === 'queued_command');
      const following = follow.some((f) => f.state === 'following');
      expect(deliveredAt !== null || (forwardedLine && diskAttachment && following), `the relay reached delivered, or forwarded with the disk attachment and the follow (${JSON.stringify({ deliveredAt, forwardedLine, diskAttachment, following })})`).toBe(true);
    });
    writeFileSync(stop, '');

    await step('Review shows the session’s diff; This branch in the worktree (C8c G3)', async () => {
      await send(page, 'Use the Write tool to create a file named c12-deep.txt containing the single line DEEP, then reply with exactly the word CREATED.');
      await log.idle(180_000);
      await showTool(page, 'Review');
      await expect(panel(page).locator('[role="option"] button[data-path="c12-deep.txt"]')).toBeVisible({ timeout: 30_000 });
      const uncommitted = { header: await panel(page).locator('[data-review-header]').innerText(), footer: await panel(page).locator('[data-review-footer]').innerText() };
      const shotsUncommitted = await shoot(page, '10.4-review');
      git(worktree!, 'add', 'c12-deep.txt');
      git(worktree!, 'commit', '-qm', 'C12 pre-run deep file');
      await panel(page).locator('[data-chip="branch"]').click();
      await expect(panel(page).locator('[data-review-footer]')).toHaveText(`${branch} · Since main`, { timeout: 30_000 });
      await expect(panel(page).locator('[data-review-header]')).toContainText('1 file changed', { timeout: 30_000 });
      out.review = { uncommitted, thisBranch: { header: await panel(page).locator('[data-review-header]').innerText(), footer: await panel(page).locator('[data-review-footer]').innerText() }, screenshots: [...shotsUncommitted, ...(await shoot(page, '10.4-review-this-branch'))] };
    });

    await step('a Terminal opens in the session’s worktree', async () => {
      await showTool(page, 'Terminal');
      let ptys: { appSessionId: string | null; cwd: string; alive: boolean }[] = [];
      await expect.poll(async () => (ptys = value(await invoke(page, 'pty.list', undefined)).ptys as typeof ptys).some((p) => p.appSessionId === id && p.alive && p.cwd === worktree), { timeout: 30_000 }).toBe(true);
      const screen = panel(page).locator('[data-tool="terminal"] .xterm-screen').last();
      await screen.click();
      // the shell's own answer, typed into the tab (the terminal renders on a canvas, so its text is read from a file)
      const pwdFile = join(scratch.root, `terminal-pwd-${Date.now().toString(36)}.txt`);
      await page.keyboard.type(terminalPwdCommand(pwdFile));
      await expect.poll(() => (existsSync(pwdFile) ? readFileSync(pwdFile, 'utf8').trim() : ''), { timeout: 15_000 }).toBe(worktree);
      out.terminal = { ptyCwd: ptys.find((p) => p.appSessionId === id)?.cwd, pwdTypedInTheTab: readFileSync(pwdFile, 'utf8').trim(), screenshots: await shoot(page, '10.4-terminal') };
    });

    await step('a file opens in a viewer tab from Files', async () => {
      await showTool(page, 'Files');
      const files = panel(page).locator('[data-tool="files"]');
      const root = files.locator(`[role="treeitem"][data-kind="root"][data-path="${worktree}"]`);
      await expect(root).toBeVisible({ timeout: 15_000 });
      if ((await root.getAttribute('aria-expanded')) !== 'true') await root.click();
      await files.locator(`[data-path="${worktree}/one.txt"]`).click();
      await expect(page.locator(`[data-file-viewer][data-path="${worktree}/one.txt"]`)).toBeVisible({ timeout: 15_000 });
      out.viewer = { path: 'one.txt in the worktree', screenshots: await shoot(page, '10.4-viewer') };
    });

    await step('a workflow shows its phases and agents in Background work', async () => {
      const from = log.seq;
      value(await invoke(page, 'session.send', { appSessionId: id as AppSessionId, content: `Call the Workflow tool once with this exact script as the script parameter, then reply STARTED:\n\n${WORKFLOW_SCRIPT}` } as never));
      const started = await log.until('the workflow’s start', (ev) => ev.find((e) => e.seq !== null && e.seq > from && e.kind === 'task.started' && e.taskType === 'local_workflow'), 240_000);
      const taskId = started.taskId as string;
      await log.until('the workflow’s end', (ev) => ev.find((e) => e.kind === 'task.notification' && e.taskId === taskId), 300_000);
      await log.idle(240_000);
      await showTool(page, 'Background work');
      const card = panel(page).locator(`[data-workflow="${taskId}"]`);
      await expect(card).toBeVisible({ timeout: 20_000 });
      out.workflow = {
        taskId, title: await card.locator('h4').innerText(), phases: await card.locator('[data-phase]').allInnerTexts(),
        agents: await card.locator('tbody tr').allInnerTexts(), screenshots: await shoot(page, '10.4-workflow'),
      };
      expect((out.workflow as { phases: string[] }).phases.join(' ')).toContain('Echo');
      expect((out.workflow as { agents: string[] }).agents.length).toBeGreaterThanOrEqual(2);
    });
    // C8's sitting item "a monitor started from a live session", run here so the owner's script carries a tested prompt
    await step('a monitor started from the live session shows in Background work and stops', async () => {
      // the viewer piece before this one leaves its file tab active in the main area, where no composer is, so the
      // session's own tab is opened again first, whichever pieces ran before
      await openRow(page, id!);
      const from = log.seq;
      await send(page, MONITOR_PROMPT);
      // the Monitor tool sits behind an engine feature gate (tengu_amber_sentinel, default off on 2.1.283), so the answer is
      // either a monitor task or the session saying the tool is not there; both are recorded, the second as unavailable
      const outcome = await log.until('the monitor’s start or the tool’s absence', (ev) => {
        const monitor = ev.find((e) => e.seq !== null && e.seq > from && e.kind === 'task.started' && String(e.taskType ?? '').startsWith('monitor'));
        if (monitor) return { monitor };
        const unavailable = ev.some((e) => e.seq !== null && e.seq > from && e.kind === 'assistant.block.complete' && e.agentId === null && JSON.stringify(e.block ?? '').includes('MONITOR UNAVAILABLE'));
        return unavailable ? { monitor: null } : null;
      }, 180_000);
      await log.idle(180_000);
      const searches = log.events.filter((e) => e.seq !== null && e.seq > from && e.kind === 'tool.use' && e.toolName === 'ToolSearch').map((e) => e.input);
      if (!outcome.monitor) {
        out.monitor = { prompt: MONITOR_PROMPT, available: false, toolSearches: searches, note: 'the engine offers no Monitor tool in this session (ToolSearch finds none); a feature gate of the engine, not MAWS' };
        return;
      }
      const taskId = outcome.monitor.taskId as string;
      await showTool(page, 'Background work');
      const row = panel(page).locator(`[data-monitor="${taskId}"]`);
      await expect(row).toBeVisible({ timeout: 20_000 });
      const line = await row.locator('[data-part="line"]').innerText();
      const shots = await shoot(page, '10.4-monitor');
      await row.getByRole('button', { name: 'Stop' }).click();
      // the end is a notification or a terminal status, never any other update (support/c12-task-end.ts)
      const ended = await log.until('the monitor’s end', (ev) => ev.find((e) => taskEnded(e as TaskEventLike, taskId, outcome.monitor!.seq!)), 60_000);
      await log.idle(180_000);
      await expect(row.getByRole('button'), 'the stopped row: no Stop (or stopping…) button, which shows only while it runs').toHaveCount(0, { timeout: 15_000 });
      out.monitor = { prompt: MONITOR_PROMPT, available: true, taskId, taskType: outcome.monitor.taskType, line, endedBy: ended.kind, lineAfterStop: await row.locator('[data-part="line"]').innerText(), screenshots: shots };
    });
    out.strayPermissionsAllowed = log.stray;
    out.consoleErrors = maws.consoleErrors();
  } finally {
    noteItem('10.4', { ...out, failures });
    await maws.cleanup();
  }
  expect(failures, 'every piece of §10.4').toEqual([]);
});

// ---- §10.5 ---------------------------------------------------------------------------------------------------------

test('§10.5 the archived deep session resumes from a terminal with claude --resume; a terminal-started session resumes in MAWS', async () => {
  test.skip(REALSTORE, 'the real-store run takes only its own case');
  const id = state.get('deep.appId');
  const worktree = state.get('deep.worktree');
  const engineId = state.get('deep.engineSessionId');
  const northOne = state.get('10.1.northOne.appId');
  expect(id && worktree && engineId && northOne, 'run §10.1 and §10.2 first').toBeTruthy();
  const maws = await open();
  const { page } = maws;
  const { step, failures } = pieces('10.5');
  const out: Record<string, unknown> = {};
  try {
    await step('archive the deep session', async () => {
      await (await rowOf(page, id!)).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
      const sheet = page.getByRole('dialog', { name: /^Archive “/ });
      await expect(sheet).toBeVisible();
      await sheet.getByRole('button', { name: 'Archive', exact: true }).click();
      await expect.poll(async () => (await records(page, true)).find((r) => r.appId === id)?.archived, { timeout: 30_000 }).toBe(true);
      const cleanup = page.getByRole('dialog');
      const offered = await cleanup.isVisible();
      out.archive = { archived: true, cleanupDialogOffered: offered, cleanupTitle: offered ? await cleanup.getAttribute('aria-label') : null };
      if (offered) await page.keyboard.press('Escape'); // the worktree stays for the terminal
    });

    await step('claude --resume in the worktree (the pinned 2.1.283 under the scratch home)', async () => {
      const since = Date.now();
      const term = await ptyEngine(scratch.config, worktree!, ['--resume', engineId!], join(scratch.root, 'terminal-10.5.txt'));
      try {
        await term.say('In one short sentence: what file did you create in this session, and what line does it hold?');
        const reply = await term.replied(/c12-deep/i, 180_000);
        out.terminalResume = { engineSessionId: engineId, reply, version: '2.1.283 (the pin, by absolute path); the owner’s `claude` on PATH is 2.1.285, so the owner’s step 5 resumes with a newer engine than MAWS’s' };
      } finally {
        await term.exit();
        const usd = transcriptUsdEstimate(transcriptFile(scratch.config, worktree!, engineId!), since);
        terminalCost('10.5 terminal --resume (PTY, estimate)', usd);
      }
    });

    await step('a terminal-started session resumes in MAWS (Resume on its row)', async () => {
      const t0 = Date.now();
      await ensureLive(page, northOne!);
      const readyMs = Date.now() - t0;
      await openRow(page, northOne!);
      await send(page, 'Reply with exactly: RESUMED IN MAWS');
      await idle(page, northOne!);
      const s = await statusOf(page, northOne!);
      const spawn = readJournal(s.journalPath).find((r) => r.direction === 'meta' && r.frame.event === 'spawn')?.frame as { args?: string[] } | undefined;
      out.mawsResume = { appSessionId: northOne, readyMs, spawnHasResume: spawn?.args?.includes('--resume') ?? false, reply: (await digestOf(page, northOne!))?.lastAssistantLine ?? null, screenshots: await shoot(page, '10.5-resumed-in-maws') };
      expect(spawn?.args ?? []).toContain('--resume');
      expect((out.mawsResume as { reply: string | null }).reply ?? '').toContain('RESUMED IN MAWS');
    });
    out.consoleErrors = maws.consoleErrors();
  } finally {
    noteItem('10.5', { ...out, failures });
    await maws.cleanup();
  }
  expect(failures, 'every piece of §10.5').toEqual([]);
});

// ---- §10.6 ---------------------------------------------------------------------------------------------------------

function quitLines(app: ElectronApplication): () => string[] {
  let text = '';
  app.process().stderr?.on('data', (chunk) => (text += String(chunk)));
  return () => text.split('\n').filter((l) => l.startsWith('quit-guard:') || l.startsWith('quit-report:'));
}

test('§10.6 in brief on the owner build: one release and its Send-to-resume; the quit question with a turn in flight, background work and a busy terminal', async () => {
  test.skip(REALSTORE, 'the real-store run takes only its own case');
  const repo = scratchRepo(scratch.root, 'budget');
  const maws = await open({ MAWS_E2E_QUIT_ANSWER: 'cancel' });
  const { page, app } = maws;
  const lines = quitLines(app);
  const { step, failures } = pieces('10.6');
  const out: Record<string, unknown> = {};
  const ids: string[] = [];
  let exited = false;
  try {
    for (const label of ['X1', 'X2', 'X3']) {
      ids.push(await plus(page, repo, `Reply with exactly the words ${label} READY and nothing else.`));
      await idle(page, ids.at(-1)!);
    }
    const [x1, x2, x3] = ids as [string, string, string];

    await step('one release under a lowered budget, then Send resumes it', async () => {
      await page.waitForTimeout(25_000); // two samples of C3's 10 s sampler: every idle tree measured and quiet
      const trees = (await value(await invoke(page, 'engine.sessions', undefined))).filter((s) => ids.includes(s.appSessionId)).map((s) => ({ id: s.appSessionId, kib: s.memory.treeRssKiB ?? 0 }));
      const sumMiB = trees.reduce((sum, t) => sum + t.kib, 0) / 1024;
      const budgetMiB = Math.max(512, Math.floor(sumMiB - Math.min(...trees.map((t) => t.kib)) / 1024 / 2));
      const at = Date.now();
      value(await invoke(page, 'settings.set', { engine: { memoryBudgetMiB: budgetMiB } }));
      await expect.poll(async () => (await statusOf(page, x1)).exit?.reason ?? null, { timeout: 30_000 }).toBe('budget');
      const releasedMs = Date.now() - at;
      value(await invoke(page, 'settings.set', { engine: { memoryBudgetMiB: null } }));
      await expect(await rowOf(page, x1)).toContainText('released', { timeout: 15_000 });
      const others = await Promise.all([x2, x3].map(async (i) => (await statusOf(page, i)).process));
      const attention = value(await invoke(page, 'attention.list', undefined)).filter((i) => i.appSessionId === x1).length;
      const shots = await shoot(page, '10.6-released');
      await openRow(page, x1);
      const t0 = Date.now();
      await send(page, 'Reply with exactly the words X1 BACK and nothing else.');
      await expect.poll(async () => (await statusOrNull(page, x1))?.process ?? null, { timeout: 60_000 }).toBe('ready');
      const resumeMs = Date.now() - t0;
      await idle(page, x1);
      const s = await statusOf(page, x1);
      const rows = readJournal(s.journalPath);
      const reconnect = rows.find((r) => r.direction === 'meta' && r.frame.event === 'reconnect' && (r.frame as { trigger?: string }).trigger === 'process_exit') !== undefined;
      out.release = {
        treesMiB: trees.map((t) => Math.round(t.kib / 102.4) / 10), sumMiB: Math.round(sumMiB), budgetMiB, releasedAfterSetMs: releasedMs, released: 'X1 (least recently used)', othersProcess: others,
        attentionItemsForX1: attention, sendToReadyMs: resumeMs, reconnectProcessExit: reconnect, userFrames: rows.filter((r) => r.direction === 'out' && r.frame.type === 'user').length,
        reply: (await digestOf(page, x1))?.lastAssistantLine ?? null, screenshots: [...shots, ...(await shoot(page, '10.6-resumed'))],
      };
      expect(others).toEqual(['ready', 'ready']);
      expect(attention).toBe(0);
      expect(reconnect).toBe(true);
      const release = out.release as { userFrames: number; reply: string | null };
      expect(release.userFrames, 'the message was delivered once (one user frame in the resumed launch)').toBe(1);
      expect(release.reply ?? '', 'the resumed session answered the message').toContain('X1 BACK');
    });

    await step('the quit question names a turn in flight, background work and a busy terminal; cancel, then quit when idle', async () => {
      await openRow(page, x2);
      await send(page, 'Use the Bash tool with run_in_background set to true to run exactly this command and nothing else: sleep 45. Do not wait for it; reply with exactly the word STARTED.');
      await expect.poll(async () => {
        const s = await statusOf(page, x2);
        return s.turn === null && s.backgroundTasks.some((t) => !t.ambient);
      }, { timeout: 180_000, intervals: [1_000] }).toBe(true);
      const { ptyId } = value(await invoke(page, 'pty.spawn', { appSessionId: x3 as AppSessionId, label: 'c12-prerun-quit', cwd: repo, cols: 80, rows: 24, shell: '/bin/sh', args: [], command: 'sleep 40' }));
      await expect.poll(async () => value(await invoke(page, 'pty.foreground', { ptyId })).busy).toBe(true);
      await openRow(page, x1);
      await send(page, 'Use the Bash tool to run exactly this command in the foreground and nothing else: sleep 30. Then reply with exactly the word SLEPT.');
      await expect.poll(async () => (await statusOf(page, x1)).turn !== null, { timeout: 60_000 }).toBe(true);

      await app.evaluate(({ app: a }) => a.quit());
      await expect.poll(() => lines().find((l) => l.includes('auto-answered cancel')) ?? '', { timeout: 20_000 }).toMatch(/mid-turn.*background work.*busy terminal/);
      const cancelled = lines().filter((l) => l.startsWith('quit-guard:') || l.startsWith('quit-report:'));
      expect((await statusOf(page, x1)).process, 'cancel keeps the app and its sessions').toBe('ready');

      await app.evaluate((_e, a) => {
        process.env.MAWS_E2E_QUIT_ANSWER = a;
      }, 'when_idle');
      const gone = new Promise<number>((resolve) => app.process().once('exit', () => resolve(Date.now())));
      await app.evaluate(({ app: a }) => a.quit());
      const banner = page.locator('[data-banner-host]').getByRole('status').filter({ hasText: 'MAWS will quit when' });
      await expect(banner).toBeVisible({ timeout: 20_000 });
      const bannerText = await banner.innerText();
      const shots = await shoot(page, '10.6-quit-when-idle');
      const waitFrom = Date.now();
      const exitAt = await Promise.race([gone, new Promise<number>((r) => setTimeout(() => r(-1), 240_000))]);
      exited = exitAt > 0;
      out.quit = { cancel: cancelled, whenIdle: lines().filter((l) => l.includes('when_idle')), banner: bannerText, quitAfterWaitMs: exited ? exitAt - waitFrom : null, screenshots: shots };
      expect(exited, 'the app quit once the turn, the background sleep and the terminal finished').toBe(true);
    });
  } finally {
    noteItem('10.6', { ...out, sessions: ids, failures });
    if (!exited) {
      await app.evaluate(() => {
        process.env.MAWS_E2E_QUIT_ANSWER = 'quit';
      }).catch(() => undefined);
    }
    await maws.cleanup();
  }
  expect(failures, 'every piece of §10.6').toEqual([]);
});

// ---- §10.7 ---------------------------------------------------------------------------------------------------------

// C6's seeded 500-turn session (test/support/synth-transcript.ts, the harness's `synthetic/500`) written as the engine's
// disk transcript under the scratch home: one record per block, chained by parentUuid, child-agent traffic left out.
function diskTranscript(cwd: string, sessionId: string, turns = 500, seed = 7): string {
  const lines: string[] = [];
  let parent: string | null = null;
  let n = 0;
  const push = (rec: Record<string, unknown>, at: string) => {
    const uuid = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    lines.push(JSON.stringify({ parentUuid: parent, isSidechain: false, uuid, timestamp: at, cwd, sessionId, version: '2.1.283', userType: 'external', ...rec }));
    parent = uuid;
  };
  for (const e of synthesise({ turns, seed }) as unknown as (Record<string, unknown> & { kind: string; agentId: string | null; at: string })[]) {
    if (e.agentId !== null) continue;
    if (e.kind === 'user.message') push({ type: 'user', message: { role: 'user', content: e.content } }, e.at);
    else if (e.kind === 'assistant.block.complete') push({ type: 'assistant', message: { id: e.apiMessageId, type: 'message', role: 'assistant', model: e.model, content: [e.block], stop_reason: null } }, e.at);
    else if (e.kind === 'tool.result') push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: e.toolUseId, content: e.content, is_error: e.isError }] }, ...(e.structured ? { toolUseResult: e.structured } : {}) }, e.at);
    else if (e.kind === 'turn.ended') push({ type: 'system', subtype: 'turn_duration', durationMs: e.durationMs, isMeta: false }, e.at);
  }
  return `${lines.join('\n')}\n`;
}

const scroller = (page: Page) => main(page).locator('[data-transcript-scroller]').first();
async function settle(page: Page, ms = 1_000): Promise<void> {
  let last = '';
  let since = Date.now();
  for (const until = Date.now() + 15_000; Date.now() < until; await page.waitForTimeout(100)) {
    const now = await scroller(page).evaluate((s) => `${s.scrollHeight}:${s.scrollTop}`);
    if (now !== last) {
      last = now;
      since = Date.now();
    }
    else if (Date.now() - since >= ms) return;
  }
}

test('§10.7 a 500-turn transcript stays anchored while old work expands; streaming never drags a reader; the owner’s three longest transcripts listed', async () => {
  test.skip(REALSTORE, 'the real-store run takes only its own case');
  const repo = scratchRepo(scratch.root, 'long');
  const sessionId = state.get('10.7.sessionId') ?? randomUUID();
  const file = join(scratch.config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
  if (!existsSync(file)) {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, diskTranscript(repo, sessionId));
    state.set('10.7.sessionId', sessionId);
  }
  const { step, failures } = pieces('10.7');
  const out: Record<string, unknown> = { transcript: { records: readFileSync(file, 'utf8').split('\n').filter(Boolean).length, turns: 500, generator: 'test/support/synth-transcript.ts synthesise({ turns: 500, seed: 7 }), written as disk records' } };

  await step('the owner’s three longest transcripts (read only, by record count)', async () => {
    const projects = join(homedir(), '.claude', 'projects');
    const counts: { path: string; records: number }[] = [];
    for (const dir of readdirSync(projects)) {
      const full = join(projects, dir);
      if (!existsSync(full) || !statSync(full).isDirectory()) continue; // a dangling link names no folder
      for (const f of readdirSync(full).filter((x) => x.endsWith('.jsonl'))) {
        const text = readFileSync(join(full, f), 'utf8');
        let lines = 0;
        for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lines++;
        counts.push({ path: `~/.claude/projects/${dir}/${f}`, records: lines });
      }
    }
    counts.sort((a, b) => b.records - a.records);
    out.ownerLongest = { listedAt: new Date().toISOString(), transcripts: counts.length, top: counts.slice(0, 5) };
  });

  const maws = await open();
  const { page } = maws;
  try {
    const record = await recordOf(page, sessionId, 60_000);
    await step('old work expands while scrolled mid-way; the anchor holds', async () => {
      await (await rowOf(page, record.appId)).click();
      await expect(scroller(page)).toBeVisible({ timeout: 30_000 });
      await settle(page, 2_000);
      const trials: Record<string, unknown>[] = [];
      for (const where of ['above', 'below'] as const) {
        // mid-way (a different point each trial), then the nearest collapsed turn centred in the viewport
        await scroller(page).evaluate((s, w) => (s.scrollTop = (s.scrollHeight - s.clientHeight) * (w === 'above' ? 0.5 : 0.4)), where);
        await settle(page);
        const button = await scroller(page).evaluate((s) => {
          const v = s.getBoundingClientRect();
          const mid = v.top + v.height / 2;
          const buttons = Array.from(s.querySelectorAll<HTMLButtonElement>('button.transcript-disclosure[aria-expanded="false"]'));
          const pick = buttons.sort((a, b) => Math.abs(a.getBoundingClientRect().top - mid) - Math.abs(b.getBoundingClientRect().top - mid))[0];
          if (!pick) return null;
          pick.setAttribute('data-c12-pick', '1');
          return pick.closest('[data-row-id]')?.getAttribute('data-row-id') ?? null;
        });
        if (button === null) {
          trials.push({ where, skipped: 'no collapsed turn rendered near the middle', disclosures: await scroller(page).locator('button.transcript-disclosure').count() });
          continue;
        }
        const pick = scroller(page).locator('[data-c12-pick="1"]');
        await pick.evaluate((b) => b.scrollIntoView({ block: 'center' }));
        await settle(page);
        // What the reader sees: the collapsed turn's divider they click (C6's own anchoring criterion: it stays put) and a
        // row 120 px above it (old work above the expansion must not move); measured once with no click first (the
        // baseline: the virtual list's own settling), then across the click.
        const measure = (rowId: string | null) =>
          scroller(page).evaluate((s, id) => {
            const b = s.querySelector('[data-c12-pick="1"]')!.getBoundingClientRect();
            let above = id ? s.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`) : null;
            if (!above) {
              const rows = Array.from(s.querySelectorAll<HTMLElement>('[data-row-id]')).filter((r) => r.getBoundingClientRect().bottom <= b.top);
              above = rows.sort((x, y) => Math.abs(x.getBoundingClientRect().top - (b.top - 120)) - Math.abs(y.getBoundingClientRect().top - (b.top - 120)))[0] ?? null;
            }
            return { divider: b.top, aboveId: above?.dataset.rowId ?? null, above: above?.getBoundingClientRect().top ?? null, scrollTop: s.scrollTop };
          }, rowId);
        const first = await measure(null);
        await page.waitForTimeout(1_000);
        const baseline = await measure(first.aboveId);
        await pick.click();
        await expect(pick).toHaveAttribute('aria-expanded', 'true');
        await settle(page);
        const after = await measure(first.aboveId);
        await pick.evaluate((b) => b.removeAttribute('data-c12-pick'));
        const d = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.abs(a - b));
        trials.push({
          at: where === 'above' ? '50%' : '40%', expanded: button, rowAbove: first.aboveId, before: baseline, after,
          baselineDriftPx: { divider: d(first.divider, baseline.divider), rowAbove: d(first.above, baseline.above) },
          driftPx: Math.max(d(baseline.divider, after.divider) ?? 0, d(baseline.above, after.above) ?? 0),
          dividerDriftPx: d(baseline.divider, after.divider), rowAboveDriftPx: d(baseline.above, after.above),
        });
      }
      out.anchoring = { trials, screenshots: await shoot(page, '10.7-long-transcript') };
      const drifts = trials.map((t) => t.driftPx).filter((d): d is number => typeof d === 'number');
      expect(drifts.length).toBeGreaterThan(0);
      for (const d of drifts) expect(d, 'anchor drift (px)').toBeLessThanOrEqual(1);
    });

    await step('a live answer streams while the reader is scrolled up; the offset does not move', async () => {
      const id = await plus(page, repo, 'Reply with exactly the word READY and nothing else.');
      await idle(page, id);
      await send(page, 'Write about 900 words on the history of lighthouses, as twelve numbered paragraphs of plain prose. No headings, no lists.');
      await expect.poll(async () => {
        const s = await statusOf(page, id);
        const tall = await scroller(page).evaluate((el) => el.scrollHeight > el.clientHeight + 700);
        return s.turn !== null && tall;
      }, { timeout: 120_000, intervals: [250] }).toBe(true);
      await scroller(page).evaluate((s) => s.scrollBy(0, -500));
      await expect(page.getByRole('button', { name: /^Jump to latest/ })).toBeVisible({ timeout: 5_000 });
      const readingAt = await scroller(page).evaluate((s) => s.scrollTop);
      let maxDelta = 0;
      let samples = 0;
      let grew = 0;
      const h0 = await scroller(page).evaluate((s) => s.scrollHeight);
      while ((await statusOf(page, id)).turn !== null) {
        const [top, h] = await scroller(page).evaluate((s) => [s.scrollTop, s.scrollHeight] as const);
        maxDelta = Math.max(maxDelta, Math.abs(top - readingAt));
        grew = h - h0;
        samples++;
        await page.waitForTimeout(100);
      }
      out.streaming = { scrolledUpPx: 500, samples, maxScrollDeltaPx: maxDelta, contentGrewPx: grew, screenshots: await shoot(page, '10.7-streaming-scrolled-up') };
      expect(grew, 'the answer kept streaming below the reader').toBeGreaterThan(0);
      expect(maxDelta, 'the reader’s offset while the answer streams').toBe(0);
    });
    out.consoleErrors = maws.consoleErrors();
  } finally {
    noteItem('10.7', { ...out, failures });
    await maws.cleanup();
  }
  expect(failures, 'every piece of §10.7').toEqual([]);
});

// ---- §10.8 and the live phase ----------------------------------------------------------------------------------------

const WIDGET_READS: Record<string, string | null> = {
  model: 'list_models', effort: 'list_models', permissions: 'list_permission_rules', usage: 'get_usage', context: 'get_context_usage', config: 'get_settings',
  plugins: null, mcp: 'mcp_status', sandbox: 'get_sandbox_dialog', hooks: 'get_hooks_listing', memory: 'get_memory_dialog', skills: 'get_skills_dialog',
};

async function closeWidgets(page: Page): Promise<void> {
  for (const w of await page.locator('[data-widget]').all()) await w.getByRole('button', { name: /^Close / }).first().click().catch(() => undefined);
}

test('§10.8 every palette widget opens backed by its read; ! and # work; a live session’s phase moves running → idle', async () => {
  test.skip(REALSTORE, 'the real-store run takes only its own case');
  const repo = scratchRepo(scratch.root, 'widgets');
  const maws = await open();
  const { page } = maws;
  const { step, failures } = pieces('10.8');
  const out: Record<string, unknown> = {};
  try {
    const id = await plus(page, repo, 'Reply with exactly the words WIDGETS READY and nothing else.');
    await idle(page, id);

    await step('the digest phase and the engine state through one turn (session_state_changed on the wire)', async () => {
      await page.evaluate((sid) => {
        const log: unknown[] = [];
        (window as unknown as { __phase: unknown[] }).__phase = log;
        window.maws.on('session.digest', (d) => d.appSessionId === sid && log.push({ phase: d.phase, t: Date.now() }));
      }, id);
      const states: string[] = [];
      await send(page, 'Use the Bash tool to run exactly this command and nothing else: sleep 4. Then reply with exactly the word DONE.');
      const until = Date.now() + 120_000;
      for (let seenTurn = false; Date.now() < until; await page.waitForTimeout(150)) {
        const s = await statusOf(page, id);
        if (states.at(-1) !== s.engineState) states.push(s.engineState);
        if (s.turn !== null) seenTurn = true;
        if (seenTurn && s.turn === null && s.engineState === 'idle') break;
      }
      const phases = (await page.evaluate(() => (window as unknown as { __phase: { phase: string }[] }).__phase)).map((p) => p.phase).filter((p, i, a) => i === 0 || a[i - 1] !== p);
      const frames = readJournal((await statusOf(page, id)).journalPath).filter((r) => r.direction === 'in' && r.frame.type === 'system' && r.frame.subtype === 'session_state_changed').map((r) => (r.frame as { state?: string }).state);
      out.phase = { engineStates: states, digestPhases: phases, sessionStateFrames: frames };
      expect(states).toEqual(expect.arrayContaining(['running', 'idle']));
      expect(states.indexOf('running')).toBeLessThan(states.lastIndexOf('idle'));
      expect(phases).toEqual(expect.arrayContaining(['working', 'idle']));
    });

    const opened: Record<string, unknown> = {};
    for (const name of Object.keys(WIDGET_READS)) {
      await step(`/${name}`, async () => {
        await closeWidgets(page);
        await main(page).getByRole('textbox', { name: 'Message' }).click();
        await page.keyboard.type(`/${name}`);
        const chosen = page.getByRole('listbox', { name: 'Commands' }).locator('[role="option"][aria-selected="true"]');
        await expect(chosen).toContainText(`/${name}`);
        await expect(chosen).not.toHaveAttribute('aria-disabled', 'true');
        await page.keyboard.press('Enter');
        const w = page.locator(`[data-widget="${name}"]`);
        await expect(w).toBeVisible();
        await expect(w.locator('footer')).toContainText('Read with');
        await expect(w).not.toContainText('Reading', { timeout: 20_000 });
        const footer = await w.locator('footer').innerText();
        const error = await w.getByRole('alert').count();
        if (name === 'context' || name === 'mcp') opened[`${name}.screenshots`] = await shoot(page, `10.8-widget-${name}`);
        opened[name] = { footer, error };
        expect(error, `/${name} answered without an error`).toBe(0);
      });
    }
    await closeWidgets(page);
    const journal = readJournal((await statusOf(page, id)).journalPath);
    const reads = new Set(journal.filter((r) => r.direction === 'out' && r.frame.type === 'control_request').map((r) => (r.frame as { request?: { subtype?: string } }).request?.subtype ?? ''));
    out.widgets = { opened, readsOnTheWire: Object.fromEntries(Object.entries(WIDGET_READS).map(([n, sub]) => [n, sub === null ? 'system/init (no read of its own)' : reads.has(sub) ? sub : `missing ${sub}`])) };
    for (const [n, sub] of Object.entries(WIDGET_READS)) if (sub) expect.soft(reads.has(sub), `/${n}'s read ${sub} on the wire`).toBe(true);

    await step('!ls runs in the session’s directory', async () => {
      await send(page, '!ls');
      const row = main(page).locator('.transcript-row[data-kind="bash"]').last();
      await expect(row).toContainText('one.txt', { timeout: 30_000 });
      out.bang = { command: '!ls', shows: 'one.txt' };
    });

    await step('# note goes to the project memory file', async () => {
      await main(page).getByRole('textbox', { name: 'Message' }).click();
      await page.keyboard.insertText('#C12 pre-run memory note');
      await expect(main(page).getByRole('button', { name: /^Memory · / })).toBeVisible();
      await page.keyboard.press('Enter');
      const claudeMd = join(repo, 'CLAUDE.md');
      await expect.poll(() => (existsSync(claudeMd) ? readFileSync(claudeMd, 'utf8') : ''), { timeout: 20_000 }).toContain('- C12 pre-run memory note');
      out.memory = { file: 'CLAUDE.md in the scratch project', line: '- C12 pre-run memory note', screenshots: await shoot(page, '10.8-bang-and-memory') };
    });
    out.consoleErrors = maws.consoleErrors();
  } finally {
    noteItem('10.8', { ...out, failures });
    await maws.cleanup();
  }
  expect(failures, 'every piece of §10.8').toEqual([]);
});

// ---- §10.9 ---------------------------------------------------------------------------------------------------------

const SLOW = 'Use the Bash tool to run exactly this command in the foreground and nothing else: sleep 15. Then reply with exactly the word SLEPT.';

test('§10.9 queue, steer, stop and resume as labelled; a paused queue survives a quit; a denial shows in a collapsed turn; an interrupt with a pending approval', async () => {
  test.skip(REALSTORE, 'the real-store run takes only its own case');
  const repo = scratchRepo(scratch.root, 'queue');
  const { step, failures } = pieces('10.9');
  const out: Record<string, unknown> = {};
  let maws = await open();
  let page = maws.page;
  try {
    const id = await plus(page, repo, 'Reply with exactly the words QUEUE READY and nothing else.');
    await idle(page, id);
    const log = new EventLog(page, id, false);
    const control = () => main(page).locator('[data-submit-state]');
    const list = () => main(page).getByRole('region', { name: 'Queued messages' });
    const toolUseAfter = async (from: number) => log.until('the slow turn’s tool call', (ev) => ev.find((e) => e.seq !== null && e.seq > from && e.kind === 'tool.use' && e.agentId === null), 120_000);
    const typeOnly = async (text: string) => {
      await main(page).getByRole('textbox', { name: 'Message' }).click();
      await page.keyboard.insertText(text);
    };
    const userWrites = async () => readJournal((await statusOf(page, id)).journalPath).filter((r) => r.direction === 'out' && r.frame.type === 'user').map((r) => r.frame as { priority?: string; message?: { content?: unknown } });
    // how many times a message's text went out on the wire as a user frame
    const writesOf = async (text: string) => (await userWrites()).filter((u) => JSON.stringify(u.message?.content ?? '').includes(text)).length;

    await step('Queue while a turn runs, sent when it ends', async () => {
      await log.pull();
      const from = log.seq;
      await send(page, SLOW);
      await toolUseAfter(from);
      await typeOnly('Reply with exactly the words QUEUED ONE and nothing else.');
      await expect(control()).toHaveText('Queue');
      await page.keyboard.press('Enter');
      await expect(list()).toContainText('1 queued');
      await idle(page, id, 180_000);
      await expect(list()).toHaveCount(0, { timeout: 60_000 });
      await idle(page, id, 180_000);
      const written = await writesOf('QUEUED ONE');
      out.queue = { label: 'Queue', queuedShown: '1 queued', writtenToTheWire: written };
      expect(written, 'the queued message reached the wire exactly once').toBe(1);
    });

    await step('Steer (⌥Enter) folds into the running turn', async () => {
      await log.pull();
      const from = log.seq;
      await send(page, SLOW);
      await toolUseAfter(from);
      await typeOnly('Also end your reply with the word STEERED.');
      await page.keyboard.down('Alt');
      await expect(control()).toHaveText('Steer');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Alt');
      await expect.poll(async () => (await userWrites()).some((u) => u.priority === 'next' && JSON.stringify(u.message?.content).includes('STEERED')), { timeout: 30_000 }).toBe(true);
      await idle(page, id, 180_000);
      out.steer = { label: 'Steer', priority: 'next' };
    });

    await step('Stop pauses the queue; Resume releases it', async () => {
      await log.pull();
      const from = log.seq;
      await send(page, SLOW);
      await toolUseAfter(from);
      await typeOnly('Reply with exactly the words AFTER STOP and nothing else.');
      await page.keyboard.press('Enter');
      await expect(list()).toContainText('1 queued');
      const stopLabel = await control().innerText();
      if (stopLabel.trim() === 'Stop') await control().click();
      else await page.keyboard.press('Meta+.');
      await expect(list().locator('header')).toHaveText(/Queue paused because you interrupted/, { timeout: 30_000 });
      await idle(page, id);
      const resumeLabel = await control().innerText();
      const shots = await shoot(page, '10.9-queue-paused');
      expect(await writesOf('AFTER STOP'), 'nothing of the paused message went out before Resume').toBe(0);
      if (resumeLabel.trim() === 'Resume') await control().click();
      else await list().getByRole('button', { name: 'Resume' }).click();
      await expect(list()).toHaveCount(0, { timeout: 60_000 });
      await idle(page, id, 180_000);
      const released = await writesOf('AFTER STOP');
      out.stopResume = { stopLabel, resumeLabel, writtenToTheWireAfterResume: released, screenshots: shots };
      expect(released, 'the paused message reached the wire exactly once, after Resume').toBe(1);
      expect(stopLabel.trim()).toBe('Stop');
      expect(resumeLabel.trim()).toBe('Resume');
    });

    await step('a queued message survives a quit and relaunch', async () => {
      await log.pull();
      const from = log.seq;
      await send(page, SLOW);
      await toolUseAfter(from);
      await typeOnly('Reply with exactly the word SURVIVOR and nothing else.');
      await page.keyboard.press('Enter');
      await expect(list()).toContainText('1 queued');
      await page.keyboard.press('Meta+.');
      await expect(list().locator('header')).toHaveText(/Queue paused because you interrupted/, { timeout: 30_000 });
      await idle(page, id);
      const before = (await statusOf(page, id)).queue;
      await maws.cleanup();
      maws = await open();
      page = maws.page;
      const stored = value(await invoke(page, 'session.queue.list', { appSessionId: id as AppSessionId }));
      await (await rowOf(page, id)).click();
      await expect(list()).toContainText('1 queued', { timeout: 20_000 });
      out.survives = { beforeQuit: before, afterRelaunch: { entries: stored.entries.map((e) => e.state), paused: stored.paused, pauseReason: (stored as { pauseReason?: unknown }).pauseReason ?? null }, shown: await list().innerText(), screenshots: await shoot(page, '10.9-queue-survived') };
      expect(stored.entries.map((e) => e.state)).toEqual(['queued']);
      expect(stored.paused).toBe(true);
    });

    let d = '';
    await step('a denied command stays visible while its turn is collapsed', async () => {
      d = await plus(page, repo, 'Use the Bash tool to run exactly this command and nothing else: mkdir c12-denied. If it is denied, reply with exactly the word DENIED.');
      const card = main(page).getByRole('group', { name: 'Approval needed' });
      await expect(card).toBeVisible({ timeout: 120_000 });
      await card.getByRole('button', { name: 'Deny', exact: true }).click();
      await idle(page, d);
      const divider = main(page).locator('.transcript-divider').filter({ has: page.locator('.transcript-divider-count', { hasText: /^1 denied$/ }) }).last();
      await expect(divider).toBeVisible({ timeout: 20_000 });
      const expanded = await divider.locator('button.transcript-disclosure').getAttribute('aria-expanded');
      out.denial = { dividerCollapsed: expanded === 'false', mark: '1 denied', screenshots: await shoot(page, '10.9-denied-collapsed') };
      expect(expanded).toBe('false');
    });

    await step('an interrupt with a pending approval; "1 approval lost"', async () => {
      if (d === '') {
        d = await plus(page, repo, 'Reply with exactly the words LOST READY and nothing else.');
        await idle(page, d);
      }
      await send(page, 'Use the Bash tool to run exactly this command and nothing else: mkdir c12-lost');
      await expect(main(page).getByRole('group', { name: 'Approval needed' })).toBeVisible({ timeout: 120_000 });
      await page.keyboard.press('Meta+.'); // app-level: the card has replaced the composer
      rec.note('10.9.lost.interruptSentAt', new Date().toISOString());
      await page.waitForTimeout(5_000);
      const s = await statusOf(page, d);
      const lostNow = value(await invoke(page, 'attention.list', undefined)).filter((i) => i.appSessionId === d && i.kind === 'interrupted').map((i) => i.summary);
      const afterInterrupt = { process: s.process, pendingRequests: s.pendingRequests, turn: s.turn !== null, interruptedItems: lostNow, cardShown: await main(page).getByRole('group', { name: 'Approval needed' }).isVisible() };
      let afterExit: Record<string, unknown>;
      if (lostNow.length === 0) {
        // On 2.1.283 the engine answers ⌘. (and a quit's end_session) with a `control_cancel_request` for the pending
        // `can_use_tool`, so the approval retires as aborted and nothing is lost (first pre-run pass: the interrupt and a
        // quit both left no interrupted item). What the count reports is a process that ends with an approval still
        // pending: ask again, then end the engine the way a crash does (SIGKILL on the scratch session's own pid).
        if (s.pendingRequests === 0) {
          await send(page, 'Use the Bash tool to run exactly this command and nothing else: mkdir c12-lost-2');
          await expect(main(page).getByRole('group', { name: 'Approval needed' })).toBeVisible({ timeout: 120_000 });
        }
        const pid = (await statusOf(page, d)).pid!;
        process.kill(pid, 'SIGKILL');
        await expect.poll(async () => (await statusOf(page, d)).process, { timeout: 30_000 }).toBe('exited');
        let items: string[] = [];
        await expect.poll(async () => (items = value(await invoke(page, 'attention.list', undefined)).filter((i) => i.appSessionId === d && i.kind === 'interrupted').map((i) => i.summary)).length, { timeout: 15_000 }).toBeGreaterThan(0);
        const exitRow = main(page).locator('.transcript-error[data-scope="exit"]').last();
        await expect(exitRow).toBeVisible({ timeout: 15_000 });
        afterExit = { how: 'SIGKILL of the engine with the approval pending (a crash)', exit: (await statusOf(page, d)).exit, interruptedItems: items, transcriptExitRow: await exitRow.innerText(), screenshots: await shoot(page, '10.9-approval-lost') };
      } else afterExit = { screenshots: await shoot(page, '10.9-approval-lost') };
      out.lost = { afterInterrupt, afterExit };
      const texts = JSON.stringify(out.lost);
      expect(texts).toMatch(/1 approval lost/);
    });
    out.consoleErrors = maws.consoleErrors();
  } finally {
    noteItem('10.9', { ...out, failures });
    await maws.cleanup();
  }
  expect(failures, 'every piece of §10.9').toEqual([]);
});

// ---- §10.10 --------------------------------------------------------------------------------------------------------

test('§10.10 light is the default on a fresh profile; dark switches cleanly and back', async () => {
  test.skip(REALSTORE, 'the real-store run takes only its own case');
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0' } }); // a fresh profile of its own, no engine launched
  launches.push(maws.consoleErrors);
  const { page, app } = maws;
  try {
    await expect(main(page)).toBeVisible({ timeout: 60_000 });
    const first = await page.locator('html').getAttribute('data-theme');
    const setting = value(await invoke(page, 'settings.get', undefined)).settings.theme;
    const bg = () => page.evaluate(() => [document.body, document.querySelector('[data-region="sidebar"]')!].map((el) => getComputedStyle(el).backgroundColor).join(' / '));
    const lightBg = await bg();
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('theme.dark')?.click());
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(bg).not.toBe(lightBg);
    const darkBg = await bg();
    await page.screenshot({ path: join(EVIDENCE, 'prerun-10.10-fresh-dark.png') });
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('theme.light')?.click());
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(bg).toBe(lightBg);
    await page.screenshot({ path: join(EVIDENCE, 'prerun-10.10-fresh-light.png') });
    rec.note('10.10', { firstPaintTheme: first, settingOnFreshProfile: setting, background: { light: lightBg, dark: darkBg, read: "body / sidebar" }, switchedBack: true, consoleErrors: maws.consoleErrors(), screenshots: ['prerun-10.10-fresh-light.png', 'prerun-10.10-fresh-dark.png'].map((f) => `docs/doperpowers/evidence/c12/${f}`) });
    expect(first).toBe('light');
    expect(setting).toBe('light');
  } finally {
    await maws.cleanup();
  }
});

// ---- C8 item 9 -----------------------------------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex -- the CLI's colour escapes are what this strips
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '').trim();

test('C8 item 9: Attach adds the Terminal tab and activates its session (a claude --bg job under the scratch home)', async () => {
  test.skip(REALSTORE, 'the real-store run takes only its own case');
  const repo = scratchRepo(scratch.root, 'bgjob');
  trustInScratch(scratch.config, repo);
  const northOne = state.get('10.1.northOne.appId');
  const env = terminalEnv(scratch.config);
  const since = Date.now();
  const out: Record<string, unknown> = {};
  let jobId: string | null = null;
  let bg: SessionRecord | undefined;
  // The job is started inside the outer try, and its stop runs after it whatever happened there, so it is stopped
  // whether or not the app launched, the attach passed or the app's cleanup succeeded. A stop that fails fails the
  // test (with the body's own failure, when there was one, in one AggregateError).
  let bodyError: unknown = null;
  try {
    let started = '';
    try {
      started = execFileSync(ENGINE_BIN_PATH, ['--bg', '--model', 'sonnet', 'Reply with exactly the words BG READY, then stop.'], { cwd: repo, env, encoding: 'utf8', timeout: 120_000 });
    } catch (error) {
      // a non-zero exit or a timeout after the job id was printed: the id is recovered from the captured stdout, so the
      // outer cleanup stops the job, and the original failure goes on
      const stdout = (error as { stdout?: string | Buffer }).stdout;
      started = typeof stdout === 'string' ? stdout : (stdout?.toString('utf8') ?? '');
      jobId = /backgrounded\W+([0-9a-f]{6,12})/.exec(plain(started))?.[1] ?? null;
      out.bgStarted = plain(started).split('\n').slice(0, 4);
      out.jobId = jobId;
      throw error;
    }
    jobId = /backgrounded\W+([0-9a-f]{6,12})/.exec(plain(started))?.[1] ?? null;
    out.bgStarted = plain(started).split('\n').slice(0, 4);
    out.jobId = jobId;
    expect(jobId, 'claude --bg printed its job id').not.toBeNull();
    const maws = await open();
    const { page } = maws;
    try {
      await expect.poll(async () => (bg = (await records(page)).find((r) => r.directory === repo && r.holder.kind === 'background_job')) !== undefined, { timeout: 60_000 }).toBe(true);
      if (northOne) await (await rowOf(page, northOne)).click(); // another session is focused before the attach
      await (await rowOf(page, bg!.appId)).click({ button: 'right' });
      const items = await page.getByRole('menuitem').allTextContents();
      await page.getByRole('menuitem', { name: 'Attach in a terminal tab' }).click();
      await expect(page.locator(`[data-tab-id="session:${bg!.appId}"]`)).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
      await expect(tabOf(page, 'Terminal').first()).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
      await expect.poll(async () => value(await invoke(page, 'pty.list', undefined)).ptys.some((p) => p.appSessionId === bg!.appId && p.alive), { timeout: 15_000 }).toBe(true);
      out.attach = { rowMenu: items, sessionTabActivated: true, terminalTabActive: true, screenshots: await shoot(page, 'c8-attach') };
      out.consoleErrors = maws.consoleErrors();
    } finally {
      rec.note('c8.attach', out);
      await maws.cleanup();
    }
  } catch (error) {
    bodyError = error;
  }
  let stopError: unknown = null;
  if (jobId) {
    try {
      out.stopped = plain(execFileSync(ENGINE_BIN_PATH, ['stop', jobId], { cwd: repo, env, encoding: 'utf8', timeout: 60_000 }));
    } catch (error) {
      stopError = error;
      out.stopFailed = error instanceof Error ? error.message.split('\n')[0] : String(error); // the diagnostic record
    }
  }
  rec.note('c8.attach', out);
  if (bg?.engineSessionId) terminalCost('c8 attach --bg job (estimate)', transcriptUsdEstimate(transcriptFile(scratch.config, repo, bg.engineSessionId), since));
  if (bodyError !== null && stopError !== null) throw new AggregateError([bodyError, stopError], `the attach case failed, and stopping the background job ${jobId} failed too`);
  if (stopError !== null) throw stopError;
  if (bodyError !== null) throw bodyError;
});
