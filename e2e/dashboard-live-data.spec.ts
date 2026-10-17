// E3 M4 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, Acceptance 1–3 and the M4 entry; Decision Log 13–15):
// granted live datasets in the ordinary Dashboard, `pnpm e2e:dashboard-live-data` (MAWS_DASHBOARD_LIVE_DATA=1; opt-in,
// outside every default list, Decision Log 2). Fixture-only and US$0: the built app on H's scratch connector scene in its
// live data mode (support/connector-scene.ts `{liveData: true}`), the installed engine started only by the owner's Start
// with no message, the unauthenticated stdio fixture server answering the rows its control file names, E2's agent seam
// for the `maws` server's real tools. The fixture's call log is the witness of every call and every silence; the
// dashboard's rendered views and source sheet are the witness of what the owner sees.
//
// One scene, in order (each later step stands on the state the earlier left):
//   1. the agent writes the dashboard and configures its query: drawn not fetched and not allowed (the view says the
//      missing grant before the missing session, editor/live.ts `livePauseOf`); the sheet says no live session and offers
//      Start, opens and closes from the keyboard, its live block whole at wide and narrow widths
//   2. the owner's Start from the sheet: one session, no message; nothing is called before the grant, and the agent's
//      own refresh is refused for want of it
//   3. Allow: the page's refresh draws the fetched rows, `server · tool`, the fetch time, by You
//   4. the owner's Refresh with the sheet open: the captured rows and time stay until Show latest
//   5. the schedule's next call; the agent's one-shot refresh as the started session publishes through the host's
//      registry (by the session, not You); its replay and a stale base call nothing
//   6. a malformed result (the owner's Refresh) and a tool error (the agent's) keep the rows and their time and say the
//      closed error, never the server's text
//   7. the agent replaces the query: the open sheet asks to be reopened; the new query is fetched with its arguments
//   8. silences longer than the schedule, each followed by exactly one catch-up: the tab inactive, the panel showing the
//      dashboard hidden, the window hidden, main killed with its supervisor, engine and server alive (then reopened on
//      the same launch)
//   9. a retained version previews its own rows and time with no live controls and no calls
//  10. a revoke during a slow call publishes nothing; the last rows stay and turn stale by expiry alone, uncalled
//  11. Restore brings the first rows back, past the latest two snapshots of their query (the version pin kept them),
//      and a closed and reopened tab keeps them
//  12. allowed again, then a scheduled refresh; an ordinary quit stops the engine
//  13. relaunched: the grant held, the schedule on, the dashboard on screen in the active tab, no eligible engine; ten real
//      minutes with no call, no new session and no new launch
// Route D (P3-HD's direct connector route) is its own named case, skipped while that runtime is absent (Decision Log 14).
import { mkdirSync } from 'node:fs';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { DATASET_STATES, utcTime } from '../src/artifacts/dashboard/states';
import { invoke, SERVER, TOOL, TOOL_NAME, value, wait, withScene, type ConnectorScene, type Run } from './support/connector-scene';
import { durable, ok, openInMain, openInPanel, refusalOf } from './support/dashboards';
import {
  agentDataset,
  agentOf,
  AUTHOR,
  barTips,
  BOARD,
  census,
  closeSheet,
  createBoard,
  dashboardTab,
  DATASET,
  drawsRows,
  fetched,
  HEAD,
  labelOf,
  liveBlock,
  liveViews,
  mainTab,
  nextCall,
  NOT_FETCHED,
  oneCatchUp,
  openSheet,
  previewViews,
  readDataset,
  rows,
  setPanel,
  sheetOf,
  silence,
  SOURCE,
  STALE_AFTER_S,
  startFromSheet,
  tableRows,
  TITLE,
  unclipped,
  userMessages,
  windowSize,
} from './support/live-data';
import { sidebarRow } from './support/sidebar';

test.skip(process.env.MAWS_DASHBOARD_LIVE_DATA !== '1', 'the live dataset acceptance runs under pnpm e2e:dashboard-live-data (MAWS_DASHBOARD_LIVE_DATA=1)');

