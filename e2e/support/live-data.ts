// E3 M4 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R5, M4, Decision Log 13–15): the live dataset
// acceptance's steps over H's connector scene in its live data mode (connector-scene.ts `{liveData: true}`: the built
// app, a detached host, a scratch profile and HOME, the fixture server answering the rows its control file names, the
// host's dashboard seam on) and E2's agent seam (dashboards.ts `AgentSeam`, the `maws` server's real tools as a named
// session). The scene owns every process and its cleanup; nothing here starts, grants or revokes on the owner's behalf
// except through the dashboard's own controls, and the agent's calls go through the host's real tools.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import { DATASET_STATES, utcTime } from '../../src/artifacts/dashboard/states';
import { invoke, SERVER, TOOL, value, wait, type ConnectorScene, type FixtureRow, type LiveEngine, type Run } from './connector-scene';
import { AgentSeam, ok, openInMain, revisionOf, refusalOf, tipsOf, type AgentCall } from './dashboards';
import { boundsProblems, type BlockMeasure } from './live-data-bounds';
import { closeSurface, mainTab as shellMainTab, openSurface } from './shell';

export const BOARD = 'Signups board';
export const DATASET = 'signups';
export const TITLE = 'Signups';
export const SCHEDULE_S = 30; // the shortest schedule a query takes, the H watch's shortest interval too
export const STALE_AFTER_S = 45;
export const SOURCE = { kind: 'query', server: SERVER, tool: TOOL, args: { series: 'signups' }, schedule: SCHEDULE_S, staleAfter: STALE_AFTER_S } as const;
export const AUTHOR = 'author'; // the seam session that writes the dashboard before any engine runs
/** A measured silence: longer than the schedule, so a running watch would have called at least once inside it. */
export const SILENT_MS = SCHEDULE_S * 1000 + 5_000;

const CONTENT = [
  `# ${BOARD}`,
  '',
  'Weekly signups, read live from the fixture connector.',
  '',
  `:::chart {spec-json='{"view":"bar","x":"week","y":"signups","title":"Signups by week"}'}`,
  DATASET,
  ':::',
  '',
  `:::chart {spec-json='{"view":"table","title":"Signups table"}'}`,
  DATASET,
  ':::',
].join('\n');

/** Flat records `W1…`, one per value, as the fixture answers them and the bar chart's tips name them. */
export const rows = (...signups: number[]): FixtureRow[] => signups.map((n, i) => ({ week: `W${i + 1}`, signups: n }));
export const tips = (...signups: number[]): string[] => signups.map((n, i) => `W${i + 1} · signups: ${n}`);

export const agentOf = (scene: ConnectorScene): AgentSeam => new AgentSeam(join(scene.userData, 'dashboard-e2e'));

/**
 * The dashboard: written by the agent through the host's real tools (its views, then its query configured, nothing
 * fetched), then put by the owner in a Space linked to the scene's project, the context an owner's Start starts in.
 */
export async function createBoard(scene: ConnectorScene, page: Page, agent: AgentSeam): Promise<string> {
  const { artifactId } = await agent.ok<{ artifactId: string }>(AUTHOR, 'artifact_create', { kind: 'dashboard', title: BOARD, content: CONTENT });
  const configured = await agent.ok<{ notFetched?: true; rows?: number }>(AUTHOR, 'artifact_dataset', { artifact: artifactId, id: DATASET, title: TITLE, source: SOURCE, baseRevision: 'last' });
  expect(configured, 'the query configured, nothing fetched').toMatchObject({ notFetched: true });
  const { space } = await ok<{ space: { id: string } }>(page, 'spaces.create', { name: 'Live data', linkedDir: scene.project });
  await ok(page, 'artifacts.update', { artifactId, spaceId: space.id });
  scene.note('dashboard', { artifactId, space: space.id });
  return artifactId;
}

// ---- what the owner sees --------------------------------------------------------------------------------------------

