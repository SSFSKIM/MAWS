// The document editor in the product app (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, "Proves (e2e,
// product)"; `pnpm e2e:document-app`, the product build, MAWS_HARNESS=0): a document the owner creates opens through L's
// registry in an `artifact` main tab and in the panel's Artifacts tool as two replicas of one host doc, each typing
// reaching the other; the X32 header stays All changes saved around an acknowledged keystroke (M9: "Saving…" only for
// edits left waiting past the tab's delay, so it never flickers) and says Reconnecting… across a
// host restart, after which the typing still lands; History lists A's versions, Save version adds a named one, and
// Restore brings it back with the banner. The document exports through A's export service (M9's fix wave): `.md`,
// `.html`, `.docx` and a `.pdf` beginning `%PDF-` with one page per tab on Letter and on A4, from the header's Export
// menu and from `artifacts.export` (UX wave U10b: the menu's A4 is the document's page, which its PDF row follows); an image uploaded as an asset renders in the editor through the `maws-artifact:`
// scheme under the app's CSP. P3-F (8.2, F7): the header's Export saves where the owner chooses (main's save seam under
// the e2e, MAWS_E2E_SAVE_PATH), the toast saying where, and exports what is shown: the version a preview shows, nothing
// while two versions are compared, the live document again once history is left.
// M9 (Acceptance 3 and 4): commented text copied through the Mac's pasteboard pastes without a second comment, a cut and
// paste moves it, a real mouse drag keeps exactly one; A's restore brings back a deleted tab and the earlier text while
// a reply posted after the version stays and a thread made after it shows orphaned.
// Every launch's userData is its own directory under /tmp; windows are never shown (the e2e quiet mode).
import { addDocumentSection } from './support/document-sections';
import { openArtifactInPanel, openArtifactReplicaInPanel, pinSurfaceForSessions } from './support/shell';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { withNativeClipboard } from './support/clipboard';
import { replyThroughActiveCard } from './support/comment-reply';
import { traceForeground } from './support/foreground-trace';
import { launchMaws, type MawsLaunch } from './support/launch';
import { sidebarRow } from './support/sidebar';
import { join } from 'node:path';
import { blocksOf, PerfSeam, type ReadResult } from './support/document-scale';
import { carriedBy, decodeMap, insertedBy } from '../src/artifacts/yjs';
import { commentsMessage, readAnchoredMessage } from '../src/shared/anchor/message'; // UX wave U5a
import { FIRST_REPLY, invoke, PARENT, startSessionCase, value } from './support/library-session'; // UX wave U5a
import { SideJournal } from './support/side-replay'; // UX wave U5a
import { journalOf, mcpCalls, mcpResultOf, resultText } from './support/maws-tools'; // UX wave U10b

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}
const hostState = (page: Page) => ok<{ state: string; pid: number | null }>(page, 'engine.hostState');

let launch: MawsLaunch | null = null;
let userData: string | null = null;

test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  if (userData) rmSync(userData, { recursive: true, force: true });
  userData = null;
});

// The panel's harness scenario (C8a): two synthetic sessions main serves, so a session's panel can hold tools.
const SESSIONS = 'stub:test/fixtures/panel/harness-sessions.json';

// `env`: more of the launch's environment (P3-F: the open seam's log).
async function start(suggestions = false, env: Record<string, string> = {}): Promise<Page> {
  mkdirSync('/tmp/maws-harness/a', { recursive: true }); // session A's directory in the scenario
  userData = mkdtempSync('/tmp/maws-e2e-document-');
  launch = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: SESSIONS, ...(suggestions ? { MAWS_DOCUMENT_PERF: '1' } : {}), ...env } });
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

// Select the session that receives the artifact's panel surface; openInPanel pins the real record after transfer.
async function selectPanelSession(page: Page): Promise<void> {
  await (await sidebarRow(page, 'Harness A')).click();
}

// The document in the pinned Artifacts tool's record view.
async function openInPanel(page: Page, artifactId: string, retainMain = false): Promise<Locator> {
  const panel = page.locator('[data-region="panel"]');
  if (retainMain) await openArtifactReplicaInPanel(page, artifactId);
  else {
    await openArtifactInPanel(page, artifactId);
    await pinSurfaceForSessions(page, 'Artifacts');
  }
  const record = panel.locator(`[data-artifact-record="${artifactId}"]`);
  await expect(record.locator('.ds-doc .ProseMirror')).toBeVisible({ timeout: 15_000 });
  return record;
}

// The durability barrier: the replica behind the editor under `scope` has nothing the host has not acknowledged (the
// header's saved word is not one: it says Saving… only after edits have waited 500 ms).
async function durable(scope: Locator): Promise<void> {
  const unsaved = () =>
    scope
      .locator('.ds-doc .ProseMirror')
      .first()
      .evaluate((el) => {
        const editor = (el as HTMLElement & { editor?: { extensionManager: { extensions: Array<{ name: string; options: { hold?: { base: { state(): { unsaved: number } } } } }> } } }).editor;
        return editor?.extensionManager.extensions.find((extension) => extension.name === 'collaboration')?.options.hold?.base.state().unsaved ?? -1;
      });
  await expect.poll(unsaved, { timeout: 10_000, message: 'every edit acknowledged by the host' }).toBe(0);
}

// Every state the header's saved slot showed since this call, in order, each by its words: the drawn words, or (the
// word cut, P23 and P24) the name of the ring or the dot drawn in their place, so a save in flight reads "Saving…".
async function watchSaved(page: Page, header: Locator): Promise<() => Promise<string[]>> {
  const handle = await header.elementHandle();
  await page.evaluate((row) => {
    const seen: string[] = [];
    (window as unknown as { __saved: string[] }).__saved = seen;
    const read = () => {
      const slot = row!.querySelector('[data-header-saved]');
      const text = slot?.textContent || slot?.querySelector('[role="progressbar"], [role="img"]')?.getAttribute('aria-label') || '';
      if (seen.at(-1) !== text) seen.push(text);
    };
    read();
    new MutationObserver(read).observe(row!, { subtree: true, childList: true, characterData: true });
  }, handle);
  return () => page.evaluate(() => (window as unknown as { __saved: string[] }).__saved);
}

test('WR #12: the floating session reserves document space when wide and overlays only when narrow', async () => {
  const page = await start();
  await launch!.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 900));
  await selectPanelSession(page);
  const { id } = await openInMain(page, 'Reading beside a conversation');
  const record = await openInPanel(page, id, true);
  await (await sidebarRow(page, 'Harness A')).click();
  const panel = page.locator('[data-region="panel"]');
  await panel.getByRole('button', { name: 'Float conversation over surface' }).click();
  const card = panel.getByRole('region', { name: 'Session card' });
  const column = record.locator('[data-document-session-column]');
  await expect(column).toBeVisible();
  await expect(card).toHaveAttribute('data-floating-card', 'column');
  const sheet = record.locator('.ds-doc').first();
  await expect.poll(async () => {
    const doc = (await sheet.boundingBox())!;
    const chat = (await card.boundingBox())!;
    return Math.round(doc.x + doc.width) <= Math.round(chat.x);
  }, { message: 'the reading sheet does not extend underneath the conversation' }).toBe(true);
  await launch!.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1100, 900));
  await expect(column).toHaveCount(0);
  await expect(card).toHaveAttribute('data-floating-card', 'card');
  await expect(record.locator('.ProseMirror')).toBeVisible();
});

