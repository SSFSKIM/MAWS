// M2 of the DC6 plan, in a browser against DC5's DX3 double and the recorded session's plane (`depth-player.ts`): the
// depth column's Subagents tab draws the session's subagent tree from the main subscription — matching the
// recording's `subagents/*.meta.json`, growing as the agents start and following each to its end — and opening an
// agent subscribes with its `agentId` and draws its transcript and stream as the main thread's are drawn, through a
// reconnect, a hub restart, and a chunk the snapshot already held, with no gap and no duplicated text. A subagent's
// disruption never resets the main thread's view, nor the reverse. Since DC9's M3 the main thread is drawn in the
// center's session view, over the subscription the column's tree reads.
import type { Locator, Page } from '@playwright/test';
import { DepthPlayer, type AgentTrack, type PlayerOptions } from './depth-player';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, S, stageProject } from './scene';
import type { HubDouble } from '../test/double/hub-double';
import { readRecording, type LiveItem } from '../test/double/session-stream';

const recording = readRecording();
const [WORDS, KETTLE] = recording.subagents;
const KETTLE_ANSWER = 'The kettle is on the second shelf';
const MAIN_ANSWER = 'Both subagents reported back.';

const isChunk = (kind: string) => (item: LiveItem) => item.kind === 'chunk' && item.body.chunk.kind === kind;
const notificationOf = (agentId: string) => (item: LiveItem) => item.kind === 'row' && JSON.stringify(item.body.row.message ?? {}).includes(`<task-id>${agentId}</task-id>`);
const streamingRows = (scope: Locator) => scope.locator('[data-row-id^="desk-stream:"]');
/** How many times `text` occurs in the scope's drawn text: once when settled, never twice. */
const occurrences = (scope: Locator, text: string) => scope.evaluate((el, t) => (el.textContent ?? '').split(t).length - 1, text);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function openDepth(page: Page, hub: HubDouble, options: Partial<PlayerOptions> = {}): Promise<{ player: DepthPlayer; depth: Locator }> {
  await stageProject(hub);
  const player = new DepthPlayer(hub, { project: PROJECT, machine: 'mini', session: S.asks, ...options });
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
  const depth = page.getByTestId('depth');
  await expect(depth).toHaveAttribute('data-session', S.asks);
  await expect.poll(() => player.subscriptions()).toBe(1);
  return { player, depth };
}

const subscribes = (hub: HubDouble, agentId: string | null) => hub.subscriptions(PROJECT).filter((s) => s.agentId === agentId).length;

/** Opens an agent from the tree; its section (Done starts collapsed, as MAWS's does) opened first when it must be. */
async function openAgent(depth: Locator, agentId: string): Promise<Locator> {
  await depth.getByTestId('depth-tab-subagents').click();
  const row = depth.locator(`[data-agent-row="${agentId}"]`);
  if ((await row.count()) === 0) await depth.locator('[data-section="done"] h3 button').click();
  await row.click();
  const detail = depth.getByTestId('depth-subagent');
  await expect(detail).toHaveAttribute('data-agent', agentId);
  return detail;
}

/** Plays the agent's track into its answer until `prefix` of it is drawn as streaming text. */
async function midAgentAnswer(track: AgentTrack, detail: Locator, prefix: string): Promise<void> {
  track.advanceTo(isChunk('text'));
  track.advance(1);
  while (!(await streamingRows(detail).last().textContent())?.includes(prefix)) {
    track.advance(1);
    await sleep(20);
  }
}

/** Plays the agent's answer to its row and stops before its hand-back call (whose cell can quote the answer again). */
async function settleAgentAnswer(track: AgentTrack, detail: Locator, answer: string): Promise<void> {
  track.advanceTo(isChunk('tool'));
  await expect(streamingRows(detail)).toHaveCount(0);
  await expect.poll(() => occurrences(detail, answer)).toBe(1);
  track.advance(track.script.length);
}

