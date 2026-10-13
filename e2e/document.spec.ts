// The document editor in the product app (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, "Proves (e2e,
// product)"; `pnpm e2e:document-app`, the product build, MAWS_HARNESS=0): a document the owner creates opens through L's
// registry in an `artifact` main tab and in the panel's Artifacts tool as two replicas of one host doc, each typing
// reaching the other; the X32 header says Saving… then All changes saved around a keystroke and Reconnecting… across a
// host restart, after which the typing still lands; History lists A's versions, Save version adds a named one, and
// Restore brings it back with the banner. The exporters run in main (through their e2e seam, until A's export service
// registers them) and write `.md`, `.html`, `.docx` and a `.pdf` beginning `%PDF-` with one page per tab on Letter and
// on A4; the header's Export menu reaches the host's export and says its answer in the header's action.
// M9 (Acceptance 3 and 4): commented text copied through the Mac's pasteboard pastes without a second comment, a cut and
// paste moves it, a real mouse drag keeps exactly one; A's restore brings back a deleted tab and the earlier text while
// a reply posted after the version stays and a thread made after it shows orphaned.
// Every launch's userData is its own directory under /tmp; windows are never shown (the e2e quiet mode).
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { withNativeClipboard } from './support/clipboard';
import { launchMaws, type MawsLaunch } from './support/launch';
import { sidebarRow } from './support/sidebar';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}
const hostState = (page: Page) => ok<{ state: string; pid: number | null }>(page, 'engine.hostState');

let launch: MawsLaunch | null = null;
let userData: string | null = null;
let scratch: string | null = null;

test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  for (const dir of [userData, scratch]) if (dir) rmSync(dir, { recursive: true, force: true });
  userData = scratch = null;
});

// The panel's harness scenario (C8a): two synthetic sessions main serves, so a session's panel can hold tools.
const SESSIONS = 'stub:test/fixtures/panel/harness-sessions.json';

async function start(): Promise<Page> {
  mkdirSync('/tmp/maws-harness/a', { recursive: true }); // session A's directory in the scenario
  userData = mkdtempSync('/tmp/maws-e2e-document-');
  launch = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: SESSIONS } });
  const { page } = launch;
  await expect.poll(async () => (await hostState(page)).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  return page;
}

// The owner's document, opened from the library in an `artifact` main tab.
async function openInMain(page: Page, title: string): Promise<{ id: string; main: Locator }> {
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'document', title });
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click({ timeout: 15_000 });
  const main = page.locator(`[data-artifact-tab="${artifact.id}"]`);
  await expect(main.locator('.ds-doc .ProseMirror')).toBeVisible({ timeout: 15_000 });
  return { id: artifact.id, main };
}

// The panel's Artifacts tool, added in a session's panel (tools belong to a session) and pinned, so it stays beside
// whatever the main area shows (an `artifact` tab is no session).
async function pinArtifactsTool(page: Page): Promise<void> {
  const panel = page.locator('[data-region="panel"]');
  await (await sidebarRow(page, 'Harness A')).click();
  await panel.getByRole('button', { name: 'Add a tool' }).click();
  await page.getByRole('menuitem', { name: 'Artifacts' }).click();
  await panel.getByRole('button', { name: 'Pin Artifacts' }).click();
}

// The document in the pinned Artifacts tool's record view.
async function openInPanel(page: Page, artifactId: string): Promise<Locator> {
  const panel = page.locator('[data-region="panel"]');
  await panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /^Artifacts/ }).click();
  await panel.getByRole('button', { name: 'All', exact: true }).click();
  await panel.locator(`[data-artifact-row][data-artifact-id="${artifactId}"]`).click({ timeout: 15_000 });
  const record = panel.locator(`[data-artifact-record="${artifactId}"]`);
  await expect(record.locator('.ds-doc .ProseMirror')).toBeVisible({ timeout: 15_000 });
  return record;
}

