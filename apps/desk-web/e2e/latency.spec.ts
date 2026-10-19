// Desk ticket #57's instrument in a real browser against DC3's fake machine (`fake-machine.ts`) and DC5's DX3 double,
// whose relay costs next to nothing, so the numbers are the web's own share of each hop: its processing, its
// verification, and its drawing. With the readout on, the suite opens a session view (its first rows), lets a response
// stream and settle, sends an owner message (acknowledged, delivered, and its framed row written), and has the session
// log a message and raise a question; then it attaches `window.deskLatency()` to the run's report and checks, loosely,
// that every hop it exercised was timed and none is absurd. Paths timed from the recording's own stamps (a replayed
// row's engine timestamp, a request's call row) carry the recording's age rather than a latency, and are reported, not
// bounded; a chunk carries the fake machine's own stamp (`t`, taken as it sends, on this host), so it is bounded.
import type { Locator, Page } from '@playwright/test';
import type { JsonObject } from 'desk-hub/protocol';
import type { LatencyPath, LatencyReport } from '../src/latency/latency';
import { FakeMachineReplay } from './fake-machine';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, stageProject } from './scene';
import type { HubDouble } from '../test/double/hub-double';

const MACHINE = 'fake';
const ALIAS = 'fakerec';

let pageErrors: string[] = [];
let fm: FakeMachineReplay | null = null;
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) pageErrors.push(message.text());
  });
});
test.afterEach(() => {
  fm?.stop();
  fm = null;
  expect(pageErrors).toEqual([]);
});

const streamingRows = (scope: Locator) => scope.locator('[data-row-id^="desk-stream:"]');
const readout = (page: Page) => page.evaluate(() => (window as unknown as { deskLatency: () => LatencyReport }).deskLatency());

async function openSession(page: Page, hub: HubDouble): Promise<{ fm: FakeMachineReplay; view: Locator }> {
  await page.addInitScript(() => localStorage.setItem('desk.latency', '1'));
  await stageProject(hub);
  const replay = (fm = new FakeMachineReplay(hub, { project: PROJECT, machine: MACHINE }));
  const policy = { read_only: false, ceiling: 'default' };
  hub.setMachines(PROJECT, [
    { machine: 'mini', online: true, policy, checkouts: [] },
    { machine: 'SK.local', online: true, policy, checkouts: [] },
    { machine: MACHINE, online: true, policy, checkouts: [{ path: replay.recording.cwd, branch: 'main' }] },
  ]);
  await hub.append(PROJECT, { writer: `${MACHINE}/${replay.session}`, kind: 'joined', session: replay.session, alias: ALIAS, name_source: 'user', machine: MACHINE, cwd: replay.recording.cwd, worktree: '', role: '', seat: '', by: '' });
  replay.sendPresence();
  // The session has run up to its `<message>` answer: the view opens on rows.
  const answer = replay.recording.rows.main.find((row) => JSON.stringify(row.message ?? {}).includes('<message>You chose'))!.uuid;
  replay.step(replay.firstChunkOf(answer) - replay.played);
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${replay.session}`);
  const view = page.getByTestId('session-view');
  await expect(view).toHaveAttribute('data-session', replay.session);
  await expect.poll(() => replay.subscriptions()).toBe(1);
  return { fm: replay, view };
}

test('with the readout on, every hop the web sees is timed, and window.deskLatency() reports each path', async ({ page, hub }) => {
  const { fm, view } = await openSession(page, hub);
  await expect(page.getByTestId('latency-overlay')).toBeVisible();

  // A response streams and settles.
  fm.playThrough((s) => s.k === 'row' && s.agentId === null && JSON.stringify(s.row.message ?? {}).includes('<message>You chose'));
  await expect(view).toContainText('You chose blue');
  await expect(streamingRows(view)).toHaveCount(0);

  // The owner sends a message: acknowledged by the hub, delivered by the machine, and written as its framed row.
  const text = 'Measure this one, please.';
  await page.getByRole('textbox', { name: `Message ${ALIAS}` }).fill(text);
  await page.getByTestId('composer').getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => hub.logOf(PROJECT).some((e) => e.event.text === text)).toBe(true);
  const event = hub.logOf(PROJECT).find((e) => e.event.text === text)!.event;
  await expect.poll(async () => (await readout(page)).paths['owner.ack']?.n ?? 0).toBe(1);
  await hub.deliver(PROJECT, MACHINE, { event: { writer: event.writer, seq: event.seq }, session: fm.session, outcome: 'delivered', reason: 'submitted to the session' });
  const last = fm.recording.rows.main.at(-1)!;
  const framed: JsonObject = {
    type: 'user',
    uuid: 'latency-framed-row',
    parentUuid: last.uuid,
    isSidechain: false,
    timestamp: new Date().toISOString(),
    sessionId: fm.session,
    origin: { kind: 'plugin', name: 'doperpowers', asUser: true },
    message: { role: 'user', content: `[sminos chat MAWS ${event.writer}:${event.seq} from human → @you]\n${text}` },
  };
  fm.depth.apply({ at: 0, k: 'row', agentId: null, row: framed as never });
  await expect(view.locator('[data-kind="user"]').filter({ hasText: text })).toHaveCount(1);

  // The session logs a message to its human, and raises a question.
  await hub.append(PROJECT, { writer: `${MACHINE}/${fm.session}`, kind: 'message', from: ALIAS, to: 'host', text: 'Measured.', src: 'latency-framed-row#0' });
  await fm.raiseRecordedQuestion();

  // The fake machine stamps each chunk it sends (`t`, as the machine's plane passes the bridge's through), on this host.
  const exercised: LatencyPath[] = ['view.snapshot', 'view.drawn', 'view.first-rows', 'stream.chunk', 'stream.row', 'owner.ack', 'owner.delivered', 'owner.row', 'session.message', 'request.drawn'];
  await expect
    .poll(
      async () => {
        const { paths } = await readout(page);
        return exercised.filter((path) => !paths[path]);
      },
      { timeout: 10_000 },
    )
    .toEqual([]);
  const report = await readout(page);
  await test.info().attach('desk-latency', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  // Also in the run's log, which the gate keeps when the report is not uploaded (the list reporter writes no files).
  console.log(`[desk latency e2e] ${JSON.stringify(report.paths)}`);
  expect(report.on).toBe(true);
  // Bounded only where both ends are on this host's clocks: the browser's, or the double's stamp on what it logs.
  const bounded: LatencyPath[] = ['view.snapshot', 'view.drawn', 'view.first-rows', 'stream.chunk', 'owner.ack', 'owner.delivered', 'owner.row', 'session.message', 'request.drawn'];
  for (const path of bounded) expect(report.paths[path]!.p95, `${path}'s p95`).toBeLessThan(5000);
});
