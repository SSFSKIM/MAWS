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
  const replay = (fm = new FakeMachineReplay(hub, { project: PROJECT, machine: MACHINE }, { recording: SESSION_VIEW, producer: options.producer ?? 'm1', stale: options.stale }));
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
  return composer.getByTestId('command-status').last();
}

test('A2: a typed /rename runs as a command — queued, then ran with its row — without inferring a title from the command receipt; its paths are timed', async ({ page, hub }) => {
  const { composer, box } = await openSession(page, hub);
  const status = await run(composer, box, '/rename desk-m0');
  await expect(status).toHaveAttribute('data-command-state', 'ran');
  await expect(status).toHaveText('Ran · Session renamed to: desk-m0 · confirmed by its row');
  await expect(page.getByTestId('channel-header')).toContainText('desk-m0');
  await expect(page.getByTestId('channel-header')).toContainText(ALIAS);
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
  await expect(status).toHaveText('Ran · Session renamed to: after-the-turn · confirmed by its row');
  expect(commandsSent(hub)).toBe(1);
});

test('A4: panels and unknown names are refused locally; Model opens its existing control', async ({ page, hub }) => {
  const { composer, box } = await openSession(page, hub);
  for (const [text, reason] of [['/usage', 'opens a panel in the terminal'], ['/foo', 'not a command this session knows']]) {
    await box.fill(text);
    await composer.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(composer.getByTestId('command-refused')).toContainText(reason);
    await expect(box).toHaveValue(text);
  }
  await box.fill('/model');
  await composer.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(composer.getByRole('form', { name: 'Model and effort' })).toBeVisible();
  expect(commandsSent(hub)).toBe(0);
  expect(wordsSent(hub)).toEqual([]);
});

test('A9: /reload-plugins confirmed by effect, /reload-skills by text, /mcp disable by its row and what it saves', async ({ page, hub }) => {
  const { composer, box } = await openSession(page, hub);
  await expect(await run(composer, box, '/reload-plugins')).toHaveText('Ran: the plugins reloaded · confirmed by effect');
  await expect(await run(composer, box, '/reload-skills')).toHaveText('Ran · Reloaded skills: 14 skills · confirmed by text');
  await expect(await run(composer, box, '/mcp disable github')).toHaveText(`Ran · MCP server "github" disabled · confirmed by its row · saved for this project on ${MACHINE}: .claude.json`);
});

test("A5: an older machine's plugin is refused in the composer with its reason, and Send as text anyway delivers the words", async ({ page, hub }) => {
  const { composer, box } = await openSession(page, hub, { producer: 'dc8' });
  await box.fill('/rename x');
  await composer.getByRole('button', { name: 'Send', exact: true }).click();
  const refusal = composer.getByTestId('command-refused');
  await expect(refusal).toContainText(`${MACHINE}'s plugin is older than the desk's controls: update sminos on ${MACHINE}`);
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
  await expect(composer.getByTestId('command-status')).toHaveText('Ran · Session renamed to: fresh · confirmed by its row');
});

test('A6: a presence whose capabilities shrink withdraws the control with the reason', async ({ page, hub }) => {
  const { fm, composer, box } = await openSession(page, hub);
  await expect(await run(composer, box, '/color red')).toHaveText('Ran · Session color set to: red · confirmed by its row');
  fm.reload(true);
  await box.fill('/color blue');
  await composer.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(composer.getByTestId('command-refused')).toContainText("this session's plugin loaded before the update: run /reload-plugins in it, or restart it");
  expect(commandsSent(hub)).toBe(1);
});


test('A10/A33: palette draws locally with groups and reasons, catalog changes push, and both paths are measured', async ({ page, hub }) => {
  const { composer, box } = await openSession(page, hub);
  await expect.poll(async () => (await readout(page)).paths['catalog.ready']?.n ?? 0).toBeGreaterThan(0);
  const sent = hub.up.length;
  await box.fill('/');
  const palette = composer.getByTestId('slash-palette');
  await expect(palette.getByRole('group', { name: 'Engine', exact: true })).toBeVisible();
  await expect(palette.getByRole('group', { name: 'Skills', exact: true })).toBeVisible();
  await expect(palette.getByRole('group', { name: 'Plugins', exact: true })).toBeVisible();
  await expect(palette.getByRole('group', { name: 'Custom', exact: true })).toBeVisible();
  await expect(palette.getByRole('option', { name: /probe:probe-prompt \(MCP\)/ })).toBeVisible();
  await test.info().attach("palette-desktop", { body: await page.screenshot(), contentType: "image/png" });
  // No read or RPC is caused by opening/filtering the palette (background presence/visibility are independent).
  expect(hub.up.slice(sent).filter(({ frame }) => frame.t === 'read' || frame.t === 'rpc')).toEqual([]);
  await box.fill('/mcp');
  await expect(palette.getByRole('option', { name: /mcp/ })).toContainText('enable|disable|reconnect <server>');
  await box.fill('/exit');
  await expect(palette.getByRole('option', { name: /exit/ })).toHaveAttribute('aria-disabled', 'true');
  await box.fill('/col');
  await box.press('Enter');
  await expect(box).toHaveValue('/color ');
  await box.fill('/color red');
  await composer.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(composer.getByTestId('command-status').last()).toContainText('Session color set to: red');
  await run(composer, box, '/reload-skills');
  await box.fill('/reloaded-skill');
  await expect(palette.getByRole('option', { name: /reloaded-skill-1/ })).toBeVisible();
  const paths = (await readout(page)).paths;
  expect(paths['palette.open']?.n).toBeGreaterThan(0);
  expect(paths['palette.open']?.p95).toBeLessThan(50);
});