// Every text the header's saved word showed since this call, in order (a keystroke's "Saving…" lasts milliseconds).
async function watchSaved(page: Page, header: Locator): Promise<() => Promise<string[]>> {
  const handle = await header.elementHandle();
  await page.evaluate((row) => {
    const seen: string[] = [];
    (window as unknown as { __saved: string[] }).__saved = seen;
    const read = () => {
      const text = row!.querySelector('[data-header-saved]')?.textContent ?? '';
      if (seen.at(-1) !== text) seen.push(text);
    };
    read();
    new MutationObserver(read).observe(row!, { subtree: true, childList: true, characterData: true });
  }, handle);
  return () => page.evaluate(() => (window as unknown as { __saved: string[] }).__saved);
}

test('a document opens in a main tab and in the panel as two replicas; the header follows saves and a host restart; History saves, lists and restores', async () => {
  test.setTimeout(150_000);
  const page = await start();
  await pinArtifactsTool(page);
  const { id, main } = await openInMain(page, 'Launch plan');
  const record = await openInPanel(page, id);
  const mainText = main.locator('.ds-doc .ProseMirror');
  const panelText = record.locator('.ds-doc .ProseMirror');
  const mainHeader = page.locator('[data-region="main"] [data-editor-header]');
  const panelHeader = page.locator('[data-region="panel"] [data-editor-header]');
  await expect(mainHeader.locator('[data-header-title]')).toHaveText('Launch plan');
  await expect(panelHeader.locator('[data-header-title]')).toHaveText('Launch plan');

  await test.step('typing in one replica reaches the other, both ways', async () => {
    await mainText.click();
    await page.keyboard.type('Typed in the main tab.');
    await expect(panelText).toContainText('Typed in the main tab.', { timeout: 10_000 });
    await panelText.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' And in the panel.');
    await expect(mainText).toContainText('Typed in the main tab. And in the panel.', { timeout: 10_000 });
  });

  await test.step('the header says Saving… then All changes saved around a keystroke', async () => {
    await expect(mainHeader.locator('[data-header-saved]')).toHaveText('All changes saved', { timeout: 10_000 });
    const seen = await watchSaved(page, mainHeader);
    await mainText.click();
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await expect.poll(seen, { timeout: 10_000, message: 'saving, then saved' }).toEqual(['All changes saved', 'Saving…', 'All changes saved']);
  });

  await test.step('across a host restart the header says Reconnecting…, and what was typed meanwhile lands', async () => {
    const seen = await watchSaved(page, mainHeader);
    const { pid } = await hostState(page);
    process.kill(pid!, 'SIGKILL');
    await expect.poll(seen, { timeout: 10_000, message: 'reconnecting' }).toContain('Reconnecting…');
    await mainText.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Written while the host was down.');
    await expect.poll(async () => (await hostState(page)).pid, { timeout: 30_000, message: 'the host restarts' }).not.toBe(pid);
    await expect(mainHeader.locator('[data-header-saved]')).toHaveText('All changes saved', { timeout: 30_000 });
    await expect(panelText).toContainText('Written while the host was down.', { timeout: 30_000 });
  });

  await test.step('History lists A’s versions, Save version adds a named one, Restore brings it back with the banner', async () => {
    await mainHeader.getByRole('button', { name: 'Save version' }).click();
    const rail = main.getByRole('complementary', { name: 'Version history' });
    await rail.getByRole('textbox', { name: 'Version name' }).fill('Before the cut');
    await rail.getByRole('textbox', { name: 'What changed' }).fill('The draft as reviewed.');
    await rail.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(rail.getByRole('button', { name: /^Version Before the cut/ })).toBeVisible({ timeout: 10_000 });
    const listed = await ok<{ versions: { kind: string; label?: string; note?: string }[] }>(page, 'artifacts.versions', { artifactId: id });
    expect(listed.versions).toContainEqual(expect.objectContaining({ kind: 'named', label: 'Before the cut', note: 'The draft as reviewed.' }));
    // every version A keeps is a row once the folded runs are opened
    for (const fold of await rail.getByRole('button', { name: /^\d+ more versions?$/ }).all()) await fold.click();
    await expect(rail.getByRole('button', { name: /^Version / })).toHaveCount(listed.versions.length);

    // the rail closes from the header, then the text after the version goes and comes back by Restore
    await mainHeader.getByRole('button', { name: 'Version history' }).click();
    await expect(rail).toBeHidden();
    await mainText.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Doomed sentence.');
    await expect(panelText).toContainText('Doomed sentence.', { timeout: 10_000 });
    await expect(mainHeader.locator('[data-header-saved]')).toHaveText('All changes saved', { timeout: 10_000 });
    await mainHeader.getByRole('button', { name: 'Version history' }).click();
    await rail.getByRole('button', { name: /^Version Before the cut/ }).click();
    const bar = main.getByRole('toolbar', { name: 'Version preview' });
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await expect(mainHeader.locator('[data-header-saved]')).toHaveText('Read-only');
    await bar.getByRole('button', { name: 'Restore this version' }).click();
    await main.getByRole('alertdialog', { name: 'Restore this version?' }).getByRole('button', { name: 'Restore' }).click();
    await expect(main.getByRole('status', { name: 'Restored' })).toContainText('Restored from Before the cut', { timeout: 15_000 });
    await expect(mainText).not.toContainText('Doomed sentence.', { timeout: 15_000 });
    await expect(panelText).not.toContainText('Doomed sentence.', { timeout: 15_000 });
    await expect(mainText).toContainText('Written while the host was down.');
    const restored = await ok<{ versions: { kind: string; label?: string }[] }>(page, 'artifacts.versions', { artifactId: id });
    expect(restored.versions).toContainEqual(expect.objectContaining({ kind: 'restore', label: 'Restored from Before the cut' }));
  });
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

// The number of pages a PDF holds (Chromium writes each page object uncompressed) and its first page's size in points.
function pdfPages(bytes: Buffer): { pages: number; width: number; height: number } {
  const text = bytes.toString('latin1');
  const pages = text.match(/\/Type\s*\/Page(?![s\w])/g)?.length ?? 0;
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
  return { pages, width: Math.round(Number(box?.[1])), height: Math.round(Number(box?.[2])) };
}

test('the exporters write Markdown, HTML, DOCX and a paged PDF in main; the Export menu says the host’s answer', async () => {
  test.setTimeout(150_000);
  const page = await start();
  const { id, main } = await openInMain(page, 'Quarterly plan');
  const mainHeader = page.locator('[data-region="main"] [data-editor-header]');
  const mainText = main.locator('.ds-doc .ProseMirror');

  // three tabs, each a page of its own in print
  await mainText.click();
  await page.keyboard.type('The launch waits for the review.');
  for (const words of ['Budget notes for October.', '안녕하세요, 팀 여러분.']) {
    await main.getByRole('button', { name: 'Add tab' }).click();
    await expect(main.locator('.ds-doc .ProseMirror')).toHaveText('', { timeout: 10_000 });
    await main.locator('.ds-doc .ProseMirror').click();
    await page.keyboard.type(words);
  }
  await expect(mainHeader.locator('[data-header-saved]')).toHaveText('All changes saved', { timeout: 10_000 });

  // the Export menu reaches the host's export; its answer is said in the header's own action
  await mainHeader.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'PDF, A4 (.pdf)' }).click();
  await expect(mainHeader.getByRole('button', { name: /^PDF export failed: / })).toBeVisible({ timeout: 10_000 });

  // the state as of a version, through the exporters in main
  const { versionId } = await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'For export' });
  const state = await page.evaluate(
    async ([artifactId, version]) => {
      const result = (await (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<{ ok: boolean; value: { bytes: Uint8Array } }> } }).maws.invoke('artifacts.versionState', { artifactId, versionId: version })) as { ok: boolean; value: { bytes: Uint8Array } };
      let binary = '';
      for (const byte of result.value.bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    [id, versionId] as const,
  );
  scratch = mkdtempSync('/tmp/maws-e2e-document-export-');
  const exportTo = async (format: string, name: string, pageSize?: string) => {
    const path = join(scratch!, name);
    await launch!.app.evaluate(
      async (_electron, request) => (globalThis as unknown as { __maws_document_export: { export(r: unknown): Promise<void> } }).__maws_document_export.export(request),
      { title: 'Quarterly plan', state, format, path, ...(pageSize ? { pageSize } : {}) },
    );
    return readFileSync(path);
  };

  const md = (await exportTo('md', 'plan.md')).toString('utf8');
  expect(md).toContain('The launch waits for the review.');
  expect(md).toContain('안녕하세요, 팀 여러분.');
  expect(md).not.toMatch(/\^[0-9a-z]{8}/); // no block ids in the file

  const html = (await exportTo('html', 'plan.html')).toString('utf8');
  expect(html.startsWith('<!doctype html>')).toBe(true);
  expect(html).toContain('Budget notes for October.');
  expect(html).not.toContain('var(--ds-');

  const docx = await exportTo('docx', 'plan.docx');
  expect(docx.subarray(0, 2).toString('latin1')).toBe('PK');

  const letter = await exportTo('pdf', 'plan.pdf');
  expect(letter.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdfPages(letter)).toEqual({ pages: 3, width: 612, height: 792 }); // a tab a page, US Letter
  const a4 = await exportTo('pdf', 'plan-a4.pdf', 'a4');
  expect(pdfPages(a4)).toEqual({ pages: 3, width: 595, height: 842 }); // A4

  // a page far past a `data:` URL's 2 MB (a document's images are inlined) prints all the same
  const long = `<!doctype html><html><head><meta charset="utf-8"><style>@page { size: 8.5in 11in; margin: 1in; }</style></head><body>${'<p>The launch waits for the review of every line in this long appendix.</p>'.repeat(40_000)}</body></html>`;
  expect(long.length).toBeGreaterThan(3_000_000);
  const bigPath = join(scratch, 'long.pdf');
  await launch!.app.evaluate(async (_electron, [html, path]) => (globalThis as unknown as { __maws_document_export: { print(h: string, p: string): Promise<void> } }).__maws_document_export.print(html, path), [long, bigPath] as const);
  const big = readFileSync(bigPath);
  expect(big.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdfPages(big).pages).toBeGreaterThan(100);
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

