// The Machines dialog's removal, in a browser against the DX3 double (its machine records: ../test/double/machines.ts):
// an admin removes a machine past a confirmation that says what removal means, and the list is the hub's again
// afterwards; the hub's refusal is explained on the confirmation; a member who is not an admin is offered no removal.
// Against DC3's real hub, with a connected machine refused once removed: e2e-hub/session-plane.spec.ts.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const machinesDialog = async (page: Page) => {
  await page.getByRole('button', { name: 'Machines', exact: true }).click();
  return page.getByRole('dialog', { name: 'Machines' });
};

test('an admin removes a machine past a confirmation that says what removal means, and the list refreshes without it', async ({ page, hub }) => {
  hub.machineRecords.add('mini');
  hub.machineRecords.add('studio', 'pending');
  await page.goto(hub.url);
  const dialog = await machinesDialog(page);
  const mini = dialog.locator('[data-machine="mini"]');
  const studio = dialog.locator('[data-machine="studio"]');
  await expect(studio).toContainText('enrolling');

  await mini.getByRole('button', { name: 'Remove mini' }).click();
  const confirm = dialog.getByTestId('remove-confirm');
  await expect(confirm).toContainText('Remove mini?');
  await expect(confirm.getByTestId('remove-meaning')).toHaveText(
    'The hub disconnects it at once and deletes its credential, so mini is refused from then on. To use it with the desk again, enroll it again with a new code.',
  );
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(mini).toContainText('enrolled');
  expect(hub.machineRecords.removals).toEqual([]);

  await mini.getByRole('button', { name: 'Remove mini' }).click();
  // Meanwhile studio connects: the list drawn after the removal is the hub's, fetched again, not the old one less a row.
  hub.machineRecords.machines = hub.machineRecords.machines.map((m) => (m.name === 'studio' ? { ...m, state: 'active', confirmed: new Date().toISOString() } : m));
  await confirm.getByRole('button', { name: 'Remove mini' }).click();
  await expect(dialog.getByTestId('machines-notice')).toHaveText('Removed mini. To use it with the desk again, enroll it again.');
  await expect(mini).toHaveCount(0);
  await expect(studio).toContainText('enrolled');
  expect(hub.machineRecords.removals).toEqual(['mini']);
  expect(hub.machineRecords.machines.map((m) => m.name)).toEqual(['studio']);
});

test("the hub's refusal is explained on the confirmation, and the machine stays listed", async ({ page, hub }) => {
  hub.machineRecords.add('mini');
  await page.goto(hub.url);
  const dialog = await machinesDialog(page);
  await dialog.getByRole('button', { name: 'Remove mini' }).click();
  hub.role = 'member'; // no longer an admin since the page loaded
  const confirm = dialog.getByTestId('remove-confirm');
  await confirm.getByRole('button', { name: 'Remove mini' }).click();
  await expect(confirm.getByRole('alert')).toHaveText('Only an admin of the org removes machines.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog.locator('[data-machine="mini"]')).toBeVisible();
  expect(hub.machineRecords.machines.map((m) => m.name)).toEqual(['mini']);
});

test('a member who is not an admin is offered no removal', async ({ page, hub }) => {
  hub.role = 'member';
  hub.machineRecords.add('mini');
  await page.goto(hub.url);
  const dialog = await machinesDialog(page);
  await expect(dialog.locator('[data-machine="mini"]')).toContainText('enrolled');
  await expect(dialog.getByRole('button', { name: /Remove/ })).toHaveCount(0);
  await expect(dialog).toContainText('An admin of the org enrolls and removes machines.');
  expect(hub.machineRecords.removals).toEqual([]);
});
