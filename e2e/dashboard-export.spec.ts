// A dashboard's four exports in the product app (P3-E2 M5 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md,
// acceptance 5 and M5's proof; E's Decision Logs 32 and 35; `pnpm e2e:dashboard`, MAWS_HARNESS=0). The owner draws a bar
// chart and a table over `sales` (Korean labels) in a main tab; the header's Export menu writes a PDF and A's
// `artifacts.export` (the library's and `artifact_export`'s route) writes all four. The HTML holds the very figure the
// editor drew (the same markup, parsed by the same engine) and the native table; Word holds the SVG with a PNG at twice
// its size beside it, the native table and the captions; Markdown the preview rows under the caption; every label the
// snapshot's time. A replacement after an export changes the next export only. Evidence (the files, the standalone
// page's picture, the PDF's first page) goes to test-results/dashboard-proof/.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { bindCsv, chart, durable, figures, insertBlocks, ok, openInMain, paragraph, SESSION_A, startApp, type DashboardApp } from './support/dashboards';

const PROOF = 'test-results/dashboard-proof';
const TITLE = 'Export board';
const OLD = { csv: 'region,total\n서울,120\n부산,98\n제주,40\n', at: Date.UTC(2026, 9, 1, 9, 0) };
const NEW = { csv: 'region,total\n서울,310\n부산,280\n제주,250\n', at: Date.UTC(2026, 9, 2, 10, 30) };
const OLD_TIME = 'updated 2026-10-01 09:00 UTC';
const NEW_TIME = 'updated 2026-10-02 10:30 UTC';
const BAR = { view: 'bar', x: 'region', y: 'total', title: '지역별 매출' };
const TABLE = { view: 'table', columns: ['region', 'total'], title: 'Sales table' };

let app: DashboardApp | null = null;
test.afterEach(async () => {
  await app?.close();
  app = null;
});

/** A PNG's size from its header. */
const pngSize = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

