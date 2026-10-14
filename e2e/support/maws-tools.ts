// The `maws` groups' one replay scene (E11 W-E: E2's `deliverables-scene.ts`, which E1's tools group and live sitting
// had copied, the copies now gone; E2 execution document, M7): a scratch project whose sessions the sidebar shows (one
// seeded transcript per session), the product app over C3's replay transport (MAWS_ENGINE_REPLAY=1) with the e2e seam
// log and a console check that leaves a deliverable frame's errors to its chip, the journal readers for the `maws`
// server's calls and answers, the window's event log, records written straight into the store's layout (the reader's
// format), the Deliverables tool's locators, the toast clearing and the evidence shots in both themes. Imported by E1's
// `tools` group and live sitting, E2's `deliverables` group and E4's browser groups.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, type ConsoleMessage, type Locator, type Page } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import type { DeliverableRecord } from '../../src/shared/maws/deliverable';
import { invoke, launchReady, value } from './c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './launch';
import { sidebarRow } from './sidebar';

export const PASS3 = 'spikes/protocol-probe/fixtures/pass3';

// ---- fixtures and journals ------------------------------------------------------------------------------------------

export type Frame = Record<string, unknown>;
const rowsOf = (path: string): JournalRow[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JournalRow);
export const fixtureRows = (fixture: string) => rowsOf(resolve(REPO_ROOT, fixture)); // a repository path, or a derived fixture's absolute one

// A recorded `ask` fixture with the ask's arguments replaced by `args`, written under `dir` (P2-C3: an option's preview
// and an answer's note postdate the recordings). Sound because the replay plays the engine's frames as given and checks
// only what MAWS writes, and that by kind: a `control_response` by request id and behaviour, a `user` frame by type, so
// no write depends on the arguments. They are replaced in each frame that carries them whole, so the host's call, the
// permission card and the transcript's capsule agree: the `tools/call` request the host parses, the `can_use_tool`
// request, and the assistant's `tool_use`. The streamed `input_json_delta` fragments and what the engine said after the
// answer (its tool result, its reply) stay the recording's; a case reads nothing from them.
export function askFixture(dir: string, fixture: string, args: Record<string, unknown>): string {
  const replaced = { call: 0, permission: 0, toolUse: 0 };
  const rows = fixtureRows(fixture).map((row) => {
    const frame = structuredClone(row.frame) as Frame;
    if (row.direction !== 'in') return { ...row, frame };
    const request = frame.request as { subtype?: string; tool_name?: string; input?: unknown; message?: { method?: string; params?: { name?: string; arguments?: unknown } } } | undefined;
    if (frame.type === 'control_request' && request?.subtype === 'mcp_message' && request.message?.method === 'tools/call' && request.message.params?.name === 'ask') {
      request.message.params.arguments = args;
      replaced.call++;
    } else if (frame.type === 'control_request' && request?.subtype === 'can_use_tool' && request.tool_name === 'mcp__maws__ask') {
      request.input = args;
      replaced.permission++;
    } else if (frame.type === 'assistant') {
      for (const block of (frame.message as { content: { type: string; name?: string; input?: unknown }[] }).content) {
        if (block.type !== 'tool_use' || block.name !== 'mcp__maws__ask') continue;
        block.input = args;
        replaced.toolUse++;
      }
    }
    return { ...row, frame };
  });
  expect(replaced, `the one ask of ${fixture}`).toEqual({ call: 1, permission: 1, toolUse: 1 });
  const path = join(dir, fixture.slice(fixture.lastIndexOf('/') + 1).replace(/\.jsonl$/, '-derived.jsonl'));
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return path;
}

// The fixture's recorded human prompt (the replay holds at it), and its `spawn` row's working directory.
const firstPrompt = (fixture: string) => ((fixtureRows(fixture).find((r) => r.direction === 'out' && (r.frame as Frame).type === 'user')!.frame as Frame).message as { content: string }).content;
export const recordedCwd = (fixture: string) => (fixtureRows(fixture).find((r) => r.direction === 'meta' && (r.frame as Frame).event === 'spawn')!.frame as { cwd: string }).cwd;

