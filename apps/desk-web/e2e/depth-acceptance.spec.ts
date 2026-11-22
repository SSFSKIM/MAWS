// DC6's acceptance (the DC6 plan's M3), every clause, in a real browser against DC3's fake machine replaying its
// committed recording — a real haiku session through DC2's bridge, with two subagents (`fake-machine.ts` says how the
// fake machine is reached): the transcript streams and settles into the same rows a reload shows; the subagent tree
// matches the recording's `subagents/*.meta.json`; the diff renders; a reconnect in the middle of a response, a hub
// restart, and a chunk arriving while the snapshot is built each end with no gap and no duplicated text, in the main
// thread and in a subagent. Context use and cost come from the recording's `usage`. Since DC9's M3 the main thread is
// drawn in the center's session view and the tree, the diff and the info in the column, over one subscription; the
// working record's folds, which unfolded the transcript in the center, are gone with it (DC9's M4 retires their code).
import type { Locator, Page } from '@playwright/test';
import type { Step } from 'desk-hub/fake-machine';
import { FakeMachineReplay } from './fake-machine';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, stageProject } from './scene';
import type { HubDouble } from '../test/double/hub-double';

const MACHINE = 'fake';
const ANSWER = 'You chose blue';
const streamingRows = (scope: Locator) => scope.locator('[data-row-id^="desk-stream:"]');
const rowIds = (scope: Locator) => scope.locator('[data-row-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-row-id')));

/**
 * Every row the transcript draws, in order: MAWS's list renders only the rows near its viewport, so the reader's
 * scroller is walked from the top to the end and each window's rows taken once.
 */