test('a document opens in a main tab and in the panel as two replicas; the header follows saves and a host restart; History saves, lists and restores', async () => {
  test.setTimeout(150_000);
  const page = await start();
  await selectPanelSession(page);
  const { id, main } = await openInMain(page, 'Launch plan');
  const record = await openInPanel(page, id, true);
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

  await test.step('the header stays All changes saved around a keystroke the host acknowledges (no flicker)', async () => {
    await expect(mainHeader.locator('[data-header-saved]')).toHaveText('All changes saved', { timeout: 10_000 });
    const seen = await watchSaved(page, mainHeader);
    await mainText.click();
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await expect(panelText).toContainText('And in the panel.!', { timeout: 10_000 }); // the host has it
    await page.waitForTimeout(1_000); // past the tab's 500 ms delay
    expect(await seen(), 'no Saving… for an acknowledged keystroke').toEqual(['All changes saved']);
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
    await main.getByRole('toolbar', { name: 'Formatting', exact: true }).getByRole('button', { name: 'Version history', exact: true }).click();
    await expect(rail).toBeHidden();
    await mainText.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Doomed sentence.');
    await expect(panelText).toContainText('Doomed sentence.', { timeout: 10_000 });
    await durable(main);
    await main.getByRole('toolbar', { name: 'Formatting', exact: true }).getByRole('button', { name: 'Version history', exact: true }).click();
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

// A 2 × 2 PNG, red and blue, as a person would pick from disk.
const TWO_BY_TWO_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DwnwEIGBgYGBgYAAAy7QL+1Hdq+wAAAABJRU5ErkJggg==', 'base64');

test('an image uploaded as an asset renders in the editor through the maws-artifact scheme under the app’s CSP', async () => {
  const page = await start();
  const { main } = await openInMain(page, 'Pictures');
  await main.locator('.ds-doc .ProseMirror').click();
  await main.getByLabel('Image file').setInputFiles({ name: 'two.png', mimeType: 'image/png', buffer: TWO_BY_TWO_PNG });
  const img = main.locator('.ds-doc .ProseMirror').getByRole('img', { name: 'two.png' });
  await expect(img).toHaveAttribute('src', /^maws-artifact:/, { timeout: 15_000 });
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : -1)), { timeout: 15_000, message: 'the image loaded' }).toBe(2);
  expect(launch!.consoleErrors(), 'no CSP refusal, no load error').toEqual([]);
});

// P3-F (F1, the owner's N.3: "링크는 안열리고 cmd+click에도 컴포넌트가 선택됨"): ⌘-click on a link opens it through main's
// one scheme-checked opener (under MAWS_E2E the seam logs `openExternal <url>` in place of the system browser), the press
// leaving the selection as it was and selecting no node; a plain click opens nothing. In the main tab and in the panel,
// each its own replica and editor.
test('a link opens on ⌘-click through main’s opener in a main tab and in the panel, selecting nothing; a plain click opens nothing', async () => {
  const seam = mkdtempSync('/tmp/maws-e2e-document-open-');
  const openLog = join(seam, 'open.log');
  try {
    const page = await start(false, { MAWS_E2E_OPEN_LOG: openLog });
    await selectPanelSession(page);
    const { id, main } = await openInMain(page, 'Link notes');
    const record = await openInPanel(page, id, true);
    type LinkRoot = HTMLElement & { editor: { commands: { insertContent(value: string): boolean }; state: { selection: { toJSON(): unknown } } } };
    const mainText = main.locator('.ds-doc .ProseMirror');
    await mainText.evaluate((el) => (el as LinkRoot).editor.commands.insertContent('<p>Read <a href="https://example.com/brief">the brief</a> and <a href="https://example.com/notes">the notes</a>.</p>'));
    await durable(main);
    const opened = () => (existsSync(openLog) ? readFileSync(openLog, 'utf8').split('\n').filter(Boolean) : []);
    for (const [where, text] of [
      ['main tab', mainText],
      ['panel', record.locator('.ds-doc .ProseMirror')],
    ] as const) {
      await test.step(`${where}: ⌘-click opens the link and moves nothing, a plain click opens nothing`, async () => {
        const brief = text.locator('a[href="https://example.com/brief"]');
        await expect(brief).toBeVisible({ timeout: 15_000 });
        const before = opened().length;
        const selection = () => text.evaluate((el) => JSON.stringify((el as LinkRoot).editor.state.selection.toJSON()));
        const held = await selection();
        await brief.click({ modifiers: ['ControlOrMeta'] });
        await expect.poll(() => opened().slice(before), { message: 'the link handed to main’s opener' }).toEqual(['openExternal https://example.com/brief']);
        expect(await selection(), 'the selection after ⌘-click').toBe(held);
        await expect(text.locator('.ProseMirror-selectednode'), 'no node selected').toHaveCount(0);
        // a plain click places the caret and opens nothing: the next ⌘-click's line follows the first directly
        await brief.click();
        await text.locator('a[href="https://example.com/notes"]').click({ modifiers: ['ControlOrMeta'] });
        await expect.poll(() => opened().slice(before)).toEqual(['openExternal https://example.com/brief', 'openExternal https://example.com/notes']);
      });
    }
    expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    rmSync(seam, { recursive: true, force: true });
  }
});

test('the document exports through A’s export service: Markdown, HTML, DOCX and a paged PDF on Letter and A4, from the Export menu (saved where the owner chooses, what is shown) and `artifacts.export`', async () => {
  test.setTimeout(180_000);
  const saved = mkdtempSync('/tmp/maws-e2e-document-saved-'); // P3-F (F7): where main's save seam puts the menu's exports
  try {
    const page = await start(false, { MAWS_E2E_SAVE_PATH: saved });
    const { id, main } = await openInMain(page, 'Quarterly plan');
    const mainHeader = page.locator('[data-region="main"] [data-editor-header]');
    const mainText = main.locator('.ds-doc .ProseMirror');

    // three tabs, each a page of its own in print
    await mainText.click();
    await page.keyboard.type('The launch waits for the review.');
    for (const words of ['Budget notes for October.', '안녕하세요, 팀 여러분.']) {
      await addDocumentSection(main);
      await expect(main.locator('.ds-doc .ProseMirror')).toHaveText('', { timeout: 10_000 });
      await main.locator('.ds-doc .ProseMirror').click();
      await page.keyboard.type(words);
    }
    await durable(main);

    // P3-F (F7): the header's Export menu reaches A's service and saves where the owner chooses, the toast saying where; the
    // header keeps no "Exported …" item
    const pick = async (label: string) => {
      await mainHeader.getByRole('button', { name: 'Export', exact: true }).click();
      await page.getByRole('menuitem', { name: label, exact: true }).click();
    };
    const savedFile = (name: string) => join(saved, name);
    const appears = (name: string, check: (bytes: Buffer) => boolean) =>
      expect.poll(() => (existsSync(savedFile(name)) ? check(readFileSync(savedFile(name))) : false), { timeout: 60_000, message: `${name} saved` }).toBe(true);
    // UX wave U10b (§B.5 of docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md): the page is the document's own,
    // chosen among the menu's checked items; its formats send no size, so PDF then prints on A4
    await mainHeader.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Letter', exact: true }), 'the system’s page, with nothing set').toHaveAttribute('aria-checked', 'true');
    await page.getByRole('menuitemcheckbox', { name: 'A4', exact: true }).click();
    await mainHeader.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'A4', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('menuitemcheckbox', { name: 'Letter', exact: true })).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    await pick('PDF (.pdf)');
    await appears('Quarterly plan.pdf', (bytes) => bytes.subarray(0, 5).toString('latin1') === '%PDF-');
    expect(pdfPages(readFileSync(savedFile('Quarterly plan.pdf')))).toEqual({ pages: 3, width: 595, height: 842 });
    await expect(page.getByRole('region', { name: /^Notifications/ }).getByText(`Saved to ${savedFile('Quarterly plan.pdf')}`).first()).toBeVisible();
    await expect(mainHeader.getByRole('button', { name: /^Exported / }), 'no finished export left in the header').toHaveCount(0);

    // the four formats through the service's own command (the library's and the menu's route), Letter and A4
    const exported = async (format: string, pageSize?: string) => {
      const { path } = await ok<{ path: string; revision: number }>(page, 'artifacts.export', { artifactId: id, format, ...(pageSize ? { pageSize } : {}) });
      return readFileSync(path);
    };
    const md = (await exported('md')).toString('utf8');
    expect(md).toContain('The launch waits for the review.');
    expect(md).toContain('안녕하세요, 팀 여러분.');
    expect(md).not.toMatch(/\^[0-9a-z]{8}/); // no block ids in the file

    const html = (await exported('html')).toString('utf8');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Budget notes for October.');
    expect(html).not.toContain('var(--ds-');

    await test.step('document inspection permits host layout reads but blocks authored script and event handlers', async () => {
      const hostile = html.replace('</body>', `<script>console.log('maws-authored-script-ran')</script><img src="data:image/png;base64,bm90LXBuZw==" onerror="console.log('maws-authored-handler-ran')"></body>`);
      const capture = await launch!.app.evaluate(async ({ app }, body) => {
        const messages: string[] = [];
        const watch = (_event: Electron.Event, contents: Electron.WebContents) => {
          contents.on('console-message', (event) => messages.push(event.message));
        };
        app.on('web-contents-created', watch);
        try {
          const png = await (globalThis as unknown as { __maws_exports: { inspect(html: string): Promise<string> } }).__maws_exports.inspect(body);
          return { png, executed: messages.filter((message) => message.startsWith('maws-authored-')), csp: messages.filter((message) => /Content Security Policy/i.test(message)) };
        } finally {
          app.off('web-contents-created', watch);
        }
      }, hostile);
      expect(Buffer.from(capture.png, 'base64').subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(capture.executed).toEqual([]);
      expect(capture.csp.length, 'the inline script and onerror handler are both refused by CSP').toBeGreaterThanOrEqual(2);
    });

    const png = await exported('png');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(1280);
    expect(png.readUInt32BE(20)).toBeGreaterThan(240);
    await test.info().attach('document-visual-inspection', { body: png, contentType: 'image/png' });

    const docx = await exported('docx');
    expect(docx.subarray(0, 2).toString('latin1')).toBe('PK');

    const letter = await exported('pdf', 'letter');
    expect(letter.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdfPages(letter)).toEqual({ pages: 3, width: 612, height: 792 }); // a tab a page, US Letter: the call's size wins
    const a4 = await exported('pdf');
    expect(pdfPages(a4)).toEqual({ pages: 3, width: 595, height: 842 }); // A4, the document's own page (UX wave U10b)

    await test.step('P3-F (8.2, F7): during a version preview the menu exports that version, while two are compared nothing, and the live document once history is left', async () => {
      await ok(page, 'artifacts.saveVersion', { artifactId: id, label: 'Three tabs' });
      await main.locator('.ds-doc .ProseMirror').click(); // the third tab, the one shown
      await page.keyboard.press('End');
      await page.keyboard.type(' Added after the version.');
      await durable(main);
      await ok(page, 'artifacts.saveVersion', { artifactId: id, label: 'With the addition' });
      await main.getByRole('toolbar', { name: 'Formatting', exact: true }).getByRole('button', { name: 'Version history', exact: true }).click();
      const rail = main.getByRole('complementary', { name: 'Version history' });
      await rail.getByRole('button', { name: /^Version Three tabs/ }).click();
      const bar = main.getByRole('toolbar', { name: 'Version preview' });
      await expect(bar).toBeVisible({ timeout: 10_000 });
      await expect(mainHeader.locator('[data-header-saved]')).toHaveText('Read-only');
      await pick('Markdown (.md)');
      await appears('Quarterly plan.md', (bytes) => bytes.toString('utf8').includes('안녕하세요, 팀 여러분.'));
      expect(readFileSync(savedFile('Quarterly plan.md'), 'utf8'), 'the version shown, not the live document').not.toContain('Added after the version.');

      await rail.getByRole('button', { name: /^Version With the addition/ }).click({ modifiers: ['Shift'] });
      await expect(bar.getByText('Three tabs → With the addition')).toBeVisible({ timeout: 10_000 });
      await mainHeader.getByRole('button', { name: 'Export', exact: true }).click();
      const items = page.getByRole('menuitem');
      await expect(items).toHaveCount(4); // UX wave U10b: the four formats, then the page's three checked items
      for (const item of await items.all()) await expect(item, 'two versions compared: nothing to export').toBeDisabled();
      const pageItems = page.getByRole('menuitemcheckbox');
      await expect(pageItems).toHaveCount(3);
      for (const item of await pageItems.all()) await expect(item, 'a version shown: the page takes no choice').toBeDisabled();
      await page.keyboard.press('Escape');

      await rail.getByRole('button', { name: 'Close version history', exact: true }).click();
      await expect(bar).toBeHidden();
      rmSync(savedFile('Quarterly plan.md'));
      await pick('Markdown (.md)');
      await appears('Quarterly plan.md', (bytes) => bytes.toString('utf8').includes('Added after the version.'));
    });
    expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    rmSync(saved, { recursive: true, force: true });
  }
});

// ---- UX wave U10b: a document's page (A3; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md, M3) -------------

// A memo of a heading and fifteen two-line paragraphs: past one Letter page at standard density (about 1,040 px of text
// on the page's 912), within one A4 page at compact (about 910 of 978). Invented text.
const MEMO_TITLE = 'Offsite planning memo';
const MEMO_PARAGRAPH = (k: number) => `Item ${k}: the planning group meets in the north room after lunch, reviews the open questions from the last session, and agrees who drafts the summary.`;
const MEMO = `# Offsite planning\n\n${Array.from({ length: 15 }, (_, k) => MEMO_PARAGRAPH(k + 1)).join('\n\n')}\n`;

// The session's turn: it makes the memo, exports a PDF, sets the page to A4 at compact density, and exports again.
function memoJournal(cwd: string): SideJournal {
  const journal = new SideJournal(PARENT, cwd);
  const prompt = journal.prompt();
  journal.mawsToolCall('artifact_create', { kind: 'document', title: MEMO_TITLE, handle: 'memo', content: MEMO }, { status: 'created', title: MEMO_TITLE }, { asked: false });
  journal.mawsToolCall('artifact_export', { artifact: 'memo', format: 'pdf' }, { status: 'exported', format: 'pdf' }, { asked: false });
  journal.mawsToolCall('artifact_edit', { artifact: 'memo', baseRevision: 0, ops: [{ op: 'set_page', size: 'a4', density: 'compact' }] }, { status: 'edited' }, { asked: false });
  journal.mawsToolCall('artifact_export', { artifact: 'memo', format: 'pdf' }, { status: 'exported', format: 'pdf' }, { asked: false });
  journal.reply(prompt, FIRST_REPLY); // the words the session case waits for at the turn's end
  journal.completed(prompt);
  return journal;
}

// The `maws` server's answers the host wrote for the session, in its calls' order, each with the call's name: what the
// agent was told, read from the journal (the replay's own tool results are the recording's).
function mawsAnswers(userData: string, appSessionId: string): Array<{ name: string; isError: boolean; answer: Record<string, unknown> }> {
  const rows = journalOf(userData, appSessionId);
  return mcpCalls(rows).map(({ requestId, name }) => {
    const result = mcpResultOf(rows, requestId);
    const isError = result?.isError === true;
    const text = result ? resultText(result) : '';
    return { name, isError, answer: isError ? { refusal: text } : (JSON.parse(text || '{}') as Record<string, unknown>) };
  });
}

// A3: asked for a one-page memo, the agent sets the page and its PDF export names the page count; the Export menu shows
// the same page, A4 and Compact checked; the owner's own PDF from the menu has the same count by the scene's own count.
test('UX wave U10b (A3): the agent’s set_page makes a two-page memo one A4 page at compact density, its export says pages: 1, and the Export menu shows A4 and Compact checked and prints one page', async () => {
  test.setTimeout(180_000);
  const saved = mkdtempSync('/tmp/maws-e2e-document-page-');
  const c = await startSessionCase((cwd) => [memoJournal(cwd)], { MAWS_E2E_SAVE_PATH: saved });
  try {
    const { page, maws, parent } = c;
    const answers = mawsAnswers(maws.userData, parent);
    expect(answers.map(({ name, isError }) => [name, isError])).toEqual([
      ['artifact_create', false],
      ['artifact_export', false],
      ['artifact_edit', false],
      ['artifact_export', false],
    ]);
    const [created, standard, edited, compact] = answers.map(({ answer }) => answer) as [{ artifactId: string }, { path: string; pages?: number }, { results: unknown[] }, { path: string; pages?: number }];
    // each PDF's bytes kept as it is read: an export of the same revision and format reuses the format's cache file
    const standardPdf = readFileSync(standard.path);
    const compactPdf = readFileSync(compact.path);
    expect(standard.pages, 'the memo at standard density on its system’s Letter page').toBe(2);
    expect(pdfPages(standardPdf)).toEqual({ pages: 2, width: 612, height: 792 });
    expect(edited.results).toEqual([{ op: 'set_page', size: 'a4', density: 'compact' }]);
    expect(compact.pages, 'the agent’s answer after set_page').toBe(1);
    expect(pdfPages(compactPdf), 'the scene’s own count of the same file').toEqual({ pages: 1, width: 595, height: 842 });
    // Proof 2 (the owner's look at a memo at two densities): the standard PDF and the compact one, on Letter too (a file
    // of its own, so the compact A4 file stays as the agent's export left it)
    const compactLetter = value(await invoke(page, 'artifacts.export', { artifactId: created.artifactId, format: 'pdf', pageSize: 'letter', ownFile: true }));
    const compactLetterPdf = readFileSync(compactLetter.path);
    const attachments = { 'memo-standard-letter.pdf': standardPdf, 'memo-compact-letter.pdf': compactLetterPdf, 'memo-compact-a4.pdf': compactPdf };
    const sizes = Object.fromEntries(Object.entries(attachments).map(([name, bytes]) => {
      const { width, height } = pdfPages(bytes);
      return [name, { width, height }];
    }));
    expect(sizes, 'each attachment is on the page its name says (their page counts are pinned above)').toEqual({
      'memo-standard-letter.pdf': { width: 612, height: 792 },
      'memo-compact-letter.pdf': { width: 612, height: 792 },
      'memo-compact-a4.pdf': { width: 595, height: 842 },
    });
    expect(readFileSync(compact.path).equals(compactPdf), 'the compact A4 file unchanged by the Letter export').toBe(true);
    for (const [name, body] of Object.entries(attachments)) await test.info().attach(name, { body, contentType: 'application/pdf' });

    // the window: the document's Export menu shows the page the agent set, and the menu's PDF prints on it
    await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
    await page.locator('[data-library]').getByRole('article', { name: MEMO_TITLE, exact: true }).click({ timeout: 15_000 });
    const main = page.locator(`[data-region="main"] [data-artifact-tab="${created.artifactId}"]`);
    await expect(main.locator('.ds-doc .ProseMirror')).toContainText(MEMO_PARAGRAPH(15), { timeout: 15_000 });
    const header = page.locator('[data-region="main"] [data-editor-header]');
    await header.getByRole('button', { name: 'Export', exact: true }).click();
    const checked = async (name: string) => page.getByRole('menuitemcheckbox', { name, exact: true }).getAttribute('aria-checked');
    await expect(page.getByRole('menuitemcheckbox', { name: 'A4', exact: true })).toHaveAttribute('aria-checked', 'true');
    expect([await checked('Letter'), await checked('A4'), await checked('Compact')]).toEqual(['false', 'true', 'true']);
    expect(await page.getByRole('menu').getByRole('menuitem').allTextContents()).toEqual(['Markdown (.md)', 'Web page (.html)', 'Word (.docx)', 'PDF (.pdf)']);
    await page.getByRole('menuitem', { name: 'PDF (.pdf)', exact: true }).click();
    const file = join(saved, `${MEMO_TITLE}.pdf`);
    await expect.poll(() => (existsSync(file) ? readFileSync(file).subarray(0, 5).toString('latin1') : ''), { timeout: 60_000, message: 'the menu’s PDF saved' }).toBe('%PDF-');
    expect(pdfPages(readFileSync(file)), 'the owner’s PDF: the same page count').toEqual({ pages: 1, width: 595, height: 842 });
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await c.cleanup();
    rmSync(saved, { recursive: true, force: true });
  }
});

// What a page draws of its blocks, read the same way in the editor and in the exported page: each top-level block of
// `content` (its tag, its height, its left edge from the content box's and its width) and the gap above it, from the
// block before; and the content box's width. Blocks the editor draws for itself (ProseMirror's own widgets) are left out.
type DrawnBlocks = { width: number; blocks: Array<{ tag: string; height: number; left: number; width: number; gap: number | null }> };
function drawnBlocks({ content, skip }: { content: string; skip?: string }): DrawnBlocks {
  const root = document.querySelector(content) as HTMLElement;
  const style = getComputedStyle(root);
  const box = root.getBoundingClientRect();
  const left = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
  const width = root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const children = Array.from(root.children).filter((child) => !(skip && child.matches(skip)) && !Array.from(child.classList).some((name) => name.startsWith('ProseMirror-')) && child.getBoundingClientRect().height > 0);
  let bottom: number | null = null;
  const blocks = children.map((shown) => {
    // the editor may wrap a table in a box of its own (the table's node view): the table is the block either way
    const child = shown.tagName === 'DIV' && shown.firstElementChild?.tagName === 'TABLE' ? shown.firstElementChild : shown;
    const rect = child.getBoundingClientRect();
    const gap = bottom === null ? null : rect.top - bottom;
    bottom = rect.bottom;
    const tag = child.tagName.toLowerCase() + (child.getAttribute('data-type') ? `[${child.getAttribute('data-type')}]` : '');
    return { tag, height: rect.height, left: rect.left - left, width: rect.width, gap };
  });
  return { width, blocks };
}

// The exported page loaded in a window of this app at `width` CSS px (a hidden one, as the export's own capture is), and
// its blocks read by `drawnBlocks` under `content`.
async function exportedBlocks(app: MawsLaunch['app'], path: string, width: number, content: string, skip?: string): Promise<DrawnBlocks> {
  const script = `(${drawnBlocks.toString()})(${JSON.stringify({ content, skip })})`;
  return app.evaluate(
    async ({ BrowserWindow }, { path, width, script }) => {
      const window = new BrowserWindow({ show: false, useContentSize: true, width, height: 3_000, webPreferences: { javascript: true } });
      try {
        await window.loadFile(path);
        await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
        return (await window.webContents.executeJavaScript(script)) as DrawnBlocks;
      } finally {
        window.destroy();
      }
    },
    { path, width, script },
  );
}

// Each block's height, left edge and width and each gap, the editor's against the export's, where they differ by half a
// pixel or more.
function spacingDifferences(editor: DrawnBlocks, exported: DrawnBlocks): string[] {
  const out: string[] = [];
  if (Math.abs(editor.width - exported.width) >= 0.5) out.push(`content width: editor ${editor.width}, export ${exported.width}`);
  if (editor.blocks.length !== exported.blocks.length) out.push(`blocks: editor ${editor.blocks.map((b) => b.tag).join(' ')}; export ${exported.blocks.map((b) => b.tag).join(' ')}`);
  editor.blocks.forEach((drawn, i) => {
    const there = exported.blocks[i];
    if (!there) return;
    for (const field of ['height', 'left', 'width', 'gap'] as const) {
      const [a, b] = [drawn[field], there[field]];
      if (a === null || b === null) continue;
      if (Math.abs(a - b) >= 0.5) out.push(`block ${i} (${drawn.tag} / ${there.tag}) ${field}: editor ${a.toFixed(1)}, export ${b.toFixed(1)}`);
    }
  });
  return out;
}

const SPACING_MD = [
  '# Spacing review',
  'The planning group meets on Thursday to settle the order of the agenda and the room.',
  '- Book the north room\n- Send the agenda\n- Print the handouts',
  '| Item | Owner |\n| --- | --- |\n| Budget | Ana |\n| Venue | Leo |',
  '> Bring the numbers from the last quarter.',
  '- [ ] Draft the slides\n- [x] Confirm the date',
  '## Next steps',
  'Each owner sends a short note by Friday.',
].join('\n\n');
const SECTION_MD = (n: number) => [`## Section ${n} notes`, `The second section keeps its own list, number ${n}.`, '- First point\n- Second point', '> A quoted line inside the section.'].join('\n\n');

// The export's page takes the editor's spacing (L1; the owner's answer of 2026-11-15 to the card "PDF spacing"; the
// architect's ruling of 2026-11-15: per block kind, the block's height and its inline box): the web-page export of a
// document holding a heading, a paragraph, a list, a table, a blockquote and a checklist, loaded in a page, draws each
// block as the editor draws it and the same gap between each pair; and a two-tab document's blocks inside each tab's
// section, as the editor draws that tab.
test('UX wave U10b (A3): the web-page export draws each block, its height, left edge and width, and each gap as the editor does, in a one-tab and a two-tab document', async () => {
  test.setTimeout(180_000);
  const page = await start(true);
  const seam = new PerfSeam(join(userData!, 'document-perf'));
  await expect.poll(() => existsSync(join(seam.dir, 'in'))).toBe(true);
  const agent = 'document-spacing-agent';
  const firstBlock = async (artifact: string, tab?: string) => {
    const read = await seam.call<ReadResult & { tabs?: Array<{ id: string }> }>(agent, 'artifact_read', { artifact, ...(tab && { tab }) });
    expect(read.isError, read.text).toBe(false);
    return { block: [...blocksOf(read.result!.markdown).keys()][0]!, tabs: read.result!.tabs ?? [] };
  };
  const write = async (artifact: string, block: string, markdown: string) => {
    const edit = await seam.call(agent, 'artifact_edit', { artifact, baseRevision: 'last', ops: [{ op: 'replace_block', id: block, markdown }] });
    expect(edit.isError, edit.text).toBe(false);
  };
  const editorOf = (main: Locator) => main.locator('.ds-doc .ProseMirror').first();
  const measureEditor = async (id: string) => page.evaluate(drawnBlocks, { content: `[data-region="main"] [data-artifact-tab="${id}"] .ds-doc .ProseMirror` });
  const containerWidth = (main: Locator) => main.locator('.ds-doc').first().evaluate((el) => (el as HTMLElement).clientWidth);
  const exportOf = async (id: string) => value(await invoke(page, 'artifacts.export', { artifactId: id, format: 'html' })).path;
  const report: Record<string, { editor: DrawnBlocks; exported: DrawnBlocks }> = {};

  // one tab: every block kind
  const one = await openInMain(page, 'Spacing review');
  await one.main.locator('[data-editor="live"]').fill('Draft.'); // a block the agent's read names
  await durable(one.main);
  const first = await firstBlock(one.id);
  await write(one.id, first.block, SPACING_MD);
  await expect(editorOf(one.main)).toContainText('Each owner sends a short note by Friday.', { timeout: 15_000 });
  await durable(one.main);
  const width = await containerWidth(one.main);
  report['one tab'] = { editor: await measureEditor(one.id), exported: await exportedBlocks(launch!.app, await exportOf(one.id), width, 'article.doc-content') };
  expect(report['one tab'].editor.blocks.map((b) => b.tag), 'the blocks the scene compares').toEqual(['h1', 'p', 'ul', 'table', 'blockquote', 'ul[taskList]', 'h2', 'p']);

  // two tabs: each tab's blocks inside its section of the export, as the editor draws that tab
  const two = await openInMain(page, 'Two sections');
  await addDocumentSection(two.main);
  await expect.poll(async () => (await firstBlock(two.id)).tabs.length, { message: 'the second tab' }).toBe(2);
  const { tabs } = await firstBlock(two.id);
  for (const [k, tab] of tabs.entries()) {
    await two.main.locator(`[role="tab"][data-tab-id="${tab.id}"]`).click();
    await two.main.locator('[data-editor="live"]').fill(`Draft ${k + 1}.`);
    await durable(two.main);
    await write(two.id, (await firstBlock(two.id, tab.id)).block, SECTION_MD(k + 1));
  }
  await durable(two.main);
  const twoPath = await exportOf(two.id);
  const twoWidth = await containerWidth(two.main);
  for (const [k, tab] of tabs.entries()) {
    await two.main.locator(`[role="tab"][data-tab-id="${tab.id}"]`).click();
    await expect(editorOf(two.main)).toContainText(`number ${k + 1}.`, { timeout: 10_000 });
    report[`tab ${k + 1} of two`] = { editor: await measureEditor(two.id), exported: await exportedBlocks(launch!.app, twoPath, twoWidth, `section.doc-tab:nth-of-type(${k + 1})`, '.doc-tab-title') };
  }
  await test.info().attach('spacing.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  const differences = Object.fromEntries(Object.entries(report).map(([name, { editor, exported }]) => [name, spacingDifferences(editor, exported)]));
  expect(differences, 'the export draws every block and gap as the editor does (spacing.json has the measures)').toEqual({ 'one tab': [], 'tab 1 of two': [], 'tab 2 of two': [] });
  expect(launch!.consoleErrors()).toEqual([]);
});

// ---- M9: comments through the real pasteboard and a real drag, and restore with conversations ------------------------
// (docs/doperpowers/plans/2026-10-12-p3-b-documents.md, M9; Acceptance 3's clipboard and drag-move, Acceptance 4's
// restore.) A comment is offered while the main area shows a session (its card's Side thread and Send to main go
// there), so these cases open the document in the pinned Artifacts tool beside session A of the panel scenario. A new
// thread whose card closes with nothing sent in it is withdrawn, so each comment is kept the owner's way that needs no
// session to answer: Resolve on the card (kept on purpose), then Reopen from the Comments rail.

// The document in the panel's Artifacts tool beside session A, typed into: one paragraph per line.
async function openBesideSession(page: Page, title: string, lines: string[]): Promise<{ id: string; record: Locator; text: Locator }> {
  await selectPanelSession(page); // the main area shows Harness A
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

// The editor element's Tiptap editor, as `durable` reads it: its document, its selection and its edits not yet acknowledged.
type EditorRoot = HTMLElement & {
  editor?: {
    state: { doc: { descendants(f: (node: { type: { name: string }; textContent: string; nodeSize: number }, pos: number) => boolean | void): void; textBetween(from: number, to: number, separator: string): string }; selection: { from: number; to: number } };
    extensionManager: { extensions: Array<{ name: string; options: { hold?: { base: { state(): { unsaved: number } } } } }> };
  };
};

// Selects `quote` inside the editor's paragraph `index` (a DOM selection the editor reads, as a person's drag would set).
// P3-F (tracker row 277): first the editor's own document holds the paragraph the page shows and the host has
// acknowledged every edit, so none of the editor's own transactions (the last typed key's flush, the binding's answer to
// it) lands between the range and the editor's read of it and puts the caret back; then the editor's selection, not
// only the page's, holds the quote (Comment reads the editor's).
async function selectIn(text: Locator, index: number, quote: string): Promise<void> {
  await expect
    .poll(
      () =>
        text.evaluate((root, at) => {
          const editor = (root as EditorRoot).editor;
          if (!editor) return 'no editor on the element';
          const paragraphs: string[] = [];
          editor.state.doc.descendants((node) => {
            if (node.type.name === 'paragraph') paragraphs.push(node.textContent);
          });
          const unsaved = editor.extensionManager.extensions.find((extension) => extension.name === 'collaboration')?.options.hold?.base.state().unsaved ?? 0;
          return paragraphs[at] === root.querySelectorAll('p')[at]?.textContent && unsaved === 0 ? 'settled' : `paragraph "${paragraphs[at]}", ${unsaved} unacknowledged`;
        }, index),
      { timeout: 10_000, message: 'the editor holds the paragraph shown and the host has acknowledged every edit' },
    )
    .toBe('settled');
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

// The caret at the end of paragraph `index`. P3-D: the click lands on the paragraph's last line, since `End` ends the
// visual line and the governing system's type (D's scope, the P3 spec's Decision Log 61) wraps a paragraph in the panel.
// P3-F (tracker row 199, the paste): the caret is there in the editor's own selection too, which is what a paste
// replaces; the gate's foreground run pasted over the copy's selection while the page's caret was here.
// The placement is the case's precondition, not what it tests: one that does not hold is made again (twice on the
// guest lane, last in run 43471601277, after a Comments toggle reflowed the document; the cause is not captured), and
// each miss is written to the report (a `caret-retry` annotation and a log line) with where the caret was and whether
// the window had focus.
async function caretAtEndOf(page: Page, text: Locator, index: number): Promise<void> {
  const paragraph = text.locator('p').nth(index);
  const read = () =>
    text.evaluate((root, at) => {
      const selection = getSelection()!;
      const p = root.querySelectorAll('p')[at]!;
      const pageAtEnd = selection.isCollapsed && p.contains(selection.focusNode) && selection.focusOffset === (selection.focusNode?.textContent ?? '').length && p.textContent!.endsWith(selection.focusNode?.textContent ?? '');
      const editor = (root as EditorRoot).editor!;
      let end = -1;
      let seen = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && ++seen === at) end = pos + node.nodeSize - 1;
      });
      const { from, to } = editor.state.selection;
      return {
        page: pageAtEnd,
        editor: from === to && from === end,
        seen: { focusText: selection.focusNode?.textContent ?? null, focusOffset: selection.focusOffset, collapsed: selection.isCollapsed, from, to, end, windowFocus: document.hasFocus() },
      };
    }, index);
  await expect(async () => {
    const lastLine = await paragraph.evaluate((p) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      const lines = range.getClientRects();
      const line = lines[lines.length - 1]!;
      const box = p.getBoundingClientRect();
      return { x: Math.max(1, Math.min(line.right - box.left - 2, box.width - 1)), y: line.top - box.top + line.height / 2 };
    });
    await paragraph.click({ position: lastLine }); // P3-D
    await page.keyboard.press('End');
    try {
      await expect(text).toBeFocused({ timeout: 2_000 });
      await expect
        .poll(read, { message: 'the caret at the paragraph’s end, on the page and in the editor', timeout: 2_000 })
        .toMatchObject({ page: true, editor: true });
    } catch (error) {
      // A missed placement stays in the report even when a later one holds: the retry must not hide its cause.
      const seen = JSON.stringify((await read().catch((failure: unknown) => ({ seen: String(failure) }))).seen);
      test.info().annotations.push({ type: 'caret-retry', description: `paragraph ${index}: ${seen}` });
      console.log(`caret-retry: paragraph ${index}: ${seen}`);
      throw error;
    }
  }).toPass({ timeout: 10_000 });
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
  await record.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Add comment', exact: true }).click();
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
  // P3-F (tracker row 199, the paste): a dropped paste reports the editor's paste path (its transformPasted and
  // handlePaste props, the paste's transaction and any filter that refused it) beside the page's focus and selection
  const trace = await traceForeground(app, page, { editor: '[data-region="panel"] .ds-doc .ProseMirror' });

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
    // the caret step's entry reading holds both selections and the marks before the click; the paste step's, after it
    await trace.step('caret-before-paste', () => caretAtEndOf(page, text, 1));
    await trace.step(
      'commented-paste',
      async () => {
        await edit('paste');
        await expect(text.locator('p').nth(1)).toHaveText(`A second paragraph waits here.${QUOTE}`);
      },
      () =>
        text.evaluate((root) => {
          const editor = (root as EditorRoot).editor!;
          const { from, to } = editor.state.selection;
          const paragraphs: string[] = [];
          editor.state.doc.descendants((node) => {
            if (node.type.name === 'paragraph') paragraphs.push(node.textContent);
          });
          return { editorSelection: [from, to], editorParagraphs: paragraphs, page: Array.from(root.querySelectorAll('p')).map((p) => p.textContent) };
        }),
    );
    expect(await markedText(text), 'the copy carries no second comment').toEqual({ [threadId]: QUOTE });
    await expect(text.locator('p').nth(0).locator(`[data-thread="${threadId}"]`)).toHaveText(QUOTE);

    // a cut and a paste: the comment moves with its text
    await selectIn(text, 0, QUOTE);
    await edit('cut');
    await expect(text.locator('p').nth(0)).toHaveText('The owner reviews the  today.');
    await caretAtEndOf(page, text, 1);
    await page.keyboard.type(' Moved: ');
    await trace.step('cut-paste', async () => {
      await edit('paste');
      await expect(text.locator('p').nth(1)).toHaveText(`A second paragraph waits here.${QUOTE} Moved: ${QUOTE}`);
    });
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
  await addDocumentSection(record);
  const tabs = record.getByRole('tablist', { name: 'Tabs' });
  await expect(tabs.getByRole('tab')).toHaveText(['Restore notes', 'Tab 2']);
  await expect(text).toHaveText('', { timeout: 10_000 });
  await text.click();
  await page.keyboard.type('Appendix figures for October.');
  await durable(record);
  const { versionId } = await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: id, label: 'Two tabs' });

  // after the version: the second tab deleted, a reply on the older thread, new text with a thread of its own
  // P3-F (the owner's observation 3): the tab's own ×, and a tab with content goes once the owner confirms
  await tabs.getByRole('tab', { name: 'Tab 2' }).getByRole('button', { name: 'Delete Tab 2' }).click();
  const ask = page.getByRole('alertdialog', { name: 'Delete “Tab 2”?' });
  await ask.getByRole('button', { name: 'Delete tab' }).click();
  await expect(ask).toHaveCount(0);
  await expect(tabs).toHaveCount(0);
  await expect(text.locator('p')).toHaveText(['The budget review is on Friday.']);
  let rail = await railOf(record);
  const replied = await replyThroughActiveCard(record, rail, older, 'Posted after the version.'); // the word cut (G385)
  await expect(replied.getByRole('listitem')).toHaveText(['YouPosted after the version.']);
  if (await rail.isVisible()) await record.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: /^Comments/ }).click();
  await caretAtEndOf(page, text, 0);
  await page.keyboard.press('Enter');
  await page.keyboard.type('A later sentence for the board.');
  // P3-F (tracker row 277): a selection that does not hold reports the page's selection and the editor's transactions
  const trace = await traceForeground(launch!.app, page, { editor: '[data-region="panel"] .ds-doc .ProseMirror' });
  const newer = await trace.step('restore-scene-selection', () => commentOn(page, record, text, 1, 'later sentence'));
  await durable(record);

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
  // the word cut (G395, G388): the toggle reads "Deleted (N)", what it holds its description; a gone passage's quote is
  // struck, the sentence its description
  const showDeleted = rail.getByRole('button', { name: /^Deleted \(\d+\)$/ });
  await expect(showDeleted).toHaveAccessibleDescription('Comments on deleted text');
  await expect(showDeleted).toHaveAttribute('aria-expanded', 'false'); // a disclosure (the pair review's fix wave)
  await expect(newerItem, 'the thread whose passage is gone is hidden by default').toHaveCount(0);
  await showDeleted.click();
  await expect(newerItem, 'the thread made after the version stays, its passage gone').toHaveAttribute('data-orphan', '');
  await expect(newerItem.locator('.doc-thread-quote-text[data-removed]')).toHaveText('later sentence');
  await expect(newerItem.getByRole('button', { name: /^Show passage: / })).toHaveAccessibleDescription('The commented passage was removed.');
  await tabs.getByRole('tab', { name: 'Tab 2' }).click();
  await expect(text).toHaveText('Appendix figures for October.', { timeout: 10_000 });
  const listed = await ok<{ versions: { id: number; kind: string; label?: string }[] }>(page, 'artifacts.versions', { artifactId: id });
  expect(listed.versions).toContainEqual(expect.objectContaining({ id: restored.versionId, kind: 'restore', label: 'Restored from Two tabs' }));
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