// ---- M9: comments through the real pasteboard and a real drag, and restore with conversations ------------------------
// (docs/doperpowers/plans/2026-10-12-p3-b-documents.md, M9; Acceptance 3's clipboard and drag-move, Acceptance 4's
// restore.) A comment is offered while the main area shows a session (its card's Side thread and Send to main go
// there), so these cases open the document in the pinned Artifacts tool beside session A of the panel scenario. A new
// thread whose card closes with nothing sent in it is withdrawn, so each comment is kept the owner's way that needs no
// session to answer: Resolve on the card (kept on purpose), then Reopen from the Comments rail.

// The document in the panel's Artifacts tool beside session A, typed into: one paragraph per line.
async function openBesideSession(page: Page, title: string, lines: string[]): Promise<{ id: string; record: Locator; text: Locator }> {
  await pinArtifactsTool(page); // the main area shows Harness A
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'document', title });
  const record = await openInPanel(page, artifact.id);
  const text = record.locator('.ds-doc .ProseMirror');
  await text.click();
  for (const [k, line] of lines.entries()) {
    if (k > 0) await page.keyboard.press('Enter');
    await page.keyboard.type(line);
  }
  await expect(text.locator('p')).toHaveText(lines);
  return { id: artifact.id, record, text };
}

// Selects `quote` inside the editor's paragraph `index` (a DOM selection the editor reads, as a person's drag would set).
async function selectIn(text: Locator, index: number, quote: string): Promise<void> {
  await text.evaluate(
    (root, [at, q]) => {
      const p = root.querySelectorAll('p')[at as number]!;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
      const whole = nodes.map((n) => n.data).join('');
      const start = whole.indexOf(q as string);
      if (start < 0) throw new Error(`no "${q}" in paragraph ${at}: "${whole}"`);
      const point = (offset: number): [Text, number] => {
        let left = offset;
        for (const n of nodes) {
          if (left <= n.data.length) return [n, left];
          left -= n.data.length;
        }
        throw new Error('offset past the paragraph');
      };
      const range = document.createRange();
      range.setStart(...point(start));
      range.setEnd(...point(start + (q as string).length));
      (root as HTMLElement).focus();
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    },
    [index, quote] as const,
  );
  await expect.poll(() => text.evaluate(() => getSelection()?.toString() ?? '')).toBe(quote);
}