async function allRowIds(scope: Locator): Promise<string[]> {
  const scroller = scope.locator('[data-transcript-scroller]').first();
  const ids: string[] = [];
  await scroller.evaluate((el) => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); el.scrollTo({ top: 0 }); });
  for (let i = 0; i < 100; i++) {
    await scope.page().waitForTimeout(60); // the list draws the window it scrolled to
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
/** How many times `text` occurs in the scope's drawn text: once when settled, never twice. */
const occurrences = (scope: Locator, text: string) => scope.evaluate((el, t) => (el.textContent ?? '').split(t).length - 1, text);
const textChunk = (agentId: string | null, startsWith = '') => (s: Step) => s.k === 'chunk' && s.agentId === agentId && s.chunk.kind === 'text' && String(s.chunk.text).startsWith(startsWith);

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

/** The fake machine enrolled in the project with its session joined, and the browser on that session's channel. */
async function openSession(page: Page, hub: HubDouble): Promise<{ fm: FakeMachineReplay; depth: Locator; view: Locator }> {
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
  const depth = page.getByTestId('depth');
  const view = page.getByTestId('session-view');
  await expect(depth).toHaveAttribute('data-session', replay.session);
  await expect(view).toHaveAttribute('data-session', replay.session);
  await expect.poll(() => replay.subscriptions()).toBe(1);
  return { fm: replay, depth, view };
}

/** The recorded `<message>` answer's row. */
const answerRow = (replay: FakeMachineReplay) => replay.recording.rows.main.find((row) => JSON.stringify(row.message ?? {}).includes('<message>You chose'))!.uuid;

/** Plays into the `<message>` answer until some of it is drawn as streaming text. */
async function midAnswer(replay: FakeMachineReplay, depth: Locator): Promise<void> {
  replay.step(replay.firstChunkOf(answerRow(replay)) + 1 - replay.played);
  for (let i = 0; i < 40 && !((await streamingRows(depth).last().textContent()) ?? '').includes('You chose'); i++) {
    replay.step(1);
    await depth.page().waitForTimeout(20);
  }
  await expect(streamingRows(depth).last()).toContainText('You chose');
}

/** Plays to the end and checks the transcript drawn: nothing streaming, the answer once, the rows a reload draws. */
async function endsWhole(page: Page, replay: FakeMachineReplay, depth: Locator): Promise<void> {
  replay.playThrough();
  await expect(streamingRows(depth)).toHaveCount(0);
  await expect.poll(() => occurrences(depth, ANSWER)).toBe(1);
  const settled = await allRowIds(depth);
  await page.reload();
  await expect(depth).toContainText(ANSWER);
  expect(await occurrences(depth, ANSWER)).toBe(1);
  await expect.poll(() => allRowIds(depth), { timeout: 15_000 }).toEqual(settled);
}

test('the transcript streams and settles into the rows a reload shows; usage gives context use and cost', async ({ page, hub }) => {
  const { fm, depth, view } = await openSession(page, hub);
  const first = fm.playThrough(textChunk(null));
  await expect(streamingRows(view).last()).toContainText(first?.k === 'chunk' ? String(first.chunk.text).trim() : '');
  await midAnswer(fm, view);
  expect(await occurrences(view, 'You chose')).toBe(1);
  await endsWhole(page, fm, view);

  await depth.getByTestId('depth-tab-info').click();
  await expect(depth.getByTestId('depth-info-model')).toContainText('haiku');
  await expect(depth.getByTestId('depth-info-context')).toHaveText('38.9K of 1M (4%)');
  await expect(depth.getByTestId('depth-info-cost')).toHaveText('$0.0053');
});

test("the subagent tree matches the recording's metas, and the diff renders", async ({ page, hub }) => {
  const { fm, depth } = await openSession(page, hub);
  fm.playThrough();
  await depth.getByTestId('depth-tab-subagents').click();
  const done = depth.locator('[data-section="done"] h3 button');
  if (await done.isVisible()) await done.click();
  const rows = depth.locator('[data-agent-row]');
  await expect(rows).toHaveCount(2);
  const metas = fm.recording.meta;
  expect((await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-agent-row')))).sort()).toEqual(Object.keys(metas).sort());
  for (const [agentId, meta] of Object.entries(metas)) await expect(depth.locator(`[data-agent-row="${agentId}"]`)).toContainText(String(meta.description));

  await depth.getByTestId('depth-tab-diff').click();
  const diff = depth.getByTestId('depth-diff');
  await expect(diff.locator('[data-review-header]')).toHaveText('2 files changed · +6 −0 · Since main');
  await expect(diff.locator('[data-review-body]')).toContainText('"name": "fakerec"');
  await diff.locator('[data-path="recorded.txt"]').click();
  await expect(diff.locator('[data-review-body]')).toContainText('blue');
});

test.describe('the main thread', () => {
  test('a reconnect in the middle of a response ends with no gap and no duplicated text', async ({ page, hub }) => {
    const { fm, view } = await openSession(page, hub);
    await midAnswer(fm, view);
    fm.drop();
    await expect.poll(() => fm.subscriptions()).toBe(1); // the client subscribed again
    await expect(streamingRows(view).last()).toContainText('You chose');
    await endsWhole(page, fm, view);
  });

  test('a hub restart loses what was in flight; the fresh snapshot holds it', async ({ page, hub }) => {
    const { fm, view } = await openSession(page, hub);
    await midAnswer(fm, view);
    fm.drop();
    fm.step(8); // applied while nobody was subscribed: never delivered live
    await expect.poll(() => fm.subscriptions()).toBe(1);
    await endsWhole(page, fm, view);
  });

  test('chunks arriving while the snapshot is built, and handed again after it, are drawn once', async ({ page, hub }) => {
    const { fm, view } = await openSession(page, hub);
    await midAnswer(fm, view);
    fm.raceNextSnapshot({ agentId: null, advance: 3, overlap: true });
    fm.drop();
    await expect.poll(() => fm.subscriptions()).toBe(1);
    await expect.poll(() => occurrences(view, 'You chose')).toBe(1);
    await endsWhole(page, fm, view);
  });
});

/** Opens an agent from the tree, once the tree shows it. */
async function openAgent(depth: Locator, agentId: string): Promise<Locator> {
  await depth.getByTestId('depth-tab-subagents').click();
  const row = depth.locator(`[data-agent-row="${agentId}"]`);
  const done = depth.locator('[data-section="done"] h3 button');
  if ((await row.count()) === 0 && (await done.isVisible())) await done.click();
  await row.click();
  const detail = depth.getByTestId('depth-subagent');
  await expect(detail).toHaveAttribute('data-agent', agentId);
  return detail;
}

for (const [disruption, disrupt] of [
  ['a reconnect in the middle of its response', async (fm: FakeMachineReplay) => fm.drop()],
  ['a hub restart', async (fm: FakeMachineReplay) => (fm.drop(), fm.step(1))],
  ['a chunk arriving while its snapshot is built', async (fm: FakeMachineReplay, agentId: string) => (fm.raceNextSnapshot({ agentId, advance: 1, overlap: true }), fm.drop())],
] as const) {
  test(`in a subagent, ${disruption} ends with no gap and no duplicated text`, async ({ page, hub }) => {
    const { fm, depth } = await openSession(page, hub);
    // The first subagent to answer: its tree entry, then its answer's first chunk.
    const first = fm.recording.steps.find((s) => s.k === 'chunk' && s.agentId !== null && s.chunk.kind === 'text');
    const agentId = first?.k === 'chunk' ? first.agentId! : '';
    fm.playThrough((s) => s.k === 'agent' && s.agentId === agentId);
    const detail = await openAgent(depth, agentId);
    await expect.poll(() => fm.subscriptions(agentId)).toBe(1);
    const chunk = fm.playThrough(textChunk(agentId));
    const head = chunk?.k === 'chunk' ? String(chunk.chunk.text) : '';
    await expect(streamingRows(detail).last()).toContainText(head);
    const answer = `${head}${fm.recording.steps.flatMap((s) => (s.k === 'chunk' && s.agentId === agentId && s.chunk.kind === 'text' ? [String(s.chunk.text)] : [])).slice(1).join('')}`;
    const before = await occurrences(detail, answer); // the agent's prompt quotes the answer it asks for

    await disrupt(fm, agentId);
    await expect.poll(() => fm.subscriptions(agentId)).toBe(1);
    fm.playThrough((s) => s.k === 'row' && s.agentId === agentId && JSON.stringify(s.row).includes('done.'));
    await expect(streamingRows(detail)).toHaveCount(0);
    await expect.poll(() => occurrences(detail, answer)).toBe(before + 1);
    fm.playThrough();
    await expect(streamingRows(detail)).toHaveCount(0);
    expect(await occurrences(detail, answer)).toBe(before + 1);
  });
}
