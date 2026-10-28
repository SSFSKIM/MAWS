// The phone registering as a `web-cards` device (P5 O13 M3; acceptance 1's phone half), in Chromium with the virtual
// authenticator against the local hub, rooted by `deployment admin genesis` (O13 M2) with admin keys this suite holds:
// the Device panel takes the code `deployment admin pair --class web-cards` prints (run here as a child process, its
// confirmation typed on its stdin as the owner types it at the terminal), shows the entry's fingerprint while pending,
// the same the Mac shows, and reads listed once the Mac approves; the head lists the entry with the browser's own keys,
// the channel key a non-extractable CryptoKey in IndexedDB. Then, with the page open and no channel, a successor reaches
// the org store through the app socket's `state` notice, a machine's listing reaches the listings store, and a delegated
// VM's listing, its certificate posted with no version change, is resolved through the certificate re-read; the push
// subscription is bound to the device; the head's age warns past 21 days; Forget empties the store. And refusals: a
// code for another member before anything is made, and a hub serving another org's chain than the code pins.
//
// The browser's push subscription is stood in for (a real one needs a push service; the owner's phone proves it, M7):
// the hub takes the stand-in's https endpoint as it would a push service's.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { enrollDelegated, enrollV2, FakeEndpoint, listing, type DelegationKey, type V2Machine } from 'desk-hub/fake-machine';
import { delegationFor, encodeEnrollmentCodeV2, type OrgStateView, type PendingDevices, type ProvisioningKeyIssued, type PushSubscriptions } from 'desk-hub/protocol';
import {
  base64urlDecode,
  base64urlEncode,
  encodePairingCode,
  generateSigningKey,
  importSigningKey,
  keyId,
  signOrgState,
  stateHash,
  type Listing,
  type OrgState,
  type SignedOrgState,
  type SigningKey,
} from 'org-protocol';
import { DESK_DB } from '../src/store/idb';
import { LocalHub } from '../test/local/hub';
import { memberId, nextOf } from '../test/org';

test.describe.configure({ mode: 'serial' });

const DESK_HUB = resolve(import.meta.dirname, '../../desk-hub');
const ADMIN = 'owner@example.com';
const DAY_MS = 86_400_000;
const PROJECT = '7c1e2f4a-6c1d-4e5f-8a9b-0c1d2e3f4a5c';

let hub: LocalHub;
let scratch: string;
let keysFile: string;
let stepUp: SigningKey;
let context: BrowserContext;
let page: Page;
let cdp: CDPSession;
let authenticatorId: string;
let org: string;
let member: string;
let deviceId: string;
const endpoints: FakeEndpoint[] = [];

/** The hub's org state as the owner reads it. */
const orgState = async (since?: number): Promise<OrgStateView> => (await fetch(`${hub.url}/api/org/state${since === undefined ? '' : `?since=${since}`}`)).json() as Promise<OrgStateView>;

