// P3-B's document editor end to end on the harness's `#document` page (M3 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md, its e2e "Proves"): two DocumentEditors over two replicas of one
// in-memory host document, each a real PortProvider on a real MessageChannel, in the built renderer. Typing, a toolbar
// insert of every block kind, a tab added and switched, find stepping to the second match, and the Korean composition
// drive (S7b's 2-set model through CDP, as S7b drove it) in replica A while replica B types elsewhere; and (M4) a
// comment's card anchored to its mark, Resolve and Reopen; and (M5) version history: a preview, a copy, a restore. `pnpm
// e2e:document` builds the harness and runs this file; under a plain build the cases skip. One launch for the file; the
// page's document is reset before each case.
import { addDocumentSection } from './support/document-sections';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import type { DocumentHarnessApi, Replica } from '../src/renderer/src/harness/document/api';
import { keystrokes, type Step } from './support/hangul';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';

// P4-B1 (LC-1 item 1; docs/doperpowers/evidence/p4/lc1/lc1-docs-margin.md): a margin entry's top sits 4 px below its
// passage's first line box top in both tiers (MARGIN_CARD_INSET_PX in src/artifacts/comments/margin-layout.ts; Docs'
// Minimize puts its icons at the line's top + 4.5 too), and a card sits 26 px from the page (LC-1 item 6: Docs' page
// gutter, `--doc-margin-page-gutter`)
const CARD_INSET_PX = 4;
const PAGE_GUTTER_PX = 26;

const HARNESS_BUILT = !process.env.MAWS_E2E_EXECUTABLE && existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));

type HarnessWindow = Window & { __maws_document: DocumentHarnessApi };
// Each page.evaluate below reads the page's harness API itself: a function sent to the page closes over nothing here.
const blockText = (page: Page, which: Replica, id: string) => page.evaluate(([r, i]) => (window as unknown as HarnessWindow).__maws_document.blockText(r, i), [which, id] as const);
const json = (page: Page, which: Replica) => page.evaluate((r) => JSON.stringify((window as unknown as HarnessWindow).__maws_document.json(r)), which);

const replica = (page: Page, which: Replica): Locator => page.locator(`[data-replica="${which}"]`);
const toolbar = (page: Page, which: Replica): Locator => replica(page, which).getByRole('toolbar', { name: 'Formatting' });
const content = (page: Page, which: Replica): Locator => replica(page, which).locator('.ProseMirror[data-editor="live"]');
// M9 (fix wave): a version is drawn by a read-only editor of its own beside the live one, which stays bound, hidden
const previewContent = (page: Page, which: Replica): Locator => replica(page, which).locator('.ProseMirror[data-editor="preview"]');

