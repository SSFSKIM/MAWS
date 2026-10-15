// M2 of the DC5 plan, with its M2b ruling, in a browser against the DX3 double: the org key is one random key, drawn in
// the browser at the org's first setup and kept at the hub wrapped once per unlock method (DX7's `/api/org/keys`, which
// the double serves with the hub's rules). A passkey (WebAuthn PRF, here Chrome's virtual authenticator) or a passphrase
// opens a copy straight into a non-extractable HMAC key (`unwrapKey`, in Chromium), every method opens the same key, a
// method is added by opening the key's bytes once more, and the key is kept as long as the owner chose. Enrollment is
// proved against the local hub (e2e-hub/local-hub.spec.ts).
import { expect, type Browser, type Locator, type Page } from '@playwright/test';
import { importOrgKey, keyCheck } from 'desk-hub/protocol';
import { DOUBLE_MEMBER, DOUBLE_ORG, type HubDouble } from '../test/double/hub-double';
import { VECTOR_KEY } from '../test/vectors';
import { checkFingerprint } from '../src/key/derive';
import { prepareMethod } from '../src/key/unlock';
import { clearOrigin, virtualAuthenticator } from './authenticator';
import { seedKey, test } from './fixtures';
import { PROJECT, stageProject } from './scene';

const PASSPHRASE = 'correct horse battery staple';
const SECOND = 'tr0ub4dor and three more words';

/** A copy of `raw` locked under `passphrase`, as a browser that set the org key up elsewhere left it at the hub. */
async function seedPassphrase(hub: HubDouble, raw: Uint8Array, passphrase: string, labels: string[] = ['Passphrase']) {
  const prepared = await prepareMethod(DOUBLE_ORG.id, { kind: 'passphrase', passphrase });
  for (const label of labels) await hub.orgKeys.seedPassphraseCopy(DOUBLE_MEMBER, DOUBLE_ORG.id, raw, prepared, label);
}

async function unlockWithPassphrase(scope: Locator, passphrase: string, keep: boolean) {
  if (keep) await scope.getByLabel('Keep unlocked on this device').check();
  const form = scope.getByRole('form', { name: 'Passphrase' });
  await form.getByLabel(/passphrase/).fill(passphrase);
  await form.getByRole('button', { name: 'Unlock', exact: true }).click();
}

async function newPassphrase(scope: Locator, passphrase: string, submit: string) {
  const form = scope.getByRole('form', { name: 'New passphrase' });
  await form.getByLabel(/Or a passphrase/).fill(passphrase);
  await form.getByLabel('The passphrase again').fill(passphrase);
  await form.getByRole('button', { name: submit, exact: true }).click();
}

const keyDialog = (page: Page) => page.getByRole('dialog', { name: 'Org key' });

async function openKeyDialog(page: Page): Promise<Locator> {
  await page.getByTestId('key-state').click();
  return keyDialog(page);
}

async function fingerprint(page: Page): Promise<string> {
  const text = (await (await openKeyDialog(page)).getByTestId('fingerprint').textContent()) ?? '';
  await page.keyboard.press('Escape');
  return text;
}

test('a passphrase opens the same key in two browsers — the key the project is sealed with — kept as each chose', async ({ browser, hub }) => {
  test.setTimeout(90_000);
  await seedPassphrase(hub, VECTOR_KEY, PASSPHRASE);
  await stageProject(hub);
  const open = async (b: Browser) => {
    const page = await (await b.newContext()).newPage();
    await page.goto(`${hub.url}/p/${PROJECT}`);
    await expect(page.getByTestId('locked')).toBeVisible();
    return page;
  };
  const center = (page: Page) => page.getByRole('region', { name: 'Channel' });

  // One browser keeps the key on the device.
  const kept = await open(browser);
  await unlockWithPassphrase(kept.getByTestId('locked'), PASSPHRASE, true);
  await expect(center(kept)).toContainText('the migration is merged', { timeout: 30_000 });

  // Another, for this tab only — after a mistyped passphrase, which opens nothing and says so.
  const tab = await open(browser);
  await unlockWithPassphrase(tab.getByTestId('locked'), 'correct horse battery stapel', false);
  await expect(tab.getByTestId('key-error')).toHaveText("That passphrase doesn't open the org key.", { timeout: 30_000 });
  await expect(tab.getByTestId('key-state')).toHaveText('Locked');
  await unlockWithPassphrase(tab.getByTestId('locked'), PASSPHRASE, false);
  await expect(center(tab)).toContainText('the migration is merged', { timeout: 30_000 });

  const org = checkFingerprint(await keyCheck(await importOrgKey(VECTOR_KEY)));
  expect(await fingerprint(kept)).toBe(org);
  expect(await fingerprint(tab)).toBe(org);

  // A reload: the device kept it; the tab's is gone.
  await kept.reload();
  await expect(center(kept)).toContainText('the migration is merged');
  await expect(kept.getByTestId('key-state')).toHaveText('Unlocked');
  await tab.reload();
  await expect(tab.getByTestId('locked')).toBeVisible();
  await expect(tab.getByTestId('key-state')).toHaveText('Locked');
});

