// P3-F1 (fix 2, docs/doperpowers/ledgers/2026-10-17-P3-F1.md; `pnpm e2e:document-app`, the product build,
// MAWS_HARNESS=0 per launch): a document opened as its own main tab, with no chat shown anywhere in the main area, offers
// a new comment card whose session comes from the artifact itself (H's owner-start policy). A document a session made
// (the recorded `maws` session replayed through C3's replay transport, the host's real tool server creating it) takes
// that session: Comment opens P2's card naming it, Side thread chosen, nothing started. The owner's own document in no
// Space has no context: Comment shows the card's notice saying so, and Close withdraws the comment's mark. Captures:
// `standalone-card-own-session`, `standalone-card-no-context`. No engine runs; every scratch directory is the case's own.
// P3-F F4 (c26, the owner's E1 mark): the owner's document in a Space linked to an untrusted folder. Comment starts a
// session there, which meets the trust card; the notice asks in the card's place, naming the folder, with Trust and
// start and Start without trusting and the comment's mark kept, and the owner's answer starts that session (C10's replay
// seam: the trust bootstrap's recording first for Trust and start, then a no-turn journal on the direct route), the card
// then opening on the same passage with Send to main chosen. Capture: `standalone-card-trust`.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import { invoke, value } from './support/c7-replay';
import { asDocumentReplay } from './support/document-replay';
import { allowNext, closeScene, idle, launchScene, PASS3, recordedCwd, replay, scene, scratchProject, show, type Scene } from './support/maws-tools';
import { SideJournal } from './support/side-replay';

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

// The editor element's Tiptap editor (as document.spec.ts's `selectIn` reads it): its document, its selection and its
// edits not yet acknowledged.
type EditorRoot = HTMLElement & {
  editor?: {
    state: { doc: { descendants(f: (node: { type: { name: string }; textContent: string }) => boolean | void): void; textBetween(from: number, to: number, separator: string): string }; selection: { from: number; to: number } };
    extensionManager: { extensions: Array<{ name: string; options: { hold?: { base: { state(): { unsaved: number } } } } }> };
  };
};

// Selects `quote` in the editor's first paragraph containing it (a DOM selection the editor reads, as a drag would set).
// P3-F (run 39149994319, cause undetermined): there the range was written right after typing and the page's selection
// read empty about 5 ms later; nothing recorded what changed it. The range is written once, as before, but only after
// the readiness document.spec.ts's `selectIn` waits on (L277): the editor's own document holds the paragraph the page
// shows and the host has acknowledged every edit. Then the editor's selection, not only the page's, must hold the quote
// (Comment reads the editor's).
async function select(text: Locator, quote: string): Promise<void> {
  await expect
    .poll(
      () =>
        text.evaluate((root, q) => {
          const editor = (root as EditorRoot).editor;
          if (!editor) return 'no editor on the element';
          const shown = Array.from(root.querySelectorAll('p')).map((el) => el.textContent ?? '');
          const at = shown.findIndex((t) => t.includes(q));
          if (at < 0) return `no paragraph shows "${q}"`;
          const paragraphs: string[] = [];
          editor.state.doc.descendants((node) => {
            if (node.type.name === 'paragraph') paragraphs.push(node.textContent);
          });
          const unsaved = editor.extensionManager.extensions.find((extension) => extension.name === 'collaboration')?.options.hold?.base.state().unsaved ?? 0;
          return paragraphs[at] === shown[at] && unsaved === 0 ? 'settled' : `paragraph "${paragraphs[at]}", ${unsaved} unacknowledged`;
        }, quote),
      { message: 'the editor holds the paragraph shown and the host has acknowledged every edit' },
    )
    .toBe('settled');
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
  await expect
    .poll(() =>
      text.evaluate((root) => {
        const editor = (root as EditorRoot).editor!;
        const { from, to } = editor.state.selection;
        return { page: getSelection()?.toString() ?? '', editor: editor.state.doc.textBetween(from, to, '\n') };
      }),
    )
    .toEqual({ page: quote, editor: quote });
}

const comment = (tab: Locator) => tab.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Add comment', exact: true }).click();
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

// P3-F F4: the trust bootstrap the replay seam hands Trust and start's first launch (as e2e/sessions.spec.ts's case does)
const BOOTSTRAP = `${PASS3}/trust-bootstrap-recorded.jsonl`;

