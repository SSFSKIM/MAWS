// Phone sleep across the end of a long reply and a queued command. The fake machine advances while the page is
// offline, so recovery must take current state rather than animate its missed stream or forget its receipt.
import type { Page } from '@playwright/test';
import { RPC_FRESHNESS_MS } from 'desk-hub/protocol';
import { type Recording, type Step } from 'desk-hub/fake-machine';
import { FakeMachineReplay } from './fake-machine';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, stageProject } from './scene';
import type { HubDouble } from '../test/double/hub-double';

const SID = 'd5f83401-7803-4216-80c1-86f45017d8fb';
const MACHINE = 'fake';
const ALIAS = 'm1-busy';
const sentence = (n: number) => `${n}. Sentence ${String(n).padStart(4, '0')}: the phone can catch up to current state.\n`;
const FULL = Array.from({ length: 1000 }, (_, i) => sentence(i + 1)).join('');
const RAN = 'Ran · Session color set to: orange · confirmed by its row';

function recording(): Recording {
  const user = { type: 'user', uuid: 'phone-prompt', parentUuid: null, sessionId: SID, timestamp: '2026-10-22T20:42:29Z', message: { role: 'user', content: 'Write 1000 numbered sentences.' } };
  const answer = { type: 'assistant', uuid: 'phone-answer', parentUuid: user.uuid, sessionId: SID, timestamp: '2026-10-22T20:44:55Z', message: { id: 'phone-response', role: 'assistant', type: 'message', model: 'claude-haiku', content: [{ type: 'text', text: FULL }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10000 } } };
  const steps: Step[] = [
    { at: 0, k: 'row', agentId: null, row: user },
    { at: 0, k: 'presence', record: { status: 'busy' } },
    { at: 0, k: 'turn-start', turnId: 'phone-turn', agentId: null },
    { at: 0, k: 'step-start', turnId: 'phone-turn', agentId: null, step: 0 },
    ...Array.from({ length: 1000 }, (_, i): Step => ({ at: i, k: 'chunk', turnId: 'phone-turn', agentId: null, step: 0, chunkIndex: i, chunk: { kind: 'text', index: 0, text: sentence(i + 1) } })),
    { at: 1001, k: 'block-row', body: { turnId: 'phone-turn', agentId: null, step: 0, index: 0, uuid: answer.uuid } },
    { at: 1002, k: 'row', agentId: null, row: answer },
    { at: 1003, k: 'turn-end', turnId: 'phone-turn', agentId: null, reason: 'end_turn' },
    { at: 1004, k: 'presence', record: { status: 'idle' } },
  ];
  return { name: 'phone-sleep', session: SID, cwd: '/fixture', member: null, rows: { main: [user, answer], agents: {} }, meta: {}, steps, diff: '', chunks: 'synthesized' };
}
let replay: FakeMachineReplay | null = null;
test.afterEach(() => { replay?.stop(); replay = null; });

