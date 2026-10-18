// P3-F1 (fix 2, docs/doperpowers/ledgers/2026-10-17-P3-F1.md; `pnpm e2e:document-app`, the product build,
// MAWS_HARNESS=0 per launch): a document opened as its own main tab, with no chat shown anywhere in the main area, offers
// a new comment card whose session comes from the artifact itself (H's owner-start policy). A document a session made
// (the recorded `maws` session replayed through C3's replay transport, the host's real tool server creating it) takes
// that session: Comment opens P2's card naming it, Side thread chosen, nothing started. The owner's own document in no
// Space has no context: Comment shows the card's notice saying so, and Close withdraws the comment's mark. Captures:
// `standalone-card-own-session`, `standalone-card-no-context`. No engine runs; every scratch directory is the case's own.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import { invoke, value } from './support/c7-replay';
import { asDocumentReplay } from './support/document-replay';
import { allowNext, idle, PASS3, recordedCwd, replay, scene, show, type Scene } from './support/maws-tools';

test.describe.configure({ timeout: 120_000 });

const ARTIFACTS = `${PASS3}/p1-maws-artifacts.jsonl`;
const QUOTE = 'scheduled for Friday';
// H's words for an artifact with no session context (src/renderer/src/artifacts/session-context.ts, NO_SESSION_CONTEXT;
// the renderer module is not imported here, its stores being the window's)
const NO_SESSION_CONTEXT = 'Put this artifact in a Space linked to a folder to start a session for it';

// The document from the library, in an `artifact` main tab: the main area then shows no chat.
async function openAsTab(s: Scene, title: string, artifactId: string): Promise<Locator> {
  await s.page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await s.page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click({ timeout: 15_000 });
  const tab = s.page.locator(`[data-artifact-tab="${artifactId}"]`);
  await expect(tab.locator('.ds-doc .ProseMirror')).toBeVisible({ timeout: 15_000 });
  await expect(s.page.locator('[data-region="main"] [data-composer]:visible'), 'no chat shown beside the document').toHaveCount(0);
  return tab;
}

// Selects `quote` in the editor's first paragraph containing it (a DOM selection the editor reads, as a drag would set).
async function select(text: Locator, quote: string): Promise<void> {
  await text.evaluate((root, q) => {
    const p = Array.from(root.querySelectorAll('p')).find((el) => (el.textContent ?? '').includes(q))!;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = (n as Text).data.indexOf(q);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(n, at);
      range.setEnd(n, at + q.length);
      (root as HTMLElement).focus();
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
    throw new Error(`no text node holds "${q}"`);
  }, quote);
  await expect.poll(() => text.evaluate(() => getSelection()?.toString() ?? '')).toBe(quote);
}

const comment = (tab: Locator) => tab.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Comment', exact: true }).click();
const marks = (text: Locator) => text.locator('[data-thread]');
const titleOf = async (page: Page, id: AppSessionId) => value(await invoke(page, 'session.list', {})).sessions.find((record) => record.appId === id)?.title.text ?? '';

test('a document a session made, opened as its own tab with no chat shown: Comment opens the card on that session', async () => {
  const repo = recordedCwd(ARTIFACTS);
  const replayed = asDocumentReplay(
    ARTIFACTS,
    [
      { name: 'artifact_create', input: { kind: 'document', title: 'Plan', handle: 'plan', content: '# Plan ^h1\n\nThe review is scheduled for Friday. ^p1' } },
      ...Array.from({ length: 4 }, () => ({ name: 'artifact_describe_type', input: { kind: 'document' } })),
    ],
    'f1-standalone',
  );
  const existed = existsSync(repo);
  mkdirSync(repo, { recursive: true });
  try {
    await scene({ titles: ['P3-F1: a standalone comment'], repo, label: 'f1-standalone' }, async (s) => {
      const [id] = s.ids;
      await show(s, id);
      await replay(s, id, replayed);
      for (let k = 0; k < 7; k++) await allowNext(s, id); // the recording's seven permission cards, as recorded
      await idle(s, id);
      const { artifacts } = value(await invoke(s.page, 'artifacts.list', { filter: { appSessionId: id, kind: 'document' } }));
      const made = artifacts.find((artifact) => artifact.title === 'Plan')!;
      expect(made.createdBy).toEqual({ kind: 'session', appSessionId: id });

      const tab = await openAsTab(s, 'Plan', made.id);
      const text = tab.locator('.ds-doc .ProseMirror');
      await select(text, QUOTE);
      await comment(tab);
      const card = s.page.locator('[data-comment-card]');
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('data-anchor-kind', 'artifact-comment');
      await expect(card).toHaveAttribute('data-anchor-locator', QUOTE);
      const named = card.locator('[data-card-parent]');
      await expect(named, 'the card names the artifact’s own session').toHaveAttribute('data-card-parent', id);
      const title = await titleOf(s.page, id);
      await expect(named).toHaveText(`Session: ${title.trim() === '' ? 'New chat' : title}`);
      await expect(card.getByRole('radio', { name: 'Side thread' })).toBeChecked();
      await expect(marks(text).filter({ hasText: QUOTE })).toHaveCount(1);
      await test.info().attach('standalone-card-own-session', { body: await s.page.screenshot(), contentType: 'image/png' });

      // Resolve keeps the thread (the owner's way that asks no session to answer)
      await card.getByRole('button', { name: 'Resolve' }).click();
      await expect(card).toHaveCount(0);
      await expect(marks(text).filter({ hasText: QUOTE })).toHaveCount(1);
    });
  } finally {
    if (!existed) rmSync(repo, { recursive: true, force: true });
  }
});

test('the owner’s document in no Space, opened as its own tab: Comment shows the card saying why, and Close withdraws the comment', async () => {
  await scene({ titles: ['P3-F1: no context'], label: 'f1-no-context' }, async (s) => {
    const { artifact } = value(await invoke(s.page, 'artifacts.create', { kind: 'document', title: 'Owner notes' }));
    const tab = await openAsTab(s, 'Owner notes', artifact.id);
    const text = tab.locator('.ds-doc .ProseMirror');
    await text.click();
    await s.page.keyboard.type('The review is scheduled for Friday.');
    await expect(text.locator('p')).toHaveText(['The review is scheduled for Friday.']);
    await select(text, QUOTE);
    await comment(tab);

    const notice = s.page.locator('[data-comment-context]');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('role', 'dialog');
    await expect(notice).toHaveAttribute('data-comment-context', 'none');
    await expect(notice).toContainText(NO_SESSION_CONTEXT);
    await expect(s.page.locator('[data-comment-card]'), 'no composing card without a session').toHaveCount(0);
    await expect(marks(text).filter({ hasText: QUOTE }), 'the passage shows as commented while the card says why').toHaveCount(1);
    await test.info().attach('standalone-card-no-context', { body: await s.page.screenshot(), contentType: 'image/png' });

    await notice.getByRole('button', { name: 'Close' }).click();
    await expect(notice).toHaveCount(0);
    await expect(marks(text), 'the unsent comment withdrawn with its mark').toHaveCount(0);
  });
});
