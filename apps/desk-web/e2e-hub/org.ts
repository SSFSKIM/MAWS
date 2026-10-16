// The org key and its dialog as the local-hub suites drive them. Each run's local hub starts from a fresh state (no key),
// and an org has one key ever: a suite that meets an org with no key sets one up with the suite's passphrase; one that
// meets an org with a key (a hub whose state was kept) unlocks with that passphrase, which every first setup adds.
import { expect, type Locator, type Page } from '@playwright/test';
import type { WrappedKeys } from 'desk-hub/protocol';
import type { LocalHub } from '../test/local/hub';

/** The passphrase the suites' first setup adds; a run against a hub whose org already has a key unlocks with it. */
export const SUITE_PASSPHRASE = 'desk local hub suite passphrase';

/** The org's wrapped keys, as any member reads them (DX7). */
export async function orgKeys(hub: LocalHub): Promise<WrappedKeys> {
  return (await (await fetch(`${hub.url}/api/org/keys`)).json()) as WrappedKeys;
}

export const keyDialog = (target: Page) => target.getByRole('dialog', { name: 'Org key' });

export async function openKeyDialog(target: Page): Promise<Locator> {
  await target.getByTestId('key-state').click();
  return keyDialog(target);
}

export async function unlockWithPassphrase(scope: Locator, passphrase: string, keep: boolean) {
  if (keep) await scope.getByLabel('Keep unlocked on this device').check();
  const form = scope.getByRole('form', { name: 'Passphrase', exact: true });
  await form.getByLabel(/passphrase/).fill(passphrase);
  await form.getByRole('button', { name: 'Unlock', exact: true }).click();
}

export async function newPassphrase(scope: Locator, passphrase: string, submit: string) {
  const form = scope.getByRole('form', { name: 'New passphrase' });
  await form.getByLabel(/Or a passphrase/).fill(passphrase);
  await form.getByLabel('The passphrase again').fill(passphrase);
  await form.getByRole('button', { name: submit, exact: true }).click();
}

/**
 * Leaves `page` (on the hub's origin) holding the org's key, kept on the device: set up with the suite's passphrase when
 * the org has none, unlocked with it otherwise.
 */
export async function holdOrgKey(page: Page, hub: LocalHub): Promise<void> {
  await page.goto(hub.localhost);
  const dialog = await openKeyDialog(page);
  if ((await orgKeys(hub)).key_check === null) {
    await dialog.getByLabel('Keep unlocked on this device').check();
    await newPassphrase(dialog, SUITE_PASSPHRASE, 'Set up');
  } else {
    await unlockWithPassphrase(dialog, SUITE_PASSPHRASE, true);
  }
  await expect(dialog.getByTestId('unlocked')).toContainText('Unlocked on this device', { timeout: 90_000 });
  await page.keyboard.press('Escape');
}

/** Enrolls a machine through the browser's Machines dialog, confirmed with the suite's passphrase: the code it shows. */
export async function enrollInBrowser(page: Page, machine: string): Promise<string> {
  await page.getByRole('button', { name: 'Machines', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Machines' });
  await dialog.getByRole('button', { name: 'Enroll a machine' }).click();
  await dialog.getByLabel(/machine's name/).fill(machine);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  const confirm = dialog.getByRole('form', { name: 'Passphrase', exact: true });
  await confirm.getByLabel(/passphrase/).fill(SUITE_PASSPHRASE);
  await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
  const code = dialog.getByTestId('enrollment-code');
  await expect(code).toBeVisible({ timeout: 90_000 });
  const text = (await code.textContent())!;
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Escape');
  return text;
}