/** Plays the main transcript into its final answer until `prefix` of it is drawn as streaming text in the center. */
async function midMainAnswer(player: DepthPlayer, main: Locator, prefix: string): Promise<void> {
  player.advanceTo((item) => item.kind === 'chunk' && item.body.chunk.kind === 'text' && String(item.body.chunk.text).startsWith('<message>'));
  player.advance(1);
  while (!(await streamingRows(main).last().textContent())?.includes(prefix)) {
    player.advance(1);
    await sleep(20);
  }
}

// MAWS's transcript and Subagents pieces run here without its Electron bridge: nothing may throw or log an error.
let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) pageErrors.push(message.text());
  });
});
test.afterEach(() => expect(pageErrors).toEqual([]));

test('the tree matches the recording’s metas, grows as the agents start, and follows each to its end', async ({ page, hub }) => {
  const { player, depth } = await openDepth(page, hub, { growTree: true });
  await depth.getByTestId('depth-tab-subagents').click();
  const tree = depth.getByTestId('depth-subagents');
  await expect(tree).toContainText('No subagents yet');

  // The first `Agent` call: its meta, then its row.
  player.advanceTo((item) => item.kind === 'subagents' && item.body.subagents.length === 2);
  await expect(tree.locator(`[data-agent-row="${KETTLE.agentId}"]`)).toHaveAttribute('data-status', 'running');
  await expect(tree).toContainText('Agents · 1 running');
  player.advanceTo(notificationOf(KETTLE.agentId));
  await expect(tree).toContainText('Agents · 2 running');
  await expect(depth.getByTestId('depth-tab-subagents')).toHaveText('Subagents · 2 running');
  player.advance(1); // the notes.md agent's task notification
  await expect(tree).toContainText('Agents · 1 running');
  await expect(tree).toContainText('Done · 1');
  player.advance(player.script.length);
  await expect(tree).toContainText('Done · 2');
  // Done starts closed, as MAWS's does, and says so: its heading's chevron points right until it is opened.
  const done = tree.locator('[data-section="done"] h3 button');
  await expect(done).toHaveAttribute('aria-expanded', 'false');
  await expect(done.locator('.transcript-chevron')).toBeVisible();
  const turned = () => done.locator('.transcript-chevron').evaluate((el) => getComputedStyle(el).transform);
  expect(await turned()).toBe('none');
  await done.click();
  await expect(done).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(turned).not.toBe('none');

  const drawn = await tree.locator('[data-agent-row]').evaluateAll((els) =>
    els.map((el) => ({ agentId: el.getAttribute('data-agent-row'), status: el.getAttribute('data-status'), title: el.querySelector('[data-part="title"]')?.textContent })),
  );
  const metas = recording.subagents.map(({ agentId, meta }) => ({ agentId, status: 'completed', title: meta.description }));
  expect(drawn.sort((a, b) => a.agentId!.localeCompare(b.agentId!))).toEqual(metas.sort((a, b) => a.agentId.localeCompare(b.agentId)));
  await expect(tree.locator(`[data-agent-row="${KETTLE.agentId}"] [data-part="line"]`)).toContainText('finished');
});

test('opening an agent subscribes with its agentId and draws its stream settling once into its transcript', async ({ page, hub }) => {
  const { player, depth } = await openDepth(page, hub);
  player.advance(player.script.length); // both agents done
  const detail = await openAgent(depth, KETTLE.agentId);
  await expect.poll(() => subscribes(hub, KETTLE.agentId)).toBe(1);
  await expect(detail).toContainText(String(KETTLE.meta.description));
  await expect(detail).toContainText('Dispatched by maws-45');
  const track = player.agent(KETTLE.agentId);
  track.advanceTo(isChunk('text'));
  await expect(detail).toContainText('Report where the kettle is'); // the agent's own prompt, from its transcript
  await midAgentAnswer(track, detail, 'The kettle is');
  expect(await occurrences(detail, 'The kettle is')).toBe(1);
  await settleAgentAnswer(track, detail, KETTLE_ANSWER);
  await expect(detail.locator('[data-part="agent-meta"]')).toContainText('claude-opus-5-5');

  await detail.getByRole('button', { name: '‹ Subagents' }).click();
  await expect(depth.getByTestId('depth-subagents')).toBeVisible();
  await expect.poll(() => track.subscriptions()).toBe(0); // leaving the agent closes its subscription
});