test('A11/A12: back-to-back queued commands retain separate receipts; an exact MCP prompt starts a turn', async ({ page, hub }) => {
  const { fm, composer, box } = await openSession(page, hub);
  fm.playThrough((step) => step.k === 'turn-start' && step.agentId === null);
  fm.depth.presence = { status: 'busy' }; fm.sendPresence();
  await run(composer, box, '/color red');
  await run(composer, box, '/color blue');
  await expect(composer.getByTestId('command-status')).toHaveCount(2);
  fm.playThrough((step) => step.k === 'turn-end' && step.agentId === null);
  await expect(composer.getByTestId('command-status').nth(0)).toContainText('Session color set to: red');
  await expect(composer.getByTestId('command-status').nth(1)).toContainText('Session color set to: blue');
  await expect(await run(composer, box, '/probe:probe-prompt (MCP) explain')).toHaveText('Started a turn');
  const call = hub.up.findLast(({ frame }) => frame.t === 'rpc' && frame.rpc.rpc === 'command')?.frame;
  expect(call?.t === 'rpc' ? call.rpc.args : null).toMatchObject({ name: 'probe:probe-prompt (MCP)', args: 'explain' });
});

test('A14: a cached catalog is labelled and run items withdraw after downgrade; no cache shows desk controls only', async ({ page, hub }) => {
  const { fm, composer, box } = await openSession(page, hub);
  await box.fill('/color');
  await expect(composer.getByRole('option', { name: /color/ })).not.toHaveAttribute('aria-disabled', 'true');
  fm.reload(true);
  await box.fill('/');
  await expect(composer.getByTestId('slash-palette')).toContainText('as of');
  await expect(composer.getByRole('option', { name: /color/ })).toHaveAttribute('aria-disabled', 'true');
  // Withdrawing the bridge alone makes a stale session, not an older machine.
  await expect(composer.getByTestId('slash-palette')).toContainText("this session's plugin loaded before the update");
  await expect(composer.getByTestId('slash-palette')).not.toContainText('commands need sminos');
  hub.setMachines(PROJECT, [{ machine: MACHINE, online: true, policy: { read_only: false, ceiling: 'default' },
    checkouts: [{ path: fm.recording.cwd, branch: 'main' }], desk: { sminos: '1.7.1', rpcs: ['command'], reads: [] } }]);
  await expect(composer.getByTestId('slash-palette')).toContainText('commands need sminos ≥ 1.8.0');
});

test('a missed op end replays after the browser reconnects without issuing the command again', async ({ page, hub }) => {
  const { fm, composer, box } = await openSession(page, hub);
  fm.playThrough((step) => step.k === 'turn-start' && step.agentId === null);
  fm.depth.presence = { status: 'busy' }; fm.sendPresence();
  await run(composer, box, '/color green');
  await expect(composer.getByTestId('command-status')).toHaveAttribute('data-command-state', 'queued');
  hub.admit = 'unreachable';
  fm.drop();
  fm.playThrough((step) => step.k === 'turn-end' && step.agentId === null);
  hub.admit = 'member';
  await expect(composer.getByTestId('command-status')).toHaveText('Ran · Session color set to: green · confirmed by its row');
  expect(commandsSent(hub)).toBe(1);
});


test('A14 on a phone: an older session with no cached catalog opens Model and Compact without fetching', async ({ page, hub }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { composer, box } = await openSession(page, hub, { producer: 'm0' });
  const sent = hub.up.length;
  await box.fill('/');
  const palette = composer.getByTestId('slash-palette');
  await expect(palette.getByRole('option')).toHaveCount(2);
  await expect(palette).toContainText('commands need sminos ≥ 1.8.0');
  await test.info().attach("palette-phone", { body: await page.screenshot(), contentType: "image/png" });
  const rect = await palette.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
  expect(hub.up.slice(sent).filter(({ frame }) => frame.t === 'read' || frame.t === 'rpc')).toEqual([]);
});
