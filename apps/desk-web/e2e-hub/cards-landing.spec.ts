// A push's landing on the cards, and the freeze's one seam (P5 O13 M6; acceptance 2's push half, acceptance 5), in
// Chromium against M4's harness (test/local/endpoint.ts) as M5's cards.spec.ts assembles it: desk-hub's local runner
// rooted by `OrgAdmin`, MAWS's endpoint module enrolled on it in this process as the owner's machine `mini`, and this
// browser paired as a `web-cards` device through the Device panel.
//
// A `waiting` notice for the owner's lane A session, as the hub's `Registry.notify` builds it (`OwnerNotice`, its shape
// pinned by desk-hub's push-owners.test.ts; a lane B session's, since O10's lane B notifier feed, is the same shape), is
// delivered to the service worker through Chromium's DevTools protocol: the notification draws from it alone, and its
// URL opens the session's cards over the machine's channel, cold and in a window already open. A landing on a delegated
// VM certified since the phone last read the org state (a certificate moves no version and raises no notice) re-reads
// the state, and the view names the VM. And a DX session whose machine the org state lists, by its name in another
// case, reads *moved to MAWS* in its frozen session view: composer and controls disabled, its request not answerable,
// nothing sent to the machine.
//
// The hub's own push to a real subscription is M7's (the hub refuses an `http:` endpoint, so no local sink takes one).
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { runnerImport } from 'vite';
import { enrollDelegated, FakeMachine, loadRecording, mintRef, TWO_SUBAGENTS, type DelegationKey } from 'desk-hub/fake-machine';
import { delegationFor, type OwnerNotice, type ProvisioningKeyIssued } from 'desk-hub/protocol';
import { generateSigningKey } from 'org-protocol';
import type { World } from '../test/local/endpoint';
import { enrollInBrowser, holdOrgKey } from './org';

test.describe.configure({ mode: 'serial' });

const ROOT = resolve(import.meta.dirname, '../../..');
const PROJECT = 'proj-m8'; // the harness's sminos project (test/endpoint/sub-harness.ts)
const MOVED = "moved to MAWS: its cards are on this phone's channel";

let harness: typeof import('../test/local/endpoint');
let world: World;
let context: BrowserContext;
let page: Page;
const fakeMachines: FakeMachine[] = [];

const question = (request: string, session = 'la-1') => ({ request, session, tool: 'AskUserQuestion', input: { questions: [{ question: 'Which way?', options: [{ label: 'left' }, { label: 'right' }] }] } });
const cardOf = (target: Page, id: string) => target.locator(`[data-card="${id}"]`);
/** What the service worker posts to the window a tap brings forward (`OPEN_MESSAGE`; handlers.test.ts proves the worker's side). */
const tapInto = (target: Page, url: string) => target.evaluate((to) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'desk-open', url: to } })), url);
const deviceVersion = (target: Page) => target.evaluate(() => window.deskDevice?.().version ?? null);

type Shown = { title: string; options: { body?: string; tag?: string; data?: { url?: string }; actions?: unknown[] } };

