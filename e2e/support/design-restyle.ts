// P3-F's S-RESTYLE (the P3-D document's Acceptance 10 and 11 on B's and C's real editors, not the fixture): what
// design-systems.spec.ts reads off a real document page and a real deck stage. A colour is compared as the window paints
// it (`rgb(…)`), whatever form a token's value was written in.
import { expect, type Locator, type Page } from '@playwright/test';

/** A one-slide deck whose title is set in the system's accent, as `__maws_presentations.seed` takes its files. */
export const ACCENT_DECK: Record<string, string> = {
  'project/deck.json': JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-18T09:00:00Z' }, title: 'Lecture', cover: 'opening', order: ['opening'], faces: {}, designSystems: [] }),
  'project/slides/opening.html':
    '<section id="opening" style="background:var(--ds-color-bg, #ffffff); padding:128px"><h1 id="headline" style="font-size:96px; color:var(--ds-color-accent, #000000)">Week one</h1></section>',
};

/** The deck's title element on a stage (`[data-history-stage]` for a version's preview). */
export const deckHeadline = (stage: Locator) => stage.locator('[data-stage-slide] [data-eid="headline"]').first();

/** The colour an element paints its text in. */
export const paintedColor = (element: Locator) => element.evaluate((node) => getComputedStyle(node).color);

/**
 * A reading-list passage whose link the document's theme sets in the system's accent (theme.css: `.ds-doc a`), as the
 * document editor's `insertContent` takes it.
 */
export const READING_PASSAGE = [
  {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Before Monday, read chapter two of ' },
      { type: 'text', text: 'the course reader', marks: [{ type: 'link', attrs: { href: 'https://example.edu/course-reader' } }] },
      { type: 'text', text: ' and bring one question to the seminar.' },
    ],
  },
];

/** The owner's edit through a real document editor (`[data-editor]`, which carries its TipTap editor), inserting `content`. */
export const insertThroughEditor = (editor: Locator, content: unknown) =>
  editor.evaluate((node, inserted) => {
    if (!(node as HTMLElement & { editor: { commands: { insertContent(value: unknown): boolean } } }).editor.commands.insertContent(inserted)) throw new Error('the editor refused the passage');
  }, content);

/** The edits a document editor's replica still waits for the host to acknowledge (document.spec.ts's `durable` read). */
export const unacknowledged = (editor: Locator) =>
  editor.evaluate((node) => {
    const bound = (node as HTMLElement & { editor?: { extensionManager: { extensions: Array<{ name: string; options: { hold?: { base: { state(): { unsaved: number } } } } }> } } }).editor;
    return bound?.extensionManager.extensions.find((extension) => extension.name === 'collaboration')?.options.hold?.base.state().unsaved ?? -1;
  });

/** An artifact opened from the library in its main tab, once `drawn` (a locator inside the tab) is visible. */
export async function openFromLibrary(page: Page, title: string, artifactId: string, drawn: string): Promise<Locator> {
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click();
  const tab = page.locator(`[data-region="main"] [data-artifact-tab="${artifactId}"]`);
  await expect(tab.locator(drawn).first()).toBeVisible({ timeout: 15_000 });
  return tab;
}

/** A header action by its label: its button, or its entry under More actions when the header folded it there. */
export async function headerAction(page: Page, label: string): Promise<void> {
  const header = page.locator('[data-region="main"] [data-editor-header]');
  const button = header.getByRole('button', { name: label, exact: true });
  if (await button.isVisible()) return button.click();
  await header.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: label }).or(page.getByRole('menuitem', { name: label })).click();
}
