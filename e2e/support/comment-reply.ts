// The word cut (G385, docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 2): only the active comment card has
// a reply field. A card chosen in the document editor's Comments panel (the dashboard's too) becomes the active one in
// place (the drawer, or an orphan the margin cannot draw), or hands its thread to the margin's card and closes the panel
// (beside the page, from 720 px). Which of the two a record meets depends on its width, so a reply goes to the active
// card wherever it stands.
import { expect, type Locator } from '@playwright/test';

/** Chooses the thread's card in `rail`, replies from the active card in `record`, and answers that card once it lists the reply. */
export async function replyThroughActiveCard(record: Locator, rail: Locator, threadId: string, text: string): Promise<Locator> {
  await rail.locator(`article[data-thread="${threadId}"]`).click();
  const card = record.locator(`article[data-thread="${threadId}"][aria-current="true"]`);
  const field = card.getByRole('textbox', { name: 'Reply' });
  await field.fill(text);
  await field.press('Enter');
  await expect(card.getByRole('listitem').filter({ hasText: text }), 'the reply posted').toHaveCount(1);
  return card;
}