// Every row the session's launches journaled (one file per launch, in the session's journal directory).
function journalOf(userData: string, id: string): JournalRow[] {
  const dir = join(userData, 'engine-host', 'journal', id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .flatMap((name) => rowsOf(join(dir, name)));
}

export type McpBlock = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export type McpResult = { content: McpBlock[]; isError?: boolean };
// The text of a tool result's block `index` (the JSON a `maws` tool answers in).
export function resultText(result: McpResult, index = 0): string {
  const block = result.content[index];
  if (block?.type !== 'text') throw new Error(`block ${index} of the result is not text: ${JSON.stringify(block)}`);
  return block.text;
}
// The tool result the host wrote for the engine's `mcp_message` request `requestId`, or null while none is written.
export function mcpResultOf(rows: JournalRow[], requestId: string): McpResult | null {
  for (const row of rows) {
    const frame = row.frame as { type?: string; response?: { request_id?: string; response?: { mcp_response?: { result?: McpResult } } } };
    if (row.direction === 'out' && frame.type === 'control_response' && frame.response?.request_id === requestId) return frame.response.response?.mcp_response?.result ?? null;
  }
  return null;
}
// The engine's `tools/call` requests of the `maws` server, in order: their request ids, names and arguments.
export function mcpCalls(rows: JournalRow[]): { requestId: string; name: string; args: Record<string, unknown> }[] {
  return rows.flatMap((row) => {
    const frame = row.frame as { type?: string; request_id?: string; request?: { subtype?: string; message?: { method?: string; params?: { name: string; arguments: Record<string, unknown> } } } };
    if (row.direction !== 'in' || frame.type !== 'control_request' || frame.request?.subtype !== 'mcp_message' || frame.request.message?.method !== 'tools/call') return [];
    return [{ requestId: frame.request_id!, name: frame.request.message.params!.name, args: frame.request.message.params!.arguments }];
  });
}
export const metaEvents = (rows: JournalRow[]) => rows.filter((r) => r.direction === 'meta').map((r) => (r.frame as { event: string }).event);

export const ofKind = <K extends SessionEvent['kind']>(events: SessionEvent[], kind: K) => events.filter((e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind);

// ---- the scene: a scratch project, the product app over the replay ---------------------------------------------------

// What outlives one launch: the scratch root, the project directory, the engine store with one transcript per session,
// the seam log and the profile (`userData`), so a relaunch runs over the same records.
export interface Scratch {
  root: string;
  repo: string;
  config: string;
  userData: string;
  openLog: string;
  engineIds: string[];
}

export interface Scene {
  maws: MawsLaunch;
  page: Page;
  scratch: Scratch;
  repo: string;
  openLog: string;
  ids: AppSessionId[]; // the seeded sessions' app ids, in the order of their titles
  pane: Locator; // the main region's first pane
  panel: Locator;
  journal(id: string): JournalRow[]; // every launch's rows, an earlier app run's (and its quit) included
  events(id: string): Promise<SessionEvent[]>; // every event batch the window received for the session since it was last loaded
  appErrors(): string[]; // the window's own console errors (a deliverable frame's are the page's, read through the chip)
}

// One transcript per title in the config home's project directory for `repo`, its first user record only, so C4
// indexes the directory as a project (the sheet's repository list) and the sidebar shows a session row for each; the
// engine session ids, in the order of the titles.
export function seedTranscripts(config: string, repo: string, titles: string[]): string[] {
  const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  return titles.map((title, k) => {
    const sessionId = randomUUID();
    const first = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: title }, uuid: randomUUID(), timestamp: `2026-10-06T0${k}:00:00.000Z`, cwd: repo, sessionId, version: '2.1.291' };
    writeFileSync(join(project, `${sessionId}.jsonl`), `${JSON.stringify(first)}\n`);
    return sessionId;
  });
}