for (const [answer, trust] of [['Trust and start', 'accepted'], ['Start without trusting', 'declined']] as const) {
  test(`the owner’s document in a Space linked to an untrusted folder: Comment asks for trust in the card’s place, and ${answer} opens the card on the passage`, async () => {
    const scratch = scratchProject({ titles: [`P3-F F4: ${answer}`], label: `f4-trust-${trust}` });
    const before = process.env.MAWS_E2E_REPLAY_FIXTURES;
    try {
      // C10's replay seam (MAWS_E2E_REPLAY_FIXTURES, handed through the runner's environment as e2e/browser-comment.spec.ts
      // hands it): each launch takes the next journal. The comment's session starts with no message, so its journal is
      // the handshake alone; Trust and start's bootstrap runs first.
      const journals = join(scratch.root, 'journals');
      mkdirSync(journals, { recursive: true });
      const session = new SideJournal(randomUUID(), scratch.repo).write(journals, 'comment-session');
      process.env.MAWS_E2E_REPLAY_FIXTURES = (trust === 'accepted' ? [BOOTSTRAP, session] : [session]).join(',');
      let s: Scene;
      try {
        s = await launchScene(scratch);
      } finally {
        if (before === undefined) delete process.env.MAWS_E2E_REPLAY_FIXTURES;
        else process.env.MAWS_E2E_REPLAY_FIXTURES = before;
      }
      try {
        // the scratch config home has no `.claude.json`, so the folder is untrusted; new sessions take the direct route
        // (the journal verifies direct, and no relay is asked)
        value(await invoke(s.page, 'settings.set', { gateway: { defaultRoute: 'direct' } }));
        const { space } = value(await invoke(s.page, 'spaces.create', { name: 'Untrusted folder', linkedDir: s.repo }));
        const { artifact } = value(await invoke(s.page, 'artifacts.create', { kind: 'document', title: 'Space notes', spaceId: space.id }));
        const tab = await openAsTab(s, 'Space notes', artifact.id);
        const text = tab.locator('.ds-doc .ProseMirror');
        await text.click();
        await s.page.keyboard.type('The review is scheduled for Friday.');
        await expect(text.locator('p')).toHaveText(['The review is scheduled for Friday.']);
        await select(text, QUOTE);
        await comment(tab);

        const notice = s.page.locator('[data-comment-context]');
        await expect(notice, 'the start met the trust card').toHaveAttribute('data-comment-context', 'trust', { timeout: 30_000 });
        await expect(notice).toContainText(s.repo);
        await expect(notice.getByRole('button', { name: 'Trust and start', exact: true })).toBeVisible();
        await expect(notice.getByRole('button', { name: 'Start without trusting', exact: true })).toBeVisible();
        await expect(notice.getByRole('button', { name: 'Open session' }), 'answered here, not in another session').toHaveCount(0);
        await expect(s.page.locator('[data-comment-card]')).toHaveCount(0);
        await expect(marks(text).filter({ hasText: QUOTE }), 'the comment’s mark kept while the card asks').toHaveCount(1);
        if (trust === 'accepted') await test.info().attach('standalone-card-trust', { body: await s.page.screenshot(), contentType: 'image/png' });

        await notice.getByRole('button', { name: answer, exact: true }).click();
        const card = s.page.locator('[data-comment-card]');
        await expect(card, 'the card opens once the session is ready').toBeVisible({ timeout: 60_000 });
        await expect(notice).toHaveCount(0);
        await expect(card).toHaveAttribute('data-anchor-kind', 'artifact-comment');
        await expect(card).toHaveAttribute('data-anchor-locator', QUOTE);
        await expect(card.getByRole('radio', { name: 'Send to main' })).toBeChecked();
        await expect(marks(text).filter({ hasText: QUOTE }), 'on the same passage, one mark').toHaveCount(1);
        const started = (await card.locator('[data-card-parent]').getAttribute('data-card-parent')) as AppSessionId;
        // the owner's answer reached the engine as the composer's card sends it: attested on Trust and start, absent without
        const initialize = s.journal(started).find((row) => row.direction === 'out' && (row.frame as { request?: { subtype?: string } }).request?.subtype === 'initialize');
        const attested = (initialize?.frame as { request?: { workspaceTrust?: unknown } } | undefined)?.request?.workspaceTrust;
        if (trust === 'accepted') expect(attested).toEqual({ accepted: true, directory: s.repo });
        else expect(attested).toBeUndefined();
      } catch (error) {
        await s.maws.cleanup();
        throw error;
      }
      await closeScene(s);
    } finally {
      rmSync(scratch.root, { recursive: true, force: true });
    }
  });
}
