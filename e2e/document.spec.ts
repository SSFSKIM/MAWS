// The document editor in the product app (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, "Proves (e2e,
// product)"; `pnpm e2e:document-app`, the product build, MAWS_HARNESS=0): a document the owner creates opens through L's
// registry in an `artifact` main tab and in the panel's Artifacts tool as two replicas of one host doc, each typing
// reaching the other; the X32 header says Saving… then All changes saved around a keystroke and Reconnecting… across a
// host restart, after which the typing still lands; History lists A's versions, Save version adds a named one, and
// Restore brings it back with the banner. The exporters run in main (through their e2e seam, until A's export service
// registers them) and write `.md`, `.html`, `.docx` and a `.pdf` beginning `%PDF-` with one page per tab on Letter and
// on A4; the header's Export menu reaches the host's export and says its answer in the header's action.
// Every launch's userData is its own directory under /tmp; windows are never shown (the e2e quiet mode).
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
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
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