// `repo` defaults to a fresh directory under the scratch root; a replay that stats files names the recording's own.
// `folders` are made inside it (E1's `assets`, which the ask's folder question picks); `label` names the root.
export function scratchProject(opts: { titles: string[]; repo?: string; folders?: string[]; label?: string }): Scratch {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `maws-${opts.label ?? 'e2-deliverables'}-`)));
  const repo = opts.repo ?? join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  for (const folder of opts.folders ?? []) mkdirSync(join(repo, folder), { recursive: true });
  const config = join(root, 'claude-config');
  const engineIds = seedTranscripts(config, repo, opts.titles);
  const userData = join(root, 'user-data');
  mkdirSync(userData);
  return { root, repo, config, userData, openLog: join(root, 'open.txt'), engineIds };
}

// Every event batch the window receives from now on, kept in the window for `eventsOf`; idempotent.
export async function recordEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __mawsEvents?: { appSessionId: string; events: unknown[] }[] };
    if (w.__mawsEvents) return;
    const log: { appSessionId: string; events: unknown[] }[] = [];
    w.__mawsEvents = log;
    window.maws.on('session.eventBatch', (payload) => log.push(payload as { appSessionId: string; events: unknown[] }));
  });
}
// The session's events the window received since `recordEvents` (since the window was last loaded).
export const eventsOf = (page: Page, id: string): Promise<SessionEvent[]> =>
  page.evaluate((appSessionId) => ((window as unknown as { __mawsEvents: { appSessionId: string; events: SessionEvent[] }[] }).__mawsEvents ?? []).filter((b) => b.appSessionId === appSessionId).flatMap((b) => b.events), id);

// The app window's console errors and uncaught errors, less those of a deliverable frame (or of Chromium's PDF viewer
// beneath one), told by the message's location or the error's stack: a frame's page is the agent's, and what it logs is
// the console chip's to show. Seeded from what Playwright kept since launch.
async function appConsoleErrors(page: Page): Promise<() => string[]> {
  const frameUrl = /^(maws-deliverable|chrome-extension):/;
  const live: string[] = [];
  const consoleError = (message: ConsoleMessage) => message.type() === 'error' && !frameUrl.test(message.location().url);
  const appError = (error: Error) => !(error.stack ?? '').includes('maws-deliverable://');
  page.on('console', (message) => {
    if (consoleError(message)) live.push(message.text());
  });
  page.on('pageerror', (error) => {
    if (appError(error)) live.push(`uncaught: ${error.message}`);
  });
  const seeded = (await page.consoleMessages({ filter: 'all' })).filter(consoleError).map((m) => m.text());
  const seededErrors = (await page.pageErrors({ filter: 'all' })).filter(appError).map((error) => `uncaught: ${error.message}`);
  live.splice(0);
  return () => [...seeded, ...seededErrors, ...live];
}

// The product app over the scratch profile (MAWS_HARNESS=0 per launch), once its sessions are indexed. A relaunch names
// the app ids its first launch found (`known`): a session a replay ran in is bound to the recording's engine session
// from then on, so its seeded transcript no longer finds it.
export async function launchScene(scratch: Scratch, known?: AppSessionId[]): Promise<Scene> {
  const maws = await launchMaws({
    userData: scratch.userData,
    env: { MAWS_HARNESS: '0', MAWS_ENGINE_REPLAY: '1', CLAUDE_CONFIG_DIR: scratch.config, MAWS_E2E_OPEN_LOG: scratch.openLog },
  });
  try {
    const { page } = maws;
    const appErrors = await appConsoleErrors(page);
    await recordEvents(page);
    let ids: AppSessionId[] = [];
    await expect
      .poll(async () => {
        const { sessions } = value(await invoke(page, 'session.list', {}));
        ids = known
          ? known.filter((id) => sessions.some((s) => s.appId === id))
          : scratch.engineIds.map((engineId) => (sessions.find((s) => s.engineSessionId === engineId)?.appId ?? '') as AppSessionId);
        return known ? ids.length === known.length : ids.every((id) => id !== '');
      })
      .toBe(true);
    return {
      maws, page, scratch, ids, appErrors,
      repo: scratch.repo,
      openLog: scratch.openLog,
      pane: page.locator('[data-region="main"] [data-pane="0"]'),
      panel: page.locator('[data-region="panel"]'),
      journal: (id) => journalOf(maws.userData, id),
      events: (id) => eventsOf(page, id),
    };
  } catch (error) {
    await maws.cleanup();
    throw error;
  }
}

