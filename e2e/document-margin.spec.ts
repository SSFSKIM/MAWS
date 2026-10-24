// The margin in the product (P4-B1; the P4 spec §2 item 1 and §5 B1's "a margin case added to e2e:document-app: an agent
// reply growing a card while the owner types"; docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md M5). `pnpm
// e2e:document-app`, the product build, MAWS_HARNESS=0, the window at 1600 × 900 and the document in the panel's
// pinned Artifacts tool, maximized, so its body reaches the margin's cards tier while the main area shows the session
// its comments go to (an `artifact` main tab alone has no session to comment to without an engine), and the host seam
// (`documents/kinds/document-perf.ts`, MAWS_DOCUMENT_PERF=1) running the real `artifact_reply` as an agent session. The owner's two threads are cards beside their passages; the agent's reply grows
// the first card while the owner types in the paragraph above, the second card is pushed down, the active thread
// stays the owner's, and the typed text lands whole; the view states and the panel's round trip are read on the same
// document. No engine runs; the profile is the case's own directory under /tmp.
import { openArtifactInPanel, pinSurfaceForSessions } from './support/shell';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PerfSeam } from './support/document-scale';

// P4-B1 (LC-1 item 1; docs/doperpowers/evidence/p4/lc1/lc1-docs-margin.md): a margin card's top sits 4 px below its
// passage's first line box top (MARGIN_CARD_INSET_PX in src/artifacts/comments/margin-layout.ts), 26 px from the page
// (LC-1 item 6: Docs' page gutter, `--doc-margin-page-gutter`)
const CARD_INSET_PX = 4;
const PAGE_GUTTER_PX = 26;
import { launchMaws, type MawsLaunch } from './support/launch';
import { sidebarRow } from './support/sidebar';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

let launch: MawsLaunch | null = null;
let userData: string | null = null;

test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  if (userData) rmSync(userData, { recursive: true, force: true });
  userData = null;
});

const SESSIONS = 'stub:test/fixtures/panel/harness-sessions.json'; // the panel's harness scenario (C8a)
const AGENT = 'document-margin-agent';

async function start(): Promise<{ page: Page; seam: PerfSeam }> {
  mkdirSync('/tmp/maws-harness/a', { recursive: true });
  userData = mkdtempSync('/tmp/maws-e2e-document-margin-');
  launch = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: SESSIONS, MAWS_DOCUMENT_PERF: '1' } });
  const { page, app } = launch;
  // the cards tier needs side space beside an 816 px page: the window's content at 1600 × 900
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())!.setContentSize(1600, 900));
  await page.waitForFunction(() => window.innerWidth === 1600);
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  const seam = new PerfSeam(join(userData, 'document-perf'));
  await expect.poll(() => existsSync(join(seam.dir, 'in')), { timeout: 10_000, message: 'the host started the seam' }).toBe(true);
  return { page, seam };
}

// Select Harness A so the record's panel surface has a session for comments.
async function selectPanelSession(page: Page): Promise<void> {
  await (await sidebarRow(page, 'Harness A')).click();
}

// The owner's document in the pinned Artifacts tool's record view, the panel maximized (the margin's cards tier).
async function openInPanel(page: Page, title: string): Promise<{ id: string; main: Locator }> {
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'document', title });
  const panel = page.locator('[data-region="panel"]');
  await openArtifactInPanel(page, artifact.id);
  await pinSurfaceForSessions(page, 'Artifacts');
  const record = panel.locator(`[data-artifact-record="${artifact.id}"]`);
  await expect(record.locator('.ds-doc .ProseMirror[data-editor="live"]')).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'Expand surface' }).click();
  await expect.poll(async () => (await record.locator('.doc-editor-body').boundingBox())!.width, { message: 'the panel maximized' }).toBeGreaterThan(1200);
  return { id: artifact.id, main: record };
}

async function selectIn(text: Locator, index: number, quote: string): Promise<void> {
  await text.evaluate(
    (el, [i, q]) => {
      const block = el.children[i as number]!;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent!.indexOf(q as string);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + (q as string).length);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      throw new Error(`no ${q} in block ${i}`);
    },
    [index, quote] as const,
  );
}

