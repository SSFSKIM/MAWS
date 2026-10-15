// M3 of the DC6 plan, in a browser against DC5's DX3 double and the recorded session's plane (`depth-player.ts`): the
// depth column's Diff tab asks for the session's diff when it opens and on Refresh, never otherwise, and draws it
// through MAWS's review view; its Info tab says where the session runs, its model (from the transcript), and its
// context use and cost from DX4 `usage` — unavailable with no bridge, then the first one, an update after a turn, and
// the same after a reconnect. And the main transcript's `<message>` marks draw as MAWS's to-human span while they
// stream and once settled, and the turn a subagent's hand-back opens reads as the session's own.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { TWO_SUBAGENTS } from 'desk-hub/fake-machine';
import { DepthPlayer, type PlayerOptions } from './depth-player';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, S, stageProject } from './scene';
import type { HubDouble } from '../test/double/hub-double';
import { readRecording } from '../test/double/session-stream';

const recording = readRecording();
const DIFF = readFileSync(join(TWO_SUBAGENTS, 'diff.patch'), 'utf8');
const FIRST = { context: { tokens: 36820, window: 1_000_000, percent: 4 }, cost: { usd: 0.003228125 } };
const LATER = { context: { tokens: 38686, window: 1_000_000, percent: 4 }, cost: { usd: 0.005277275 } };

async function openDepth(page: Page, hub: HubDouble, options: Partial<PlayerOptions> = {}, setUp: (player: DepthPlayer) => void = () => {}): Promise<{ player: DepthPlayer; depth: Locator }> {
  await stageProject(hub);
  const player = new DepthPlayer(hub, { project: PROJECT, machine: 'mini', session: S.asks, ...options });
  setUp(player);
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${S.asks}`);
  const depth = page.getByTestId('depth');
  await expect(depth).toHaveAttribute('data-session', S.asks);
  await expect.poll(() => player.subscriptions()).toBe(1);
  return { player, depth };
}

let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) pageErrors.push(message.text());
  });
});
test.afterEach(() => expect(pageErrors).toEqual([]));

test("the diff is asked for when its tab opens and on Refresh, never otherwise, and drawn through MAWS's review view", async ({ page, hub }) => {
  const { player, depth } = await openDepth(page, hub, {}, (p) => {
    p.skip(p.script.length);
    p.diff = { base: 'main', text: DIFF };
  });
  await expect(depth).toContainText('Both subagents reported back.');
  await page.waitForTimeout(300);
  expect(player.diffsAsked).toBe(0); // never polled, never asked before the tab opens

  await depth.getByTestId('depth-tab-diff').click();
  const diff = depth.getByTestId('depth-diff');
  await expect.poll(() => player.diffsAsked).toBe(1);
  await expect(diff.locator('[data-review-header]')).toHaveText('2 files changed · +6 −0 · Since main');
  await expect(diff.locator('[data-path]')).toHaveText(['.smns+5 −0', 'recorded.txt+1 −0']);
  // The first file's hunk, in the diff library's table.
  await expect(diff.locator('[data-review-body]')).toContainText('"name": "fakerec"');
  await diff.locator('[data-path="recorded.txt"]').click();
  await expect(diff.locator('[data-review-file-header]')).toHaveText('recorded.txt · Added');
  await expect(diff.locator('[data-review-body]')).toContainText('blue');

  // The reader's Refresh asks once more; the new answer replaces the drawn one.
  player.diff = { base: 'main', text: `${DIFF}diff --git a/notes.md b/notes.md\n--- a/notes.md\n+++ b/notes.md\n@@ -1 +1 @@\n-kettle\n+teapot\n` };
  await diff.getByTestId('depth-diff-refresh').click();
  await expect.poll(() => player.diffsAsked).toBe(2);
  await expect(diff.locator('[data-review-header]')).toHaveText('3 files changed · +7 −1 · Since main');

  // An empty diff says so.
  player.diff = { base: 'main', text: '' };
  await diff.getByTestId('depth-diff-refresh').click();
  await expect(diff.locator('[data-review-empty]')).toHaveText('No changes against main');
  expect(player.diffsAsked).toBe(3);
});

test('session info: where it runs, its model, and context and cost from usage — none, the first, an update, a reconnect', async ({ page, hub }) => {
  const { player, depth } = await openDepth(page, hub, {}, (p) => p.skip(p.script.length));
  await depth.getByTestId('depth-tab-info').click();
  const info = (id: string) => depth.getByTestId(`depth-info-${id}`);
  await expect(info('machine')).toHaveText('mini');
  await expect(info('cwd')).toHaveText('/Users/new/Developer/GitHub/MAWS');
  await expect(info('worktree')).toHaveText('none');
  await expect(info('kind')).toHaveText('Running, bridged');
  const model = (recording.session.findLast((row) => row.type === 'assistant')!.message as { model: string }).model;
  await expect(info('model')).toHaveText(model);
  // No usage yet (the snapshot's is null): unavailable, said why.
  await expect(info('context')).toHaveText('unavailable (no bridge)');
  await expect(info('cost')).toHaveText('unavailable (no bridge)');

  player.sendUsage(FIRST); // after a main turn
  await expect(info('context')).toHaveText('36.8K of 1M (4%)');
  await expect(info('cost')).toHaveText('$0.0032');
  player.sendUsage(LATER);
  await expect(info('context')).toHaveText('38.7K of 1M (4%)');
  await expect(info('cost')).toHaveText('$0.0053');

  hub.dropConnections(); // the fresh snapshot carries the last usage
  await expect.poll(() => player.subscriptions()).toBe(2);
  await expect(depth.getByTestId('depth-status')).toHaveText('');
  await expect(info('context')).toHaveText('38.7K of 1M (4%)');
  await expect(info('cost')).toHaveText('$0.0053');
});

test("a <message> draws as MAWS's to-human span while it streams and once settled; a hand-back's turn reads Continued", async ({ page, hub }) => {
  const { player, depth } = await openDepth(page, hub);
  player.advanceTo((item) => item.kind === 'chunk' && item.body.chunk.kind === 'text' && String(item.body.chunk.text).startsWith('<message>'));
  const stream = depth.locator('[data-row-id^="desk-stream:"]');
  while (!(await stream.last().textContent())?.includes('Both subagents rep')) {
    player.advance(1);
    await page.waitForTimeout(20);
  }
  const live = stream.last().locator('[data-owner-span="to-human"]');
  await expect(live).toContainText('Both subagents rep');
  await expect(stream.last()).not.toContainText('<message>');

  player.advance(player.script.length);
  await expect(stream).toHaveCount(0);
  const settled = depth.locator('[data-owner-span="to-human"]');
  await expect(settled).toHaveCount(1);
  await expect(settled).toContainText('Both subagents reported back.');
  await expect(settled.locator('.owner-report-label')).toHaveText('to human');
  expect(await depth.evaluate((el) => el.textContent?.includes('<message>'))).toBe(false);
  await expect(depth).not.toContainText('Peer session worked');
  await expect(depth).toContainText('Continued for');
});
