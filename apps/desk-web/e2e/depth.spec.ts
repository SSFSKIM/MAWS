// M1 of the DC6 plan, in a browser against DC5's DX3 double and the recorded session's plane (`depth-player.ts`):
// selecting a direct channel opens the depth column on the session's main transcript, drawn by MAWS's transcript view;
// a response streams per content block and settles into the rows a reload draws; a reconnect, a hub restart, and a
// chunk the snapshot already held each end with no gap and no duplicated text; older rows page in at the top with the
// reader kept in place; an end keeps what was drawn and says why, and the column subscribes again once the session is
// reachable; a row's script, raw HTML, and `javascript:` link draw inert.
import type { Locator, Page } from '@playwright/test';
import type { JsonObject } from 'desk-hub/protocol';
import { DepthPlayer, type PlayerOptions } from './depth-player';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, S, stageProject } from './scene';
import type { HubDouble } from '../test/double/hub-double';
import type { LiveItem } from '../test/double/session-stream';
import { STRAY } from '../test/double/session-stream';

const ANSWER = 'Both subagents reported back.';
const isChunk = (kind: string) => (item: LiveItem) => item.kind === 'chunk' && item.body.chunk.kind === kind;
const rowOf = (uuid: string) => (item: LiveItem) => item.kind === 'row' && item.body.row.uuid === uuid;

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

/** How many times `text` occurs in the column's drawn text: once when settled, never twice. */
const occurrences = (depth: Locator, text: string) => depth.evaluate((el, t) => (el.textContent ?? '').split(t).length - 1, text);
const streamingRows = (depth: Locator) => depth.locator('[data-row-id^="desk-stream:"]');
const geometry = (depth: Locator) =>
  depth.locator('[data-row-id]').evaluateAll((els) => els.map((el) => ({ id: el.getAttribute('data-row-id')!, y: el.getBoundingClientRect().y, height: el.getBoundingClientRect().height })));
const rowIds = (depth: Locator) => depth.locator('[data-row-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-row-id')));

// MAWS's transcript runs here without its Electron bridge: nothing it draws may throw or log an error for want of one.
let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    // A resource's 404 is the fixture's own (`seedKey` stores the key from an `/api` page the double answers 404).
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) pageErrors.push(message.text());
  });
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned)).toBeUndefined();
  expect(pageErrors).toEqual([]);
});

test('a direct channel draws its transcript; a response streams per block, settles, and a reload draws the same rows', async ({ page, hub }) => {
  const { player, depth } = await openDepth(page, hub, { lateRows: true, strayAfterBlockRow: 4 });
  // The snapshot is taken at the start; the session's first turn arrives live.
  await expect(depth.getByTestId('depth-status')).toHaveText('');
  player.advanceTo(isChunk('thinking'));
  await expect(depth).toContainText('Think briefly first');
  player.advance(1); // the first thinking chunk: live thinking, MAWS's own row
  await expect(streamingRows(depth)).toHaveCount(1);
  await expect(depth.locator('[data-kind="thinking"]')).toBeVisible();
  await expect(streamingRows(depth)).not.toContainText('One repor'); // live thinking is its label alone, never text

  // The answer streams: its partial text is drawn, then settles into its row, drawn once.
  await midAnswer(player, depth, 'Both subagents rep');
  expect(await occurrences(depth, 'Both subagents rep')).toBe(1);
  player.advance(player.script.length);
  await expect(streamingRows(depth)).toHaveCount(0);
  await expect.poll(() => occurrences(depth, ANSWER)).toBe(1);
  expect(await occurrences(depth, STRAY)).toBe(0);
  const settled = await rowIds(depth);

  await page.reload();
  await expect(depth).toContainText(ANSWER);
  await expect.poll(() => rowIds(depth)).toEqual(settled);
  expect(await occurrences(depth, ANSWER)).toBe(1);
});

