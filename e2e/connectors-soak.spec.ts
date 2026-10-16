// P3-H H4: the connector soak (`pnpm e2e:connectors-soak`, MAWS_CONNECTORS_SOAK=1; outside the class-1 e2e set, run
// once before P3-H's hand-back on the Mac lane with `--evidence`; gate-offload Decision Log 49 as amended). The product
// scene of e2e/connectors.spec.ts (support/connector-scene.ts: the built app, a detached host, a scratch profile and
// HOME, the fixture MCP server in its scratch config, the owner's HTML page watching the fixture's read-only tool at
// 30 s, the one session the owner's Start launched from the header), held in real time, the fixture's call log the
// witness:
//   1. five real minutes with the window hidden: no call, no engine acquired; shown again, exactly one catch-up call;
//   2. five real minutes with main closed (killed; the detached supervisor, its engine and the fixture server live on, as
//      after a crash or a forced quit): no call, the supervisor's, the engine's and the server's pids unchanged;
//   3. relaunched on the same profile: the same supervisor, the same launch (id and pid, one `spawn` and no `exit` in
//      its journal), the grant held, and the page reads again through that same engine and server, with no new grant;
//   4. revoked from the header: the page reads it, nothing more is called; the artifact deleted: its grant gone;
//   5. an ordinary idle quit stops the engine, and a relaunch acquires none (the page's timer asks for a route only).
// Evidence: the call log and the timeline (pids, launches, the hidden and closed spans) attached to the test.
import { test, expect, type Locator } from '@playwright/test';
import { invoke, TOOL, TOOL_NAME, value, wait, WATCH_MS, withScene } from './support/connector-scene';

test.skip(process.env.MAWS_CONNECTORS_SOAK !== '1', 'the connector soak runs under pnpm e2e:connectors-soak (MAWS_CONNECTORS_SOAK=1)');

const SOAK_MS = 5 * 60_000;
const row = (sheet: Locator) => sheet.locator(`[data-connector-tool="${TOOL_NAME}"]`);

