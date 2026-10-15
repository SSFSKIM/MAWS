// The web app against DC3's local hub (`pnpm --filter desk-hub local`): the Worker serving the built app behind the
// stand-in for Access, DX7's enrollment, and DX3's project socket over the real log plane. M1's proof as far as DC3's
// M2 carries it (sign-in, the Worker serving the app, resume across a reload, a web `human` acknowledged) and M2's:
// a passkey-derived key in an enrollment code the browser made, which enrolls a machine whose events the browser then
// verifies with the same key. The machine is a DX7/DX2 test client (test/local/machine.ts) until DC4's uplink lands;
// the grid's counts wait on DC3's M3 (the registry's socket).
//
// One browser page for the suite: its virtual authenticator holds the org's passkey from the enrollment on.
import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page, type WebSocket } from '@playwright/test';
import { seal, verify, type DownFrame, type HumanDraft, type LogEvent, type ProjectDown, type ProjectUp } from 'desk-hub/protocol';
import { ProjectClient } from '../src/hub/project-client';
import { virtualAuthenticator } from '../e2e/authenticator';
import { LocalHub } from '../test/local/hub';
import { TestMachine } from '../test/local/machine';

test.describe.configure({ mode: 'serial' });

const PROJECT = randomUUID();
const SESSION = randomUUID();
const MACHINE = `e2e-${randomUUID().slice(0, 8)}`;

let hub: LocalHub;
let context: BrowserContext;
let page: Page;
let machine: TestMachine | undefined;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(150_000);
  hub = await LocalHub.start();
  context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: hub.localhost });
  page = await context.newPage();
  await virtualAuthenticator(page);
});

test.afterAll(async () => {
  await machine?.close();
  await context?.close();
  await hub?.stop();
});

/** The project socket's frames, as the page sent and received them, from the moment of the call. */
function watchSockets(target: Page) {
  const sent: ProjectUp[] = [];
  const received: ProjectDown[] = [];
  const watch = (ws: WebSocket) => {
    if (!ws.url().includes(`/api/projects/${PROJECT}/socket`)) return;
    ws.on('framesent', (f) => sent.push(JSON.parse(String(f.payload)) as ProjectUp));
    ws.on('framereceived', (f) => received.push(JSON.parse(String(f.payload)) as ProjectDown));
  };
  target.on('websocket', watch);
  return { sent, received, stop: () => target.off('websocket', watch) };
}

test('signed in through the stand-in, the Worker serves the built app at every path of the app', async ({ browser }) => {
  const response = await page.goto(hub.localhost);
  expect(response?.headers()['content-type']).toContain('text/html');
  await expect(page.getByRole('banner')).toContainText('owner@example.com');

  // A deep link is the app too (the single-page fallback), and /api/* is the Worker's.
  const deep = await page.goto(`${hub.localhost}/p/${PROJECT}/s/${SESSION}`);
  expect(deep?.status()).toBe(200);
  await expect(page.getByTestId('project-view')).toBeVisible();
  const me = await page.request.get(`${hub.localhost}/api/me`);
  expect(await me.json()).toMatchObject({ org: { id: 'local' }, member: { email: 'owner@example.com', role: 'admin' } });

  // Someone Access admits but the org does not hold.
  const stranger = await browser.newPage();
  await stranger.goto(`${hub.url}/standin/login?email=stranger@example.com`);
  await expect(stranger.getByTestId('sign-in')).toContainText('does not hold you as a member');
  await stranger.close();
});