test('a reconnect in the middle of a subagent’s response redraws it from its fresh snapshot with no gap and no duplicated text', async ({ page, hub }) => {
  const { player, depth } = await openDepth(page, hub);
  player.advance(player.script.length);
  const detail = await openAgent(depth, KETTLE.agentId);
  const track = player.agent(KETTLE.agentId);
  await midAgentAnswer(track, detail, 'The kettle is');
  hub.dropConnections();
  track.advance(2); // sent to a socket that is gone; the fresh snapshot holds them
  await expect.poll(() => track.answered).toBe(2);
  await expect(streamingRows(detail).last()).toContainText('The kettle is');
  await settleAgentAnswer(track, detail, KETTLE_ANSWER);
});

test('a hub restart loses what was in flight to a subagent; its fresh snapshot holds it, and its stream goes on', async ({ page, hub }) => {
  const { player, depth } = await openDepth(page, hub);
  player.advance(player.script.length);
  const detail = await openAgent(depth, KETTLE.agentId);
  const track = player.agent(KETTLE.agentId);
  await midAgentAnswer(track, detail, 'The kettle');
  hub.dropConnections();
  track.skip(3); // in flight when the hub went down: never delivered
  await expect.poll(() => track.answered).toBe(2);
  await settleAgentAnswer(track, detail, KETTLE_ANSWER);
});

test('chunks a subagent’s snapshot already held, sent again while it was built, are drawn once', async ({ page, hub }) => {
  const { player, depth } = await openDepth(page, hub);
  player.advance(player.script.length);
  const detail = await openAgent(depth, KETTLE.agentId);
  const track = player.agent(KETTLE.agentId);
  await midAgentAnswer(track, detail, 'The kettle is on');
  const drawn = await streamingRows(detail).last().textContent();
  track.overlapNext = 3;
  hub.dropConnections();
  await expect.poll(() => track.answered).toBe(2);
  await expect(streamingRows(detail).last()).toHaveText(drawn!);
  await settleAgentAnswer(track, detail, KETTLE_ANSWER);
});

test('a subagent’s disruption never resets the main thread’s view, nor the main thread’s the subagent’s', async ({ page, hub }) => {
  const { player, depth } = await openDepth(page, hub);
  const main = page.getByTestId('session-view');
  await midMainAnswer(player, main, 'Both sub'); // the words.txt agent still runs
  const detail = await openAgent(depth, WORDS.agentId);
  const track = player.agent(WORDS.agentId);
  await midAgentAnswer(track, detail, 'The last word');
  const agentDrawn = await streamingRows(detail).last().textContent();

  // The main thread's discontinuity: it alone subscribes again; the open agent keeps what it drew.
  const mainBefore = subscribes(hub, null);
  player.end('discontinuity');
  await expect.poll(() => subscribes(hub, null)).toBe(mainBefore + 1);
  await expect.poll(() => player.subscriptions()).toBe(1);
  expect(track.answered).toBe(1);
  await expect(streamingRows(detail).last()).toHaveText(agentDrawn!);
  await expect(detail.getByTestId('depth-subagent-status')).toHaveText('');

  // The agent's discontinuity: it alone subscribes again; the main thread's view, in the center, keeps its place.
  track.end('discontinuity');
  await expect.poll(() => track.answered).toBe(2);
  await expect(streamingRows(detail).last()).toHaveText(agentDrawn!);
  expect(subscribes(hub, null)).toBe(mainBefore + 1);
  await settleAgentAnswer(track, detail, 'The last word');

  await expect(streamingRows(main).last()).toContainText('Both sub');
  await expect(main.getByTestId('depth-reconnecting')).toHaveCount(0);
  await expect(page.getByTestId('session-status')).toHaveText('');
  player.advance(player.script.length);
  await expect(streamingRows(main)).toHaveCount(0);
  await expect.poll(() => occurrences(main, MAIN_ANSWER)).toBe(1);
});