const PROOF = 'test-results/dashboard-live-data';
const SOAK_MS = 10 * 60_000;
const SAMPLE_MS = 30_000;
// The host's recorded refresh errors (src/engine-host/dashboards/refresh.ts `refused`, query-result.ts's closed problems)
const REFUSED = 'the last refresh was refused: ';
const MALFORMED = `${REFUSED}its structured content is neither an array of rows nor an object with a rows array`;
// A tool error is the envelope's `isError` (query-result.ts) or, should the engine's mcp_call answer it as a failed call,
// the call's failure (refresh.ts FAILED.toolError): either is the host's closed wording, never the server's text.
const TOOL_ERROR = /the last refresh (was refused|failed): the tool reported an error/;
// The rows the fixture answers, step by step
const FIRST = [12, 18, 15];
const OWNERS = [12, 18, 15, 27];
const AGENTS = [12, 18, 15, 27, 31];
const TRIALS = [3, 5];
const NEVER = [99];
const AGAIN = [20, 22];

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(PROOF, { recursive: true });
  const path = `${PROOF}/${name}.png`;
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

const nativeVisible = (run: Run) => run.maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible());

test('granted live dataset: the owner’s grant, Start and controls, the agent’s refresh, silence while unseen, history, and ten minutes acquiring nothing', async () => {
  test.setTimeout(26 * 60_000);
  await withScene(
    'live-data',
    test.info(),
    async (scene: ConnectorScene) => {
      scene.fixtureReply({ reply: 'rows', rows: rows(...FIRST) });
      let run = await scene.launch();
      let page = run.page;
      const agent = agentOf(scene);
      let id = '';
      let tab: Locator;
      let views: Locator;
      let firstAt = 0;

      await test.step('1. the agent writes the dashboard and configures its query; the owner sees it not fetched and not allowed, the sheet offering Start for want of a session', async () => {
        id = await createBoard(scene, page, agent);
        tab = await openInMain(page, id);
        views = liveViews(tab);
        // ungranted, the view names the grant first; the sheet below says the session is missing too
        await expect(labelOf(views)).toHaveText(`${NOT_FETCHED} · ${DATASET_STATES.notAllowed}`, { timeout: 20_000 });
        await expect(tableRows(views)).toHaveCount(0);
        // the keyboard's way to the sheet and back
        await labelOf(views).focus();
        await page.keyboard.press('Enter');
        const sheet = sheetOf(page);
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
        const block = liveBlock(sheet);
        await expect(block.getByText(TOOL_NAME, { exact: true })).toBeVisible();
        await expect(block).toContainText('Not allowed');
        await expect(block, 'the watch found no live route').toContainText('No live session for this dashboard has this server.', { timeout: 20_000 });
        await expect(block.getByRole('button', { name: 'Start session', exact: true })).toBeEnabled();
        expect(await unclipped(block), 'the live block whole at 1440 px').toEqual([]);
        await shot(page, 'paused-no-session-wide');
        await windowSize(run, 820, 900);
        await expect.poll(() => unclipped(block), { message: 'the live block whole at 820 px' }).toEqual([]);
        await shot(page, 'paused-no-session-narrow');
        await windowSize(run, 1440, 900);
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
        await expect(labelOf(views), 'the focus back on the label that opened it').toBeFocused();
        expect(scene.toolCalls(), 'nothing called before any session').toEqual([]);
      });

      let engine = { appSessionId: '', launchId: '', pid: 0 };
      let server = 0;
      await test.step('2. the owner’s Start from the sheet: one session, no message; nothing is called before the grant', async () => {
        const sheet = await openSheet(views);
        const block = liveBlock(sheet);
        engine = await startFromSheet(scene, page, block);
        expect(userMessages(scene, engine.appSessionId), 'the Start sent no message').toBe(0);
        expect(scene.launches(engine.appSessionId)).toEqual({ spawns: 1, exits: 0 });
        await expect(block).toContainText('Not allowed', { timeout: 30_000 });
        await expect(block).toContainText('Allow it to read before this dashboard can refresh it.');
        await expect(block.getByRole('button', { name: 'Start session', exact: true }), 'the route found: no Start offered').toHaveCount(0);
        await expect(labelOf(views)).toHaveText(`${NOT_FETCHED} · ${DATASET_STATES.notAllowed}`);
        await shot(page, 'not-allowed-wide');
        const refused = await agentDataset(page, agent, engine.appSessionId, id, { refresh: true });
        expect(refusalOf(refused)).toMatchObject({ reason: 'unavailable', dataset: DATASET });
        expect(refused.text).toContain(`the owner has not granted ${TOOL_NAME} to this dashboard`);
        expect(scene.toolCalls(), 'nothing called before the grant').toEqual([]);
        await closeSheet(sheet);
      });

      await test.step('3. Allow: the page’s refresh draws the fetched rows, server · tool and the fetch time, by You', async () => {
        const sheet = await openSheet(views);
        const block = liveBlock(sheet);
        const allowedAt = Date.now();
        await block.getByRole('button', { name: `Allow ${TOOL_NAME} to read` }).click();
        await expect(block).toContainText('Allowed to read');
        await expect(block).toContainText('Refreshes every 30 seconds while this dashboard is on screen');
        const first = await nextCall(scene, allowedAt);
        expect(first).toMatchObject({ server: 'series', tool: TOOL, arguments: SOURCE.args });
        server = first.pid;
        await closeSheet(sheet);
        await drawsRows(views, FIRST, 'the first fetch');
        const read = await readDataset(agent, AUTHOR, id);
        expect(read.updated).toMatchObject({ by: 'user' });
        expect(read.at!, 'fetched after the call was made').toBeGreaterThanOrEqual(Date.parse(first.at) - 1_000);
        await expect(labelOf(views)).toHaveText(fetched(read.at!, 'You'));
        firstAt = read.at!;
        await ok(page, 'artifacts.saveVersion', { artifactId: id, label: 'First rows' });
        await shot(page, 'allowed-rows-wide');
      });

      await test.step('4. the owner’s Refresh with the sheet open: the captured rows and time stay until Show latest', async () => {
        scene.fixtureReply({ reply: 'rows', rows: rows(...OWNERS) });
        const sheet = await openSheet(views);
        const block = liveBlock(sheet);
        const captured = sheet.getByRole('table', { name: 'Rows' });
        await expect(captured).toHaveAttribute('aria-rowcount', String(FIRST.length + 1));
        const before = Date.now();
        await block.getByRole('button', { name: `Refresh ${TITLE}` }).click();
        await nextCall(scene, before);
        await drawsRows(views, OWNERS, 'the owner’s refresh');
        await expect(block).toContainText('Newer rows were fetched at');
        await expect(captured, 'the sheet keeps the rows it captured').toHaveAttribute('aria-rowcount', String(FIRST.length + 1));
        await block.getByRole('button', { name: 'Show latest' }).click();
        await expect(sheet.getByRole('table', { name: 'Rows' })).toHaveAttribute('aria-rowcount', String(OWNERS.length + 1));
        await closeSheet(sheet);
        const read = await readDataset(agent, AUTHOR, id);
        expect(read.updated).toMatchObject({ by: 'user' });
        await expect(labelOf(views)).toHaveText(fetched(read.at!, 'You'));
      });

      await test.step('5. the schedule’s next call; the agent’s one-shot refresh publishes as the started session; its replay and a stale base call nothing', async () => {
        // the 30-second schedule at work while shown; the agent then asks right after it, so no scheduled refresh
        // overtakes the agent's in what the label is read for
        const last = scene.toolCalls().at(-1)!;
        const scheduled = await nextCall(scene, Date.parse(last.at) + 1, 40_000);
        expect(Date.parse(scheduled.at) - Date.parse(last.at), 'the scheduled call within the schedule (and a margin)').toBeLessThanOrEqual(35_000);
        await wait(2_000);
        scene.fixtureReply({ reply: 'rows', rows: rows(...AGENTS) });
        const before = Date.now();
        const asked = await agentDataset<{ status: string; id: string; rows: number; revision: number }>(page, agent, engine.appSessionId, id, { refresh: true });
        expect(asked.isError, asked.text).toBe(false);
        expect(asked.result).toMatchObject({ status: 'dataset', id: DATASET, rows: AGENTS.length });
        expect(scene.toolCallsBetween(before, Date.now()).filter((call) => call.pid === server), 'the agent’s call reached the started session’s server').not.toHaveLength(0);
        await drawsRows(views, AGENTS, 'the agent’s refresh');
        const read = await readDataset(agent, engine.appSessionId, id);
        expect(read.updated, 'the session is the actor').toMatchObject({ by: 'this session', appSessionId: engine.appSessionId });
        await expect(labelOf(views)).toHaveText(fetched(read.at!, 'session'));
        await shot(page, 'agent-refresh-wide');

        const replayFrom = Date.now();
        const replay = await agent.call(engine.appSessionId, 'artifact_dataset', { artifact: id, id: DATASET, refresh: true, baseRevision: asked.result!.revision }, { toolUseId: asked.toolUseId });
        expect(replay.result, 'a replay answers the first result').toEqual(asked.result);
        expect(scene.toolCallsBetween(replayFrom, Date.now()), 'a replay calls nothing').toEqual([]);
        const staleFrom = Date.now();
        const stale = await agent.call(engine.appSessionId, 'artifact_dataset', { artifact: id, id: DATASET, refresh: true, baseRevision: asked.result!.revision - 1 });
        expect(refusalOf(stale)).toMatchObject({ reason: 'conflict', dataset: DATASET });
        expect(scene.toolCallsBetween(staleFrom, Date.now()), 'a stale base calls nothing').toEqual([]);
      });

      await test.step('6. a malformed result and a tool error keep the rows and their time, and say the closed error', async () => {
        scene.fixtureReply({ reply: 'invalid' }); // first, so no later call publishes rows that would move the time read next
        const kept = await readDataset(agent, AUTHOR, id);
        const sheet = await openSheet(views);
        const before = Date.now();
        await liveBlock(sheet).getByRole('button', { name: `Refresh ${TITLE}` }).click();
        await nextCall(scene, before);
        await expect(labelOf(views)).toContainText(MALFORMED, { timeout: 20_000 });
        await expect(labelOf(views)).not.toContainText('not rows');
        await drawsRows(views, AGENTS, 'after the malformed result');
        await shot(page, 'malformed-kept-wide');
        await closeSheet(sheet);
        scene.fixtureReply({ reply: 'isError' });
        const failed = await agentDataset(page, agent, engine.appSessionId, id, { refresh: true });
        expect(failed.isError, failed.text).toBe(false);
        expect(failed.result).toMatchObject({ status: 'dataset', rows: AGENTS.length, state: { status: 'error', message: expect.stringMatching(TOOL_ERROR) } });
        await expect(labelOf(views)).toContainText(TOOL_ERROR);
        await expect(labelOf(views)).not.toContainText('the series is unavailable');
        await drawsRows(views, AGENTS, 'after the tool error');
        const after = await readDataset(agent, AUTHOR, id);
        expect(after.at, 'a failure never moves the fetch time').toBe(kept.at);
        expect(after.state).toMatchObject({ status: 'error' });
      });

      await test.step('7. the agent replaces the query: the open sheet asks to be reopened; the new query is fetched with its own arguments', async () => {
        scene.fixtureReply({ reply: 'rows', rows: rows(...TRIALS) });
        const sheet = await openSheet(views);
        const before = Date.now();
        const replaced = await agentDataset(page, agent, engine.appSessionId, id, { title: TITLE, source: { ...SOURCE, args: { series: 'trials' } } });
        expect(replaced.isError, replaced.text).toBe(false);
        await expect(liveBlock(sheet)).toContainText('This query was replaced or removed after the source opened');
        const call = await nextCall(scene, before);
        expect(call.arguments, 'the new query’s own arguments').toEqual({ series: 'trials' });
        await drawsRows(views, TRIALS, 'the replaced query');
        await liveBlock(sheet).getByRole('button', { name: 'Show current' }).click();
        await expect(liveBlock(sheet)).toContainText('Allowed to read');
        await closeSheet(sheet);
      });

      await test.step('8a. the dashboard’s tab inactive: no call; the panel showing it hidden: no call, one catch-up when shown', async () => {
        await setPanel(page, false);
        await (await sidebarRow(page, { appSessionId: engine.appSessionId })).click();
        await expect(tab.locator('.ds-doc').first()).toBeHidden();
        await expect(page.getByRole('button', { name: `Close ${BOARD}`, exact: true }), 'the dashboard’s tab stays open, inactive').toHaveCount(1);
        await wait(1_000);
        await silence(scene, 'the dashboard’s tab is inactive');
        await setPanel(page, true);
        const panel = page.locator('[data-region="panel"]');
        await panel.getByRole('button', { name: 'Add a tool' }).click();
        await page.getByRole('menuitem', { name: 'Artifacts' }).click();
        const shownAt = Date.now();
        const record = await openInPanel(page, id);
        await nextCall(scene, shownAt);
        await drawsRows(liveViews(record), TRIALS, 'the dashboard in the panel');
        await wait(2_000);
        await setPanel(page, false);
        const hidden = await silence(scene, 'the panel showing the dashboard is hidden');
        await setPanel(page, true);
        await oneCatchUp(scene, hidden.to, 'the panel shown again');
        await setPanel(page, false);
        await wait(1_000);
        const back = Date.now();
        tab = await openInMain(page, id);
        views = liveViews(tab);
        await oneCatchUp(scene, back, 'the dashboard’s tab active again');
      });

      await test.step('8b. the window hidden: no call; shown: one catch-up', async () => {
        await scene.hideWindow(run);
        const hidden = await silence(scene, 'the window is hidden');
        await scene.showWindow(run);
        await oneCatchUp(scene, hidden.to, 'the window shown again');
      });

      await test.step('8c. main killed with its supervisor, engine and server alive: no call; reopened on the same launch: one catch-up', async () => {
        const supervisor = await scene.supervisor(page);
        scene.note('pids', { supervisor, engine: engine.pid, server, launchId: engine.launchId });
        await scene.killApp(run);
        const closed = await silence(scene, 'main is closed and its engine lives on');
        expect([supervisor, engine.pid, server].map((pid) => scene.pidAlive(pid)), 'the supervisor, the engine and the server live on').toEqual([true, true, true]);
        run = await scene.launch();
        page = run.page;
        expect(await scene.supervisor(page), 'the same supervisor').toBe(supervisor);
        expect(await scene.live(page), 'the same launch, no other').toEqual([engine]);
        expect(scene.launches(engine.appSessionId), 'one launch, never exited').toEqual({ spawns: 1, exits: 0 });
        tab = await dashboardTab(page, id, scene);
        views = liveViews(tab);
        await oneCatchUp(scene, closed.to, 'the reopened dashboard');
        expect(scene.toolCallsBetween(closed.to, Date.now()), 'through the same engine’s server').toMatchObject([{ pid: server, tool: TOOL }]);
        await drawsRows(views, TRIALS, 'the reopened dashboard');
      });

      await test.step('9. a retained version previews its own rows and time, with no live controls and no calls', async () => {
        const rail = tab.getByRole('complementary', { name: 'Version history' });
        if (!(await rail.isVisible())) await tab.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Version history' }).click();
        await rail.getByRole('button', { name: /^Version First rows/ }).click();
        const bar = tab.getByRole('toolbar', { name: 'Version preview' });
        await expect(bar).toBeVisible({ timeout: 15_000 });
        const previewed = previewViews(tab);
        await drawsRows(previewed, FIRST, 'the retained version');
        await expect(labelOf(previewed)).toHaveText(`${HEAD} · updated ${utcTime(firstAt)} by You`);
        // the header's Datasets inspects the version shown: its rows, and no live controls
        await page.locator('[data-region="main"] [data-editor-header]').getByRole('button', { name: 'More actions' }).click();
        await page.getByRole('menuitemcheckbox', { name: 'Datasets' }).click();
        const sheet = page.getByRole('dialog', { name: new RegExp(`^(Source of ${TITLE}|Datasets)$`) });
        await expect(sheet.getByRole('table', { name: 'Rows' })).toHaveAttribute('aria-rowcount', String(FIRST.length + 1));
        await expect(liveBlock(sheet)).toHaveCount(0);
        await shot(page, 'preview-read-only-wide');
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
        const previewing = await silence(scene, 'a retained version is previewed');
        await bar.getByRole('button', { name: 'Back to document' }).click();
        await expect(bar).toBeHidden();
        await oneCatchUp(scene, previewing.to, 'back on the live document');
      });

      let revokedAt = 0;
      await test.step('10. a revoke during a slow call publishes nothing; the last rows stay and turn stale by expiry alone', async () => {
        const kept = await readDataset(agent, AUTHOR, id);
        expect(kept.rows).toBe(TRIALS.length);
        const sheet = await openSheet(views);
        const block = liveBlock(sheet);
        scene.fixtureReply({ reply: 'rows', rows: rows(...NEVER), delayMs: 8_000 });
        await nextCall(scene, Date.now(), 40_000); // the schedule's next call, answered 8 s later
        await block.getByRole('button', { name: `Revoke ${TOOL_NAME}` }).click();
        revokedAt = Date.now();
        await expect(block).toContainText('Not allowed');
        await wait(10_000);
        await drawsRows(views, TRIALS, 'after the revoked slow call');
        const after = await readDataset(agent, AUTHOR, id);
        expect(after.at, 'nothing published after the revoke').toBe(kept.at);
        await closeSheet(sheet);
        const staleAt = kept.at! + STALE_AFTER_S * 1_000;
        await expect(labelOf(views)).toContainText(DATASET_STATES.staleSince(staleAt), { timeout: Math.max(0, staleAt - Date.now()) + 20_000 });
        await expect(labelOf(views)).toContainText(DATASET_STATES.notAllowed);
        await wait(Math.max(0, revokedAt + 35_000 - Date.now()));
        expect(scene.toolCallsBetween(revokedAt, Date.now()), 'no call after the revoke, the stale label from expiry alone').toEqual([]);
        await shot(page, 'revoked-stale-wide');
      });

      await test.step('11. Restore brings the first rows back past the latest two snapshots of their query, and a reopened tab keeps them', async () => {
        const rail = tab.getByRole('complementary', { name: 'Version history' });
        if (!(await rail.isVisible())) await tab.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Version history' }).click();
        await rail.getByRole('button', { name: /^Version First rows/ }).click();
        const bar = tab.getByRole('toolbar', { name: 'Version preview' });
        await bar.getByRole('button', { name: 'Restore this version' }).click();
        await tab.getByRole('alertdialog', { name: 'Restore this version?' }).getByRole('button', { name: 'Restore', exact: true }).click();
        await expect(tab.getByRole('status', { name: 'Restored' })).toContainText('Restored from First rows', { timeout: 15_000 });
        await drawsRows(views, FIRST, 'the restored rows');
        await expect(labelOf(views)).toHaveText(fetched(firstAt, 'You'));
        await durable(tab);
        await page.getByRole('button', { name: `Close ${BOARD}`, exact: true }).click();
        await expect(mainTab(page, id)).toHaveCount(0);
        tab = await openInMain(page, id);
        views = liveViews(tab);
        await drawsRows(views, FIRST, 'the restored rows, reopened');
        expect(await barTips(views)).not.toContain('W1 · signups: 99');
        expect(scene.toolCallsBetween(revokedAt, Date.now()), 'revoked, the restored query is not called').toEqual([]);
      });

      await test.step('12. allowed again, the page reads at once, then on schedule; an ordinary quit stops the engine', async () => {
        scene.fixtureReply({ reply: 'rows', rows: rows(...AGAIN) });
        const sheet = await openSheet(views);
        const allowedAt = Date.now();
        await liveBlock(sheet).getByRole('button', { name: `Allow ${TOOL_NAME} to read` }).click();
        await nextCall(scene, allowedAt);
        await closeSheet(sheet);
        await drawsRows(views, AGAIN, 'allowed again');
        const scheduled = await nextCall(scene, Date.now(), 40_000);
        await expect.poll(async () => (await readDataset(agent, AUTHOR, id)).at!, { timeout: 15_000, message: 'the scheduled refresh published' }).toBeGreaterThanOrEqual(Date.parse(scheduled.at) - 1_000);
        await scene.quit(run);
        await expect.poll(() => scene.pidAlive(engine.pid), { timeout: 30_000, message: 'the engine stopped with the app' }).toBe(false);
      });

      await test.step('13. relaunched with the grant held, the schedule on and the dashboard on screen: ten real minutes with no route call nothing and acquire nothing', async () => {
        run = await scene.launch();
        page = run.page;
        expect(await scene.live(page), 'no engine after the relaunch').toEqual([]);
        tab = await dashboardTab(page, id, scene);
        views = liveViews(tab);
        await expect(labelOf(views)).toContainText(DATASET_STATES.paused, { timeout: 30_000 });
        await drawsRows(views, AGAIN, 'the last rows after the relaunch');
        expect(value(await invoke(page, 'artifacts.connectorGrants', { artifactId: id })).grants, 'the grant persisted').toEqual([expect.objectContaining({ server: SERVER, tool: TOOL })]);
        const sheet = await openSheet(views);
        const block = liveBlock(sheet);
        await expect(block).toContainText('Allowed to read');
        await expect(block).toContainText('Refreshes every 30 seconds while this dashboard is on screen');
        await expect(block.getByRole('button', { name: 'Start session', exact: true })).toBeVisible();
        await shot(page, 'soak-paused-wide');
        await closeSheet(sheet);
        // Route D: no direct connector route exists on this branch (P3-HD has not landed; Decision Log 14). With it
        // present, this scene must prove that route absent independently of the engine's absence.
        test.info().annotations.push({ type: 'route D', description: 'absent: P3-HD’s direct connector runtime is not on this branch' });

        const baseline = await census(scene, page);
        expect(baseline.live, 'no eligible engine: none live').toBe(0);
        const from = Date.now();
        const samples: unknown[] = [];
        while (Date.now() - from < SOAK_MS) {
          await wait(Math.min(SAMPLE_MS, from + SOAK_MS - Date.now()));
          const now = await census(scene, page);
          const native = await nativeVisible(run);
          const label = (await labelOf(views).textContent()) ?? '';
          samples.push({ at: new Date().toISOString(), ...now, native, label });
          expect(now, 'no new session, no new launch, nothing live').toEqual(baseline);
          expect(native, 'the window stays on screen').toBe(true);
          await expect(tab.locator('.ds-doc').first(), 'the dashboard stays the active tab').toBeVisible();
          expect(label, 'still paused for want of a session').toContain(DATASET_STATES.paused);
        }
        const to = Date.now();
        expect(scene.toolCallsBetween(from, to), 'no call in ten minutes').toEqual([]);
        scene.note('soak', { from: new Date(from).toISOString(), to: new Date(to).toISOString(), baseline });
        await test.info().attach('soak-samples.json', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
      });
    },
    { liveData: true },
  );
});

test('route D: with no engine holding the server, the same dashboard refreshes over the direct route (P3-HD)', () => {
  // A named dependency (E3 Decision Log 14): P3-HD's direct connector route is not on this branch, so there is nothing
  // to drive and no as-built name to drive it by. Once HD lands, its corrective writes this case into the scene above.
  test.skip(true, 'P3-HD’s direct connector route has not landed on this branch (E3 Decision Log 14)');
});
