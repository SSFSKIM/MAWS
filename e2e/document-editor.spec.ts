// P3-B's document editor end to end on the harness's `#document` page (M3 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md, its e2e "Proves"): two DocumentEditors over two replicas of one
// in-memory host document, each a real PortProvider on a real MessageChannel, in the built renderer. Typing, a toolbar
// insert of every block kind, a tab added and switched, find stepping to the second match, and the Korean composition
// drive (S7b's 2-set model through CDP, as S7b drove it) in replica A while replica B types elsewhere. `pnpm
// e2e:document` builds the harness and runs this file; under a plain build the cases skip. One launch for the file; the
// page's document is reset before each case.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import type { DocumentHarnessApi, Replica } from '../src/renderer/src/harness/document/api';
import { keystrokes, type Step } from './support/hangul';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';

const HARNESS_BUILT = !process.env.MAWS_E2E_EXECUTABLE && existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));

type HarnessWindow = Window & { __maws_document: DocumentHarnessApi };
// Each page.evaluate below reads the page's harness API itself: a function sent to the page closes over nothing here.
const blockText = (page: Page, which: Replica, id: string) => page.evaluate(([r, i]) => (window as unknown as HarnessWindow).__maws_document.blockText(r, i), [which, id] as const);
const json = (page: Page, which: Replica) => page.evaluate((r) => JSON.stringify((window as unknown as HarnessWindow).__maws_document.json(r)), which);

const replica = (page: Page, which: Replica): Locator => page.locator(`[data-replica="${which}"]`);
const toolbar = (page: Page, which: Replica): Locator => replica(page, which).getByRole('toolbar', { name: 'Formatting' });
const content = (page: Page, which: Replica): Locator => replica(page, which).locator('.ProseMirror');

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
    await maws.page.evaluate(() => (window as unknown as HarnessWindow).__maws_document.reset());
    await maws.page.waitForFunction(() => (window as unknown as Partial<HarnessWindow>).__maws_document?.ready() === true);
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
    await replica(page, 'a').getByRole('button', { name: 'Add tab' }).click();
    await expect(replica(page, 'a').getByRole('tab', { selected: true })).toHaveText('Tab 2');
    await expect(content(page, 'a')).toHaveText('');
    await content(page, 'a').click();
    await page.keyboard.type('The second tab');
    await expect(replica(page, 'b').getByRole('tab')).toHaveText(['Notes', 'Tab 2']);
    await replica(page, 'b').getByRole('tab', { name: 'Tab 2' }).click();
    await expect(content(page, 'b')).toHaveText('The second tab');
    await replica(page, 'a').getByRole('tab', { name: 'Notes' }).click();
    await expect(content(page, 'a')).toContainText('Field notes');
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