// The window's own console stayed clean and every replay followed its recording (a mismatch ends a replay early, which a
// case's own waits can miss), then the app is closed; the profile stays for a relaunch. The whole journal is read: a
// relaunch's check covers the earlier app run's quit too (E11), which writes nothing the replay calls a mismatch.
export async function closeScene(s: Scene): Promise<void> {
  try {
    expect(s.appErrors()).toEqual([]);
    for (const id of s.ids) expect(metaEvents(s.journal(id)), `the journal of ${id}`).not.toContain('replay_mismatch');
  } finally {
    await s.maws.cleanup();
  }
}

export async function scene(opts: { titles: string[]; repo?: string; folders?: string[]; label?: string }, body: (s: Scene) => Promise<void>): Promise<void> {
  const scratch = scratchProject(opts);
  try {
    const s = await launchScene(scratch);
    try {
      await body(s);
    } catch (error) {
      await s.maws.cleanup();
      throw error;
    }
    await closeScene(s);
  } finally {
    rmSync(scratch.root, { recursive: true, force: true });
  }
}

// The session's row clicked (the main view shows it), the pointer moved off the sidebar so no hover card covers rows.
export async function show(s: Scene, id: string): Promise<void> {
  await (await sidebarRow(s.page, { appSessionId: id })).click();
  await s.page.mouse.move(700, 20);
  await expect(s.pane.locator(`[data-composer="${id}"]`)).toBeVisible();
}

// The fixture launched under the session's id (with the scratch directory as its cwd) and its prompt sent as recorded.
export async function replay(s: Scene, id: string, fixture: string): Promise<void> {
  await launchReady(s.page, id, fixture, { cwd: s.repo });
  value(await invoke(s.page, 'session.send', { appSessionId: id as AppSessionId, content: firstPrompt(fixture) }));
}

// The next permission the session asks, allowed once through the request card docked in the composer (the replay
// compares the response's behaviour: every fixture recorded `allow`).
export async function allowNext(s: Scene, id: string): Promise<void> {
  const answered = ofKind(await s.events(id), 'permission.resolved').length;
  await expect.poll(async () => ofKind(await s.events(id), 'permission.requested').length, { timeout: 30_000 }).toBeGreaterThan(answered);
  const frame = s.pane.getByRole('group', { name: 'Approval needed' });
  await frame.getByRole('radio', { name: 'Allow once' }).click();
  await frame.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect.poll(async () => ofKind(await s.events(id), 'permission.resolved').length, { timeout: 30_000 }).toBe(answered + 1);
}

const turnOf = async (s: Scene, id: string) => value(await invoke(s.page, 'session.status', { appSessionId: id as AppSessionId })).turn;
export const idle = (s: Scene, id: string) => expect.poll(() => turnOf(s, id), { timeout: 60_000 }).toBeNull();

// The work of a completed turn folds behind its divider; the cells are read with it open.
export async function unfoldWork(pane: Locator): Promise<void> {
  const divider = pane.locator('[data-kind="divider"]').last().locator('button[aria-expanded]').first();
  await expect(divider).toBeVisible();
  if ((await divider.getAttribute('aria-expanded')) === 'false') await divider.click();
}

// The seam log's lines so far (main's openExternal and reveal, and the frame policies' blocked lines).
export const seamLines = (s: Scene): string[] => (existsSync(s.openLog) ? readFileSync(s.openLog, 'utf8').trim().split('\n').filter(Boolean) : []);