// The passage `quote` of paragraph `index` on screen: the left edge of its first character, the right edge of its last,
// and the line's middle.
const passageAt = (text: Locator, index: number, quote: string) =>
  text.evaluate(
    (root, [at, q]) => {
      const p = root.querySelectorAll('p')[at as number]!;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
      const start = nodes.map((n) => n.data).join('').indexOf(q as string);
      const charRect = (offset: number): DOMRect => {
        let left = offset;
        for (const n of nodes) {
          if (left < n.data.length) {
            const range = document.createRange();
            range.setStart(n, left);
            range.setEnd(n, left + 1);
            return range.getBoundingClientRect();
          }
          left -= n.data.length;
        }
        throw new Error('offset past the paragraph');
      };
      const first = charRect(start);
      const last = charRect(start + (q as string).length - 1);
      return { left: first.left, right: last.right, y: first.top + first.height / 2 };
    },
    [index, quote] as const,
  );

// The caret at the end of paragraph `index`.
async function caretAtEndOf(page: Page, text: Locator, index: number): Promise<void> {
  await text.locator('p').nth(index).click();
  await page.keyboard.press('End');
  await expect(text).toBeFocused();
  await expect.poll(() => text.evaluate((root, at) => {
    const selection = getSelection()!;
    const p = root.querySelectorAll('p')[at]!;
    return selection.isCollapsed && p.contains(selection.focusNode) && selection.focusOffset === (selection.focusNode?.textContent ?? '').length && p.textContent!.endsWith(selection.focusNode?.textContent ?? '');
  }, index)).toBe(true);
}

