// M3 of the DC9 plan, in a real browser: a direct channel's center on a desktop is the session view — MAWS's report
// over the session's own transcript (the composite's §9.1), against DC3's fake machine replaying its committed
// `two-subagents` recording through DC5's DX3 double (`fake-machine.ts`): its `<message>` spans and questions, one
// working record per marked turn, an unmarked turn whole; the Report · Transcript toggle and back; a reload drawing the
// same rows; a marked response folding its turn while it streams, and settling with no double. Older rows page in at
// the top of the view until the first row, on a live session and on one that ended while the view was open, against
// the recorded session's plane (`depth-player.ts`), whose snapshots can be cut short (the fake machine's recording fits
// one snapshot). The column and the center share one subscription.
import type { Locator, Page } from '@playwright/test';
import type { Step } from 'desk-hub/fake-machine';
import { DepthPlayer } from './depth-player';
import { FakeMachineReplay } from './fake-machine';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, S, stageProject } from './scene';
import type { HubDouble } from '../test/double/hub-double';

const MACHINE = 'fake';
const ANSWER = 'You chose blue';
const streamingRows = (scope: Locator) => scope.locator('[data-row-id^="desk-stream:"]');
const records = (scope: Locator) => scope.locator('[data-row-id^="owner-record:"]');
const rowIds = (scope: Locator) => scope.locator('[data-row-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-row-id')));
const occurrences = (scope: Locator, text: string) => scope.evaluate((el, t) => (el.textContent ?? '').split(t).length - 1, text);
const toggle = (page: Page, view: 'Report' | 'Transcript') => page.getByRole('group', { name: 'Session view' }).getByRole('button', { name: view });

/** Every row the view draws, in order, its virtualized list walked from the top to the end. */
async function allRowIds(scope: Locator): Promise<string[]> {
  const scroller = scope.locator('[data-transcript-scroller]').first();
  const ids: string[] = [];
  await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
  for (let i = 0; i < 100; i++) {
    await scope.page().waitForTimeout(60);
    for (const id of await rowIds(scope)) if (id !== null && !ids.includes(id)) ids.push(id);
    const atEnd = await scroller.evaluate((el) => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) return true;
      el.scrollBy({ top: el.clientHeight * 0.8 });
      return false;
    });
    if (atEnd) return ids;
  }
  throw new Error(`the transcript's end was not reached in 100 windows (${ids.length} rows taken)`);
}

let pageErrors: string[] = [];
let fm: FakeMachineReplay | null = null;
let player: DepthPlayer | null = null;
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
  player?.stop();
  player = null;
  expect(pageErrors).toEqual([]);
});