test('soak: hidden five minutes and closed five minutes with the engine live, nothing is called and nothing acquired; the grant and the launch outlive main', async () => {
  test.setTimeout(22 * 60_000);
  await withScene('soak', test.info(), async (scene) => {
    const first = await scene.launch();
    expect(await first.page.evaluate(() => document.visibilityState), 'the app’s window is visible (the e2e quiet mode keeps native visibility)').toBe('visible');
    const supervisor = await scene.supervisor(first.page);
    const artifactId = await scene.createPage(first.page);
    let { frame } = await scene.openPage(first.page, artifactId);
    await expect(frame.locator('#last')).toHaveText('paused:noRoute', { timeout: 20_000 });
    const engine = await scene.ownerStart(first.page); // the owner's Start: the one session of the run
    await expect(frame.locator('#last')).toHaveText('revoked:notGranted', { timeout: WATCH_MS + 15_000 });
    let sheet = await scene.openSheet(first.page);
    await row(sheet).getByRole('button', { name: `Allow ${TOOL_NAME} to read` }).click();
    await expect(row(sheet).locator('[data-connector-state]')).toContainText('Allowed to read');
    await scene.closeSheet(first.page);
    await expect(frame.locator('#last')).toHaveText('ok n=1 via=engine', { timeout: 20_000 });
    const server = scene.toolCalls()[0]!.pid;
    scene.note('pids', { supervisor, engine: engine.pid, server, launchId: engine.launchId });

    // 1. hidden five real minutes, then one catch-up
    await scene.hideWindow(first);
    const hiddenAt = Date.now();
    await wait(SOAK_MS);
    const shownAt = Date.now();
    expect(scene.toolCallsBetween(hiddenAt, shownAt), 'no call while hidden').toEqual([]);
    expect(await scene.live(first.page), 'no engine acquired while hidden').toEqual([engine]);
    await scene.showWindow(first);
    await expect(frame.locator('#last')).toHaveText('ok n=2 via=engine', { timeout: 15_000 });
    await wait(5_000);
    expect(scene.toolCallsBetween(shownAt, Date.now()), 'exactly one catch-up call when shown').toHaveLength(1);
    scene.note('hidden span', { from: new Date(hiddenAt).toISOString(), to: new Date(shownAt).toISOString() });

    // 2. main closed five real minutes, the detached engine alive
    await scene.killApp(first);
    const closedAt = Date.now();
    await wait(SOAK_MS);
    const reopenedAt = Date.now();
    expect(scene.toolCallsBetween(closedAt, reopenedAt), 'no call while main is closed').toEqual([]);
    expect([supervisor, engine.pid, server].map((pid) => scene.pidAlive(pid)), 'the supervisor, the engine and the server live on').toEqual([true, true, true]);
    scene.note('closed span', { from: new Date(closedAt).toISOString(), to: new Date(reopenedAt).toISOString() });

    // 3. relaunched on the same profile: the same supervisor and launch; the held grant serves the page again
    const second = await scene.launch();
    expect(await scene.supervisor(second.page), 'the same supervisor').toBe(supervisor);
    expect(await scene.live(second.page), 'the same launch, no other').toEqual([engine]);
    expect(scene.launches(engine.appSessionId), 'one launch, never exited').toEqual({ spawns: 1, exits: 0 });
    ({ frame } = await scene.restoredPage(second.page, artifactId)); // the restored page's one load, never navigated again
    await expect(frame.locator('#last')).toHaveText('ok n=3 via=engine', { timeout: 20_000 });
    await wait(5_000);
    expect(scene.toolCallsBetween(reopenedAt, Date.now()), 'the restored page read once').toMatchObject([{ pid: server, tool: TOOL }]);
    sheet = await scene.openSheet(second.page);
    await expect(row(sheet).locator('[data-connector-state]')).toContainText('Allowed to read');

    // 4. revoked, then deleted
    await row(sheet).getByRole('button', { name: `Revoke ${TOOL_NAME}` }).click();
    await expect(frame.locator('#last')).toHaveText('revoked:revoked');
    const revoked = scene.toolCalls().length;
    await scene.closeSheet(second.page);
    await wait(WATCH_MS + 5_000);
    expect(scene.toolCalls(), 'no call after the revoke').toHaveLength(revoked);
    expect(value(await invoke(second.page, 'artifacts.connectorGrants', { artifactId })).grants).toEqual([]);
    sheet = await scene.openSheet(second.page);
    await row(sheet).getByRole('button', { name: `Allow ${TOOL_NAME} to read` }).click();
    await expect(row(sheet).locator('[data-connector-state]')).toContainText('Allowed to read');
    await scene.closeSheet(second.page);
    await expect(frame.locator('#last')).toHaveText('ok n=4 via=engine', { timeout: 20_000 });
    value(await invoke(second.page, 'artifacts.delete', { artifactId }));
    const gone = await invoke(second.page, 'artifacts.connectorGrants', { artifactId });
    expect(gone.ok ? gone.value.grants : [], 'a deleted artifact holds no grant').toEqual([]);
    const deleted = scene.toolCalls().length;
    await wait(WATCH_MS + 5_000);
    expect(scene.toolCalls(), 'nothing is called for a deleted artifact').toHaveLength(deleted);

    // 5. an ordinary idle quit stops the engine; a relaunch acquires none
    await scene.quit(second);
    await expect.poll(() => scene.pidAlive(engine.pid), { timeout: 30_000, message: 'the engine stopped with the app' }).toBe(false);
    const third = await scene.launch();
    await wait(WATCH_MS);
    expect(await scene.live(third.page), 'no engine acquired after the relaunch').toEqual([]);
    expect(scene.launches(engine.appSessionId).spawns).toBe(1);
    expect(scene.toolCalls().every((entry) => entry.tool === undefined || entry.tool === TOOL)).toBe(true);
  });
});