/** The running service worker, each notification it asks for recorded, and a push delivered through the DevTools protocol (as phone.spec.ts does). */
async function serviceWorker(target: Page) {
  const cdp = await context.newCDPSession(target);
  const registrations = new Map<string, string>();
  cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations: updated }) => {
    for (const r of updated as Array<{ registrationId: string; scopeURL: string; isDeleted: boolean }>) if (!r.isDeleted) registrations.set(r.scopeURL, r.registrationId);
  });
  await cdp.send('ServiceWorker.enable');
  await target.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => registrations.size).toBeGreaterThan(0);
  const [scope, registrationId] = [...registrations][0];
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(() => {
    const scope = self as unknown as { registration: { showNotification(title: string, options?: object): Promise<void> }; __shown: unknown[] };
    const show = scope.registration.showNotification.bind(scope.registration);
    scope.__shown = [];
    scope.registration.showNotification = (title, options) => {
      scope.__shown.push({ title, options });
      return show(title, options).catch(() => {});
    };
  });
  return {
    deliver: async (notice: OwnerNotice) => void (await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(scope).origin, registrationId, data: JSON.stringify(notice) })),
    shown: () => worker.evaluate(() => (self as unknown as { __shown: Shown[] }).__shown),
  };
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  ({ module: harness } = await runnerImport<typeof import('../test/local/endpoint')>(resolve(import.meta.dirname, '../test/local/endpoint.ts'), {
    configFile: false,
    logLevel: 'error',
    resolve: { alias: { '@shared': resolve(ROOT, 'src/shared'), '@artifacts': resolve(ROOT, 'src/artifacts') } },
  }));
  world = await harness.startWorld({ localhost: true });
  world.sminos.s.send({ t: 'hello', project: PROJECT, name: 'cards', have: {} });
  world.sminos.restate([question('toolu_landed')]);

  context = await browser.newContext();
  await context.grantPermissions(['notifications'], { origin: world.url });
  page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await page.goto(world.url);
  await expect(page.getByTestId('grid-status')).toContainText('Live', { timeout: 30_000 });
  const pairing = await world.pairing();
  await page.getByRole('button', { name: 'Device', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Device' });
  await panel.getByLabel('Pairing code').fill(pairing.code);
  await panel.getByRole('button', { name: 'Pair this device' }).click();
  await expect(panel.getByTestId('device-state')).toContainText(/waiting for approval/i, { timeout: 10_000 });
  await pairing.approve();
  await expect(panel.getByTestId('device-state')).toHaveText(/Listed, version \d+/, { timeout: 10_000 });
  await page.keyboard.press('Escape');
});

test.afterAll(async () => {
  for (const fm of fakeMachines) await fm.close();
  await context?.close();
  await world?.stop();
});

test("a waiting push for the owner's lane A session, as Registry.notify builds it: drawn from its payload alone, its tap landing on the session's cards, cold and in a window already open", async () => {
  const worker = await serviceWorker(page);
  const notice: OwnerNotice = { project: PROJECT, machine: world.ref, session: 'la-1', kind: 'waiting' };
  await worker.deliver(notice);
  await expect.poll(worker.shown).toHaveLength(1);
  const [shown] = await worker.shown();
  expect(shown.title).toBe('A session is waiting for your answer');
  expect(shown.options.body).toBe('Opens at its cards');
  expect(shown.options.tag).toBe(`cards/${world.ref}/la-1`);
  expect(shown.options.actions).toBeUndefined(); // no Allow, no Deny: the worker holds no key to answer with
  const url = shown.options.data!.url!;
  expect(url).toBe(`/cards/${encodeURIComponent(world.ref)}/la-1`);

  // No window open: the tap opens one at the URL (what `clients.openWindow` is handed), and the card is drawn over the
  // machine's channel.
  const cold = await context.newPage();
  await cold.goto(`${world.url}${url}`);
  await expect(cold.getByTestId('channel-cards-title')).toHaveText('main', { timeout: 20_000 });
  await expect(cold.getByTestId('channel-cards-machine')).toHaveText('on mini');
  await expect(cold.getByTestId('channel-cards-list')).toHaveAttribute('data-connected', 'true', { timeout: 20_000 });
  await expect(cardOf(cold, 'toolu_landed')).toContainText('Which way?');
  await expect(cardOf(cold, 'toolu_landed')).toHaveAttribute('data-card-state', 'open');
  await expect(cold).toHaveURL(`${world.url}${url}`); // the route is the card: nothing to drop
  await cold.close();

  // A window open: brought forward and sent there in place, keeping its page (and its sockets).
  await page.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
  await tapInto(page, url);
  await expect(page.getByTestId('channel-cards')).toHaveAttribute('data-session', 'la-1');
  await expect(page.getByTestId('channel-cards-list')).toHaveAttribute('data-connected', 'true', { timeout: 20_000 });
  await expect(cardOf(page, 'toolu_landed')).toContainText('Which way?');
  await expect(page).toHaveURL(`${world.url}${url}`);
  expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
});

