// The web app against DC3's local hub (`pnpm --filter desk-hub local`): the Worker serving the built app behind the
// stand-in for Access, and an admin removing an enrolled machine from the Machines dialog (DX7's enrollment and
// revocation, which take no org key).
//
// What else this suite and session-plane.spec.ts proved drove the phase-1 routes, which left the hub with P5 O14 M5b:
// the org key set up, opened and changed (`POST` and `DELETE /api/org/keys`), the codes the browser built with it, and
// a machine's log, a web human and the session plane fed over DX2 (`/machine/stream`, `/machine/frames`) and DX6 (the
// project socket's `rpc`). An RL1 machine carries no session-plane frame, so nothing feeds those views now; the cards
// that replaced them are cards-device.spec.ts's and src/cards/cards.local.test.ts's.
//
// Each run's local hub starts from a fresh state (test/local/hub.ts).
import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { EnrollmentIssued, MachineRecord, Redeemed } from 'desk-hub/protocol';
import { LocalHub } from '../test/local/hub';

test.describe.configure({ mode: 'serial' });

const PROJECT = randomUUID();
const SESSION = randomUUID();

let hub: LocalHub;
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(150_000);
  hub = await LocalHub.start();
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
  await hub?.stop();
});

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

test('an admin removes an enrolled machine from the Machines dialog: it leaves the list, and its credential is refused', async () => {
  test.setTimeout(60_000);
  // A machine enrolled as `sminos hub enroll` redeems a token, and confirmed by its first request.
  const name = `rm-${randomUUID().slice(0, 8)}`;
  const issued = await fetch(`${hub.url}/api/enrollments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(issued.status).toBe(201);
  const { token } = (await issued.json()) as EnrollmentIssued;
  const redeemed = await fetch(`${hub.url}/machine/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, machine: name }) });
  expect(redeemed.status).toBe(200);
  const { client_id, client_secret } = (await redeemed.json()) as Redeemed;
  const self = () => fetch(`${hub.url}/machine/enrollment`, { headers: { 'CF-Access-Client-Id': client_id, 'CF-Access-Client-Secret': client_secret } });
  expect(await (await self()).json()).toMatchObject({ machine: name, state: 'active' });

  await page.goto(hub.localhost);
  await page.getByRole('button', { name: 'Machines', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Machines' });
  const row = dialog.locator(`[data-machine="${name}"]`);
  await expect(row).toContainText('enrolled');

  await row.getByRole('button', { name: `Remove ${name}` }).click();
  const confirm = dialog.getByTestId('remove-confirm');
  await expect(confirm.getByTestId('remove-meaning')).toContainText('disconnects it at once and deletes its credential');
  await confirm.getByRole('button', { name: `Remove ${name}` }).click();
  await expect(dialog.getByTestId('machines-notice')).toHaveText(`Removed ${name}. To use it with the desk again, enroll it again.`);
  await expect(row).toHaveCount(0);
  const listed = (await (await fetch(`${hub.url}/api/machines`)).json()) as { machines: MachineRecord[] };
  expect(listed.machines.map((m) => m.name)).not.toContain(name);
  // Its credential is refused by Access, 401: the local stand-in deletes the revoked token in the same call and then
  // refuses it as production Access does (the provisioning-keys spec, §4).
  expect((await self()).status).toBe(401);
});