// A thread on `quote` in paragraph `index`, kept: the compose card (hosted in the margin) resolved on purpose, then
// reopened from the panel; answers its id with the panel closed again.
async function keep(page: Page, main: Locator, text: Locator, index: number, quote: string): Promise<string> {
  const before = new Set(await text.locator('[data-thread]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.thread!)));
  await selectIn(text, index, quote);
  const toolbar = main.getByRole('toolbar', { name: 'Formatting' });
  await toolbar.getByRole('button', { name: 'Add comment', exact: true }).click();
  const card = page.locator('[data-comment-card]');
  await expect(card).toBeVisible();
  await expect(main.locator('[data-margin-entry][data-compose] [data-comment-card]'), 'the compose card hosted in the margin').toBeVisible();
  await card.getByRole('button', { name: 'Resolve' }).click();
  await expect(card).toHaveCount(0);
  const ids = await text.locator('[data-thread]').evaluateAll((els) => [...new Set(els.map((el) => (el as HTMLElement).dataset.thread!))]);
  const threadId = ids.find((id) => !before.has(id))!;
  await toolbar.getByRole('button', { name: /^Comments/ }).click();
  const panel = main.getByRole('complementary', { name: 'Comments' });
  await panel.locator(`article[data-thread="${threadId}"]`).getByRole('button', { name: 'Reopen' }).click();
  await toolbar.getByRole('button', { name: /^Comments/ }).click();
  await expect(panel).toHaveCount(0);
  return threadId;
}

test('an agent reply grows a card while the owner types; the stack re-lays, the active thread stays; the view states and the panel round trip', async () => {
  test.setTimeout(120_000);
  const { page, seam } = await start();
  await selectPanelSession(page);
  const { id, main } = await openInPanel(page, 'Margin review');
  const text = main.locator('.ds-doc .ProseMirror[data-editor="live"]');
  const toolbar = main.getByRole('toolbar', { name: 'Formatting' });
  const margin = main.getByRole('region', { name: 'Comments' });
  const pageBox = async () => (await main.locator('.ds-doc-page').boundingBox())!;

  await test.step('the owner writes three paragraphs and keeps a thread on the second and the third', async () => {
    await text.click();
    await page.keyboard.type('The kickoff is on Monday, and the agenda is set.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('The budget review is on Friday with the whole team.');
    await page.keyboard.press('Enter');
    // two lines between the two passages (three line pitches, about 117 px): the first card, compact, fits above the
    // second without pushing it; the active card with the agent's reply (a name, two lines of text, the reply field) does
    // not, so the reply's growth pushes the second (four lines left the grown card short of the second's room)
    for (const line of ['Agenda item one.', 'Agenda item two.']) {
      await page.keyboard.type(line);
      await page.keyboard.press('Enter');
    }
    await page.keyboard.type('Risks are listed below, each with an owner.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Closing notes follow the risks.');
  });
  const centredLeft = (await pageBox()).x;
  const t1 = await keep(page, main, text, 1, 'budget review');
  const t2 = await keep(page, main, text, 4, 'listed below'); // the fifth paragraph: two agenda lines between the passages
  const entry = (threadId: string) => margin.locator(`[data-margin-entry="${threadId}"]`);
  const lineTop = (threadId: string) => text.locator(`[data-thread="${threadId}"]`).first().evaluate((el) => el.getClientRects()[0]!.top);
  const entryTop = async (threadId: string) => (await entry(threadId).boundingBox())!.y;

  await test.step('two cards beside their passages, the page moved left for the margin', async () => {
    await expect(margin).toHaveAttribute('data-margin-tier', 'cards');
    await expect(entry(t1)).toBeVisible();
    await expect(entry(t2)).toBeVisible();
    expect(Math.abs((await entryTop(t1)) - (await lineTop(t1)) - CARD_INSET_PX), 'the first card at its line').toBeLessThanOrEqual(2);
    expect(Math.abs((await entryTop(t2)) - (await lineTop(t2)) - CARD_INSET_PX), 'the second card at its line').toBeLessThanOrEqual(2);
    // N6 as Docs (LC-1 item 6): the page and the column's reserve centre as one unit, so the page moved left by half the
    // reserve, and the card sits the page gutter from the page
    const reserve = await margin.evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--doc-margin-reserve')));
    expect(reserve, 'the margin reserved').toBeGreaterThan(0);
    const moved = await pageBox();
    expect(Math.abs(centredLeft - moved.x - reserve / 2), 'the page moved left by half the reserve (N6)').toBeLessThanOrEqual(1);
    expect(Math.abs((await entry(t1).boundingBox())!.x - (moved.x + moved.width) - PAGE_GUTTER_PX), 'the card at the page gutter').toBeLessThanOrEqual(1);
    await page.screenshot({ path: 'test-results/document-margin-cards.png' });
  });

  await test.step('the agent replies in the first thread while the owner types above: the card grows, the second is pushed, the active thread stays', async () => {
    // the paragraph holding the caret, by index in the live editor (−1: the selection is not in it)
    const caretParagraph = () =>
      text.evaluate((el) => {
        const node = window.getSelection()?.anchorNode;
        const paragraph = (node instanceof Element ? node : node?.parentElement)?.closest('p') ?? null;
        return paragraph ? Array.from(el.querySelectorAll('p')).indexOf(paragraph) : -1;
      });
    // the owner's keyboard is on the toolbar after the panel's round trip and the editor's own selection is still the
    // second passage: a click in the first paragraph (plain text: nothing to clear) brings the keyboard back to the page
    // first. A click on a passage of an unfocused page can leave the caret where it was: ProseMirror re-syncs its
    // selection to the DOM 20 ms after a focus, and the activation's render on the mini ran past that
    await text.locator('p').first().click();
    await text.locator(`.comment-${t1}`).click();
    await expect(entry(t1)).toHaveAttribute('data-active', '');
    expect(await caretParagraph(), 'the caret in the first passage after the click').toBe(1);
    const t2Before = await entryTop(t2);
    const h1Before = (await entry(t1).boundingBox())!.height;
    // the owner types at the end of the first paragraph (above both passages) while the reply lands. P4-B1: the caret
    // gets there by the keyboard (a click on uncommented text would clear the active thread, D5; a caret leaving a
    // passage by the keyboard keeps it): up out of the passage into the first paragraph, then to its end
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('End');
    await expect(entry(t1), 'the caret leaving by the keyboard keeps the thread').toHaveAttribute('data-active', '');
    expect(await caretParagraph(), 'the caret at the first paragraph after ArrowUp and End').toBe(0);
    await text.evaluate((el) => {
      (el as HTMLElement).dataset.marker = 'before-reply'; // survives only if the editor is not remounted by the reply
    });
    const typing = (async () => {
      for (const ch of ' More words typed here.') {
        await page.keyboard.type(ch);
        await new Promise((r) => setTimeout(r, 40));
      }
    })();
    const read = await seam.call<{ revision: number }>(AGENT, 'artifact_read', { artifact: id });
    expect(read.isError, read.text).toBe(false);
    const answer = await seam.call(AGENT, 'artifact_reply', { artifact: id, threadId: t1, body: 'The budget review moved to Thursday: the finance team is out on Friday, and the slides need one more pass before then.' });
    expect(answer.isError, answer.text).toBe(false);
    await typing;
    await expect.poll(async () => (await entry(t1).boundingBox())!.height, { message: 'the card grew with the reply' }).toBeGreaterThan(h1Before + 20);
    await expect(entry(t1).getByRole('listitem').last()).toContainText('finance team');
    await expect(entry(t1)).toHaveAttribute('data-active', '');
    await expect(text.locator(`.comment-active.comment-${t1}`)).toHaveCount(1);
    // P4-B1 (the follow-up wave): the owner's last keys owe the margin a pass, run once they pause (within 700 ms), so the
    // anchor is read as the margin settles
    await expect.poll(async () => Math.abs((await entryTop(t1)) - (await lineTop(t1)) - CARD_INSET_PX), { message: 'the active card stays at its anchor' }).toBeLessThanOrEqual(2);
    await expect.poll(() => entryTop(t2), { message: 'the second card pushed below the grown first' }).toBeGreaterThan(t2Before + 20);
    // where the keyboard was and whether the editor survived the reply, read into the message (the mini's run is the
    // only evidence)
    const where = await page.evaluate(() => {
      const el = document.activeElement;
      return { active: el ? `${el.tagName}.${el.className}` : null, editorKept: document.querySelector('.ProseMirror[data-marker="before-reply"]') !== null };
    });
    const paragraphs = await text.locator('p').allTextContents();
    expect(paragraphs[0], `the owner's words appended to the first paragraph (${JSON.stringify({ ...where, caretParagraph: await caretParagraph(), paragraphs })})`).toContain('agenda is set. More words typed here.');
    await page.screenshot({ path: 'test-results/document-margin-grown.png' });
  });

  await test.step('the view states: Minimize gives the icon rail, Hide no margin, Expand the cards; the panel takes the cards out and gives them back', async () => {
    const view = toolbar.getByRole('button', { name: 'Comment view' });
    // Minimize keeps the passages' highlights; Hide draws them plain, as Docs' Hide does (LC-1 item 7), the decoration
    // kept (only its colours go)
    const passage = text.locator(`.comment-${t1}`);
    const plain = 'rgba(0, 0, 0, 0)';
    await view.click();
    await toolbar.getByRole('menuitemradio', { name: 'Minimize' }).click();
    await expect(margin).toHaveAttribute('data-margin-tier', 'icons');
    await expect(passage).not.toHaveCSS('background-color', plain);
    await view.click();
    await toolbar.getByRole('menuitemradio', { name: 'Hide' }).click();
    await expect(margin).toHaveCount(0);
    await expect(passage).toHaveCount(1);
    await expect(passage).toHaveCSS('background-color', plain);
    await expect(passage).toHaveCSS('border-bottom-color', plain);
    await view.click();
    await toolbar.getByRole('menuitemradio', { name: 'Expand' }).click();
    await expect(margin).toHaveAttribute('data-margin-tier', 'cards');
    await expect(passage).not.toHaveCSS('background-color', plain);
    await toolbar.getByRole('button', { name: /^Comments/ }).click();
    await expect(margin).toHaveCount(0);
    await expect(main.getByRole('complementary', { name: 'Comments' })).toBeVisible();
    await toolbar.getByRole('button', { name: /^Comments/ }).click();
    await expect(margin).toHaveAttribute('data-margin-tier', 'cards');
    await expect(entry(t1)).toHaveAttribute('data-active', ''); // the same active thread (Z5)
  });

  await test.step('resolving the last thread un-reserves the margin: the page centres again', async () => {
    for (const threadId of [t2, t1]) {
      await entry(threadId).getByRole('button', { name: 'Resolve' }).click();
      await expect(entry(threadId)).toHaveCount(0);
    }
    await expect.poll(async () => (await pageBox()).x, { message: 'the page centred again' }).toBeGreaterThan(centredLeft - 2);
  });
  await seam.release(AGENT);
});