test('the passkey unlocks the key, and the code the browser builds enrolls a machine, shown once', async () => {
  test.setTimeout(60_000);
  await page.goto(hub.localhost);
  await page.getByTestId('key-state').click();
  const keyDialog = page.getByRole('dialog', { name: 'Org key' });
  await keyDialog.getByLabel('Keep unlocked on this device').check();
  await keyDialog.getByRole('button', { name: "First time? Create the org's passkey" }).click();
  await keyDialog.getByRole('button', { name: 'Create the org passkey' }).click();
  await expect(keyDialog.getByTestId('unlocked')).toContainText('Unlocked on this device');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Machines' }).click();
  const dialog = page.getByRole('dialog', { name: 'Machines' });
  await dialog.getByRole('button', { name: 'Enroll a machine' }).click();
  await dialog.getByLabel(/machine's name/).fill('hub');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByRole('alert')).toContainText('not "hub" or "legacy"');
  await dialog.getByLabel(/machine's name/).fill(MACHINE);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByTestId('confirm-machine')).toHaveText(MACHINE);
  await dialog.getByRole('button', { name: 'Confirm with passkey' }).click();
  // The code alone, never inside a command line (the process listing and the shell's history would keep the key).
  const shown = dialog.getByTestId('enroll-code');
  await expect(shown).toContainText('run sminos hub enroll, then paste this code');
  const code = (await dialog.getByTestId('enrollment-code').textContent())!;
  expect(code).toMatch(/^smns-enroll-v1\.[A-Za-z0-9_-]+$/);
  await expect(shown).not.toContainText(`sminos hub enroll ${code}`);
  await dialog.getByRole('button', { name: 'Copy' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog.getByTestId('enrollment-code')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('smns-enroll-v1.');

  // On the machine: `sminos hub enroll`, the code pasted at its prompt, redeems the token at the hub the code names.
  machine = await TestMachine.enroll(code);
  expect(machine.code).toMatchObject({ hub: hub.localhost, org: 'local', machine: MACHINE });
  expect(machine.redeemed).toMatchObject({ org: 'local', machine: MACHINE });
  const reopen = async () => {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Machines' }).click();
  };
  await reopen();
  await expect(dialog.locator(`[data-machine="${MACHINE}"]`)).toContainText('enrolling');

  // Its first authenticated connection confirms it.
  await machine.connect();
  await reopen();
  await expect(dialog.locator(`[data-machine="${MACHINE}"]`)).toContainText('connected');

  // The name is the machine's now.
  await dialog.getByRole('button', { name: 'Enroll a machine' }).click();
  await dialog.getByLabel(/machine's name/).fill(MACHINE.toUpperCase());
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByRole('alert')).toContainText('already enrolled');
  await page.keyboard.press('Escape');
});

test("the machine's log is drawn, verified with the passkey's key, and a reload resumes after the recorded offset", async () => {
  const m = machine!;
  await m.hello(PROJECT, 'desk-e2e');
  await m.write(PROJECT, SESSION, [
    { kind: 'joined', session: SESSION, alias: 'e2e-45', machine: MACHINE, cwd: '/tmp/desk-e2e', worktree: '', role: '', seat: '', by: '', name_source: 'user' },
    { kind: 'message', from: 'e2e-45', to: 'host', text: `hello from ${MACHINE}`, src: 'r1:0' },
  ]);

  const first = watchSockets(page);
  await page.goto(`${hub.localhost}/p/${PROJECT}`);
  const center = page.getByRole('region', { name: 'Channel' });
  await expect(center).toContainText(`hello from ${MACHINE}`);
  await expect(page.getByTestId('refused')).toHaveCount(0);
  const head = Math.max(...first.received.flatMap((f) => (f.t === 'log' ? f.events.map((e) => e.offset) : [])));
  expect(first.sent.find((f) => f.t === 'resume')).toEqual({ t: 'resume', after: 0 });
  first.stop();

  const second = watchSockets(page);
  await page.reload();
  await expect(center).toContainText(`hello from ${MACHINE}`); // drawn from the browser's own record
  await expect.poll(() => second.received.some((f) => f.t === 'caught-up')).toBe(true);
  expect(second.sent.find((f) => f.t === 'resume')).toEqual({ t: 'resume', after: head });
  expect(second.received.flatMap((f) => (f.t === 'log' ? f.events.map((e) => e.offset) : [])).filter((offset) => offset <= head)).toEqual([]);

  // And it tails live after the resume.
  await m.write(PROJECT, SESSION, [{ kind: 'message', from: 'e2e-45', to: 'host', text: 'written after the reload', src: 'r2:0' }]);
  await expect(center).toContainText('written after the reload');
  second.stop();
});

test('a web human sent through the hub client is acknowledged, stored under hub/<member>, and reaches the machine', async () => {
  const m = machine!;
  const me = (await (await fetch(`${hub.url}/api/me`)).json()) as { member: { id: string } };
  const client = new ProjectClient({ base: hub.url.replace('http', 'ws'), project: PROJECT, handlers: { held: () => 0 } });
  client.start();
  try {
    const draft: HumanDraft = { kind: 'human', from: 'human', member: me.member.id, to: [{ session: SESSION, alias: 'e2e-45' }], text: 'keep user_id', created: new Date().toISOString() };
    const from = m.frames.length;
    const ack = await client.sendHuman(await seal(m.key, 'log', PROJECT, draft));
    expect(ack).toMatchObject({ writer: `hub/${me.member.id}`, seq: 1 });

    const delivered = (await m.next((f) => f.t === 'events' && f.project === PROJECT && f.events.some((e) => e.writer === ack.writer), 'the human', from)) as Extract<DownFrame, { t: 'events' }>;
    const event = delivered.events.find((e) => e.writer === ack.writer) as LogEvent;
    expect(await verify(m.key, 'log', PROJECT, event)).toBe(true);
    await expect(page.getByRole('region', { name: 'Channel' })).toContainText('keep user_id');
  } finally {
    client.stop();
  }
});