/** The fake machine enrolled with its session joined, and the browser on that session's channel. */
async function openSession(page: Page, hub: HubDouble): Promise<{ fm: FakeMachineReplay; view: Locator }> {
  await stageProject(hub);
  const replay = (fm = new FakeMachineReplay(hub, { project: PROJECT, machine: MACHINE }));
  const policy = { read_only: false, ceiling: 'default' };
  hub.setMachines(PROJECT, [
    { machine: 'mini', online: true, policy, checkouts: [] },
    { machine: 'SK.local', online: true, policy, checkouts: [] },
    { machine: MACHINE, online: true, policy, checkouts: [{ path: replay.recording.cwd, branch: 'main' }] },
  ]);
  await hub.append(PROJECT, { writer: `${MACHINE}/${replay.session}`, kind: 'joined', session: replay.session, alias: 'fakerec', name_source: 'user', machine: MACHINE, cwd: replay.recording.cwd, worktree: '', role: '', seat: '', by: '' });
  replay.sendPresence();
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${replay.session}`);
  const view = page.getByTestId('session-view');
  await expect(view).toHaveAttribute('data-session', replay.session);
  await expect(page.getByTestId('depth')).toHaveAttribute('data-session', replay.session);
  await expect.poll(() => replay.subscriptions()).toBe(1); // the center and the column, over one subscription
  return { fm: replay, view };
}

/** The recorded `<message>` answer's row. */
const answerRow = (replay: FakeMachineReplay) => replay.recording.rows.main.find((row) => JSON.stringify(row.message ?? {}).includes('<message>You chose'))!.uuid;
const isAnswerChunk = (uuid: string, replay: FakeMachineReplay) => {
  const named = replay.recording.steps.find((s) => s.k === 'block-row' && s.body.uuid === uuid);
  return (s: Step) => named?.k === 'block-row' && s.k === 'chunk' && s.turnId === named.body.turnId && s.step === named.body.step && s.chunk.index === named.body.index;
};

test("the report: the marks and questions, one working record per marked turn, an unmarked turn whole; the toggle shows the transcript and back; a reload draws the same rows", async ({ page, hub }) => {
  const { fm, view } = await openSession(page, hub);
  fm.playThrough();
  await expect(view.locator('[data-owner-card="to-human"]')).toContainText(ANSWER);
  await expect(page.getByTestId('session-status')).toHaveText('');
  await expect(toggle(page, 'Report')).toHaveAttribute('aria-pressed', 'true');
  // The unmarked last turn draws whole: its prompt and its answer, at the end.
  await expect(view).toContainText('Count from one to three hundred');
  await expect(view).toContainText('three hundred');
  const report = await allRowIds(view);
  const marked = report.filter((id) => id.startsWith('owner-record:'));
  expect(marked).toHaveLength(1); // the turn that answered with a <message>, its work folded
  await view.locator('[data-transcript-scroller]').evaluate((el) => el.scrollTo({ top: 0 }));
  await expect(records(view)).toContainText(/Working record · \d+ tool calls?/);
  await expect(view).toContainText('Color→blue'); // its question (the ask mod's, answered) stays in view

  await toggle(page, 'Transcript').click();
  await expect(toggle(page, 'Transcript')).toHaveAttribute('aria-pressed', 'true');
  const transcript = await allRowIds(view);
  expect(transcript.filter((id) => id.startsWith('owner-record:'))).toEqual([]);
  expect(transcript.filter((id) => id.startsWith('divider:')).length).toBeGreaterThan(report.filter((id) => id.startsWith('divider:')).length);

  await toggle(page, 'Report').click();
  await expect.poll(() => allRowIds(view)).toEqual(report);

  await page.reload();
  await expect(view.locator('[data-owner-card="to-human"]')).toContainText(ANSWER);
  await expect(toggle(page, 'Report')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => allRowIds(view), { timeout: 15_000 }).toEqual(report);
});

test('a marked response folds its turn and shows its mark while it streams, before its row is written; settling leaves no double', async ({ page, hub }) => {
  const { fm, view } = await openSession(page, hub);
  const uuid = answerRow(fm);
  fm.step(fm.recording.steps.findIndex(isAnswerChunk(uuid, fm)) - fm.played); // up to the answer's first chunk
  await expect(view).toContainText('Color→blue');
  await expect(view).toContainText("Ran python3 -c"); // nothing marked yet: the turn draws whole, its Bash call too
  await expect(records(view)).toHaveCount(0);

  for (let i = 0; i < 40 && !(await streamingRows(view).allTextContents()).join('').includes(ANSWER); i++) {
    fm.step(1);
    await page.waitForTimeout(20);
  }
  const live = streamingRows(view).last();
  await expect(live.locator('[data-owner-card="to-human"]')).toContainText(ANSWER);
  await expect(live).not.toContainText('<message>');
  await expect(records(view)).toHaveCount(1); // the turn folded into its record while the mark streams
  await expect(view).not.toContainText('Ran python3 -c');
  expect(fm.depth.rows.get('main')!.some((row) => row.uuid === uuid)).toBe(false); // and its row is not written yet

  fm.playThrough();
  await expect(streamingRows(view)).toHaveCount(0);
  await expect.poll(() => occurrences(view, ANSWER)).toBe(1);
  await expect(records(view)).toHaveCount(1);
});

/** The recorded session's plane with its snapshots cut to the newest `limit` rows, the browser on its channel. */
async function openPaged(page: Page, hub: HubDouble, limit: number): Promise<{ player: DepthPlayer; view: Locator }> {
  await page.setViewportSize({ width: 1280, height: 480 });
  await stageProject(hub);
  const played = (player = new DepthPlayer(hub, { project: PROJECT, machine: 'mini', session: S.asks, limit }));
  played.skip(played.script.length); // the session has run: the snapshot holds its newest rows
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
  const view = page.getByTestId('session-view');
  await expect(view).toContainText('Both subagents reported back.');
  await expect.poll(() => played.subscriptions()).toBe(1);
  return { player: played, view };
}

/** Scrolls the view to its top until its first row (the session's first prompt) is drawn; how many pages it took. */
async function pageToFirstRow(hub: HubDouble, view: Locator): Promise<number> {
  const scroller = view.locator('[data-transcript-scroller]');
  await expect
    .poll(
      async () => {
        await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
        return view.getByText('Think briefly first', { exact: false }).count();
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  const pages = hub.up.filter((u) => u.frame.t === 'rows').length;
  await view.page().waitForTimeout(500);
  expect(hub.up.filter((u) => u.frame.t === 'rows').length).toBe(pages); // none asked past the first row
  return pages;
}

test('older rows page in at the top of the session view until the first row, on a live session', async ({ page, hub }) => {
  const { player, view } = await openPaged(page, hub, 6);
  await expect(view).not.toContainText('Think briefly first');
  expect(await pageToFirstRow(hub, view)).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('session-status')).toHaveText('');
  expect(player.subscriptions()).toBe(1);
});

test('a session that ended while its view was open keeps its subscription and pages to its first row', async ({ page, hub }) => {
  const { player, view } = await openPaged(page, hub, 6);
  // The session's process goes (DX8: presence says so); its subscription stays open and idle.
  hub.sendSession(PROJECT, { project: PROJECT, machine: 'mini', session: S.asks, kind: 'presence', sub: null, n: null, body: { record: null, bridge: false } });
  await expect(page.getByTestId('channel-header').getByRole('button', { name: 'Resume' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(player.subscriptions()).toBe(1);
  expect(hub.up.some((u) => u.frame.t === 'unsubscribe')).toBe(false);
  expect(await pageToFirstRow(hub, view)).toBeGreaterThanOrEqual(1);
  await expect(view.getByTestId('depth-unavailable')).toHaveCount(0);
});