test('first setup with a passkey, a passphrase added, and each opens the same key — the passkey in a browser that holds nothing else', async ({ browser, page, hub }) => {
  test.setTimeout(90_000);
  const origin = hub.url.replace('127.0.0.1', 'localhost');
  const cdp = await virtualAuthenticator(page);
  await page.goto(origin);
  await expect(page.getByTestId('key-state')).toHaveText('Locked');
  const dialog = await openKeyDialog(page);
  await dialog.getByRole('button', { name: 'Set up with a passkey' }).click();
  await expect(dialog.getByTestId('unlocked')).toContainText('Unlocked for this tab');
  const first = (await dialog.getByTestId('fingerprint').textContent())!;
  expect(first).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
  expect(checkFingerprint(hub.orgKeys.key_check!)).toBe(first);
  expect(hub.orgKeys.keys).toMatchObject([{ method: 'passkey' }]);

  // Right after the first setup: add a second method. The new one first, then one the org has.
  await expect(dialog.getByTestId('one-method')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add a method' }).click();
  const add = dialog.getByTestId('add-method');
  await newPassphrase(add, SECOND, 'Add');
  await add.getByRole('button', { name: 'Confirm with passkey' }).click({ timeout: 30_000 });
  await expect(dialog.getByTestId('one-method')).toHaveCount(0);
  await expect(dialog.getByTestId('methods').getByRole('listitem')).toHaveCount(2);
  expect(hub.orgKeys.keys.map((k) => k.method)).toEqual(['passkey', 'passphrase']);

  // Locked, and the browser emptied of everything it held: only the passkey remains.
  await dialog.getByRole('button', { name: 'Lock' }).click();
  await clearOrigin(cdp, origin);
  await page.reload();
  await expect(page.getByTestId('key-state')).toHaveText('Locked');
  await (await openKeyDialog(page)).getByRole('button', { name: 'Unlock with passkey' }).click();
  await expect(page.getByTestId('fingerprint')).toHaveText(first);

  // Another browser, with the passphrase.
  const other = await (await browser.newContext()).newPage();
  await other.goto(origin);
  await unlockWithPassphrase(await openKeyDialog(other), SECOND, false);
  await expect(other.getByTestId('fingerprint')).toHaveText(first, { timeout: 30_000 });
});

test('a passkey made without PRF sets up nothing, says so, and leaves the passphrase', async ({ page, hub }) => {
  await virtualAuthenticator(page, { prf: false });
  await page.goto(hub.url.replace('127.0.0.1', 'localhost'));
  const dialog = await openKeyDialog(page);
  await dialog.getByRole('button', { name: 'Set up with a passkey' }).click();
  await expect(dialog.getByTestId('key-error')).toContainText("this browser didn't enable PRF for it");
  await expect(dialog.getByRole('form', { name: 'New passphrase' })).toBeVisible();
  await expect(page.getByTestId('key-state')).toHaveText('Locked');
  expect(hub.orgKeys.keys).toEqual([]);
});

test('a second first-time setup is told a key was set up elsewhere, and offered the unlock', async ({ browser, hub }) => {
  test.setTimeout(90_000);
  const [a, b] = await Promise.all([0, 1].map(async () => (await browser.newContext()).newPage()));
  for (const page of [a, b]) {
    await page.goto(hub.url);
    await expect((await openKeyDialog(page)).getByTestId('set-up')).toBeVisible();
  }
  await newPassphrase(keyDialog(a), PASSPHRASE, 'Set up');
  await expect(keyDialog(a).getByTestId('unlocked')).toBeVisible({ timeout: 30_000 });

  await newPassphrase(keyDialog(b), SECOND, 'Set up');
  await expect(keyDialog(b).getByTestId('key-error')).toHaveText('A key was already set up for this org elsewhere. Unlock with one of its methods.', { timeout: 30_000 });
  await expect(keyDialog(b).getByRole('form', { name: 'Passphrase' })).toBeVisible();
  expect(hub.orgKeys.keys).toHaveLength(1);
});

test("a browser holding another key than the org's is told so, and its change is refused", async ({ page, hub }) => {
  test.setTimeout(90_000);
  await seedPassphrase(hub, crypto.getRandomValues(new Uint8Array(32)), PASSPHRASE, ['One', 'Two']);
  await seedKey(page, hub); // the vector key, which is not the org's
  await page.goto(hub.url);
  const dialog = await openKeyDialog(page);
  await expect(dialog.getByTestId('other-key')).toContainText(`the org's fingerprint is ${checkFingerprint(hub.orgKeys.key_check!)}`);
  await dialog.getByRole('button', { name: 'Remove One' }).click();
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(dialog.getByTestId('key-error')).toHaveText("This browser's key isn't the org's, so the hub refused the change. Lock it, and unlock with one of the org's methods.");
  expect(hub.orgKeys.keys).toHaveLength(2);
});
