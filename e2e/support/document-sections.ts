import type { Locator } from '@playwright/test';

// Creation stays available when a single section does not earn its own strip.
export async function addDocumentSection(record: Locator): Promise<void> {
  await record.getByRole('toolbar', { name: 'Formatting', exact: true }).getByRole('button', { name: 'Insert', exact: true }).click();
  await record.getByRole('menuitem', { name: 'New section', exact: true }).click();
}
