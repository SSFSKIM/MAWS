// M3 of the DC6 plan, in a browser against DC5's DX3 double and the recorded session's plane (`depth-player.ts`): the
// depth column's Diff tab asks for the session's diff when it opens and on Refresh, never otherwise, and draws it
// through MAWS's review view; its Info tab says where the session runs, its model (from the transcript), and its
// context use and cost from DX4 `usage` — unavailable with no bridge, then the first one, an update after a turn, and
// the same after a reconnect. And the main transcript's `<message>` marks — drawn in the center's session view since
// DC9's M3, as MAWS's report draws them — are its message cards while they stream and once settled, and the turn a
// subagent's hand-back opens reads as the session's own. The desk control surface's M0 (A1): the Info tab reads the
// engine's status (`read status`) when it opens and on Refresh, where the session's bridge can answer it, and otherwise
// says the plugin cannot and what it would need.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { M0_CAPABILITIES, TWO_SUBAGENTS } from 'desk-hub/fake-machine';
import type { StatusRead } from 'desk-hub/protocol';
import type { LatencyReport } from '../src/latency/latency';
import { DepthPlayer, type PlayerOptions } from './depth-player';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, S, stageProject } from './scene';
import type { HubDouble } from '../test/double/hub-double';
import { readRecording } from '../test/double/session-stream';

const recording = readRecording();
const DIFF = readFileSync(join(TWO_SUBAGENTS, 'diff.patch'), 'utf8');
const FIRST = { context: { tokens: 36820, window: 1_000_000, percent: 4 }, cost: { usd: 0.003228125 } };
const LATER = { context: { tokens: 38686, window: 1_000_000, percent: 4 }, cost: { usd: 0.005277275 } };
const POLICY = { read_only: false, ceiling: 'default' };
const STATUS: StatusRead = { version: { version: '2.1.307', base: '2.1.300' }, model: null, cwd: '/Users/new/Developer/GitHub/MAWS', root: '/Users/new/Developer/GitHub/MAWS', repo: { remote: 'https://github.com/SSFSKIM/MAWS.git', branch: 'master' }, surfaces: ['cli'], override: null };

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
  await expect(page.getByTestId('session-view')).toContainText('Both subagents reported back.'); // drawn in the center
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
  // Bridged, but no usage has been reported yet (the snapshot has null usage).
  await expect(info('context')).toHaveText('not reported yet');
  await expect(info('cost')).toHaveText('not reported yet');

  player.sendUsage(FIRST); // after a main turn
  await expect(info('context')).toHaveText('36.8K of 1M (4%)');
  await expect(info('cost')).toHaveText('$0.0032');
  player.sendUsage(LATER);
  await expect(info('context')).toHaveText('38.7K of 1M (4%)');
  await expect(info('cost')).toHaveText('$0.0053');

  hub.dropConnections(); // the fresh snapshot carries the last usage
  await expect.poll(() => player.subscriptions()).toBe(2);
  await expect(page.getByTestId('session-status')).toHaveText('');
  await expect(info('context')).toHaveText('38.7K of 1M (4%)');
  await expect(info('cost')).toHaveText('$0.0053');
});

