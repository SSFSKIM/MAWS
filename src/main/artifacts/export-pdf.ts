// The PDF route of the document export (D12 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.8 of the P3
// spec): the standalone HTML export printed by a hidden window on the in-memory `maws-capture` partition, the one
// route for `artifact_export` and the editor's Export menu (never the live editor's window, which would print the
// chrome). The page needs no script and loads nothing from outside (its own CSP says so), so the window runs with
// JavaScript off, denies new windows and refuses navigation. The page is written to a file of its own in the OS's
// temporary directory and loaded from there, removed after (its images are inlined, and Chromium caps a `data:` URL
// at 2 MB). `preferCSSPageSize` makes the page's `@page` rule the paper and the margins (Letter unless A4 is chosen or the system's page tokens say otherwise, the margin
// `--ds-page-margin`, else 1in); headings become the PDF's outline. A's export service (its M7) owns the capture window
// in the end; this is the function its document exporter's context calls until then and the shape it keeps.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import { CAPTURE_PARTITION } from '../deliverables/capture';

export const PDF_PRINT_GUARD_MS = 30_000;

export async function printHtmlToPdf(html: string, { guardMs = PDF_PRINT_GUARD_MS }: { guardMs?: number } = {}): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'maws-print-'));
  const win = new BrowserWindow({
    show: false,
    width: 816, // a Letter page at 96 px per inch, so a layout read before printing is the page's
    height: 1056,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, partition: CAPTURE_PARTITION, backgroundThrottling: false, disableDialogs: true, spellcheck: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<never>((_, reject) => {
      guard = setTimeout(() => reject(new Error(`the page did not print within ${guardMs / 1000} s`)), guardMs);
    });
    const printed = (async () => {
      const page = join(dir, 'page.html');
      await writeFile(page, html, 'utf8');
      await win.loadFile(page);
      return win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, generateDocumentOutline: true });
    })();
    const pdf = await Promise.race([printed, timedOut]);
    return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  } finally {
    clearTimeout(guard);
    if (!win.isDestroyed()) win.destroy();
    await rm(dir, { recursive: true, force: true });
  }
}