export const mainTab = (page: Page, artifactId: string): Locator => page.locator(`[data-region="main"] [data-artifact-tab="${artifactId}"]`);
/** A tab of the main area's strip by its name (main/Tab.tsx: `role="tab"`, its label the name, `aria-selected`). */
export const stripTab = (page: Page, name: string): Locator => shellMainTab(page, name);
/** The live document's views under `scope` (a tab or a panel record), the bar first, the table second. */
export const liveViews = (scope: Locator): Locator => scope.locator('.doc-live figure.dash-view');
export const previewViews = (scope: Locator): Locator => scope.locator('.doc-preview figure.dash-view');
export const labelOf = (views: Locator): Locator => views.first().locator('.dash-source-label');
export const tableRows = (views: Locator): Locator => views.nth(1).locator('.dash-figure > table tbody tr');
export const barTips = (views: Locator) => tipsOf(views.first());
export const sheetOf = (page: Page): Locator => page.getByRole('dialog', { name: `Source of ${TITLE}` });
export const liveBlock = (sheet: Locator): Locator => sheet.getByRole('group', { name: 'Live query' });

// The label's fixed head, and what follows it once fetched (`by You` for the owner's page, a session's title for the agent's)
export const HEAD = `${TITLE} · ${SERVER} · ${TOOL}`;
export const NOT_FETCHED = `${HEAD} · ${DATASET_STATES.notFetched}`;
export const fetched = (at: number, by: 'You' | 'session'): RegExp => new RegExp(`^${escape(`${HEAD} · updated ${utcTime(at)} by `)}${by === 'You' ? 'You' : '(?!You\\b)[^·]+'}( · |$)`);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The views draw exactly these rows: the bar chart's tips and the table's row count. */
export async function drawsRows(views: Locator, signups: number[], what: string): Promise<void> {
  await expect.poll(() => barTips(views), { timeout: 20_000, message: `${what}: the bar chart’s rows` }).toEqual(tips(...signups));
  await expect(tableRows(views), `${what}: the table’s rows`).toHaveCount(signups.length);
}

/** The dashboard in its main tab: the tab the app restored when it did (never navigated to again), else from the library. */
export async function dashboardTab(page: Page, artifactId: string, scene: ConnectorScene): Promise<Locator> {
  const tab = mainTab(page, artifactId);
  const restored = await expect(tab.locator('.ds-doc .ProseMirror').first())
    .toBeVisible({ timeout: 20_000 })
    .then(
      () => true,
      () => false,
    );
  scene.note(restored ? 'dashboard tab restored' : 'dashboard tab opened from the library');
  return restored ? tab : openInMain(page, artifactId);
}

/** The source sheet from the bar chart's label, the owner's click. */
export async function openSheet(views: Locator): Promise<Locator> {
  await labelOf(views).click();
  const sheet = sheetOf(views.page());
  await expect(sheet).toBeVisible();
  return sheet;
}
export async function closeSheet(sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toBeHidden();
}

// ---- the owner's Start from the live query block ----------------------------------------------------------------------

/**
 * The owner's Start from the sheet's live query block (shown while the query pauses for want of a session): the real
 * button, then the durable outcome, never the block's passing words: one new session live and ready with the fixture
 * server connected. A card or a refusal the block says ends the wait at once with its words.
 */
export async function startFromSheet(scene: ConnectorScene, page: Page, block: Locator): Promise<LiveEngine> {
  const before = new Set((await scene.live(page)).map((session) => session.appSessionId));
  await block.getByRole('button', { name: 'Start session', exact: true }).click();
  const passing = new Set(['', 'Starting…', 'Starting the session…', 'The session is ready']);
  let started: LiveEngine | undefined;
  for (const deadline = Date.now() + 90_000; started === undefined; await wait(500)) {
    const words = (await block.getByRole('status').textContent({ timeout: 250 }).catch(() => null))?.trim() ?? '';
    if (!passing.has(words)) throw new Error(`the owner’s Start did not start a session: ${words}`);
    if (Date.now() > deadline) throw new Error(`the owner’s Start made no live, ready session within 90 s (the block said “${words}”)`);
    const fresh = value(await invoke(page, 'engine.sessions', undefined)).find((session) => !before.has(session.appSessionId) && session.process === 'ready');
    if (fresh) started = { appSessionId: fresh.appSessionId, launchId: fresh.launchId, pid: fresh.pid ?? 0 };
  }
  const appSessionId = started.appSessionId as LaunchSpec['appSessionId'];
  await expect
    .poll(
      async () => {
        const status = await invoke(page, 'session.mcpStatus', { appSessionId });
        return status.ok ? status.value.mcpServers.find((server) => server.name === SERVER)?.status : 'unanswered';
      },
      { timeout: 60_000, message: 'the fixture server is connected' },
    )
    .toBe('connected');
  expect((await scene.live(page)).filter((session) => !before.has(session.appSessionId)), 'exactly one new session').toHaveLength(1);
  scene.note('owner start', started);
  return started;
}