// D14 through the product editor and the existing host-side agent channel (no engine or new IPC API).
test('suggestions keep the base untouched until Accept, credit the agent, and Reject keeps its content', async () => {
  const page = await start(true);
  const seam = new PerfSeam(join(userData!, 'document-perf'));
  await expect.poll(() => existsSync(join(seam.dir, 'in'))).toBe(true);
  const { id, main } = await openInMain(page, 'Suggestion review');
  const live = main.locator('[data-editor="live"]');
  await live.fill('Original.');
  await durable(main);
  const agent = 'document-suggestion-agent';
  const read = await seam.call<ReadResult>(agent, 'artifact_read', { artifact: id });
  expect(read.isError).toBe(false);
  const block = /\^([A-Za-z0-9_-]+)\s*$/m.exec(read.result!.markdown)![1];
  const edit = (ops: unknown[], mode?: string) => seam.call(agent, 'artifact_edit', { artifact: id, baseRevision: 'last', ops, ...(mode && { mode }) });
  expect((await edit([{ op: 'replace_text', block, old: 'Original.', new: 'Direct.' }])).isError).toBe(false);
  await expect(live).toHaveText('Direct.');
  const baseContent = () => live.evaluate((el) => JSON.stringify((el as HTMLElement & { editor: { getJSON(): unknown } }).editor.getJSON()));
  const before = await baseContent();
  expect((await edit([{ op: 'insert', after: block, markdown: 'Proposed by the agent. ^proposal' }], 'suggest')).isError).toBe(false);
  await expect(main.getByLabel('Suggested document')).toContainText('Proposed by the agent.');
  expect(await baseContent()).toBe(before);
  await main.getByRole('button', { name: 'Accept suggestion 1', exact: true }).click();
  await expect(live).toContainText('Proposed by the agent.');
  const item = await live.evaluate((el) => {
    type Item = { id: { client: number; clock: number } };
    type Node = { getAttr(name: string): unknown; toArray(): Node[]; _start: Item };
    const editor = (el as HTMLElement & { editor: { extensionManager: { extensions: Array<{ name: string; options: { ytype?: Node } }> } } }).editor;
    return editor.extensionManager.extensions.find((extension) => extension.name === 'collaboration')!.options.ytype!.toArray().find((node) => node.getAttr('id') === 'proposal')!._start.id;
  });
  const bytes = await page.evaluate(async (artifactId) => {
    const result = await (window as unknown as { maws: { invoke(name: string, args: unknown): Promise<{ ok: boolean; value: { bytes: Uint8Array } }> } }).maws.invoke('artifacts.attributions', { artifactId, fromSeq: 0, toSeq: Number.MAX_SAFE_INTEGER });
    if (!result.ok) throw new Error('attributions refused');
    return Array.from(result.value.bytes);
  }, id);
  const map = decodeMap(Uint8Array.from(bytes));
  expect(insertedBy(map, item)?.actor).toBe(`session:${agent}`);
  expect(carriedBy(map, item)).toBe('accept');

  await ok(page, 'artifacts.update', { artifactId: id, agentEditsAsSuggestions: true });
  await seam.call(agent, 'artifact_read', { artifact: id });
  const accepted = await baseContent();
  expect((await edit([{ op: 'insert', after: block, markdown: 'Reject this proposal. ^rejected' }])).isError).toBe(false);
  await expect(main.getByLabel('Suggested document')).toContainText('Reject this proposal.');
  expect(await baseContent()).toBe(accepted);
  await main.getByRole('button', { name: 'Reject suggestion 1', exact: true }).click();
  await expect(main.getByRole('button', { name: 'Reject suggestion 1', exact: true })).toHaveCount(0);
  expect(await baseContent()).toBe(accepted);
});

