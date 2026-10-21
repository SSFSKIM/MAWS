// The web app against DC3's local hub (`pnpm --filter desk-hub local`): the Worker serving the built app behind the
// stand-in for Access, DX7's enrollment and wrapped keys, and DX3's project socket over the real log plane. M1's proof as
// far as DC3's M2 carries it (sign-in, the Worker serving the app, resume across a reload, a web `human` acknowledged)
// and M2's with its M2b ruling: the org key drawn at random at first setup and kept at the hub wrapped once per method,
// every method opening the same key, a method added and removed, the hub's `not-key-holder` in both its meanings, and
// an enrollment code the browser made with that key, which enrolls a machine whose events the browser then verifies;
// and a provisioning key (the provisioning-keys spec, §5) made, listed with the machines it enrolled, and revoked.
// The machine here is a DX7/DX2 test client (test/local/machine.ts); the grid's counts and M3's proofs against DC3's
// session plane and fake machine are session-plane.spec.ts.
//
// Each run's local hub starts from a fresh state (test/local/hub.ts), so first setup is proved on an org with no key; an
// org has one key ever, and the setup adds the suite's passphrase, which a hub whose state was kept would unlock with.
//
// One browser page for the suite: its virtual authenticator holds the org's passkey from the setup on.
import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type CDPSession, type Page, type WebSocket } from '@playwright/test';
import {
  base64urlDecode,
  decodeCode,
  importOrgKey,
  keyCheck,
  seal,
  verify,
  type DownFrame,
  type HumanDraft,
  type LogEvent,
  type ProjectDown,
  type ProjectUp,
  type ProvisioningKeys,
} from 'desk-hub/protocol';
import { checkFingerprint } from '../src/key/derive';
import { ProjectClient } from '../src/hub/project-client';
import { clearOrigin, virtualAuthenticator } from '../e2e/authenticator';
import { seedKey } from '../e2e/fixtures';
import { LocalHub } from '../test/local/hub';
import { TestMachine } from '../test/local/machine';
import { keyDialog, newPassphrase, openKeyDialog, orgKeys as orgKeysOf, SUITE_PASSPHRASE, unlockWithPassphrase } from './org';

test.describe.configure({ mode: 'serial' });

const PROJECT = randomUUID();
const SESSION = randomUUID();
const MACHINE = `e2e-${randomUUID().slice(0, 8)}`;

let hub: LocalHub;
let context: BrowserContext;
let page: Page;
let authenticator: CDPSession;
/** Whether this run set the org key up, with the page's passkey. */
let setUpHere = false;
let machine: TestMachine | undefined;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(150_000);
  hub = await LocalHub.start();
  context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: hub.localhost });
  page = await context.newPage();
  authenticator = await virtualAuthenticator(page);
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

/** The org's wrapped keys, as any member reads them (DX7). */
const orgKeys = () => orgKeysOf(hub);

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