// A 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test.describe('the document editor', () => {
  test.skip(!HARNESS_BUILT, 'needs the harness build: pnpm e2e:document');
  test.describe.configure({ mode: 'serial' });

  let maws: MawsLaunch;
  let pageErrors: string[] = [];
  test.beforeAll(async () => {
    maws = await launchMaws();
    maws.page.on('pageerror', (error) => pageErrors.push(error.message));
    await maws.page.evaluate(() => {
      location.hash = 'document';
    });
    await maws.page.waitForFunction(() => (window as unknown as Partial<HarnessWindow>).__maws_document?.ready() === true);
  });
  test.afterAll(async () => {
    await maws?.cleanup();
  });
  test.beforeEach(async () => {
    pageErrors = [];
    const before = await maws.page.evaluate(() => {
      const api = (window as unknown as HarnessWindow).__maws_document;
      const generation = api.generation();
      api.reset();
      return generation;
    });
    await maws.page.waitForFunction((g) => {
      const api = (window as unknown as Partial<HarnessWindow>).__maws_document;
      return api !== undefined && api.generation() > g && api.ready();
    }, before);
  });
  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test('typing in one replica shows in the other', async () => {
    const { page } = maws;
    await content(page, 'a').getByText('The owner types here.').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Typed by hand.');
    await expect.poll(() => blockText(page, 'b', 'para0001')).toBe('The owner types here. Typed by hand.');
    await expect(content(page, 'b')).toContainText('Typed by hand.');
  });

  test('highlight fills the text background and its toolbar sample follows the same live colors', async () => {
    const { page } = maws;
    await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.selectText('a', 'para0001', 'owner'));
    await toolbar(page, 'a').getByRole('button', { name: 'Highlight', exact: true }).click();
    const paint = () => replica(page, 'a').evaluate((root) => {
      const mark = root.querySelector('mark')!;
      const sample = root.querySelector('[data-highlight-sample]')!;
      return { background: getComputedStyle(mark).backgroundColor, shadow: getComputedStyle(mark).boxShadow, sample: getComputedStyle(sample).backgroundColor };
    });
    const before = await paint();
    expect(before.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(before.shadow).toBe('none');
    expect(before.sample).toBe(before.background);
    await replica(page, 'a').evaluate(root => (root as HTMLElement).style.setProperty('--ds-color-accent', '#2864bb'));
    const after = await paint();
    expect(after.background).not.toBe(before.background);
    expect(after.sample).toBe(after.background);
  });

  test('the toolbar inserts every block kind, each drawn and edited in place', async () => {
    const { page } = maws;
    const bar = toolbar(page, 'a');
    const press = (name: string) => bar.getByRole('button', { name, exact: true }).click();
    const insert = async (item: string) => {
      await press('Insert');
      await bar.getByRole('menuitem', { name: item, exact: true }).click();
    };
    const line = () => page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.newLineAtEnd('a'));
    const typing = (text: string) => page.keyboard.type(text);
    const a = content(page, 'a');

    await line();
    await bar.getByRole('combobox', { name: 'Block style' }).selectOption('h2');
    await typing('A section');
    for (const [button, word] of [
      ['Bulleted list', 'bullet'],
      ['Numbered list', 'number'],
      ['Checklist', 'task'],
    ] as const) {
      await line();
      await press(button);
      await typing(`${word} one`);
      await page.keyboard.press('Enter');
      await typing(`${word} two`);
    }
    await line();
    await press('Quote');
    await typing('Quoted words');
    await line();
    await press('Code block');
    await bar.getByRole('combobox', { name: 'Code language' }).selectOption('javascript');
    await content(page, 'a').locator('pre').click();
    await page.keyboard.press('End');
    await typing('const answer = 42;');
    await expect.poll(() => a.locator('pre .doc-code-token').count()).toBeGreaterThan(2); // shiki's tokens

    await line();
    await insert('Table');
    await typing('cell one');
    await page.keyboard.press('Tab');
    await typing('cell two');
    await press('Add row below');
    await expect(a.locator('table tr')).toHaveCount(4);

    await line();
    await insert('Divider');
    await line();
    await insert('Callout');
    await typing('Mind the gap');
    await a.getByRole('combobox', { name: 'Callout tone' }).selectOption('warn');
    await expect(a.locator('[data-callout-tone="warn"]')).toContainText('Mind the gap');

    await line();
    await insert('Math');
    await typing('e^{i\\pi}+1=0');
    await page.keyboard.press('Enter');
    await expect(a.locator('[data-node="math"] .katex')).toBeVisible();
    await line();
    await insert('Equation');
    await typing('a^2+b^2=c^2');
    await page.keyboard.press('Escape');
    await expect(a.locator('[data-node="mathBlock"] .katex-display')).toBeVisible();
    await line();
    await insert('Diagram');
    await page.keyboard.press('Escape');
    await expect(a.locator('[data-node="diagram"] svg')).toBeVisible({ timeout: 15_000 }); // mermaid, loaded on first use
    await line();
    await insert('Pending section');
    await typing('Results');
    await page.keyboard.press('Enter');
    await expect(a.locator('[data-node="pending"]')).toContainText('Results');

    await line();
    await insert('Date');
    await page.keyboard.press('Escape');
    await insert('Mention');
    await page.keyboard.press('Escape');
    await insert('Status');
    await a.getByRole('combobox', { name: 'Status' }).selectOption('Done');
    await expect(a.locator('[data-node="mention"]')).toContainText('@Owner');

    await line();
    await replica(page, 'a').getByLabel('Image file').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG });
    await expect.poll(() => a.locator('[data-node="image"] img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(1);

    const shown = await json(page, 'a');
    for (const type of ['heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'table', 'horizontalRule', 'callout', 'math', 'mathBlock', 'diagram', 'pending', 'date', 'mention', 'dropdown', 'image']) {
      expect(shown, type).toContain(`"type":"${type}"`);
    }
    for (const text of ['bullet two', 'number two', 'task two', 'cell two', '"tone":"warn"', '"latex":"e^{i\\\\pi}+1=0"', '"intent":"Results"', '"value":"Done"']) expect(shown).toContain(text);
    await expect.poll(() => json(page, 'b')).toBe(shown);
    await expect.poll(() => page.evaluate(() => JSON.stringify((window as unknown as HarnessWindow).__maws_document.hostJson()))).toBe(shown);
  });

  test('a tab is added in one replica, switched to, and seen by the other', async () => {
    const { page } = maws;
    await addDocumentSection(replica(page, 'a'));
    await expect(replica(page, 'a').getByRole('tab', { selected: true })).toHaveText('Tab 2');
    await expect(content(page, 'a')).toHaveText('');
    await content(page, 'a').click();
    await page.keyboard.type('The second tab');
    await expect(replica(page, 'b').getByRole('tab')).toHaveText(['Notes', 'Tab 2']);
    await replica(page, 'b').getByRole('tab', { name: 'Tab 2' }).click();
    await expect(content(page, 'b')).toHaveText('The second tab');
    await replica(page, 'a').getByRole('tab', { name: 'Notes' }).click();
    await expect(content(page, 'a')).toContainText('Field notes');

    // P3-F (the owner's observation 3): a tab's own context menu acts on the tab right-clicked, not the active one
    await replica(page, 'a').getByRole('tab', { name: 'Tab 2' }).click({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Move left' }).click();
    await expect(replica(page, 'a').getByRole('tab')).toHaveText(['Tab 2', 'Notes']);
    await expect(replica(page, 'a').getByRole('tab', { selected: true })).toHaveText('Notes');
    await expect(replica(page, 'b').getByRole('tab')).toHaveText(['Tab 2', 'Notes']);
    // and its ×: an empty tab goes without asking, the selection moving on
    await addDocumentSection(replica(page, 'a'));
    await expect(replica(page, 'a').getByRole('tab', { selected: true })).toHaveText('Tab 3');
    await replica(page, 'a').getByRole('tab', { name: 'Tab 3' }).getByRole('button', { name: 'Delete Tab 3' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(replica(page, 'a').getByRole('tab')).toHaveText(['Tab 2', 'Notes']);
    await expect(replica(page, 'b').getByRole('tab')).toHaveText(['Tab 2', 'Notes']);
  });

  // P3-F (sitting candidate 17): Tab from a table's last cell, ending in a date chip, adds a row, and the next typing lands
  // in the new row's first cell (it landed after the chip of the row above)
  test('Tab from a table’s last cell adds a row and the next typing lands in its first cell', async () => {
    const { page } = maws;
    const bar = toolbar(page, 'a');
    const insert = async (item: string) => {
      await bar.getByRole('button', { name: 'Insert', exact: true }).click();
      await bar.getByRole('menuitem', { name: item, exact: true }).click();
    };
    await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.newLineAtEnd('a'));
    await insert('Table');
    const rows = content(page, 'a').locator('table tr');
    await expect(rows).toHaveCount(3);
    const last = rows.nth(2).locator('td').last();
    await last.click();
    await insert('Date');
    await page.keyboard.press('Escape');
    await expect(last.locator('[data-node="date"]')).toHaveCount(1);
    // the caret after the chip, as the owner's was
    const box = (await last.locator('p').boundingBox())!;
    await last.locator('p').click({ position: { x: box.width - 2, y: box.height / 2 } });
    await page.keyboard.press('Tab');
    await page.keyboard.type('Reviewer');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(3).locator('td').first()).toHaveText('Reviewer');
    await expect(rows.nth(2)).not.toContainText('Reviewer');
  });

  test('find highlights the matches and steps to the second', async () => {
    const { page } = maws;
    await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.caretAtEnd('a', 'title001'));
    await page.keyboard.press('ControlOrMeta+f');
    const search = replica(page, 'a').getByRole('searchbox', { name: 'Find in document' });
    await search.fill('river');
    const count = replica(page, 'a').locator('.doc-find-count');
    await expect(count).toHaveText('1 of 2');
    await expect(content(page, 'a').locator('.find-match')).toHaveCount(2);
    await search.press('Enter');
    await expect(count).toHaveText('2 of 2');
    await expect(content(page, 'a').locator('.find-match').nth(1)).toHaveClass(/find-match-current/);
    await search.press('Escape');
    await expect(content(page, 'a').locator('.find-match')).toHaveCount(0);
  });

  test('Korean composed in one replica lands exactly while the other types elsewhere', async () => {
    const { page } = maws;
    const TYPED = ' 안녕하세요 한글 입력 테스트입니다';
    await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.caretAtEnd('a', 'para0001'));
    const cdp = await page.context().newCDPSession(page);
    try {
      await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.startRemoteTyping('para0003', 'xyz', 45));
      const steps = keystrokes(TYPED);
      for (const step of steps) await imeStep(cdp, step, steps);
    } finally {
      await cdp.detach();
    }
    await page.waitForTimeout(300);
    const remote = await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.stopRemoteTyping());
    expect(remote.length).toBeGreaterThan(10); // the other replica typed throughout
    const expected = `The owner types here.${TYPED}`;
    await expect.poll(() => blockText(page, 'a', 'para0001')).toBe(expected);
    await expect.poll(() => blockText(page, 'b', 'para0001')).toBe(expected);
    await expect.poll(() => blockText(page, 'a', 'para0003')).toBe(`The collaborator types here.${remote}`);
    await expect.poll(async () => (await json(page, 'a')) === (await json(page, 'b'))).toBe(true);
  });

  // M4: a passage commented in replica A opens P2's card on the artifact target in A's editor, pinned under the mark;
  // replica B highlights the passage; the card's Resolve hides the highlight on both (the mark stays in the text) and
  // the rail's Reopen brings it back. The real-coordinate drag-move and the OS pasteboard are M9's.
  test('a commented passage opens the card under its mark, and Resolve hides the mark on both replicas', async () => {
    const { page } = maws;
    const QUOTE = 'river runs north';
    await page.evaluate(([id, text]) => (window as unknown as HarnessWindow).__maws_document.selectText('a', id, text), ['para0002', QUOTE] as const);
    await toolbar(page, 'a').getByRole('button', { name: 'Add comment', exact: true }).click();

    const card = replica(page, 'a').locator('[data-comment-card]');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-anchor-kind', 'artifact-comment');
    await expect(card).toHaveAttribute('data-anchor-locator', QUOTE);
    await expect(card.getByRole('heading')).toHaveText('Field notes'); // P4-B1 (tracker L275): a one-tab document names no tab
    // the host's doc has the thread once replica A's update arrived over its port (as the next case reads it)
    const hostThreads = () => page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.threads());
    await expect.poll(async () => (await hostThreads()).length, { message: 'the new thread at the host' }).toBe(1);
    const threads = await hostThreads();
    expect(threads).toEqual([{ id: expect.any(String), status: 'open', quote: QUOTE, messages: [] }]);
    const threadId = threads[0]!.id;

    // P4-B1: the card is hosted in the margin's stack at the passage's first line (the two replicas side by side leave
    // no side space, so the margin is the icon rail and the compose card sits in its overlay over the icon); before
    // P4-B1 it was anchored 4 px under the passage over the frame
    const mark = content(page, 'a').locator(`[data-thread="${threadId}"]`).first();
    await expect(mark).toHaveText(QUOTE);
    await expect(content(page, 'a').locator(`.comment-active.comment-${threadId}`)).toHaveText(QUOTE); // the display's decoration
    const margin = replica(page, 'a').getByRole('region', { name: 'Comments' });
    await expect(margin.locator('[data-margin-entry][data-compose] [data-comment-card]')).toBeVisible();
    const line = await mark.evaluate((el) => {
      const r = el.getClientRects()[0]!;
      return { left: r.left, top: r.top };
    });
    // the stack's moves animate (350 ms), so the card is read once it has settled at the line
    await expect.poll(async () => Math.abs((await card.boundingBox())!.y - line.top - CARD_INSET_PX), { message: 'the compose card at the passage’s first line' }).toBeLessThanOrEqual(2);
    // P4-B1 (the fix wave): with less side space than the icon rail's 33 px past the page gutter, the rail hangs over
    // the page's padding without moving the page: the page at the box's left edge, the icon and the card inside it (the
    // rail moved by a negative margin had pushed the page right and both past the box's right edge)
    const across = await replica(page, 'a')
      .locator('.ds-doc')
      .evaluate((box) => {
        const outer = box.getBoundingClientRect();
        const pageBox = box.querySelector('.ds-doc-page')!.getBoundingClientRect();
        const rightOf = (selector: string) => box.querySelector(selector)!.getBoundingClientRect().right;
        return {
          side: box.clientWidth - pageBox.width,
          left: outer.left + box.clientLeft,
          right: outer.left + box.clientLeft + box.clientWidth,
          page: pageBox.left,
          icon: rightOf('[data-margin-entry][data-compose] .doc-margin-icon'),
          card: rightOf('[data-margin-entry][data-compose] [data-comment-card]'),
        };
      });
    if (across.side < 33) {
      expect(Math.abs(across.page - across.left), 'the page at the box’s left edge').toBeLessThanOrEqual(1);
      expect(across.icon, 'the icon inside the box').toBeLessThanOrEqual(across.right + 1);
      expect(across.card, 'the compose card inside the box').toBeLessThanOrEqual(across.right + 1);
    }
    await expect(content(page, 'b').locator(`.comment-${threadId}`)).toHaveText(QUOTE);

    await card.getByRole('button', { name: 'Resolve' }).click();
    await expect(card).toHaveCount(0);
    await expect(content(page, 'a').locator(`.comment-${threadId}`)).toHaveCount(0);
    await expect(content(page, 'b').locator(`.comment-${threadId}`)).toHaveCount(0);
    await expect(content(page, 'b').locator(`[data-thread="${threadId}"]`)).toHaveText(QUOTE); // the mark stays in the text
    expect((await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.threads()))[0]!.status).toBe('resolved');

    await toolbar(page, 'b').getByRole('button', { name: /^Comments/ }).click();
    const resolved = replica(page, 'b').getByRole('region', { name: 'Resolved (1)' });
    await expect(resolved.getByRole('group')).toHaveAttribute('data-thread', threadId); // P4-B1: X36's card is a group
    await resolved.getByRole('button', { name: 'Reopen' }).click();
    await expect(content(page, 'a').locator(`.comment-${threadId}`)).toHaveText(QUOTE);
    await expect(content(page, 'b').locator(`.comment-${threadId}`)).toHaveText(QUOTE);
  });

  // M4's fix wave, re-read for P4-B1's margin: in replica B a click on the passage A commented draws its thread active
  // in B's margin (the two replicas side by side leave no side space beside the page, so the margin is the icon rail
  // and the active thread's card is overlaid over its icon); a reply typed there lands in the thread (the host's and
  // A's panel); a click on plain text draws none and the overlaid card goes.
  test('a click on a highlighted passage draws its thread active in the margin, whose card takes a reply', async () => {
    const { page } = maws;
    const QUOTE = 'river runs north';
    await page.evaluate(([id, text]) => (window as unknown as HarnessWindow).__maws_document.selectText('a', id, text), ['para0002', QUOTE] as const);
    await toolbar(page, 'a').getByRole('button', { name: 'Add comment', exact: true }).click();
    // the thread is read from the host's doc, which has it once replica A's update arrived over its port
    const threads = () => page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.threads());
    await expect.poll(async () => (await threads()).length, { message: 'the new thread at the host' }).toBe(1);
    const threadId = (await threads())[0]!.id;
    const passage = content(page, 'b').locator(`.comment-${threadId}`);
    await expect(passage).toHaveText(QUOTE);
    await expect(content(page, 'b').locator('.comment-active')).toHaveCount(0);

    await passage.click();
    await expect(content(page, 'b').locator(`.comment-active.comment-${threadId}`)).toHaveText(QUOTE);
    const margin = replica(page, 'b').getByRole('region', { name: 'Comments' });
    await expect(margin).toHaveAttribute('data-margin-tier', 'icons'); // 800 px per replica: no side space beside the page
    await expect(replica(page, 'b').getByRole('complementary', { name: 'Comments' })).toHaveCount(0); // the panel stays closed
    const card = margin.locator(`.doc-margin-overlay [data-thread="${threadId}"]`);
    await expect(card).toHaveAttribute('aria-current', 'true');

    await card.getByRole('textbox', { name: 'Reply' }).fill('Which river?');
    await card.getByRole('textbox', { name: 'Reply' }).press('Enter');
    await expect(card.getByRole('listitem')).toHaveText(['YouWhich river?']);
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.threads()))[0]!.messages).toEqual(['Which river?']);
    await toolbar(page, 'a').getByRole('button', { name: /^Comments/ }).click();
    await expect(replica(page, 'a').locator(`article[data-thread="${threadId}"]`).getByRole('listitem')).toHaveText(['YouWhich river?']);

    await content(page, 'b').getByText('The collaborator types here.').click();
    await expect(content(page, 'b').locator('.comment-active')).toHaveCount(0);
    await expect(margin.locator('.doc-margin-overlay')).toHaveCount(0);
  });

  // P4-B1 (the P4 spec §2 item 1; the prior art's P1, L2, R1, R2, R3, N6): the replicas stacked, each the window's
  // width, so the margin has room for cards. A's two threads are cards at their passages' lines; the agent's reply
  // grows the first card and the second is pushed down while the active thread stays; the owner's Enter above both
  // moves both cards down by one line, with the stack's own layout, not a scroll's; resolving the last thread un-reserves
  // the margin and the page centres again.
  test('margin: an agent reply grows a card while the owner types, the stack re-laid, the active thread unchanged', async () => {
    const { page } = maws;
    await page.evaluate(() => {
      location.hash = 'document-stack';
    });
    await page.waitForFunction(() => (window as unknown as Partial<HarnessWindow>).__maws_document?.ready() === true);
    const api = () => (window as unknown as HarnessWindow).__maws_document;
    const threads = () => page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.threads());
    const margin = replica(page, 'a').getByRole('region', { name: 'Comments' });
    const pageBox = async () => (await replica(page, 'a').locator('.ds-doc-page').boundingBox())!;
    const centredLeft = (await pageBox()).x;

    // a kept thread on each of two passages (the card's Resolve keeps it; Reopen from the panel brings it back)
    const keep = async (id: string, quote: string): Promise<string> => {
      const before = new Set((await threads()).map((t) => t.id));
      await page.evaluate(([blockId, text]) => (window as unknown as HarnessWindow).__maws_document.selectText('a', blockId, text), [id, quote] as const);
      await toolbar(page, 'a').getByRole('button', { name: 'Add comment', exact: true }).click();
      const card = replica(page, 'a').locator('[data-comment-card]');
      await expect(card).toBeVisible();
      await expect(margin.locator('[data-margin-entry][data-compose] [data-comment-card]'), 'the compose card hosted in the margin').toBeVisible();
      await card.getByRole('button', { name: 'Resolve' }).click();
      await expect(card).toHaveCount(0);
      const threadId = (await threads()).find((t) => !before.has(t.id))!.id;
      await toolbar(page, 'a').getByRole('button', { name: /^Comments/ }).click();
      const panel = replica(page, 'a').getByRole('complementary', { name: 'Comments' });
      await panel.locator(`article[data-thread="${threadId}"]`).getByRole('button', { name: 'Reopen' }).click();
      await toolbar(page, 'a').getByRole('button', { name: /^Comments/ }).click();
      await expect(panel).toHaveCount(0);
      return threadId;
    };
    // two lines between the two passages (three line pitches): the compact cards fit at their lines, the active card
    // with the agent's reply does not, so the reply's growth pushes the second
    await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.caretAtEnd('a', 'para0002'));
    for (const line of ['Agenda item one.', 'Agenda item two.']) {
      await page.keyboard.press('Enter');
      await page.keyboard.type(line);
    }
    await expect(content(page, 'a').locator('p')).toHaveCount(5);
    const t1 = await keep('para0002', 'river runs north');
    const t2 = await keep('para0003', 'collaborator types');
    await expect(margin).toHaveAttribute('data-margin-tier', 'cards');
    const entry = (id: string) => margin.locator(`[data-margin-entry="${id}"]`);
    await expect(entry(t1)).toBeVisible();
    await expect(entry(t2)).toBeVisible();
    // N6 as Docs (LC-1 item 6): the page and the column's reserve centre as one unit, so the page moved left by half the
    // reserve; each card sits the page gutter from the page
    const reserve = await margin.evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--doc-margin-reserve')));
    expect(reserve, 'the margin reserved').toBeGreaterThan(0);
    const moved = await pageBox();
    expect(Math.abs(centredLeft - moved.x - reserve / 2), 'the page moved left by half the reserve (N6)').toBeLessThanOrEqual(1);
    const entryLeft = async (id: string) => (await entry(id).boundingBox())!.x;
    expect(Math.abs((await entryLeft(t1)) - (moved.x + moved.width) - PAGE_GUTTER_PX), 'the card at the page gutter').toBeLessThanOrEqual(1);

    // P1: each card's top at its passage's first line
    const lineTop = (id: string) => content(page, 'a').locator(`[data-thread="${id}"]`).first().evaluate((el) => el.getClientRects()[0]!.top);
    const entryTop = async (id: string) => (await entry(id).boundingBox())!.y;
    expect(Math.abs((await entryTop(t1)) - (await lineTop(t1)) - CARD_INSET_PX)).toBeLessThanOrEqual(2);
    expect(Math.abs((await entryTop(t2)) - (await lineTop(t2)) - CARD_INSET_PX)).toBeLessThanOrEqual(2);

    // the first thread active by its passage; the agent's long reply grows its card and pushes the second down (R2, R3)
    await content(page, 'a').locator(`.comment-${t1}`).click();
    await expect(entry(t1)).toHaveAttribute('data-active', '');
    // LC-1 item 2: the active card is not shifted sideways; it is raised (the floating shadow), the inactive one flat
    expect(Math.abs((await entryLeft(t1)) - (await entryLeft(t2))), 'the active card in the column').toBeLessThanOrEqual(1);
    await expect(entry(t1).locator(`[data-thread="${t1}"]`)).not.toHaveCSS('box-shadow', 'none');
    await expect(entry(t2).locator(`[data-thread="${t2}"]`)).toHaveCSS('box-shadow', 'none');
    const t2Before = await entryTop(t2);
    const h1Before = (await entry(t1).boundingBox())!.height;
    await page.evaluate(([id, text]) => (window as unknown as HarnessWindow).__maws_document.agentReply(id, text), [t1, 'A reply long enough to grow the card by several lines, so the next card in the stack is pushed down while the owner keeps the first thread active.'] as const);
    await expect.poll(async () => (await entry(t1).boundingBox())!.height, { message: 'the card grew' }).toBeGreaterThan(h1Before + 20);
    await expect(entry(t1)).toHaveAttribute('data-active', '');
    await expect(content(page, 'a').locator(`.comment-active.comment-${t1}`)).toHaveCount(1);
    expect(Math.abs((await entryTop(t1)) - (await lineTop(t1)) - CARD_INSET_PX), 'the active card stays at its anchor').toBeLessThanOrEqual(2);
    await expect.poll(() => entryTop(t2), { message: 'the second card pushed below the grown first' }).toBeGreaterThan(t2Before + 20);

    // R1: the owner's Enter above both passages moves both cards with their lines
    const [a1, a2] = [await lineTop(t1), await lineTop(t2)];
    await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.caretAtEnd('a', 'para0001'));
    await page.keyboard.press('Enter');
    await expect.poll(() => lineTop(t1)).toBeGreaterThan(a1 + 10);
    await expect.poll(async () => Math.abs((await entryTop(t1)) - (await lineTop(t1)) - CARD_INSET_PX), { message: 'the first card follows its line' }).toBeLessThanOrEqual(2);
    expect((await lineTop(t2)) - a2).toBeGreaterThan(10);
    await expect(entry(t1)).toHaveAttribute('data-active', '');

    // Z1, N6: resolving both from the cards un-reserves the margin; the page centres again
    for (const id of [t2, t1]) {
      await entry(id).getByRole('button', { name: 'Resolve' }).click();
      await expect(entry(id)).toHaveCount(0);
    }
    await expect.poll(async () => (await pageBox()).x, { message: 'the page centred again' }).toBeGreaterThan(centredLeft - 2);
    await page.evaluate(() => {
      location.hash = 'document';
    });
    await page.waitForFunction(() => (window as unknown as Partial<HarnessWindow>).__maws_document?.ready() === true);
    void api;
  });

  // M5: version history in replica A. An agent session's turn is previewed in place, read-only, in the agent's author
  // colour with its change counted and reached by ↓; the owner then restores the draft before it: history is left, the
  // banner names the version, and both replicas show the restored text. Make a copy asks for the version shown.
  test('version history: an agent’s turn previewed in its colour, a copy made, the earlier draft restored', async () => {
    const { page } = maws;
    const ADDED = ' The agent added this.';
    await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.version('named', 'owner', { label: 'Clean draft' }));
    await page.evaluate((text) => (window as unknown as HarnessWindow).__maws_document.agentAppend('para0002', text), ADDED);
    await expect.poll(() => blockText(page, 'a', 'para0002')).toBe(`The river runs north; the river is cold.${ADDED}`);
    await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.version('turn', 'agent', { label: 'Agent revision' }));

    await toolbar(page, 'a').getByRole('button', { name: 'Version history' }).click();
    const rail = replica(page, 'a').getByRole('complementary', { name: 'Version history' });
    const today = rail.getByRole('region', { name: 'Today' });
    await today.getByRole('button', { name: /^Version Agent revision by / }).click();
    const bar = replica(page, 'a').getByRole('toolbar', { name: 'Version preview' });
    await expect(bar.getByText('1 change', { exact: true })).toBeVisible();
    const inserted = previewContent(page, 'a').locator('.doc-change-ins');
    await expect(inserted).toHaveText(ADDED);
    await expect(inserted).toHaveAttribute('style', /--doc-author: var\(--author-\d\)/);
    expect(await inserted.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain('underline');
    await expect(previewContent(page, 'a')).toHaveAttribute('contenteditable', 'false');
    await expect(content(page, 'a')).toBeHidden(); // the live editor, bound, out of sight
    await bar.getByRole('button', { name: 'Next change' }).click();
    await expect(previewContent(page, 'a').locator('.doc-change-current')).toHaveText(ADDED);
    await expect(content(page, 'b')).toHaveAttribute('contenteditable', 'true'); // the other replica stays live

    await rail.getByRole('button', { name: /^Version Clean draft/ }).click();
    await expect(bar.getByText(/^Clean draft/)).toBeVisible();
    await bar.getByRole('button', { name: 'Make a copy' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.copies().length)).toBe(1);
    await bar.getByRole('button', { name: 'Restore this version' }).click();
    await replica(page, 'a').getByRole('alertdialog', { name: 'Restore this version?' }).getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(replica(page, 'a').getByRole('status', { name: 'Restored' })).toContainText('Restored from Clean draft');
    await expect(content(page, 'a')).toBeVisible();
    await expect(previewContent(page, 'a')).toHaveCount(0);
    await expect(content(page, 'a')).toHaveAttribute('contenteditable', 'true');
    await expect.poll(() => blockText(page, 'a', 'para0002')).toBe('The river runs north; the river is cold.');
    await expect.poll(() => blockText(page, 'b', 'para0002')).toBe('The river runs north; the river is cold.');
    await expect(replica(page, 'b').getByRole('status', { name: 'Restored' })).toContainText('Restored from Clean draft');
  });

  // P3-F (sitting candidate 13): the app's preflight takes every list's markers away; the page gives them back
  test('bulleted and numbered lists draw their markers, a checklist its boxes alone', async () => {
    const { page } = maws;
    const bar = toolbar(page, 'a');
    for (const button of ['Bulleted list', 'Numbered list', 'Checklist']) {
      await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.newLineAtEnd('a'));
      await bar.getByRole('button', { name: button, exact: true }).click();
      await page.keyboard.type(`${button} item`);
    }
    const marker = (selector: string) => content(page, 'a').locator(selector).first().evaluate((el) => getComputedStyle(el).listStyleType);
    expect(await marker('ul:not([data-type="taskList"])')).toBe('disc');
    expect(await marker('ol')).toBe('decimal');
    expect(await marker('ul[data-type="taskList"]')).toBe('none');
  });

  // P3-F (sitting candidates 14 and 16): an atom inserted while the keyboard is outside the page (here on the toolbar's
  // Block style) keeps the keyboard in its field, so the next keys write its content, not the paragraph's text
  test('an atom inserted from the toolbar takes the next keys in its field, wherever the keyboard was', async () => {
    const { page } = maws;
    const bar = toolbar(page, 'a');
    await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.newLineAtEnd('a'));
    await page.keyboard.type('Euler: ');
    await bar.getByRole('combobox', { name: 'Block style' }).focus();
    await bar.getByRole('button', { name: 'Insert', exact: true }).click();
    await bar.getByRole('menuitem', { name: 'Math', exact: true }).click();
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', 'LaTeX');
    await page.keyboard.type('E=mc^2');
    await page.keyboard.press('Enter');
    await expect(content(page, 'a').locator('[data-node="math"] .katex').last()).toBeVisible();
    const shown = await json(page, 'a');
    expect(shown).toContain('"latex":"E=mc^2"');
    expect(shown).not.toContain('Euler: E=mc^2');
  });

  // P3-F (sitting candidate 20): a diagram follows its page's palette. Drawn in the dark app on a page without a system
  // (a dark page), it is drawn again once a light system's stylesheet arrives, its boxes on the page's light ground
  test('a diagram is drawn again in its page’s palette when the page’s system arrives after it', async () => {
    const { page } = maws;
    const bar = toolbar(page, 'a');
    await page.evaluate(() => void (document.documentElement.dataset.theme = 'dark'));
    try {
      await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.newLineAtEnd('a'));
      await bar.getByRole('button', { name: 'Insert', exact: true }).click();
      await bar.getByRole('menuitem', { name: 'Diagram', exact: true }).click();
      await page.keyboard.press('Escape');
      const box = content(page, 'a').locator('[data-node="diagram"] svg .node rect').first();
      await expect(box).toBeVisible({ timeout: 15_000 }); // mermaid, loaded on first use
      const fill = () => box.evaluate((el) => getComputedStyle(el).fill);
      const ground = await replica(page, 'a').locator('.ds-doc').evaluate((el) => getComputedStyle(el).backgroundColor);
      await expect.poll(fill).toBe(ground); // the dark page's own ground
      await page.evaluate(() => {
        const system = document.head.appendChild(document.createElement('style'));
        system.id = 'p3f-light-system';
        system.textContent = '.ds-doc { --ds-color-bg: rgb(250, 249, 246); --ds-color-text: rgb(31, 30, 27); }';
      });
      await expect.poll(fill, { timeout: 15_000 }).toBe('rgb(250, 249, 246)');
    } finally {
      await page.evaluate(() => {
        delete document.documentElement.dataset.theme;
        document.getElementById('p3f-light-system')?.remove();
      });
    }
  });

  // P3-F (sitting candidate 29): Show editors' list keeps its title on one line, its × at the header's far end, away from
  // the pointer that chose Show editors at the popover's corner
  test('Show editors lists the editors under a one-line title, its × away from the pointer', async () => {
    const { page } = maws;
    await page.evaluate(([id, text]) => (window as unknown as HarnessWindow).__maws_document.selectText('a', id, text), ['para0002', 'river runs north'] as const);
    const selection = await page.evaluate(() => {
      const box = getSelection()!.getRangeAt(0).getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    await page.mouse.click(selection.x, selection.y, { button: 'right' });
    const item = replica(page, 'a').getByRole('menuitem', { name: 'Show editors' });
    const choice = (await item.boundingBox())!;
    const pointer = { x: choice.x + choice.width / 2, y: choice.y + choice.height / 2 };
    await page.mouse.click(pointer.x, pointer.y);
    const dialog = replica(page, 'a').getByRole('dialog', { name: 'Editors' });
    await expect(dialog.getByText('Reading the history…')).toHaveCount(0, { timeout: 15_000 });
    const title = dialog.getByText('Editors of the selection', { exact: true });
    const line = await title.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.5);
    const titleBox = (await title.boundingBox())!;
    expect(titleBox.height).toBeLessThan(line * 1.5); // one line
    const close = (await dialog.getByRole('button', { name: 'Close editors' }).boundingBox())!;
    expect(close.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width);
    const under = pointer.x >= close.x && pointer.x <= close.x + close.width && pointer.y >= close.y && pointer.y <= close.y + close.height;
    expect(under, 'the × is not under the pointer').toBe(false);
    await dialog.getByRole('button', { name: 'Close editors' }).click();
    await expect(dialog).toHaveCount(0);
  });

  // P3-F (sitting candidate 16): Return in a new date chip's field commits its date and keeps the chip, the line whole,
  // and the typing after it lands right after the chip
  test('Return in a new date chip’s field keeps the chip, and the next typing lands after it', async () => {
    const { page } = maws;
    const bar = toolbar(page, 'a');
    await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.newLineAtEnd('a'));
    await page.keyboard.type('Due ');
    await bar.getByRole('combobox', { name: 'Block style' }).focus(); // the keyboard off the page, as the owner's was
    await bar.getByRole('button', { name: 'Insert', exact: true }).click();
    await bar.getByRole('menuitem', { name: 'Date', exact: true }).click();
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', 'Date');
    const lines = await content(page, 'a').locator('p').count();
    await page.keyboard.press('Enter');
    await page.keyboard.type(' later');
    await expect(content(page, 'a').locator('p')).toHaveCount(lines);
    const line = content(page, 'a').locator('p').last();
    await expect(line.locator('[data-node="date"]')).toHaveCount(1);
    await expect(line).toContainText('Due');
    await expect(line).toContainText('later');
    expect(await json(page, 'a')).toMatch(/"type":"date","attrs":\{"iso":"\d{4}-\d{2}-\d{2}"\}/);
  });

  // P3-F (sitting candidate 53): in the dark app a light page draws its native controls in the light scheme (an unticked
  // checklist box is no solid dark square), and a dark page in the dark one
  test('a page draws its checklist boxes in its own ground’s colour scheme, not the app’s', async () => {
    const { page } = maws;
    const bar = toolbar(page, 'a');
    await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.newLineAtEnd('a'));
    await bar.getByRole('button', { name: 'Checklist', exact: true }).click();
    await page.keyboard.type('Unticked');
    const sheet = replica(page, 'a').locator('.ds-doc');
    const box = content(page, 'a').locator('ul[data-type="taskList"] input[type="checkbox"]').last();
    const scheme = () => box.evaluate((el) => getComputedStyle(el).colorScheme);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
      const system = document.head.appendChild(document.createElement('style'));
      system.id = 'p3f-page-system';
      system.textContent = '.ds-doc { --ds-color-bg: rgb(250, 249, 246); --ds-color-text: rgb(31, 30, 27); }';
    });
    try {
      await expect(sheet).toHaveAttribute('data-ground', 'light');
      await expect.poll(scheme).toBe('light');
      await expect(box).not.toBeChecked();
      await page.evaluate(() => void (document.getElementById('p3f-page-system')!.textContent = '.ds-doc { --ds-color-bg: rgb(31, 30, 27); --ds-color-text: rgb(250, 249, 246); }'));
      await expect(sheet).toHaveAttribute('data-ground', 'dark');
      await expect.poll(scheme).toBe('dark');
    } finally {
      await page.evaluate(() => {
        delete document.documentElement.dataset.theme;
        document.getElementById('p3f-page-system')?.remove();
      });
    }
  });

  // P3-F (sitting candidate 11, F18, the architect's ruling): a link is the colour of its text with its underline, no
  // accent, hovered or not; hover thickens the underline
  test('a link takes its text’s colour, hover thickening its underline', async () => {
    const { page } = maws;
    const bar = toolbar(page, 'a');
    const WORDS = 'See the notes';
    await page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.newLineAtEnd('a'));
    await page.keyboard.type(WORDS);
    for (let i = 0; i < WORDS.length; i += 1) await page.keyboard.press('Shift+ArrowLeft');
    await bar.getByRole('button', { name: 'Link', exact: true }).click();
    const address = bar.getByRole('textbox', { name: 'Link address' });
    await address.fill('https://example.com/notes');
    await address.press('Enter');
    const link = content(page, 'a').locator('a[href="https://example.com/notes"]');
    await expect(link).toHaveText(WORDS);
    const text = await link.evaluate((el) => getComputedStyle(el.closest('p')!).color);
    const look = () =>
      link.evaluate((el) => {
        const style = getComputedStyle(el);
        return { color: style.color, underline: style.textDecorationColor, line: style.textDecorationLine, thickness: parseFloat(style.textDecorationThickness) || 0 };
      });
    const resting = await look();
    expect(resting).toMatchObject({ color: text, underline: text, line: 'underline' });
    await link.hover();
    await expect.poll(async () => (await look()).thickness).toBeGreaterThan(resting.thickness);
    expect(await look()).toMatchObject({ color: text, underline: text });
  });
});

// One step of S4's 2-set model, as S7b's ime scenario sends it (spikes/p3-store/s7/electron/main.ts, `imeStep`).
async function imeStep(cdp: CDPSession, step: Step, steps: Step[]): Promise<void> {
  switch (step.kind) {
    case 'key':
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229, key: step.key, code: step.code });
      break;
    case 'compose':
      await cdp.send('Input.imeSetComposition', { text: step.text, selectionStart: step.text.length, selectionEnd: step.text.length });
      break;
    case 'commit':
      await cdp.send('Input.insertText', { text: step.text });
      break;
    case 'plain':
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      break;
    case 'backspace':
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229, key: 'Backspace', code: 'Backspace' });
      break;
  }
  if (step.kind === 'compose') {
    const previous = steps
      .slice(0, steps.indexOf(step))
      .reverse()
      .find((s): s is Extract<Step, { kind: 'key' }> => s.kind === 'key');
    if (previous) await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: previous.keyCode, key: previous.key, code: previous.code });
  }
  // the owner's capture's pace: about 70 to 90 ms between jamo
  if (step.kind === 'compose' || step.kind === 'plain') await new Promise((resolve) => setTimeout(resolve, 60 + Math.random() * 30));
}