// ---- UX wave U5a: a document's comment sent to the main conversation (A3, A2) -----------------------------------------

// docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M8. A live parent on C3's replay transport (the library's
// session case, support/library-session.ts: its first turn, then the turn the comment opens), the owner's document in
// the pinned Artifacts surface beside it. The open-comment count does not move for a card opened and closed unsent, and
// rises by one once the comment is sent; the card's place then says where it went. Beside its own session the card
// names no session (decision 16: "Session: <title>" only when the receiving session is not the one the main area shows;
// e2e/document-standalone.spec.ts shows the line for a document in a tab of its own).
const U5A_QUOTE = 'Friday';
const U5A_COMMENT = 'Is Friday still the date?';
const U5A_REPLY = 'Read the comment: Friday stands.';

test('UX wave U5a: a document’s count ignores a card opened and closed unsent and rises by one when its comment is sent to main; the card’s place says where it went', async () => {
  test.setTimeout(180_000);
  const c = await startSessionCase((cwd) => {
    const parent = new SideJournal(PARENT, cwd);
    parent.turn(FIRST_REPLY); // the case's first prompt
    parent.turn(U5A_REPLY); // the comment's message
    return [parent];
  });
  try {
    const { page, maws, parent } = c;
    const { artifact } = value(await invoke(page, 'artifacts.create', { kind: 'document', title: 'Launch notes' }));
    await openArtifactInPanel(page, artifact.id);
    await pinSurfaceForSessions(page, 'Artifacts');
    await (await sidebarRow(page, { appSessionId: parent as never })).click(); // the main area on the parent, the document beside it
    const panel = page.locator('[data-region="panel"]');
    const record = panel.locator(`[data-artifact-record="${artifact.id}"]`);
    const text = record.locator('.ds-doc .ProseMirror');
    await expect(text).toBeVisible({ timeout: 15_000 });
    await text.click();
    await page.keyboard.type('The launch moves to Friday.');
    await expect(text.locator('p')).toHaveText(['The launch moves to Friday.']);
    const count = panel.getByTitle(/^\d+ open comments?$/);
    const card = page.locator('[data-comment-card]');
    const addComment = record.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Add comment', exact: true });
    await expect(count, 'before any comment').toHaveCount(0);

    // a card opened and closed unsent: the count never moves, and Close withdraws the comment's mark
    await selectIn(text, 0, U5A_QUOTE);
    await addComment.click();
    await expect(card).toHaveAttribute('data-anchor-locator', U5A_QUOTE);
    await expect(text.locator('[data-thread]'), 'the unsent comment’s mark').toHaveCount(1);
    await expect(count, 'an unsent card is no comment').toHaveCount(0);
    await expect(card.locator('[data-card-parent]'), 'beside its own session the card names none').toHaveCount(0);
    await card.getByRole('button', { name: 'Close' }).click();
    await expect(card).toHaveCount(0);
    await expect(text.locator('[data-thread]'), 'Close withdrew it').toHaveCount(0);
    await expect(count, 'after Close').toHaveCount(0);

    // sent to main: one message in the parent, the place's line, and the count at one
    await selectIn(text, 0, U5A_QUOTE);
    await addComment.click();
    await expect(card).toHaveAttribute('data-anchor-locator', U5A_QUOTE);
    await card.getByRole('textbox', { name: 'Comment' }).fill(U5A_COMMENT);
    await card.getByRole('checkbox', { name: 'Send to main' }).check();
    const listed = value(await invoke(page, 'session.list', {})).sessions.find((row) => row.appId === parent)?.title.text ?? '';
    await card.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(record.locator('[data-sent-note]'), 'the card’s place says where it went').toHaveText(`Sent to ${listed.trim() === '' ? 'New chat' : listed}`);
    await expect(panel.getByTitle('1 open comment', { exact: true }).first()).toBeVisible();
    const users = () =>
      readdirSync(join(maws.userData, 'engine-host', 'journal', parent))
        .filter((name) => name.endsWith('.jsonl'))
        .sort()
        .flatMap((name) => readFileSync(join(maws.userData, 'engine-host', 'journal', parent, name), 'utf8').split('\n').filter(Boolean))
        .map((line) => JSON.parse(line) as { direction: string; frame: { type?: string; message?: { content: { type: string; text?: string }[] } } })
        .filter((row) => row.direction === 'out' && row.frame.type === 'user');
    await expect.poll(() => users().length, { timeout: 20_000, message: 'the comment reached the parent' }).toBe(2);
    const content = users()[1]!.frame.message!.content;
    expect(content.map((block) => block.type)).toEqual(['text']);
    const read = readAnchoredMessage(content[0]!.text!);
    expect(read?.comments.map(({ anchor, text: words }) => ({ kind: anchor.kind, locator: anchor.locator, text: words }))).toEqual([{ kind: 'artifact-comment', locator: U5A_QUOTE, text: U5A_COMMENT }]);
    expect(content[0]!.text, 'one comment’s text, as a single comment has always been written').toBe(commentsMessage(read!.comments, 'main'));
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: parent as never })).turn, { timeout: 20_000, message: 'the comment’s turn ended' }).toBeNull();
    await expect(page.locator('[data-region="main"]').getByText(U5A_REPLY)).toBeVisible({ timeout: 20_000 });
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await c.cleanup();
  }
});