// ---- the fixture's call log as the witness ------------------------------------------------------------------------------

/** A span of real time in which nothing may call the fixture's tool: its bounds, noted on the timeline. */
export async function silence(scene: ConnectorScene, what: string, ms = SILENT_MS): Promise<{ from: number; to: number }> {
  const from = Date.now();
  await wait(ms);
  const to = Date.now();
  expect(scene.toolCallsBetween(from, to), `no call while ${what}`).toEqual([]);
  scene.note('silent span', { what, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
  return { from, to };
}

/** Exactly one call after `from` (the catch-up of a watch shown again), and no second one in the following seconds. */
export async function oneCatchUp(scene: ConnectorScene, from: number, what: string): Promise<void> {
  await expect.poll(() => scene.toolCallsBetween(from, Date.now()).length, { timeout: 20_000, message: `${what}: a catch-up call` }).toBeGreaterThanOrEqual(1);
  await wait(5_000);
  expect(scene.toolCallsBetween(from, Date.now()), `${what}: exactly one catch-up call, no burst`).toHaveLength(1);
}

/** The next call after `from`, once logged. */
export async function nextCall(scene: ConnectorScene, from: number, timeout = 20_000) {
  await expect.poll(() => scene.toolCallsBetween(from, Date.now()).length, { timeout, message: 'a call of the fixture’s tool' }).toBeGreaterThanOrEqual(1);
  return scene.toolCallsBetween(from, Date.now())[0]!;
}

// ---- sessions and launches -----------------------------------------------------------------------------------------------

/** Every session the engine host and main know, and every launch any session's journal records. */
export async function census(scene: ConnectorScene, page: Page): Promise<{ hostSessions: number; live: number; records: number; spawns: number; exits: number }> {
  const sessions = value(await invoke(page, 'engine.sessions', undefined));
  const records = value(await invoke(page, 'session.list', { includeArchived: true })).sessions.length;
  const dir = join(scene.userData, 'engine-host', 'journal');
  const launches = existsSync(dir) ? readdirSync(dir).map((id) => scene.launches(id)) : [];
  return {
    hostSessions: sessions.length,
    live: sessions.filter((session) => session.process !== 'exited').length,
    records,
    spawns: launches.reduce((sum, launch) => sum + launch.spawns, 0),
    exits: launches.reduce((sum, launch) => sum + launch.exits, 0),
  };
}

/** The user messages any launch of the session wrote to its engine (its journal's `out` frames of type `user`): none, for
 * a Start that runs no model turn. */
export function userMessages(scene: ConnectorScene, appSessionId: string): number {
  const dir = join(scene.userData, 'engine-host', 'journal', appSessionId);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir)
    .filter((file) => file.endsWith('.jsonl'))
    .flatMap((file) => readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { direction: string; frame: { type?: string } }))
    .filter((row) => row.direction === 'out' && row.frame.type === 'user').length;
}

// ---- the agent's one-shot refresh and its writes -------------------------------------------------------------------------

/**
 * `artifact_dataset` on the dashboard as `session`, at the live revision read just before; a refusal for a write that
 * landed between the read and the call (a scheduled refresh) is retried at the new revision, at most twice.
 */
export async function agentDataset<R = Record<string, unknown>>(page: Page, agent: AgentSeam, session: string, artifactId: string, args: Record<string, unknown>): Promise<AgentCall<R>> {
  for (let attempt = 0; ; attempt++) {
    // a refresh's one budget is the host's 180 s operation deadline (CONNECTOR_OPERATION_DEADLINE_MS); the seam waits past it
    const call = await agent.call<R>(session, 'artifact_dataset', { artifact: artifactId, id: DATASET, ...args, baseRevision: await revisionOf(page, artifactId) }, { timeoutMs: 200_000 });
    if (!call.isError || attempt === 2 || refusalOf(call).reason !== 'conflict') return call;
  }
}