// ---- records, as the engine host writes them ------------------------------------------------------------------------

export function seedRecord(userData: string, record: DeliverableRecord): DeliverableRecord {
  const dir = join(userData, 'deliverables', record.appSessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${record.id}.json`), `${JSON.stringify(record)}\n`);
  return record;
}

export const recordPath = (userData: string, record: DeliverableRecord) => join(userData, 'deliverables', record.appSessionId, `${record.id}.json`);

// A delivered file, referenced in place (A-3).
export function seedFile(userData: string, appSessionId: AppSessionId, path: string, at: string, caption?: string): DeliverableRecord {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return seedRecord(userData, { id: randomUUID(), appSessionId, kind: 'file', path, title: name, ...(caption !== undefined && { caption }), versions: [{ path, at }], createdAt: at });
}

// An artifact whose versions are copied under the store (`<id>/v<n>.html`), one HTML text per version, `at` its first.
export function seedArtifact(userData: string, appSessionId: AppSessionId, artifactId: string, title: string, pages: string[], at = new Date().toISOString()): DeliverableRecord {
  const id = randomUUID();
  const dir = join(userData, 'deliverables', appSessionId, id);
  mkdirSync(dir, { recursive: true });
  const start = Date.parse(at);
  const versions = pages.map((html, k) => {
    const path = join(dir, `v${k + 1}.html`);
    writeFileSync(path, html);
    return { path, at: new Date(start + k * 1_000).toISOString() };
  });
  const last = versions[versions.length - 1]!;
  return seedRecord(userData, { id, appSessionId, kind: 'artifact', artifactId, title, path: last.path, versions, createdAt: at, updatedAt: last.at });
}

// ---- the Deliverables tool ------------------------------------------------------------------------------------------

export const listOf = (s: Scene) => s.panel.locator('[data-deliverables-list]');
export const viewerOf = (root: Locator) => root.locator('[data-deliverable-viewer]');
export const rowOf = (root: Locator, record: { id: string }) => root.locator(`[data-deliverable-row][data-deliverable-id="${record.id}"]`);

// The tool added from the panel's "+" menu (it opens on the shown session's list).
export async function openDeliverables(s: Scene): Promise<void> {
  await s.panel.getByRole('button', { name: 'Add a tool' }).click();
  await s.page.getByRole('menuitem', { name: 'Deliverables' }).click();
  await expect(listOf(s)).toBeVisible();
}

// The frame Playwright reached for a deliverable URL (the frame's own document, cross-origin).
export async function frameAt(page: Page, url: string) {
  let found: ReturnType<Page['frames']>[number] | undefined;
  await expect.poll(() => (found = page.frames().find((f) => f.url() === url)) !== undefined, { message: `a frame at ${url}` }).toBe(true);
  return found!;
}

// ---- evidence -------------------------------------------------------------------------------------------------------

export const SHOTS = process.env.MAWS_E2_SHOTS === '1' ? join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e2') : null;
const THEMES = ['light', 'dark'] as const;

// Every open toast dismissed, then none left open (a closing one still animates out).
export async function clearToasts(page: Page): Promise<void> {
  const region = page.getByRole('region', { name: /^Notifications/ });
  const open = region.locator('li[data-state="open"]');
  await expect(async () => {
    for (const dismiss of await open.getByRole('button', { name: 'Dismiss' }).all()) await dismiss.click({ timeout: 2_000 }).catch(() => undefined);
    await expect(region.locator('li')).toHaveCount(0, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

// The window as it stands in each theme, toasts cleared first, saved where `path` names for the theme; then back to light
// (the default). `before` runs after each switch, to restore what the shot is of (an open popover, a hover).
export async function shootThemes(page: Page, path: (theme: (typeof THEMES)[number]) => string, before?: () => Promise<void>): Promise<void> {
  await clearToasts(page);
  for (const theme of THEMES) {
    value(await invoke(page, 'settings.set', { theme }));
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await before?.();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path(theme) });
  }
  value(await invoke(page, 'settings.set', { theme: 'light' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
}

// `e2-<surface>-<theme>.png` under docs/doperpowers/evidence/p1-e2/ when MAWS_E2_SHOTS=1.
export async function shoot(s: Scene, surface: string, before?: () => Promise<void>): Promise<void> {
  if (SHOTS === null) return;
  await shootThemes(s.page, (theme) => join(SHOTS, `e2-${surface}-${theme}.png`), before);
}

// P3-A (M6; X25): E2's recorded artifact case (`pass3/p1-maws-artifacts`) as this build's tools are called, the recording
// itself left as it was recorded (the conformance suite and the transcript snapshots read it as E2's). Its two calls of
// the retired `artifact_update` become `artifact_publish` calls in every frame that carries them (the stream's input
// deltas, the assistant's tool use, the permission request and its allow, the `tools/call`, the recorded answers and
// the engine's tool result): the first publishes `page` as the `index.html` of "dash" from `baseRevision` (what its create
// answered), the second names "nope". Every other mention of the old name reads as the new one. Written under
// `test-results/replays/` and answered as a path relative to the repository, as `replay` takes a fixture.
export function asPublishReplay(fixture: string, page: string, baseRevision: number): string {
  const inputs = [
    { artifact: 'dash', baseRevision, files: { 'index.html': page } },
    { artifact: 'nope', baseRevision, files: { 'index.html': page } },
  ];
  const E2_REFUSAL = 'artifact_update: no artifact "nope" in this session; use artifact_create';
  const refusal = 'artifact_publish: no artifact "nope" in this session';
  let started = -1; // the update blocks begun so far (0: "dash", 1: "nope")
  let open: { index: number; delta: number } | null = null;
  const rewrite = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (value.startsWith('{\n  "status": "updated"')) {
        const old = JSON.parse(value) as { deliverableId: string };
        return JSON.stringify({ status: 'published', artifactId: old.deliverableId, kind: 'html', title: 'Dashboard', revision: baseRevision + 1, changed: ['index.html'], kept: [], removed: [], id: 'dash', deliverableId: old.deliverableId, version: 2, externalReferences: 0 }, null, 2);
      }
      return value.replaceAll(E2_REFUSAL, refusal).replaceAll('artifact_update', 'artifact_publish').replaceAll('Artifact Update', 'Artifact Publish').replaceAll('Update artifact', 'Publish artifact');
    }
    if (Array.isArray(value)) return value.map(rewrite);
    if (value === null || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    if (record.html_path === 'dashboard.html' && (record.id === 'dash' || record.id === 'nope') && Object.keys(record).length === 2) return inputs[record.id === 'dash' ? 0 : 1];
    return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, rewrite(entry)]));
  };
  const rows = fixtureRows(fixture).map((row) => {
    const event = (row.frame as { type?: string; event?: { type?: string; index?: number; content_block?: { name?: string }; delta?: { type?: string; partial_json?: string } } }).event;
    if ((row.frame as Frame).type === 'stream_event' && event) {
      if (event.type === 'content_block_start' && event.content_block?.name === 'mcp__maws__artifact_update') {
        started += 1;
        open = { index: event.index!, delta: 0 };
      } else if (event.type === 'content_block_stop' && open?.index === event.index) open = null;
      else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
        const block = open as { index: number; delta: number } | null;
        if (block && block.index === event.index) event.delta.partial_json = block.delta++ === 0 ? JSON.stringify(inputs[started]) : '';
      }
    }
    return { ...row, frame: rewrite(row.frame) };
  });
  const relative = join('test-results', 'replays', `${fixture.split('/').at(-1)!.replace(/\.jsonl$/, '')}.publish.jsonl`);
  mkdirSync(join(REPO_ROOT, 'test-results', 'replays'), { recursive: true });
  writeFileSync(join(REPO_ROOT, relative), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return relative;
}