test('the four exports draw the editor’s figure and native table with snapshot times, from the menu and the service; a later replacement changes only later exports', async () => {
  test.setTimeout(240_000);
  app = await startApp(PROOF);
  const { page, launch } = app;
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'dashboard', title: TITLE });
  const id = artifact.id;
  const main = await openInMain(page, id);
  await bindCsv(page, id, 'sales', { title: 'Sales', name: 'sales.csv', csv: OLD.csv, at: OLD.at, appSessionId: SESSION_A });
  await insertBlocks(main, [paragraph('Totals by region.'), chart('sales', BAR), chart('sales', TABLE)]);
  await durable(main);
  const views = figures(main);
  await expect(views.nth(0).locator('.dash-figure > svg')).toBeVisible({ timeout: 15_000 });
  await expect(views.nth(1).locator('.dash-figure > table')).toBeVisible({ timeout: 15_000 });
  // the editor's figure as the page's engine serialises it
  const editorSvg = await views.nth(0).locator('.dash-figure > svg').evaluate((el) => el.outerHTML);
  const editorTable = await views.nth(1).locator('.dash-figure > table').evaluate((el) => el.outerHTML);

  const exported = async (format: string) => {
    const { path } = await ok<{ path: string }>(page, 'artifacts.export', { artifactId: id, format });
    copyFileSync(path, `${PROOF}/export-board.${format}`);
    return readFileSync(path);
  };

  await test.step('the header’s Export menu writes the PDF', async () => {
    const header = page.locator('[data-region="main"] [data-editor-header]');
    await header.getByRole('button', { name: 'Export' }).click();
    await page.getByRole('menuitem', { name: 'PDF (.pdf)', exact: true }).click();
    await expect(header.getByRole('button', { name: /^Exported \S+\.pdf$/ })).toBeVisible({ timeout: 60_000 });
  });

  await test.step('HTML: the editor’s figure and table, captions, the label with the snapshot time; nothing executable', async () => {
    const html = (await exported('html')).toString('utf8');
    const parsed = await page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, 'text/html');
      return {
        svg: doc.querySelector('.dash-figure > svg')?.outerHTML ?? null,
        table: doc.querySelector('.dash-figure > table')?.outerHTML ?? null,
        captions: Array.from(doc.querySelectorAll('.dash-caption'), (el) => el.textContent),
        labels: Array.from(doc.querySelectorAll('.dash-source-label'), (el) => el.textContent),
      };
    }, html);
    expect(parsed.svg).toBe(editorSvg);
    expect(parsed.table).toBe(editorTable);
    expect(parsed.captions).toEqual(['지역별 매출', 'Sales table']);
    for (const label of parsed.labels) expect(label).toContain(`Sales · from sales.csv · ${OLD_TIME}`);
    expect(html).not.toMatch(/<script|\son[a-z]+=|var\(--ds-/i);
    // the standalone page, pictured offscreen as a reader's browser draws it
    const shot = await launch.app.evaluate(async ({ BrowserWindow }, file) => {
      const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { offscreen: true, javascript: false } });
      try {
        await win.loadFile(file);
        await new Promise((resolve) => setTimeout(resolve, 500));
        return (await win.webContents.capturePage()).toPNG().toString('base64');
      } finally {
        win.destroy();
      }
    }, `${process.cwd()}/${PROOF}/export-board.html`);
    writeFileSync(`${PROOF}/export-board-html.png`, Buffer.from(shot, 'base64'));
  });

  await test.step('Word: the SVG with its PNG at twice its size, the native table, the captions and labels', async () => {
    const zip = await JSZip.loadAsync(await exported('docx'));
    const media = Object.keys(zip.files).filter((name) => name.startsWith('word/media/') && !zip.files[name].dir);
    const svgs = await Promise.all(media.filter((name) => name.endsWith('.svg')).map((name) => zip.file(name)!.async('string')));
    const pngs = await Promise.all(media.filter((name) => name.endsWith('.png')).map((name) => zip.file(name)!.async('uint8array')));
    expect(svgs).toHaveLength(1);
    expect(pngs).toHaveLength(1);
    const svgSize = /width="([\d.]+)" height="([\d.]+)"/.exec(svgs[0])!;
    expect(pngSize(pngs[0])).toEqual({ width: Math.round(Number(svgSize[1]) * 2), height: Math.round(Number(svgSize[2]) * 2) });
    writeFileSync(`${PROOF}/export-board-docx-fallback.png`, pngs[0]);
    const parsedSvg = await page.evaluate((text) => new DOMParser().parseFromString(`<!doctype html><body>${text}`, 'text/html').querySelector('svg')!.outerHTML, svgs[0]);
    expect(parsedSvg).toBe(editorSvg); // Word's figure is the editor's
    const document = await zip.file('word/document.xml')!.async('string');
    const tables = [...document.matchAll(/<w:tbl>.*?<\/w:tbl>/gs)].map(([table]) => [...table.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(([, t]) => t));
    expect(tables).toEqual([['region', 'total', '서울', '120', '부산', '98', '제주', '40']]);
    for (const text of ['지역별 매출', 'Sales table', `Sales · from sales.csv · ${OLD_TIME}`]) expect(document).toContain(text);
  });

  await test.step('Markdown: each view’s preview rows under its caption, the label with the snapshot time', async () => {
    const md = (await exported('md')).toString('utf8');
    expect(md).toContain('**지역별 매출**\n\n| region | total |\n| --- | ---: |\n| 서울 | 120 |\n| 부산 | 98 |\n| 제주 | 40 |');
    expect(md).toContain(`*Sales · from sales.csv · ${OLD_TIME} by `);
    expect(md).not.toContain(':::chart');
  });

  await test.step('PDF: printed pages, the first pictured', async () => {
    const pdf = await exported('pdf');
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g)?.length ?? 0).toBeGreaterThan(0);
    // macOS draws the PDF's first page as a picture for the evidence (sips is the system's image tool)
    if (process.platform === 'darwin') {
      execFileSync('sips', ['-s', 'format', 'png', `${PROOF}/export-board.pdf`, '--out', `${PROOF}/export-board-pdf.png`], { stdio: 'ignore' });
      expect(existsSync(`${PROOF}/export-board-pdf.png`)).toBe(true);
    }
  });

  await test.step('a replacement after the exports: the next export shows the new snapshot and time, the files written stay', async () => {
    await bindCsv(page, id, 'sales', { title: 'Sales', name: 'sales.csv', csv: NEW.csv, at: NEW.at, appSessionId: SESSION_A });
    const md = (await exported('md')).toString('utf8');
    expect(md).toContain('| 서울 | 310 |');
    expect(md).toContain(NEW_TIME);
    expect(readFileSync(`${PROOF}/export-board.html`, 'utf8')).toContain(OLD_TIME);
  });
  expect(launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