// The window's Edit command on the OS pasteboard, as ⌘C, ⌘X and ⌘V run it: the app menu's Edit roles (src/main/menu.ts)
// call these on the window's contents (a key event Playwright synthesizes reaches the page, never the menu).
async function edit(command: 'copy' | 'cut' | 'paste'): Promise<void> {
  await launch!.app.evaluate(({ BrowserWindow }, which) => {
    const [win] = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
    win!.webContents[which]();
  }, command);
}

// Every thread id the editor's text carries, with the text each one marks (adjacent pieces joined).
const markedText = (text: Locator) =>
  text.evaluate((root) => {
    const out: Record<string, string> = {};
    root.querySelectorAll<HTMLElement>('[data-thread]').forEach((el) => {
      out[el.dataset.thread!] = (out[el.dataset.thread!] ?? '') + el.textContent;
    });
    return out;
  });

// A comment on `quote` in paragraph `index`, kept: Comment opens the card on a new thread, Resolve keeps it, Reopen in
// the rail opens it again. Returns its thread id, the rail left closed.
async function commentOn(page: Page, record: Locator, text: Locator, index: number, quote: string): Promise<string> {
  const before = new Set(Object.keys(await markedText(text)));
  await selectIn(text, index, quote);
  await record.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Comment', exact: true }).click();
  const card = page.locator('[data-comment-card]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-anchor-kind', 'artifact-comment');
  await expect(card).toHaveAttribute('data-anchor-locator', quote);
  let threadId = '';
  await expect
    .poll(async () => {
      const ids = Object.entries(await markedText(text)).filter(([id, marked]) => !before.has(id) && marked === quote);
      threadId = ids[0]?.[0] ?? '';
      return ids.length;
    }, { message: 'one new mark on the passage' })
    .toBe(1);
  await card.getByRole('button', { name: 'Resolve' }).click();
  await expect(card).toHaveCount(0);
  const comments = record.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: /^Comments/ });
  await comments.click();
  const rail = record.getByRole('complementary', { name: 'Comments' });
  await rail.locator(`article[data-thread="${threadId}"]`).getByRole('button', { name: 'Reopen' }).click();
  await expect(text.locator(`.comment-${threadId}`)).toHaveText(quote);
  await comments.click();
  await expect(rail).toBeHidden();
  return threadId;
}

// The Comments rail open, its thread articles (open, then resolved).
async function railOf(record: Locator): Promise<Locator> {
  const rail = record.getByRole('complementary', { name: 'Comments' });
  if (!(await rail.isVisible())) await record.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: /^Comments/ }).click();
  await expect(rail).toBeVisible();
  return rail;
}