test('a landing on a delegated VM certified since the last read: the org state is read again, and the view names the VM', async () => {
  // A delegation, in a successor the page follows through the app socket's `state` notice.
  const issued = (await (await fetch(`${world.hub.url}/api/provisioning-keys`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'devcloud', prefix: 'vm-', max_uses: null, offline_revoke_s: null }) })).json()) as ProvisioningKeyIssued;
  const delegation: DelegationKey = { id: issued.key.id, key: await generateSigningKey() };
  const withDelegation = await world.admin.amend('a delegation', (s) => void s.delegations.push(delegationFor(issued.key, delegation.key.pub, 'org')));
  await expect.poll(() => deviceVersion(page), { timeout: 10_000 }).toBe(withDelegation!.state.version);

  // A fresh tab, its start's read of the state done; then the cards view opened, and its own once-a-minute read of the
  // state made, before the VM exists: the landing's own view finds that read too recent to repeat.
  const isState = (url: string) => new URL(url).pathname === '/api/org/state';
  const started = page.waitForResponse((response) => isState(response.url()), { timeout: 20_000 });
  await page.goto(world.url);
  await started;
  const read = page.waitForRequest((request) => isState(request.url()), { timeout: 10_000 });
  await page.getByRole('button', { name: /^Cards/ }).click();
  await expect(page.getByTestId('cards-list')).toBeVisible();
  await read;

  // The VM boots and posts its certificate: no version moves, no notice is raised.
  const vm = await enrollDelegated(world.hub.url, issued.token, 'vm-one', delegation);
  const tapped = Date.now();
  await tapInto(page, `/cards/${encodeURIComponent(vm.ref)}/vm-session`);
  await expect(page.getByTestId('channel-cards')).toHaveAttribute('data-machine', vm.ref);
  await expect(page.getByTestId('channel-cards-machine')).toHaveText('on vm-one', { timeout: 5000 });
  expect(Date.now() - tapped).toBeLessThan(5000);
  expect(await deviceVersion(page)).toBe(withDelegation!.state.version);
});

test("the seam: a DX session on a machine the org state lists, by its name in another case, reads moved to MAWS — composer and controls disabled, its request not answerable, nothing sent", async () => {
  test.setTimeout(240_000);
  const hub = { url: world.hub.url, localhost: world.url } as Parameters<typeof holdOrgKey>[1];
  await holdOrgKey(page, hub);
  const name = `fm-${randomUUID().slice(0, 8)}`;
  const enrolled = await FakeMachine.redeem(await enrollInBrowser(page, name));
  const me = (await (await fetch(`${world.hub.url}/api/me`)).json()) as { member: { id: string } };
  const rec = loadRecording(TWO_SUBAGENTS, { session: randomUUID() });
  const project = randomUUID();
  const fm = new FakeMachine({ ...enrolled, member: me.member.id, projectName: `seam ${project.slice(0, 4)}`, recordings: [rec], decisions: 'wait', project });
  fakeMachines.push(fm);
  await fm.connect();
  await fm.play({ speed: 0, until: (step) => step.k === 'log' && step.event.kind === 'joined' && step.event.session === rec.session });

  // The machine moves to MAWS: the org state lists it, under its name upper-cased.
  const ref = mintRef();
  const key = await generateSigningKey();
  const moved = await world.admin.amend('the DX machine moved', (s) => {
    s.machines.push({ name: name.toUpperCase(), ref, pub: key.pub, owners: [world.admin.id] });
    s.machineNames.push({ name: name.toUpperCase(), ref });
  });
  await expect.poll(() => deviceVersion(page), { timeout: 10_000 }).toBe(moved!.state.version);

  await page.goto(`${world.url}/p/${project}/s/${rec.session}`);
  const center = page.getByRole('region', { name: 'Channel' });
  await expect(center.getByTestId('session-view')).toHaveAttribute('data-session', rec.session, { timeout: 20_000 });
  const composer = center.getByTestId('composer');
  await expect(composer.getByTestId('composer-note')).toHaveText(MOVED, { timeout: 15_000 });
  await expect(composer.getByRole('textbox')).toBeDisabled();
  for (const verb of ['send', 'model', 'compact']) await expect(composer.locator(`[data-verb="${verb}"]`)).toBeDisabled();

  await fm.play({ speed: 0, until: (step) => step.k === 'raised' });
  const [bash] = fm.pendingRequests();
  const card = center.getByTestId('session-view').locator(`[data-tail-request="${bash.request}"]`);
  await expect(card).toContainText(/wants to run a command/i, { timeout: 15_000 });
  await expect(card.getByTestId('terminal-only')).toContainText(MOVED);
  await expect(card.getByRole('button', { name: 'Allow' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Deny' })).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(fm.rpcs).toEqual([]);
});