async function open(page: Page, hub: HubDouble, { send = true, pausedAt = 425 } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await stageProject(hub);
  const fm = replay = new FakeMachineReplay(hub, { project: PROJECT, machine: MACHINE }, { recording: recording(), producer: 'm1' });
  fm.playThrough((s) => s.k === 'chunk' && s.chunkIndex === pausedAt);
  hub.setMachines(PROJECT, [{ machine: MACHINE, online: true, policy: { read_only: false, ceiling: 'default' }, checkouts: [{ path: '/fixture', branch: 'main' }], ...fm.machineDesk }]);
  await hub.append(PROJECT, { writer: `${MACHINE}/${SID}`, kind: 'joined', session: SID, alias: ALIAS, name_source: 'user', machine: MACHINE, cwd: '/fixture', worktree: '', role: '', seat: '', by: '' });
  fm.sendPresence();
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${SID}`);
  await expect(page.getByTestId('session-view')).toContainText('Sentence 0426:');
  if (send) {
    const composer = page.getByTestId('composer');
    await composer.getByRole('textbox').fill('/color orange');
    await composer.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(composer.getByTestId('command-status')).toHaveText('Queued until m1-busy is idle');
  }
  return fm;
}
const commands = (hub: HubDouble) => hub.up.filter(({ frame }) => frame.t === 'rpc' && frame.rpc.rpc === 'command');
const subscriptions = (hub: HubDouble) => hub.up.filter(({ frame }) => frame.t === 'subscribe').length;

// Reopening after the RPC freshness window, without making a browser sleep through a minute of wall time.
async function ageOwnership(page: Page, hub: HubDouble) {
  await page.goto(`${hub.url}/api/seed`);
  await page.evaluate((age) => {
    const rows = JSON.parse(localStorage.getItem('desk.pending-commands') ?? '[]');
    for (const row of rows) row.at -= age;
    localStorage.setItem('desk.pending-commands', JSON.stringify(rows));
  }, RPC_FRESHNESS_MS + 1);
}

test('@layout an offline phone catches up by fresh snapshot, recovers the missed end, and is as fast as reopening', async ({ page, hub, context }) => {
  const fm = await open(page, hub);
  const before = subscriptions(hub);
  await context.setOffline(true);
  fm.drop();
  fm.playThrough();
  // The mounted view missed the terminal transcript and command end, rather than having rendered them hidden.
  await expect(page.getByTestId('session-view')).not.toContainText('Sentence 1000:');
  const woke = Date.now();
  await context.setOffline(false);
  await expect.poll(() => subscriptions(hub)).toBeGreaterThan(before);
  await expect(page.getByTestId('session-view')).toContainText('Sentence 1000:');
  await expect(page.getByTestId('command-status')).toHaveText(RAN);
  const wakeMs = Date.now() - woke;
  await expect.poll(() => subscriptions(hub)).toBeGreaterThan(before);
  expect(commands(hub)).toHaveLength(1); // Replay observes the effect; it never executes the command twice.
  await page.getByRole('button', { name: 'Back to MAWS' }).click();
  await expect(page.getByTestId('session-view')).toHaveCount(0);
  const reopened = Date.now();
  await page.getByRole('navigation', { name: 'Channels' }).locator(`[data-session="${SID}"]`).click();
  await expect(page.getByTestId('session-view')).toContainText('Sentence 1000:');
  const freshMs = Date.now() - reopened;
  expect(wakeMs).toBeLessThanOrEqual(Math.max(1500, freshMs * 2 + 250));
  console.log(`[desk phone wake] ${JSON.stringify({ engine: test.info().project.name, wakeMs, freshMs })}`);
  await test.info().attach('catch-up-times', { body: JSON.stringify({ wakeMs, freshMs }), contentType: 'application/json' });
});

test('@layout a killed page whose command was refused before running reaches an honest terminal fallback without retrying', async ({ page, hub, context }) => {
  let refused: string | null = null;
  await page.routeWebSocket(`**/api/projects/${PROJECT}/socket`, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(message.toString());
      if (frame.t === 'rpc' && frame.rpc.rpc === 'command') {
        // The UI saw online presence when it sent, but the hub's lease is gone by acceptance.
        hub.dropMachine(PROJECT, MACHINE);
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(message.toString());
      if (frame.t === 'rpc-state' && frame.state === 'failed') { refused = frame.nonce; return; }
      socket.send(message);
    });
  });
  await open(page, hub, { send: false });
  const composer = page.getByTestId('composer');
  await composer.getByRole('textbox').fill('/color orange');
  await composer.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => refused).not.toBeNull(); // The sender never takes this one-shot failure, and no op exists.
  expect(hub.rpcState(PROJECT, refused!)).toBeNull();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('desk.pending-commands') ?? '[]').length)).toBe(1);
  await page.close();
  const fresh = await context.newPage();
  await fresh.setViewportSize({ width: 390, height: 844 });
  await ageOwnership(fresh, hub);
  await fresh.goto(`${hub.url}/p/${PROJECT}/s/${SID}`);
  await expect(fresh.getByTestId('command-status')).toHaveAttribute('data-command-state', 'unknown');
  await expect(fresh.getByTestId('command-status')).toContainText(/may not have run.*check the session/i);
  await expect.poll(() => fresh.evaluate(() => JSON.parse(localStorage.getItem('desk.pending-commands') ?? '[]').length)).toBe(0);
  await fresh.reload();
  await expect(fresh.getByTestId('composer')).toBeVisible();
  await expect(fresh.getByTestId('command-status')).toHaveCount(0);
  expect(commands(hub)).toHaveLength(1);
});

test('@layout a fresh page keeps an old replayed command start pending until its real end', async ({ page, hub, context }) => {
  // Leave only the terminal row/turn-end after reopening: this tests the receipt, not a bulk live-chunk flood.
  const fm = await open(page, hub, { pausedAt: 999 });
  await page.close();
  fm.drop(); // Closing the page also ends this generation's fake-machine subscriptions, not its queued command.
  const fresh = await context.newPage();
  await fresh.setViewportSize({ width: 390, height: 844 });
  await ageOwnership(fresh, hub);
  await fresh.goto(`${hub.url}/p/${PROJECT}/s/${SID}`);
  await expect(fresh.getByTestId('command-status')).toHaveText('Queued until m1-busy is idle');
  expect(await fresh.evaluate(() => JSON.parse(localStorage.getItem('desk.pending-commands') ?? '[]').length)).toBe(1);
  await expect(fresh.getByTestId('session-view')).toContainText('Sentence 1000:');
  fm.playThrough();
  await expect(fresh.getByTestId('command-status')).toHaveText(RAN);
  await expect.poll(() => fresh.evaluate(() => JSON.parse(localStorage.getItem('desk.pending-commands') ?? '[]').length)).toBe(0);
  expect(commands(hub)).toHaveLength(1);
});

test('@layout an offline home-screen page killed before the end recovers only its own unseen receipt on a fresh page', async ({ page, hub, context }) => {
  const fm = await open(page, hub);
  await context.setOffline(true);
  await page.close();
  fm.playThrough();
  hub.sendSession(PROJECT, { project: PROJECT, machine: MACHINE, session: SID, sub: null, n: null, kind: 'op', body: {
    rpc: 'other-browser', op: 'command', phase: 'end', id: 'other-command', name: 'color', args: 'blue',
    settled: { ok: true }, readback: { how: 'row', text: 'Session color set to: blue', uuid: 'other-row' },
  } });
  await context.setOffline(false);
  const fresh = await context.newPage();
  await fresh.setViewportSize({ width: 390, height: 844 });
  await ageOwnership(fresh, hub);
  await fresh.goto(`${hub.url}/p/${PROJECT}/s/${SID}`);
  await expect(fresh.getByTestId('session-view')).toContainText('Sentence 1000:');
  await expect(fresh.getByTestId('command-status')).toHaveCount(1);
  await expect(fresh.getByTestId('command-status')).toHaveText(RAN);
  await expect.poll(() => fresh.evaluate(() => JSON.parse(localStorage.getItem('desk.pending-commands') ?? '[]').length)).toBe(0);
  await fresh.reload();
  await expect(fresh.getByTestId('session-view')).toContainText('Sentence 1000:');
  await expect(fresh.getByTestId('command-status')).toHaveCount(0); // Seen own result and other devices' history stay out.
  expect(commands(hub)).toHaveLength(1);
});
