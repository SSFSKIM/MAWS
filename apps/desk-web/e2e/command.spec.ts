// The desk control surface's M0 (A2–A6, A9, A33 for its paths), in a real browser against DC3's fake machine replaying
// the `session-view` recording as an M0 producer (`fake-machine.ts`): a `/name args` typed in the session's composer
// runs as DX6 `command` and its status line reads queued, then what ran with the line read back and how it was
// confirmed; mid-turn it waits for the turn (H-queue); the bridge's route check refuses a panel, a command the desk has
// its own control for, and a name the session does not know, nothing run; an older machine's plugin and a stale session
// are refused in the composer with their reasons, *Send as text anyway* delivering the words as before; and a presence
// whose capabilities shrink withdraws the control with the reason.
import type { Locator, Page } from '@playwright/test';
import { SESSION_VIEW, type Producer } from 'desk-hub/fake-machine';
import type { LatencyReport } from '../src/latency/latency';
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

/** The fake machine replaying the recording as `producer`, its machine's presence carrying `desk` when it is M0's. */
async function openSession(page: Page, hub: HubDouble, options: { producer?: Producer; stale?: boolean } = {}): Promise<{ fm: FakeMachineReplay; composer: Locator; box: Locator }> {
  await page.addInitScript(() => localStorage.setItem('desk.latency', '1'));
  await stageProject(hub);
  const replay = (fm = new FakeMachineReplay(hub, { project: PROJECT, machine: MACHINE }, { recording: SESSION_VIEW, producer: options.producer ?? 'm0', stale: options.stale }));
  const policy = { read_only: false, ceiling: 'default' };
  hub.setMachines(PROJECT, [
    { machine: 'mini', online: true, policy, checkouts: [] },
    { machine: 'SK.local', online: true, policy, checkouts: [] },
    { machine: MACHINE, online: true, policy, checkouts: [{ path: replay.recording.cwd, branch: 'main' }], ...replay.machineDesk },
  ]);
  await hub.append(PROJECT, { writer: `${MACHINE}/${replay.session}`, kind: 'joined', session: replay.session, alias: ALIAS, name_source: 'user', machine: MACHINE, cwd: replay.recording.cwd, worktree: '', role: '', seat: '', by: '' });
  replay.sendPresence();
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${replay.session}`);
  await expect(page.getByTestId('session-view')).toHaveAttribute('data-session', replay.session);
  await expect.poll(() => replay.subscriptions()).toBe(1);
  const composer = page.getByTestId('composer');
  return { fm: replay, composer, box: composer.getByRole('textbox', { name: `Message ${ALIAS}` }) };
}

const commandsSent = (hub: HubDouble) => hub.up.filter(({ frame }) => frame.t === 'rpc' && frame.rpc.rpc === 'command').length;
const wordsSent = (hub: HubDouble) => hub.up.flatMap(({ frame }) => (frame.t === 'human' ? [frame.event.text] : []));
const readout = (page: Page) => page.evaluate(() => (window as unknown as { deskLatency: () => LatencyReport }).deskLatency());

async function run(composer: Locator, box: Locator, text: string): Promise<Locator> {
  await box.fill(text);
  await composer.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(box).toHaveValue('');
  return composer.getByTestId('command-status');
}

test('A2: a typed /rename runs as a command — queued, then ran with its row — and the session is titled; its paths are timed', async ({ page, hub }) => {
  const { composer, box } = await openSession(page, hub);
  const status = await run(composer, box, '/rename desk-m0');
  await expect(status).toHaveAttribute('data-command-state', 'ran');
  await expect(status).toHaveText('Session renamed to: desk-m0 · confirmed by its row');
  await expect(page.getByTestId('channel-header')).toContainText('desk-m0');
  expect(wordsSent(hub)).toEqual([]); // a command, never words
  // A33: each M0 path is in the readout after one use.
  await expect.poll(async () => {
    const { paths } = await readout(page);
    return ['op.queued', 'op.ran', 'op.readback'].filter((path) => !paths[path as keyof typeof paths]);
  }).toEqual([]);
});

test('A3: mid-turn a command waits for the turn and says so, then runs after it', async ({ page, hub }) => {
  const { fm, composer, box } = await openSession(page, hub);
  fm.playThrough((step) => step.k === 'turn-start' && step.agentId === null);
  fm.depth.presence = { status: 'busy', waitingFor: null, needs: null };
  fm.sendPresence();
  await box.fill('/rename after-the-turn');
  await expect(composer.getByTestId('composer-note')).toContainText(`a command is queued until ${ALIAS} is idle`);
  await box.press('Enter'); // mid-turn Enter steers words; a slash is a command
  const status = composer.getByTestId('command-status');
  await expect(status).toHaveText(`Queued until ${ALIAS} is idle`);
  await page.waitForTimeout(300);
  await expect(status).toHaveAttribute('data-command-state', 'queued');
  fm.playThrough((step) => step.k === 'turn-end' && step.agentId === null);
  await expect(status).toHaveText('Session renamed to: after-the-turn · confirmed by its row');
  expect(commandsSent(hub)).toBe(1);
});

test("A4: the bridge refuses a panel, a command the desk has its own control for, and one the session does not know, by its reason", async ({ page, hub }) => {
  const { composer, box } = await openSession(page, hub);
  const refused = async (text: string, words: string) => {
    const status = await run(composer, box, text);
    await expect(status).toHaveAttribute('data-command-state', 'refused');
    await expect(status).toHaveText(`${text.split(' ')[0]}: ${words}`);
  };
  await refused('/usage', "opens a panel in the terminal; it would hold the session's queue");
  await refused('/model sonnet', 'use Model instead: /model saves a default for new sessions');
  await refused('/foo', 'not a command this session knows');
  expect(wordsSent(hub)).toEqual([]);
});

test('A9: /reload-plugins confirmed by effect, /reload-skills by text, /mcp disable by its row and what it saves', async ({ page, hub }) => {
  const { composer, box } = await openSession(page, hub);
  await expect(await run(composer, box, '/reload-plugins')).toHaveText('Ran: the plugins reloaded · confirmed by effect');
  await expect(await run(composer, box, '/reload-skills')).toHaveText('Reloaded skills: 14 skills · confirmed by text');
  await expect(await run(composer, box, '/mcp disable github')).toHaveText(`MCP server "github" disabled · confirmed by its row · saved for this project on ${MACHINE} until enabled again`);
});

test("A5: an older machine's plugin is refused in the composer with its reason, and Send as text anyway delivers the words", async ({ page, hub }) => {
  const { composer, box } = await openSession(page, hub, { producer: 'dc8' });
  await box.fill('/rename x');
  await composer.getByRole('button', { name: 'Send', exact: true }).click();
  const refusal = composer.getByTestId('command-refused');
  await expect(refusal).toContainText(`${MACHINE}'s plugin is older than the desk's controls: update doperpowers on ${MACHINE}`);
  expect(commandsSent(hub)).toBe(0);
  await refusal.getByRole('button', { name: 'Send as text anyway' }).click();
  await expect.poll(() => wordsSent(hub)).toEqual(['/rename x']);
  await expect(refusal).toHaveCount(0);
  await expect(box).toHaveValue('');
  expect(commandsSent(hub)).toBe(0);
});

test('A5: a stale session is told to reload; after /reload-plugins in its terminal the command runs', async ({ page, hub }) => {
  const { fm, composer, box } = await openSession(page, hub, { stale: true });
  await box.fill('/rename fresh');
  await composer.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(composer.getByTestId('command-refused')).toContainText("this session's plugin loaded before the update: run /reload-plugins in it, or restart it");
  expect(commandsSent(hub)).toBe(0);
  fm.reload();
  await composer.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(composer.getByTestId('command-status')).toHaveText('Session renamed to: fresh · confirmed by its row');
});

test('A6: a presence whose capabilities shrink withdraws the control with the reason', async ({ page, hub }) => {
  const { fm, composer, box } = await openSession(page, hub);
  await expect(await run(composer, box, '/color red')).toHaveText('Session color set to: red · confirmed by its row');
  fm.reload(true);
  await box.fill('/color blue');
  await composer.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(composer.getByTestId('command-refused')).toContainText("this session's plugin loaded before the update: run /reload-plugins in it, or restart it");
  expect(commandsSent(hub)).toBe(1);
});