/** Plays into the final answer until `prefix` of it is drawn as streaming text. */
async function midAnswer(player: DepthPlayer, depth: Locator, prefix: string): Promise<void> {
  player.advanceTo((item) => item.kind === 'chunk' && item.body.chunk.kind === 'text' && String(item.body.chunk.text).startsWith('<message>'));
  player.advance(1);
  while (!(await streamingRows(depth).last().textContent())?.includes(prefix)) {
    player.advance(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('a reconnect in the middle of a response redraws from the fresh snapshot with no gap and no duplicated text', async ({ page, hub }) => {
  const { player, depth } = await openDepth(page, hub);
  await midAnswer(player, depth, 'Both sub');
  hub.dropConnections();
  player.advance(2); // sent to a socket that is gone
  await expect.poll(() => player.subscriptions()).toBe(2); // the client subscribed again; the snapshot holds those two
  await expect(streamingRows(depth).last()).toContainText('Both sub');
  player.advance(player.script.length);
  await expect(streamingRows(depth)).toHaveCount(0);
  await expect.poll(() => occurrences(depth, ANSWER)).toBe(1);
  await expect(depth).toContainText('the last word in words.txt is "gamma"');
});

test('a hub restart loses what was in flight; the fresh snapshot holds it, and the stream goes on', async ({ page, hub }) => {
  const { player, depth } = await openDepth(page, hub);
  await midAnswer(player, depth, 'Both');
  hub.dropConnections();
  player.skip(6); // in flight when the hub went down: never delivered
  await expect.poll(() => player.subscriptions()).toBe(2);
  player.advance(player.script.length);
  await expect(streamingRows(depth)).toHaveCount(0);
  await expect.poll(() => occurrences(depth, ANSWER)).toBe(1);
});

test('chunks the snapshot already held, sent again while it was built, are drawn once', async ({ page, hub }) => {
  const { player, depth } = await openDepth(page, hub);
  await midAnswer(player, depth, 'Both subagents rep');
  const drawn = await streamingRows(depth).last().textContent();
  player.overlapNext = 3;
  hub.dropConnections();
  await expect.poll(() => player.subscriptions()).toBe(2);
  await expect(streamingRows(depth).last()).toHaveText(drawn!);
  player.advance(player.script.length);
  await expect.poll(() => occurrences(depth, ANSWER)).toBe(1);
});

test('older rows page in when the reader reaches the top, and the reader stays where they were', async ({ page, hub }) => {
  await page.setViewportSize({ width: 1280, height: 360 });
  const { player, depth } = await openDepth(page, hub, { limit: 8 });
  await midAnswer(player, depth, 'Both sub');
  player.holdRows = true;
  hub.dropConnections(); // a fresh snapshot of the newest rows only
  await expect.poll(() => player.subscriptions()).toBe(2);
  await expect(streamingRows(depth).last()).toContainText('Both sub');
  await expect(depth).not.toContainText('Think briefly first');

  const scroller = depth.locator('[data-transcript-scroller]');
  await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
  await expect.poll(() => hub.up.filter((u) => u.frame.t === 'rows').length).toBe(1); // the reader reached the top
  // The reader's anchor: the first drawn row whose id outlives the rebuild (a turn's time and divider rows are keyed
  // by the turn, which the older page can re-identify once it holds the turn's prompt).
  const anchorId = (await depth.locator('[data-row-id]:not([data-row-id^="time:"]):not([data-row-id^="divider:"])').first().getAttribute('data-row-id'))!;
  // Live chunks while the page is on its way, drawn before the reader's place is taken.
  const streamed = (await streamingRows(depth).last().textContent()) ?? '';
  player.advance(3);
  await expect.poll(async () => ((await streamingRows(depth).last().textContent()) ?? '').length).toBeGreaterThan(streamed.length);
  await page.waitForTimeout(300);
  // The reader is away from the end (past the list's 80 px threshold), so the list does not pin them there.
  expect(await scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeGreaterThan(80);
  const before = await geometry(depth);
  expect(player.releaseRows()).toBe(1);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0); // older rows went above the reader
  await page.waitForTimeout(300); // the virtualiser measures the rows it had only estimated
  const after = await geometry(depth);
  // The row the reader was looking at stays where it was, whatever changed beneath it (here a subagent's hand-back row,
  // which reads its agent's name once the older page holds the call that started it). The rows above it at the top —
  // the oldest turn's time and divider — are renamed by the page, so the list's own anchor cannot hold this; the
  // depth pane's does (`view/keep-place.ts`).
  const at = (rows: Array<{ id: string; y: number }>) => rows.find((r) => r.id === anchorId)!.y;
  expect(Math.abs(at(after) - at(before))).toBeLessThan(4);
  player.advance(player.script.length);
  await expect.poll(() => occurrences(depth, ANSWER)).toBe(1);
  await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
  await expect(depth).toContainText('Think briefly first'); // the turn's prompt, from the older page
});

test('an end keeps what was drawn and says why; the column subscribes again once the session is reachable', async ({ page, hub }) => {
  const { player, depth } = await openDepth(page, hub);
  await midAnswer(player, depth, 'Both sub');
  const policy = { read_only: false, ceiling: 'default' };
  hub.setMachines(PROJECT, [
    { machine: 'mini', online: false, policy, checkouts: [] },
    { machine: 'SK.local', online: true, policy, checkouts: [] },
  ]);
  player.end('machine-offline');
  await expect(depth.getByTestId('depth-unavailable')).toContainText('The machine is offline');
  await expect(streamingRows(depth).last()).toContainText('Both sub');
  await expect(depth).toContainText('Think briefly first');
  player.advance(4); // the machine goes on; nobody is subscribed
  await page.waitForTimeout(200);
  expect(player.subscriptions()).toBe(0);

  hub.setMachines(PROJECT, [
    { machine: 'mini', online: true, policy, checkouts: [] },
    { machine: 'SK.local', online: true, policy, checkouts: [] },
  ]);
  hub.sendSession(PROJECT, { project: PROJECT, machine: 'mini', session: S.asks, kind: 'presence', sub: null, n: null, body: { record: { status: 'busy' }, bridge: true } });
  await expect.poll(() => player.subscriptions()).toBe(1);
  await expect(depth.getByTestId('depth-unavailable')).toHaveCount(0);
  player.advance(player.script.length);
  await expect(streamingRows(depth)).toHaveCount(0);
  await expect.poll(() => occurrences(depth, ANSWER)).toBe(1);
});

test('a subscription the hub ends before its snapshot reads as reconnecting, not as an empty transcript', async ({ page, hub }) => {
  await stageProject(hub);
  const player = new DepthPlayer(hub, { project: PROJECT, machine: 'mini', session: S.asks });
  player.endBeforeSnapshot = 1;
  player.holdSubscriptions = true;
  player.skip(player.script.length);
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
  const depth = page.getByTestId('depth');
  await expect.poll(() => hub.subscriptions(PROJECT).length).toBeGreaterThanOrEqual(2); // ended at n 0, then taken up again
  await expect(depth.getByTestId('depth-status')).toHaveText('Reconnecting…');
  await expect(depth.getByTestId('depth-reconnecting')).toBeVisible();
  expect(player.releaseSubscriptions()).toBeGreaterThanOrEqual(1);
  await expect(depth).toContainText(ANSWER);
  await expect(depth.getByTestId('depth-reconnecting')).toHaveCount(0);
  await expect(depth.getByTestId('depth-status')).toHaveText('');
});

const HOSTILE =
  'Plain words, then hostile ones.\n\n<script>window.__pwned = "script"</script>\n\n<img src="x" onerror="window.__pwned = \'img\'">\n\n<b>raw bold</b>\n\n[a link](javascript:window.__pwned=\'link\') and [a site](https://example.com/docs)';

const hostileRow = (uuid: string, timestamp: string): JsonObject => ({
  type: 'assistant',
  uuid,
  parentUuid: null,
  isSidechain: false,
  timestamp,
  sessionId: S.asks,
  apiBlockIndex: 0,
  message: { id: 'msg_hostile', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: HOSTILE }], stop_reason: 'end_turn' },
});

test("a row's script, raw HTML, and javascript: link draw inert, streaming and settled", async ({ page, hub }) => {
  const prompt: JsonObject = { type: 'user', uuid: 'hostile-prompt', parentUuid: null, isSidechain: false, timestamp: '2026-10-15T11:40:00.000Z', sessionId: S.asks, message: { role: 'user', content: 'Show me something.' } };
  const { player, depth } = await openDepth(page, hub, { extraRows: [prompt, hostileRow('hostile-row', '2026-10-15T11:40:01.000Z')], piece: 40 });
  player.advanceTo(rowOf('hostile-row'));
  await expect(streamingRows(depth).last()).toContainText('a site'); // streaming: MAWS's Markdown, live
  await expectInert(depth);
  player.advance(1);
  await expect(streamingRows(depth)).toHaveCount(0);
  await expect(depth).toContainText('Plain words, then hostile ones.');
  await expectInert(depth);
  await page.context().route('https://example.com/**', (route) => route.fulfill({ body: 'elsewhere', contentType: 'text/plain' }));
  const popup = page.waitForEvent('popup');
  await depth.getByRole('link', { name: 'a site' }).click();
  const opened = await popup;
  expect(await opened.evaluate(() => window.opener)).toBeNull();
  await opened.close();
  await depth.getByText('a link').click();
  expect(page.url()).toContain(`/p/${PROJECT}/s/${S.asks}`);
});

async function expectInert(depth: Locator): Promise<void> {
  expect(await depth.locator('script').count()).toBe(0);
  expect(await depth.locator('[onerror], [onclick], [onload]').count()).toBe(0);
  expect(await depth.locator('a[href^="javascript:"]').count()).toBe(0);
  expect(await depth.locator('b').filter({ hasText: 'raw bold' }).count()).toBe(0);
}