test('commented text through the Mac’s pasteboard: a copy pasted in the same document does not duplicate the comment, a cut and paste moves it', async () => {
  test.setTimeout(150_000);
  const page = await start();
  const { record, text } = await openBesideSession(page, 'Pasteboard notes', ['The owner reviews the launch plan today.', 'A second paragraph waits here.']);
  const QUOTE = 'launch plan';
  const threadId = await commentOn(page, record, text, 0, QUOTE);
  const app = launch!.app;

  await withNativeClipboard(app, [QUOTE], async () => {
    // a copy: the pasteboard's HTML carries the thread (the mark's data-thread), the paste is plain text
    await selectIn(text, 0, QUOTE);
    await edit('copy');
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(QUOTE);
    const html = await app.evaluate(async ({ clipboard }) => {
      for (const item of await clipboard.read()) if (item.types.includes('text/html')) return ((await item.getType('text/html')) as Blob).text();
      return '';
    });
    expect(html, 'the pasteboard’s text/html carries the thread id').toContain(`data-thread="${threadId}"`);
    await caretAtEndOf(page, text, 1);
    await edit('paste');
    await expect(text.locator('p').nth(1)).toHaveText(`A second paragraph waits here.${QUOTE}`);
    expect(await markedText(text), 'the copy carries no second comment').toEqual({ [threadId]: QUOTE });
    await expect(text.locator('p').nth(0).locator(`[data-thread="${threadId}"]`)).toHaveText(QUOTE);

    // a cut and a paste: the comment moves with its text
    await selectIn(text, 0, QUOTE);
    await edit('cut');
    await expect(text.locator('p').nth(0)).toHaveText('The owner reviews the  today.');
    await caretAtEndOf(page, text, 1);
    await page.keyboard.type(' Moved: ');
    await edit('paste');
    await expect(text.locator('p').nth(1)).toHaveText(`A second paragraph waits here.${QUOTE} Moved: ${QUOTE}`);
  });
  expect(await markedText(text), 'one comment, on the pasted text').toEqual({ [threadId]: QUOTE });
  await expect(text.locator('p').nth(1).locator(`[data-thread="${threadId}"]`)).toHaveText(QUOTE);
  await expect(text.locator('p').nth(0).locator('[data-thread]')).toHaveCount(0);
  await expect(text.locator(`.comment-${threadId}`)).toHaveText(QUOTE); // drawn as an open thread's passage
  const rail = await railOf(record);
  await expect(rail.locator('article[data-thread]')).toHaveCount(1);
  await expect(rail.locator(`article[data-thread="${threadId}"]`)).not.toHaveAttribute('data-orphan');
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

test('a commented passage dragged with the mouse to another paragraph keeps exactly one comment, on the moved text', async () => {
  test.setTimeout(150_000);
  const page = await start();
  const { record, text } = await openBesideSession(page, 'Drag notes', ['The river runs north past the mill.', 'The road ends at the bridge.']);
  const QUOTE = 'river runs north';
  const threadId = await commentOn(page, record, text, 0, QUOTE);

  // a real drag: the passage selected with the mouse (pressed before its first character, released after its last), then
  // pressed inside the selection and held, moved in steps to the second paragraph's end, released there
  const passage = await passageAt(text, 0, QUOTE);
  await page.mouse.move(passage.left + 1, passage.y);
  await page.mouse.down();
  await page.mouse.move(passage.right - 1, passage.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => text.evaluate(() => getSelection()?.toString() ?? '')).toBe(QUOTE);
  const from = { x: (passage.left + passage.right) / 2, y: passage.y };
  const to = await text.locator('p').nth(1).evaluate((p) => {
    const range = document.createRange();
    range.selectNodeContents(p);
    const r = range.getBoundingClientRect();
    return { x: r.right - 1, y: r.top + r.height / 2 };
  });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(300); // held: on macOS Chromium starts a text drag only after 150 ms down (else it selects)
  await page.mouse.move(from.x + 6, from.y + 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();

  await expect(text.locator('p').nth(1)).toContainText(QUOTE);
  await expect(text.locator('p').nth(0)).not.toContainText(QUOTE);
  expect(await markedText(text), 'exactly one comment, on the moved text').toEqual({ [threadId]: QUOTE });
  await expect(text.locator('p').nth(1).locator(`[data-thread="${threadId}"]`)).toHaveText(QUOTE);
  await expect(text.locator(`.comment-${threadId}`)).toHaveText(QUOTE);
  const rail = await railOf(record);
  await expect(rail.locator('article[data-thread]')).toHaveCount(1);
  await expect(rail.locator(`article[data-thread="${threadId}"]`)).not.toHaveAttribute('data-orphan');
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

test('restore brings back a deleted tab and the earlier text while a later reply stays on its thread and a newer thread shows orphaned', async () => {
  test.setTimeout(150_000);
  const page = await start();
  const { id, record, text } = await openBesideSession(page, 'Restore notes', ['The budget review is on Friday.']);
  const older = await commentOn(page, record, text, 0, 'budget review');
  // a second tab with its own text, in the version
  await record.getByRole('button', { name: 'Add tab' }).click();
  const tabs = record.getByRole('tablist', { name: 'Tabs' });
  await expect(tabs.getByRole('tab')).toHaveText(['Restore notes', 'Tab 2']);
  await expect(text).toHaveText('', { timeout: 10_000 });
  await text.click();
  await page.keyboard.type('Appendix figures for October.');
  const panelHeader = page.locator('[data-region="panel"] [data-editor-header]');
  await expect(panelHeader.locator('[data-header-saved]')).toHaveText('All changes saved', { timeout: 10_000 });
  const { versionId } = await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'Two tabs' });

  // after the version: the second tab deleted, a reply on the older thread, new text with a thread of its own
  await record.getByRole('button', { name: 'Tab options' }).click();
  await record.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(tabs.getByRole('tab')).toHaveText(['Restore notes']);
  await expect(text.locator('p')).toHaveText(['The budget review is on Friday.']);
  let rail = await railOf(record);
  const reply = rail.locator(`article[data-thread="${older}"]`).getByRole('textbox', { name: 'Reply' });
  await reply.fill('Posted after the version.');
  await reply.press('Enter');
  await expect(rail.locator(`article[data-thread="${older}"]`).getByRole('listitem')).toHaveText(['YouPosted after the version.']);
  await record.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: /^Comments/ }).click();
  await caretAtEndOf(page, text, 0);
  await page.keyboard.press('Enter');
  await page.keyboard.type('A later sentence for the board.');
  const newer = await commentOn(page, record, text, 1, 'later sentence');
  await expect(panelHeader.locator('[data-header-saved]')).toHaveText('All changes saved', { timeout: 10_000 });

  // A's restore, artifact-wide
  const restored = await ok<{ versionId: number }>(page, 'artifacts.restore', { artifactId: id, versionId });
  await expect(tabs.getByRole('tab')).toHaveText(['Restore notes', 'Tab 2'], { timeout: 15_000 });
  await expect(text.locator('p')).toHaveText(['The budget review is on Friday.'], { timeout: 15_000 });
  expect(await markedText(text)).toEqual({ [older]: 'budget review' });
  rail = await railOf(record);
  const olderItem = rail.locator(`article[data-thread="${older}"]`);
  await expect(olderItem.getByRole('listitem'), 'the reply posted after the version stays').toHaveText(['YouPosted after the version.']);
  await expect(olderItem).not.toHaveAttribute('data-orphan');
  const newerItem = rail.locator(`article[data-thread="${newer}"]`);
  await expect(newerItem, 'the thread made after the version stays, its passage gone').toHaveAttribute('data-orphan', '');
  await expect(newerItem).toContainText('The commented passage was removed.');
  await tabs.getByRole('tab', { name: 'Tab 2' }).click();
  await expect(text).toHaveText('Appendix figures for October.', { timeout: 10_000 });
  const listed = await ok<{ versions: { id: number; kind: string; label?: string }[] }>(page, 'artifacts.versions', { artifactId: id });
  expect(listed.versions).toContainEqual(expect.objectContaining({ id: restored.versionId, kind: 'restore', label: 'Restored from Two tabs' }));
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