/** A successor of the hub's head, changed by `edit` and signed by the admin device's step-up key, posted as the owner. */
async function postSuccessor(edit: (state: OrgState) => void | Promise<void>): Promise<SignedOrgState> {
  const head = (await orgState()).head!;
  const signed = await signOrgState(await nextOf(head, edit), [stepUp]);
  const response = await fetch(`${hub.url}/api/org/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(signed) });
  if (response.status !== 201) throw new Error(`the successor was refused: ${response.status} ${await response.text()}`);
  return signed;
}

/** `deployment admin <args>` against the local hub, as the owner's Mac runs it, its stdin open for the confirmation. */
function admin(args: string[]): { child: ChildProcessWithoutNullStreams; out: () => string; line: (match: RegExp, ms?: number) => Promise<RegExpMatchArray>; exit: Promise<number | null> } {
  const child = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', join(DESK_HUB, 'deploy/bin.ts'), 'admin', ...args, '--hub', hub.localhost, '--user', ADMIN, '--keys', keysFile], {
    cwd: DESK_HUB,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DESK_ADMIN_KEYS: '' },
  });
  let out = '';
  child.stdout.on('data', (chunk) => (out += String(chunk)));
  child.stderr.on('data', (chunk) => (out += String(chunk)));
  const exit = new Promise<number | null>((done) => child.on('close', done));
  const line = async (match: RegExp, ms = 30_000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = match.exec(out);
      if (found) return found;
      if (Date.now() > deadline || child.exitCode !== null) throw new Error(`deployment admin ${args[0]}: no ${match} in:\n${out}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  return { child, out: () => out, line, exit };
}

/** The device record as the page's IndexedDB holds it: the channel key's kind, never its bytes (it cannot export them). */
const storedDevice = (target: Page) =>
  target.evaluate(
    async ({ db, org }) => {
      const open = indexedDB.open(db.name, db.version);
      const conn = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const read = (store: string) =>
        new Promise<unknown>((resolve, reject) => {
          const request = conn.transaction(store).objectStore(store).get(org);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const record = (await read(db.device)) as { deviceId: string; channelPub: string; channelKey: CryptoKey; passkey: unknown; state: unknown } | undefined;
      const orgRecord = (await read(db.org)) as { head: { state: { version: number } } } | undefined;
      conn.close();
      if (record === undefined) return { record: null, orgVersion: orgRecord?.head.state.version ?? null };
      const exported = await crypto.subtle.exportKey('pkcs8', record.channelKey).then(
        () => 'exported',
        (e: unknown) => (e as Error).name,
      );
      return {
        record: {
          deviceId: record.deviceId,
          channelPub: record.channelPub,
          passkey: record.passkey,
          state: record.state,
          isCryptoKey: record.channelKey instanceof CryptoKey,
          extractable: record.channelKey.extractable,
          algorithm: record.channelKey.algorithm,
          usages: record.channelKey.usages,
          exported,
          fields: Object.keys(record).sort(),
        },
        orgVersion: orgRecord?.head.state.version ?? null,
      };
    },
    { db: DESK_DB, org },
  );

const readout = (target: Page) => target.evaluate(() => window.deskDevice!());

const devicePanel = (target: Page) => target.getByRole('dialog', { name: 'Device' });

async function openDevicePanel(target: Page) {
  await target.getByRole('button', { name: 'Device', exact: true }).click();
  return devicePanel(target);
}

/** A push subscription stood in for, under the key the page subscribes with, kept across reloads of the page. */
function standInPush(target: Page) {
  return target.addInitScript(() => {
    const p256dh = btoa(String.fromCharCode(4, ...Array.from({ length: 64 }, (_, i) => i + 1))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const auth = btoa(String.fromCharCode(...new Array(16).fill(7))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const make = (key: number[]) => {
      const endpoint = 'https://push.example/cards-device/1';
      return { endpoint, options: { applicationServerKey: Uint8Array.from(key).buffer }, toJSON: () => ({ endpoint, keys: { p256dh, auth } }), unsubscribe: async () => (localStorage.removeItem('stand-in-push'), true) };
    };
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
    Notification.requestPermission = async () => 'granted';
    PushManager.prototype.getSubscription = async function () {
      const held = localStorage.getItem('stand-in-push');
      return held === null ? null : (make(JSON.parse(held) as number[]) as unknown as PushSubscription);
    };
    PushManager.prototype.subscribe = async function (options?: PushSubscriptionOptionsInit) {
      const key = [...new Uint8Array(options!.applicationServerKey as ArrayBuffer)];
      localStorage.setItem('stand-in-push', JSON.stringify(key));
      return make(key) as unknown as PushSubscription;
    };
  });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  hub = await LocalHub.start();
  scratch = mkdtempSync(join(tmpdir(), 'cards-device-'));
  // The admin device's keys, written as `deployment admin init` writes them; this suite keeps the step-up key to sign
  // the successors a test makes (a machine enrolled, a delegation).
  const channel = await generateSigningKey(true);
  const made = await generateSigningKey(true);
  const jwk = (key: CryptoKey) => crypto.subtle.exportKey('jwk', key);
  keysFile = join(scratch, 'admin', 'keys.json');
  mkdirSync(join(scratch, 'admin'), { recursive: true });
  writeFileSync(keysFile, JSON.stringify({ device: 'a1', keys: { 'a1.channel': await jwk(channel.privateKey), 'a1.stepUp': await jwk(made.privateKey) } }), { mode: 0o600 });
  stepUp = await importSigningKey((await jwk(made.privateKey)) as JsonWebKey);
  const genesis = admin(['genesis', '--yes', '--recovery', join(scratch, 'volume-recovery.json')]);
  expect(await genesis.exit, genesis.out()).toBe(0);
  expect(genesis.out()).toMatch(/genesis posted: version 1, orgGenesis \S+/);

  const me = (await (await fetch(`${hub.url}/api/me`)).json()) as { org: { id: string }; member: { id: string } };
  org = me.org.id;
  member = me.member.id;
  context = await browser.newContext();
  page = await context.newPage();
  await standInPush(page);
  cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  ({ authenticatorId } = (await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })) as { authenticatorId: string });
  await page.goto(hub.localhost);
  await expect(page.getByTestId('grid-status')).toContainText('Live', { timeout: 30_000 });
});

test.afterAll(async () => {
  for (const endpoint of endpoints) endpoint.close();
  await context?.close();
  await hub?.stop();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

test('a code for another member is refused before anything is made', async () => {
  const head = (await orgState()).head!;
  const code = encodePairingCode({ hub: hub.localhost, org, member: memberId(), roots: head.state.root.keys, recoveryPub: head.state.root.recoveryPub, k: base64urlEncode(new Uint8Array(16)) });
  const panel = await openDevicePanel(page);
  await expect(panel.getByTestId('device-panel')).toHaveAttribute('data-state', 'none');
  await panel.getByLabel('Pairing code').fill(code);
  await panel.getByRole('button', { name: 'Pair this device' }).click();
  await expect(panel.getByTestId('device-error')).toContainText('another member');
  await expect(panel.getByTestId('device-panel')).toHaveAttribute('data-state', 'none');
  const { credentials } = (await cdp.send('WebAuthn.getCredentials', { authenticatorId })) as { credentials: unknown[] };
  expect(credentials).toEqual([]);
  expect(((await (await fetch(`${hub.url}/api/devices/pending`)).json()) as PendingDevices).pending).toEqual([]);
  expect((await storedDevice(page)).record).toBeNull();
  await page.keyboard.press('Escape');
});

test("the pinned sync refuses a hub serving another org's chain than the code pins", async () => {
  // The code carries the real org's pins; the hub then serves a throwaway org of the same id, rooted by other keys.
  const head = (await orgState()).head!;
  const code = encodePairingCode({ hub: hub.localhost, org, member, roots: head.state.root.keys, recoveryPub: head.state.root.recoveryPub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))) });
  const other = await generateSigningKey();
  const recovery = await generateSigningKey();
  const throwaway = await signOrgState(
    {
      org,
      version: 1,
      prev: null,
      issued: new Date().toISOString(),
      root: { keys: [await keyId(other.pub)], recoveryPub: recovery.pub },
      members: [{ id: member, email: ADMIN, role: 'admin', devices: [{ id: 'a1', class: 'native-mac', keyStorage: 'software', channelPub: (await generateSigningKey()).pub, stepUpPub: other.pub }] }],
      machines: [],
      machineNames: [],
      retired: [],
      revoked: [],
      delegations: [],
      projects: [],
    },
    [other],
  );
  expect(await stateHash(throwaway.state)).not.toBe(await stateHash((await orgState(0)).chain![0].state));
  const served: OrgStateView = { head: throwaway, transitions: [], certificates: { certs: [], retirements: [] }, chain: [throwaway] };
  await page.route('**/api/org/state*', (route) => route.fulfill({ json: served }));
  try {
    const panel = await openDevicePanel(page);
    await panel.getByLabel('Pairing code').fill(code);
    await panel.getByRole('button', { name: 'Pair this device' }).click();
    await expect(panel.getByTestId('device-state')).toContainText(/waiting for approval/i, { timeout: 2000 });
    await expect(panel.getByTestId('device-refused')).toContainText("isn't the org this device's pairing code names", { timeout: 10_000 });
    expect((await storedDevice(page)).orgVersion).toBeNull();
    expect((await readout(page)).version).toBeNull();
    await panel.getByRole('button', { name: 'Forget…' }).click();
    await panel.getByRole('button', { name: 'Forget this device' }).click();
    await expect(panel.getByTestId('device-panel')).toHaveAttribute('data-state', 'none');
    await page.keyboard.press('Escape');
  } finally {
    await page.unroute('**/api/org/state*');
  }
});

test('the code from `pair`: pending with the fingerprint the Mac shows, approved there, listed with the keys this browser holds', async () => {
  test.setTimeout(90_000);
  const pair = admin(['pair', '--class', 'web-cards']);
  try {
    const [, code] = await pair.line(/pairing code: (\S+)/);
    const panel = await openDevicePanel(page);
    await panel.getByLabel('Pairing code').fill(code);
    await panel.getByRole('button', { name: 'Pair this device' }).click();
    await expect(panel.getByTestId('device-state')).toContainText(/waiting for approval on your Mac/i, { timeout: 2000 });
    const shown = (await panel.getByTestId('device-fingerprint').textContent())!;
    expect(shown).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    const [, macPrint] = await pair.line(/pending: \S+ web-cards webcrypto rpId localhost fingerprint (\S+)/);
    await pair.line(/approve\? \[y\/N\]/);
    expect(macPrint).toBe(shown);
    // Still waiting on the Mac: nothing is listed until the owner says yes there.
    await expect(panel.getByTestId('device-state')).toContainText(/waiting for approval/i);
    pair.child.stdin.end('y\n');
    const [, version] = await pair.line(/listed: version (\d+)/);
    expect(await pair.exit, pair.out()).toBe(0);
    await expect(panel.getByTestId('device-state')).toHaveText(`Listed, version ${version}`, { timeout: 10_000 });
    await expect(panel.getByTestId('device-rp')).toHaveText('localhost');
    await expect(panel.getByLabel('Pairing code')).toHaveCount(0); // a second registration is not offered while listed
    await expect(panel.getByTestId('device-age-warning')).toHaveCount(0);
    await expect(panel.getByTestId('device-org-state')).toContainText('issued today');
  } finally {
    pair.child.kill();
  }

  const stored = (await storedDevice(page)).record!;
  deviceId = stored.deviceId;
  expect(stored).toMatchObject({ isCryptoKey: true, extractable: false, algorithm: { name: 'ECDSA', namedCurve: 'P-256' }, usages: ['sign'], exported: 'InvalidAccessError' });
  expect(stored.fields).toEqual(['channelKey', 'channelPub', 'deviceId', 'member', 'passkey', 'pins', 'state']);
  // The head lists the device as this browser posted it: its own channel key and its own passkey, no step-up key.
  const head = (await orgState()).head!;
  const entry = head.state.members.find((m) => m.id === member)!.devices.find((d) => d.id === deviceId)!;
  expect(entry).toMatchObject({ class: 'web-cards', keyStorage: 'webcrypto', channelPub: stored.channelPub, passkey: stored.passkey });
  expect(entry).not.toHaveProperty('stepUpPub');
  expect(entry.endorsement).toBeDefined();
  // The passkey is a credential the virtual authenticator made for this pairing, not discoverable, its point the listed one.
  const { credentials } = (await cdp.send('WebAuthn.getCredentials', { authenticatorId })) as { credentials: Array<{ credentialId: string; isResidentCredential: boolean; rpId: string; privateKey: string }> };
  const credential = credentials.find((c) => base64urlEncode(Buffer.from(c.credentialId, 'base64')) === entry.passkey!.credentialId)!;
  expect(credential).toMatchObject({ isResidentCredential: false, rpId: 'localhost' });
  const privateKey = await crypto.subtle.importKey('pkcs8', Buffer.from(credential.privateKey, 'base64'), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const { x, y } = await crypto.subtle.exportKey('jwk', privateKey);
  expect(base64urlEncode(Uint8Array.from([4, ...base64urlDecode(x!), ...base64urlDecode(y!)]))).toBe(entry.passkey!.publicKey);
  expect(await readout(page)).toMatchObject({ state: 'listed', deviceId, version: head.state.version });
  await page.keyboard.press('Escape');
});

test('push: the subscription the hub keeps names the device', async () => {
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Notifications' });
  await dialog.getByRole('button', { name: 'Turn on notifications' }).click();
  await expect(dialog.getByTestId('notifications')).toHaveAttribute('data-state', 'on');
  await page.keyboard.press('Escape');
  const { subscriptions } = (await (await fetch(`${hub.url}/api/push/subscriptions`)).json()) as PushSubscriptions;
  expect(subscriptions).toMatchObject([{ endpoint: 'https://push.example/cards-device/1', device: deviceId }]);
  // At the next start the device hands it over again, still bound.
  await page.reload();
  await expect.poll(async () => ((await (await fetch(`${hub.url}/api/push/subscriptions`)).json()) as PushSubscriptions).subscriptions.map((s) => s.device)).toEqual([deviceId]);
  await expect(devicePanel(page)).toHaveCount(0);
  const panel = await openDevicePanel(page);
  await expect(panel.getByTestId('device-push')).toHaveText('On for this device');
  await page.keyboard.press('Escape');
});

let mini: V2Machine;

test('with the page open and no channel, a successor reaches the org store through the state notice, and a listing the listings store', async () => {
  await expect.poll(async () => (await readout(page)).version, { timeout: 10_000 }).toBe((await orgState()).head!.state.version);
  const head = (await orgState()).head!;
  const { token } = (await (await fetch(`${hub.url}/api/enrollments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()) as { token: string };
  mini = await enrollV2(encodeEnrollmentCodeV2({ hub: hub.url, token, roots: head.state.root.keys, recoveryPub: head.state.root.recoveryPub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) }), 'mini');
  const posted = Date.now();
  const added = await postSuccessor((s) => {
    s.machines.push({ name: 'mini', ref: mini.ref, pub: mini.key.pub, owners: [member] });
    s.machineNames.push({ name: 'mini', ref: mini.ref });
  });
  await expect.poll(async () => (await readout(page)).version, { timeout: 5000, intervals: [100] }).toBe(added.state.version);
  expect(Date.now() - posted).toBeLessThan(5000);
  expect((await storedDevice(page)).orgVersion).toBe(added.state.version);

  const endpoint = new FakeEndpoint({ hub: hub.url, credentials: mini.credentials, ref: mini.ref });
  endpoints.push(endpoint);
  await endpoint.connect();
  await endpoint.project(PROJECT, 'cards-device');
  const fields: Listing['fields'] = { owners: [member], project: PROJECT, lane: 'A', state: 'waiting', title: 'a question on the mini' };
  endpoint.listing(await listing(mini, 'session-mini-1', 1, fields));
  await expect.poll(async () => (await readout(page)).listings, { timeout: 5000, intervals: [100] }).toEqual([{ machine: mini.ref, session: 'session-mini-1', revision: 1, title: 'a question on the mini' }]);
  // One the machine's key did not sign is never kept.
  const forger = { ...mini, key: await generateSigningKey() };
  endpoint.listing(await listing(forger, 'session-forged', 1, fields));
  await page.waitForTimeout(500);
  expect((await readout(page)).listings.map((l) => l.session)).toEqual(['session-mini-1']);
});

test('a delegated VM certified with the version fixed: its listing resolved through the certificate re-read', async () => {
  const issued = (await (await fetch(`${hub.url}/api/provisioning-keys`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'devcloud', prefix: 'vm-', max_uses: null, offline_revoke_s: null }) })).json()) as ProvisioningKeyIssued;
  const delegation: DelegationKey = { id: issued.key.id, key: await generateSigningKey() };
  const withDelegation = await postSuccessor((s) => void s.delegations.push(delegationFor(issued.key, delegation.key.pub, 'org')));
  await expect.poll(async () => (await readout(page)).version, { timeout: 5000 }).toBe(withDelegation.state.version);

  const vm = await enrollDelegated(hub.url, issued.token, 'vm-one', delegation);
  expect((await orgState()).head!.state.version).toBe(withDelegation.state.version); // the certificate moved no version
  const endpoint = new FakeEndpoint({ hub: hub.url, credentials: vm.credentials, ref: vm.ref });
  endpoints.push(endpoint);
  await endpoint.connect();
  await endpoint.project(PROJECT, 'cards-device');
  const posted = Date.now();
  // Two of its sessions at once: both wait on the one re-read of its machine.
  endpoint.listing(await listing(vm, 'session-vm-1', 1, { owners: [member], project: PROJECT, lane: 'B', state: 'waiting', title: 'a permission on the VM' }));
  endpoint.listing(await listing(vm, 'session-vm-2', 1, { owners: [member], project: PROJECT, lane: 'B', state: 'waiting', title: 'a question on the VM' }));
  await expect.poll(async () => (await readout(page)).listings.map((l) => l.session).sort(), { timeout: 5000, intervals: [100] }).toEqual(['session-mini-1', 'session-vm-1', 'session-vm-2']);
  expect(Date.now() - posted).toBeLessThan(5000);
  expect((await readout(page)).version).toBe(withDelegation.state.version);
});

test("the head's age: no warning on a fresh head, and one past 21 days with the clock 22 days on", async () => {
  let panel = await openDevicePanel(page);
  await expect(panel.getByTestId('device-org-state')).toBeVisible();
  await expect(panel.getByTestId('device-age-warning')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // The context's clock, which the panel reads the head's age by (Playwright's clock is the whole context's: this
  // case comes last of those that care about time).
  await page.clock.setFixedTime(new Date(Date.now() + 22 * DAY_MS));
  panel = await openDevicePanel(page);
  await expect(panel.getByTestId('device-state')).toHaveText(/Listed, version \d+/);
  await expect(panel.getByTestId('device-age-warning')).toHaveText("The org state is 22 days old; run deployment admin refresh on your Mac before day 30, or this phone's answers stop.");
  await page.keyboard.press('Escape');
});

test('Forget empties the store; the org state keeps the entry until the Mac removes it', async () => {
  const panel = await openDevicePanel(page);
  await panel.getByRole('button', { name: 'Forget…' }).click();
  await expect(panel).toContainText(`deployment admin remove-device ${deviceId}`);
  await panel.getByRole('button', { name: 'Forget this device' }).click();
  await expect(panel.getByTestId('device-panel')).toHaveAttribute('data-state', 'none');
  await expect(panel.getByLabel('Pairing code')).toBeVisible();
  expect(await storedDevice(page)).toEqual({ record: null, orgVersion: null });
  expect(await readout(page)).toEqual({ state: null, deviceId: null, version: null, listings: [] });
  const head = (await orgState()).head!;
  expect(head.state.members.find((m) => m.id === member)!.devices.map((d) => d.id)).toContain(deviceId);
  await page.keyboard.press('Escape');
});


test('an older tab holding the database at version 1 blocks the upgrade: the page says so, and carries on once it closes', async ({ browser }) => {
  const other = await browser.newContext();
  try {
    // A tab of the build before: the database at version 1, its connection held, no `versionchange` handler.
    const old = await other.newPage();
    await old.goto(`${hub.localhost}/api/me`);
    await old.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('desk', 1);
          open.onupgradeneeded = () => {
            open.result.createObjectStore('org-keys');
            open.result.createObjectStore('log');
          };
          open.onsuccess = () => ((window as unknown as { held: IDBDatabase }).held = open.result, resolve());
          open.onerror = () => reject(open.error);
        }),
    );
    const fresh = await other.newPage();
    await fresh.goto(hub.localhost);
    await expect(fresh.getByTestId('storage-blocked')).toContainText("Close the desk's other tabs");
    await expect(fresh.getByTestId('key-state')).toBeDisabled(); // the org key waits on the database
    await old.evaluate(() => (window as unknown as { held: IDBDatabase }).held.close());
    await expect(fresh.getByTestId('storage-blocked')).toHaveCount(0);
    await expect(fresh.getByTestId('key-state')).toBeEnabled();
    const panel = await openDevicePanel(fresh);
    await expect(panel.getByTestId('device-panel')).toHaveAttribute('data-state', 'none');
  } finally {
    await other.close();
  }
});