test('first setup: the passkey locks a random key, a passphrase is added, and a second setup is told a key was set up elsewhere', async ({ browser }) => {
  test.setTimeout(120_000);
  test.skip((await orgKeys()).key_check !== null, "the local hub's org already has a key (apps/desk-hub/.wrangler/state from an earlier run); first setup is proved on a fresh state");

  const late = await (await browser.newContext()).newPage(); // another browser, its setup form open first
  await late.goto(hub.localhost);
  await expect((await openKeyDialog(late)).getByTestId('set-up')).toBeVisible();

  await page.goto(hub.localhost);
  const dialog = await openKeyDialog(page);
  await dialog.getByLabel('Keep unlocked on this device').check();
  await dialog.getByRole('button', { name: 'Set up with a passkey' }).click();
  await expect(dialog.getByTestId('unlocked')).toContainText('Unlocked on this device');
  setUpHere = true;
  const fingerprint = (await dialog.getByTestId('fingerprint').textContent())!;
  const set = await orgKeys();
  expect(checkFingerprint(set.key_check!)).toBe(fingerprint);
  expect(set.keys).toMatchObject([{ method: 'passkey', check: set.key_check }]);

  // The prompt for a second method, right away: the new one first, then one the org has.
  await expect(dialog.getByTestId('one-method')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add a method' }).click();
  const add = dialog.getByTestId('add-method');
  await newPassphrase(add, SUITE_PASSPHRASE, 'Add');
  await add.getByRole('button', { name: 'Confirm with passkey' }).click({ timeout: 60_000 });
  await expect(dialog.getByTestId('one-method')).toHaveCount(0, { timeout: 30_000 });
  expect((await orgKeys()).keys.map((k) => k.method)).toEqual(['passkey', 'passphrase']);
  await page.keyboard.press('Escape');

  // The other browser's setup came second: one org, one key.
  await newPassphrase(keyDialog(late), 'another org key entirely', 'Set up');
  await expect(keyDialog(late).getByTestId('key-error')).toHaveText('A key was already set up for this org elsewhere. Unlock with one of its methods.', { timeout: 30_000 });
  await expect(keyDialog(late).getByRole('form', { name: 'Passphrase', exact: true })).toBeVisible();
  expect((await orgKeys()).keys).toHaveLength(2);
  await late.context().close();
});

test("every method opens the org's key: the passphrase in another browser, the passkey in a browser emptied of everything", async ({ browser }) => {
  test.setTimeout(120_000);
  const fingerprint = checkFingerprint((await orgKeys()).key_check!);

  const other = await (await browser.newContext()).newPage();
  await other.goto(hub.localhost);
  await unlockWithPassphrase(await openKeyDialog(other), SUITE_PASSPHRASE, false);
  await expect(other.getByTestId('fingerprint')).toHaveText(fingerprint, { timeout: 30_000 });
  await other.context().close();

  // This page: locked, emptied of everything it held, and unlocked again with its passkey (or, on a hub an earlier run
  // set up, with the suite's passphrase), kept on the device for the tests that follow.
  await page.goto(hub.localhost);
  if ((await page.getByTestId('key-state').textContent()) === 'Unlocked') await (await openKeyDialog(page)).getByRole('button', { name: 'Lock' }).click();
  await clearOrigin(authenticator, hub.localhost);
  await page.reload();
  const dialog = await openKeyDialog(page);
  await dialog.getByLabel('Keep unlocked on this device').check();
  if (setUpHere) await dialog.getByRole('button', { name: 'Unlock with passkey' }).click();
  else await unlockWithPassphrase(dialog, SUITE_PASSPHRASE, false);
  await expect(page.getByTestId('fingerprint')).toHaveText(fingerprint, { timeout: 30_000 });
  await page.keyboard.press('Escape');
});

test('the code the browser builds, confirmed by opening the key once more, enrolls a machine, shown once', async () => {
  test.setTimeout(60_000);
  await page.goto(hub.localhost);
  await expect(page.getByTestId('key-state')).toHaveText('Unlocked');

  await page.getByRole('button', { name: 'Machines', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Machines' });
  await dialog.getByRole('button', { name: 'Enroll a machine' }).click();
  await dialog.getByLabel(/machine's name/).fill('hub');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByRole('alert')).toContainText('not "hub" or "legacy"');
  await dialog.getByLabel(/machine's name/).fill(MACHINE);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByTestId('confirm-machine')).toHaveText(MACHINE);
  if (setUpHere) {
    await dialog.getByRole('button', { name: 'Confirm with passkey' }).click();
  } else {
    const confirm = dialog.getByRole('form', { name: 'Passphrase', exact: true });
    await confirm.getByLabel(/passphrase/).fill(SUITE_PASSPHRASE);
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
  }
  // The code alone, never inside a command line (the process listing and the shell's history would keep the key).
  const shown = dialog.getByTestId('enroll-code');
  await expect(shown).toContainText('run sminos hub enroll, then paste this code', { timeout: 30_000 });
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
  // The key the code carries is the org's.
  expect(checkFingerprint(await keyCheck(machine.key))).toBe(checkFingerprint((await orgKeys()).key_check!));
  const reopen = async () => {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Machines', exact: true }).click();
  };
  await reopen();
  await expect(dialog.locator(`[data-machine="${MACHINE}"]`)).toContainText('enrolling');

  // Its first authenticated connection confirms it.
  await machine.connect();
  await reopen();
  await expect(dialog.locator(`[data-machine="${MACHINE}"]`)).toContainText('enrolled');

  // The name is the machine's now.
  await dialog.getByRole('button', { name: 'Enroll a machine' }).click();
  await dialog.getByLabel(/machine's name/).fill(MACHINE.toUpperCase());
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByRole('alert')).toContainText('already enrolled');
  await page.keyboard.press('Escape');
});

test('a provisioning key made in the browser, its code shown once with the boot line, enrolls machines under its prefix; revoked, it enrolls no more', async () => {
  test.setTimeout(60_000);
  const label = `pk-${randomUUID().slice(0, 8)}`;
  const prefix = `${label}-`;
  await page.goto(hub.localhost);
  await expect(page.getByTestId('key-state')).toHaveText('Unlocked');
  const dialog = page.getByRole('dialog', { name: 'Machines' });
  const reopen = async () => {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Machines', exact: true }).click();
  };
  await page.getByRole('button', { name: 'Machines', exact: true }).click();

  // The key described, checked in the browser, and confirmed with the org key.
  await dialog.getByRole('button', { name: 'Create a key' }).click();
  const form = dialog.getByTestId('key-form');
  await form.getByLabel('Label').fill(label);
  await form.getByLabel('Prefix').fill('hub');
  await form.getByRole('button', { name: 'Continue' }).click();
  await expect(form.getByRole('alert')).toContainText('not "hub" or "legacy"');
  await form.getByLabel('Prefix').fill(prefix);
  await form.getByLabel('Revoke a machine offline for').selectOption('21600');
  await form.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByTestId('confirm-key')).toHaveText(label);
  if (setUpHere) {
    await dialog.getByRole('button', { name: 'Confirm with passkey' }).click();
  } else {
    const confirm = dialog.getByRole('form', { name: 'Passphrase', exact: true });
    await confirm.getByLabel(/passphrase/).fill(SUITE_PASSPHRASE);
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
  }

  // Shown once, with the line each machine runs at boot; it carries the org's key.
  const shown = dialog.getByTestId('enroll-code');
  await expect(shown.getByTestId('boot-command')).toHaveText(`printf %s "$CODE" | sminos hub enroll --name ${prefix}<machine>`, { timeout: 30_000 });
  const code = decodeCode((await shown.getByTestId('enrollment-code').textContent())!);
  expect(code).toMatchObject({ kind: 'provision', hub: hub.localhost, org: 'local', prefix });
  expect(checkFingerprint(await keyCheck(await importOrgKey(base64urlDecode(code.key))))).toBe(checkFingerprint((await orgKeys()).key_check!));
  const listed = (await (await fetch(`${hub.url}/api/provisioning-keys`)).json()) as ProvisioningKeys;
  expect(listed.keys.find((k) => k.label === label)).toMatchObject({ prefix, uses: 0, max_uses: null, offline_revoke_s: 21_600, revoked: null });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog.getByTestId('enrollment-code')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('smns-provision-v1.');
  const row = dialog.locator(`[data-key-label="${label}"]`);
  await expect(row).toContainText(`${label} · ${prefix} · 0 / ∞`);

  // Two machines enroll through it, each as its `sminos hub enroll` redeems the code; a name off the prefix is refused.
  const redeem = (name: string) =>
    fetch(`${hub.url}/machine/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: code.token, machine: name }) });
  for (const name of [`${prefix}a`, `${prefix}b`]) expect((await redeem(name)).status).toBe(200);
  expect(await (await redeem(`other-${label}`)).json()).toMatchObject({ error: 'prefix-mismatch' });
  await reopen();
  await expect(row).toContainText(`${label} · ${prefix} · 2 / ∞`);
  await expect(row.getByTestId(`key-machine-${prefix}a`)).toHaveText(`${prefix}a enrolling…`);
  await expect(dialog.locator(`[data-machine="${prefix}a"]`)).toContainText(`via ${label}`);

  // Revoked: no new machine enrolls through it, and the two it enrolled stay.
  await row.getByRole('button', { name: `Revoke ${label}` }).click();
  const revoke = dialog.getByTestId('revoke-key-confirm');
  await expect(revoke.getByTestId('revoke-key-meaning')).toContainText('The 2 machines enrolled through it stay');
  await revoke.getByRole('button', { name: `Revoke ${label}` }).click();
  await expect(dialog.getByTestId('machines-notice')).toContainText(`Revoked ${label}`);
  await expect(row).toContainText('revoked');
  await expect(row.getByRole('button')).toHaveCount(0);
  const refused = await redeem(`${prefix}c`);
  expect([refused.status, await refused.json()]).toMatchObject([410, { error: 'key-revoked' }]);
  await expect(dialog.locator(`[data-machine="${prefix}a"]`)).toBeVisible();
  await expect(dialog.locator(`[data-machine="${prefix}b"]`)).toBeVisible();

  // Removed by hand as any machine is, so the tests after this one see the org as it was.
  for (const name of [`${prefix}a`, `${prefix}b`]) expect((await fetch(`${hub.url}/api/machines/${name}`, { method: 'DELETE' })).status).toBe(200);
  await page.keyboard.press('Escape');
});

test("the machine's log is drawn, verified with the org key, and a reload resumes after the recorded offset", async () => {
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

test('a method is removed with the held key, and a browser holding another key is refused its change', async ({ browser }) => {
  test.setTimeout(120_000);
  // A spare passphrase, added and then removed by this page, which holds the org's key.
  await page.goto(hub.localhost);
  const dialog = await openKeyDialog(page);
  const before = (await orgKeys()).keys.map((k) => k.id);
  await dialog.getByRole('button', { name: 'Add a method' }).click();
  const add = dialog.getByTestId('add-method');
  await newPassphrase(add, 'a spare passphrase to remove', 'Add');
  const confirm = add.getByRole('form', { name: 'Passphrase', exact: true });
  await confirm.getByLabel(/passphrase/).fill(SUITE_PASSPHRASE);
  await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(add).toHaveCount(0, { timeout: 60_000 });
  const spare = (await orgKeys()).keys.find((k) => !before.includes(k.id))!;
  // By its id: two methods added in one minute share a generated label.
  const row = dialog.locator(`[data-key="${spare.id}"]`);
  await row.getByRole('button', { name: `Remove ${spare.label}` }).click();
  await row.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect.poll(async () => (await orgKeys()).keys.map((k) => k.id)).toEqual(before);
  await page.keyboard.press('Escape');

  // Another browser holding another key: told so by the fingerprints, and refused by the hub (`not-key-holder`).
  const stranger = await (await browser.newContext()).newPage();
  await seedKey(stranger, { url: hub.localhost }, 'local', crypto.getRandomValues(new Uint8Array(32)));
  await stranger.goto(hub.localhost);
  const theirs = await openKeyDialog(stranger);
  await expect(theirs.getByTestId('other-key')).toContainText("This browser holds another key than the org's");
  const target = (await orgKeys()).keys[0];
  await theirs.locator(`[data-key="${target.id}"]`).getByRole('button', { name: `Remove ${target.label}` }).click();
  await theirs.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(theirs.getByTestId('key-error')).toHaveText("This browser's key isn't the org's, so the hub refused the change. Lock it, and unlock with one of the org's methods.");
  expect((await orgKeys()).keys.map((k) => k.id)).toEqual(before);
  await stranger.context().close();
});