test("a streaming message stays authored text until closed, then receives unboxed ink; a hand-back's turn reads Continued", async ({ page, hub }) => {
  const { player } = await openDepth(page, hub);
  const view = page.getByTestId('session-view');
  player.advanceTo((item) => item.kind === 'chunk' && item.body.chunk.kind === 'text' && String(item.body.chunk.text).startsWith('<message>'));
  player.advance(1);
  const stream = view.locator('[data-row-id^="desk-stream:"]');
  while (!(await stream.last().textContent())?.includes('Both subagents rep')) {
    player.advance(1);
    await page.waitForTimeout(20);
  }
  // UX1-C preserves unfinished output tags literally instead of repairing them into a card.
  await expect(stream.last()).toContainText('<message>\nBoth subagents rep');
  await expect(stream.last().locator('.owner-message-ink')).toHaveCount(0);

  player.advance(player.script.length);
  await expect(stream).toHaveCount(0);
  const settled = view.locator('[data-kind="assistant_text"]').filter({ hasText: 'Both subagents reported back.' });
  await expect(settled).toHaveCount(1); // one answer row, not one ink span per Markdown leaf
  await expect(settled).toContainText('Both subagents reported back. The kettle is on the second shelf, and the last word in words.txt is "gamma".');
  await expect(settled.locator('p .owner-message-ink').filter({ hasText: 'Both subagents reported back.' })).toHaveCount(1);
  await expect(settled.locator('li')).toHaveText([
    'notes.md: the kettle is on the second shelf.',
    'words.txt: the file lists alpha, beta, gamma, then an empty trailing line, so the last word is "gamma".',
  ]);
  await expect(settled.locator('[data-streamdown="strong"] .owner-message-ink')).toHaveText(['notes.md:', 'words.txt:']);
  await expect(view.locator('[data-owner-card], .owner-card-label')).toHaveCount(0);
  expect(await view.evaluate((el) => el.textContent?.includes('<message>'))).toBe(false);
  await expect(view).not.toContainText('Peer session worked');
  await expect(view).toContainText('Continued for');
});

test("the engine's status: read when Info opens and on Refresh, never on a presence; from an older plugin, not available and what it needs", async ({ page, hub }) => {
  await page.addInitScript(() => localStorage.setItem('desk.latency', '1'));
  const { player, depth } = await openDepth(page, hub, {}, (p) => {
    p.skip(p.script.length);
    p.status = STATUS;
  });
  await depth.getByTestId('depth-tab-info').click();
  const info = (id: string) => depth.getByTestId(`depth-info-${id}`);
  // The scene's mini runs a plugin older than the desk's controls: the fields say so, not a spinner, and nothing is read.
  for (const id of ['engine', 'root', 'repo', 'surfaces']) await expect(info(id)).toHaveText('not available from this plugin (needs sminos ≥ 1.7.0)');
  await expect(info('status-reason')).toHaveText("mini's plugin is older than the desk's controls: update sminos on mini");
  await page.waitForTimeout(300);
  expect(player.readsAsked).toBe(0);

  // mini updated, the session's bridge at M0: the tab reads the status once.
  hub.setMachines(PROJECT, [
    { machine: 'mini', online: true, policy: POLICY, checkouts: [], desk: { sminos: '1.7.0', rpcs: ['command'], reads: [] } },
    { machine: 'SK.local', online: true, policy: POLICY, checkouts: [] },
  ]);
  hub.sendSession(PROJECT, { project: PROJECT, machine: 'mini', session: S.asks, kind: 'presence', sub: null, n: null, body: { record: { status: 'waiting' }, bridge: true, capabilities: M0_CAPABILITIES } });
  await expect.poll(() => player.readsAsked).toBe(1);
  await expect(info('engine')).toHaveText('2.1.307 (base 2.1.300)');
  await expect(info('root')).toHaveText('/Users/new/Developer/GitHub/MAWS');
  await expect(info('repo')).toHaveText('https://github.com/SSFSKIM/MAWS.git · master');
  await expect(info('surfaces')).toHaveText('cli');
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { deskLatency: () => LatencyReport }).deskLatency())).paths['read.status']?.n ?? 0).toBe(1);

  // A presence is no reason to read again; Refresh is.
  hub.sendSession(PROJECT, { project: PROJECT, machine: 'mini', session: S.asks, kind: 'presence', sub: null, n: null, body: { record: { status: 'idle' }, bridge: true, capabilities: M0_CAPABILITIES } });
  await page.waitForTimeout(300);
  expect(player.readsAsked).toBe(1);
  player.status = { ...STATUS, surfaces: ['cli', 'desk'] };
  await info('refresh').click();
  await expect.poll(() => player.readsAsked).toBe(2);
  await expect(info('surfaces')).toHaveText('cli, desk');
});
