// M2 of the DC5 plan, in a browser against the DX3 double: the org key derives in the browser from the owner's passkey
// (WebAuthn PRF, here Chrome's virtual authenticator) or from a passphrase, every browser holding the same secret
// derives the same key, and the key is kept as long as the owner chose. Enrollment, which needs DX7's endpoints, is
// proved against the local hub (local-hub.spec.ts).
import { test as base, expect, type Browser, type Page } from '@playwright/test';
import { DOUBLE_ORG, HubDouble } from '../test/double/hub-double';
import { orgKeyFromPassphrase } from '../src/key/derive';
import { clearOrigin, virtualAuthenticator } from './authenticator';
import { DIST, test } from './fixtures';
import { PROJECT, stageProject } from './scene';

const PASSPHRASE = 'correct horse battery staple';

async function unlockWithPassphrase(page: Page, passphrase: string, keep: boolean) {
  const form = page.getByTestId('unlock');
  if (keep) await form.getByLabel('Keep unlocked on this device').check();
  await form.getByLabel(/your passphrase/).fill(passphrase);
  await form.getByRole('button', { name: 'Unlock', exact: true }).click();
}

async function fingerprint(page: Page): Promise<string> {
  await page.getByTestId('key-state').click();
  const text = (await page.getByTestId('fingerprint').textContent()) ?? '';
  await page.keyboard.press('Escape');
  return text;
}

base('a passphrase derives the same key in two browsers — the key the project is sealed with — kept as each chose', async ({ browser }) => {
  base.setTimeout(60_000);
  const hub = await HubDouble.start({ orgKey: await orgKeyFromPassphrase(PASSPHRASE, DOUBLE_ORG.id), staticDir: DIST });
  try {
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
    await unlockWithPassphrase(kept, PASSPHRASE, true);
    await expect(center(kept)).toContainText('the migration is merged', { timeout: 20_000 });

    // Another, for this tab only — after a mistyped passphrase, which derives another key: its log fails verification.
    const tab = await open(browser);
    await unlockWithPassphrase(tab, 'correct horse battery stapel', false);
    await expect(tab.getByTestId('refused')).toBeVisible({ timeout: 20_000 });
    await expect(center(tab)).not.toContainText('the migration is merged');
    const wrong = await fingerprint(tab);
    await tab.getByTestId('key-state').click();
    await tab.getByRole('dialog').getByRole('button', { name: 'Lock' }).click();
    await tab.keyboard.press('Escape');
    await unlockWithPassphrase(tab, PASSPHRASE, false);
    await expect(center(tab)).toContainText('the migration is merged', { timeout: 20_000 });

    const a = await fingerprint(kept);
    expect(a).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(await fingerprint(tab)).toBe(a);
    expect(wrong).not.toBe(a);

    // A reload: the device kept it; the tab's is gone.
    await kept.reload();
    await expect(center(kept)).toContainText('the migration is merged');
    await expect(kept.getByTestId('key-state')).toHaveText('Unlocked');
    await tab.reload();
    await expect(tab.getByTestId('locked')).toBeVisible();
    await expect(tab.getByTestId('key-state')).toHaveText('Locked');
  } finally {
    await hub.close();
  }
});

test('the passkey derives the key through PRF, and derives it again in a browser that holds nothing else', async ({ page, hub }) => {
  const origin = hub.url.replace('127.0.0.1', 'localhost');
  const cdp = await virtualAuthenticator(page);
  await page.goto(origin);
  await expect(page.getByTestId('key-state')).toHaveText('Locked');
  await page.getByTestId('key-state').click();
  const dialog = page.getByRole('dialog', { name: 'Org key' });
  await dialog.getByRole('button', { name: "First time? Create the org's passkey" }).click();
  await dialog.getByRole('button', { name: 'Create the org passkey' }).click();
  await expect(dialog.getByTestId('unlocked')).toContainText('Unlocked for this tab');
  const first = await dialog.getByTestId('fingerprint').textContent();
  expect(first).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);

  // Locked, and the browser emptied of everything it held: only the passkey remains.
  await dialog.getByRole('button', { name: 'Lock' }).click();
  await clearOrigin(cdp, origin);
  await page.reload();
  await expect(page.getByTestId('key-state')).toHaveText('Locked');
  await page.getByTestId('key-state').click();
  await page.getByRole('dialog', { name: 'Org key' }).getByRole('button', { name: 'Unlock with passkey' }).click();
  await expect(page.getByTestId('fingerprint')).toHaveText(first!);
});

test('a passkey without PRF is refused, and the passphrase offered', async ({ page, hub }) => {
  await virtualAuthenticator(page, { prf: false });
  await page.goto(hub.url.replace('127.0.0.1', 'localhost'));
  await page.getByTestId('key-state').click();
  const dialog = page.getByRole('dialog', { name: 'Org key' });
  await dialog.getByRole('button', { name: "First time? Create the org's passkey" }).click();
  await dialog.getByRole('button', { name: 'Create the org passkey' }).click();
  await expect(dialog.getByRole('alert')).toContainText('without the PRF extension');
  await expect(page.getByTestId('key-state')).toHaveText('Locked');
});