/** The dataset as the agent reads it: its rows, its fetch time and who fetched it. */
export async function readDataset(agent: AgentSeam, session: string, artifactId: string) {
  const read = await agent.ok<{ datasets: { id: string; rows: number; updated?: { at: string; by: string; appSessionId?: string }; notFetched?: true; state?: { status: string; message?: string } }[] }>(session, 'artifact_read', { artifact: artifactId });
  const dataset = read.datasets.find((d) => d.id === DATASET);
  if (!dataset) throw new Error(`no dataset ${DATASET} on ${artifactId}`);
  return { ...dataset, at: dataset.updated ? Date.parse(dataset.updated.at) : null };
}

// ---- layout ------------------------------------------------------------------------------------------------------------------

/** The dashboard's Artifacts surface shown or hidden by its icon, retaining the record for the next opening. */
export async function setPanel(page: Page, shown: boolean): Promise<void> {
  if (shown) await openSurface(page, 'Artifacts');
  else await closeSurface(page, 'Artifacts');
}

/** The window as it actually is: its native frame and content size, its minimum, and the renderer's CSS viewport and
 * device pixel ratio (what a screenshot's pixels mean). */
export interface WindowGeometry {
  native: { width: number; height: number };
  content: { width: number; height: number };
  minimum: { width: number; height: number };
  viewport: { width: number; height: number };
  dpr: number;
}

export async function windowGeometry(run: Run): Promise<WindowGeometry> {
  const native = await run.maws.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    const [width, height] = win.getSize();
    const [cw, ch] = win.getContentSize();
    const [mw, mh] = win.getMinimumSize();
    return { native: { width: width!, height: height! }, content: { width: cw!, height: ch! }, minimum: { width: mw!, height: mh! } };
  });
  const page = await run.page.evaluate(() => ({ viewport: { width: window.innerWidth, height: window.innerHeight }, dpr: window.devicePixelRatio }));
  return { ...native, ...page };
}

/**
 * The window resized to `width` × `height`, answered once the native frame has that size and the renderer's viewport
 * has followed its content area. A size below the window's own minimum is refused, never clamped silently: the
 * narrowest a spec can show is that minimum.
 */
export async function windowSize(run: Run, width: number, height: number): Promise<WindowGeometry> {
  const { minimum } = await windowGeometry(run);
  if (width < minimum.width || height < minimum.height) throw new Error(`${width}×${height} is below the window’s minimum ${minimum.width}×${minimum.height}`);
  await run.maws.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w!, h!), [width, height]);
  let geometry = await windowGeometry(run);
  await expect
    .poll(
      async () => {
        geometry = await windowGeometry(run);
        const settled = geometry.native.width === width && geometry.native.height === height && Math.abs(geometry.viewport.width - geometry.content.width) <= 1 && Math.abs(geometry.viewport.height - geometry.content.height) <= 1;
        return settled ? 'settled' : JSON.stringify(geometry);
      },
      { timeout: 10_000, message: `the window at ${width}×${height}, its renderer following` },
    )
    .toBe('settled');
  return geometry;
}

/** What keeps the live block's controls from lying wholly inside the sheet and the window, on both axes (none when
 * all do): measured in the page, judged by live-data-bounds.ts. */
export async function unclipped(block: Locator): Promise<string[]> {
  const measured: BlockMeasure = await block.evaluate((el) => {
    const rect = (r: DOMRect) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      sheet: rect(el.closest('.dash-sheet')!.getBoundingClientRect()),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      controls: Array.from(el.querySelectorAll('button')).map((button) => ({ name: button.getAttribute('aria-label') ?? button.textContent ?? '', box: rect(button.getBoundingClientRect()), scrollWidth: button.scrollWidth, clientWidth: button.clientWidth })),
    };
  });
  return boundsProblems(measured);
}

