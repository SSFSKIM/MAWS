// A dashboard's four exports in the product app (P3-E2 M5 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md,
// acceptance 5 and M5's proof; P3-E Decision Logs 32, 33, 35 and 37; `pnpm e2e:dashboard`, MAWS_HARNESS=0).
// - The owner draws a bar chart and a table over `sales` (Korean labels) in a main tab; the header's Export menu saves a
//   PDF where the owner chooses (main's save seam, MAWS_E2E_SAVE_PATH; the toast saying where) and A's `artifacts.export`
//   (the library's route) writes all four. The HTML holds the very figure the editor drew (the same markup, parsed by
//   the same engine) and the native table; Word holds the SVG with a PNG at twice its size beside it, the native table
//   and the captions; Markdown the preview rows under the caption; the PDF's text (Poppler's pdftotext, as C's export
//   group and M1 read PDFs) the captions, labels, table values and the snapshot's UTC time. A replacement after an
//   export changes the next export only. P3-F (8.2, F7): during a version's preview the menu saves that version, its old
//   snapshot and time; while two versions are compared it saves nothing; once history is left, the live data.
// - Governed by a system with uploaded faces (the bundled Official's Noto Serif KR), the editor's figure is still the
//   exports' figure byte for byte, naming the authored family, while the editor draws it in its scope's face; the HTML
//   declares the face and the PDF embeds it (pdffonts).
// - The agent's `artifact_export` through the real `maws` server (a recorded session replayed, its five calls a create
//   and the four formats) writes all four.
// - The owner's comment on a chart, replied to in the rail, is a Word comment on the view's caption, resolved as it is;
//   M6: with the chart the last block written (its selection watched, the tracker's last-block row).
// Evidence (the files, the standalone page's picture, the PDF's first page) goes to test-results/dashboard-proof/.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { asDocumentReplay } from './support/document-replay';
import { bindCsv, chart, commentSelectedChart, durable, figures, insertBlocks, ok, openInMain, openInPanel, paragraph, selectPanelSession, railOf, reply, selectChart, SESSION_A, startApp, watchSelection, type DashboardApp } from './support/dashboards';
import { allowNext, idle, mcpCalls, mcpResultOf, PASS3, recordedCwd, replay, resultText, scene, show } from './support/maws-tools';

const PROOF = 'test-results/dashboard-proof';
const POPPLER = '/opt/homebrew/bin'; // the Mac lane's Poppler, as e2e/presentations-export.spec.ts reads PDFs
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
/** A PDF's text (pdftotext's layout), kept beside it as evidence. */
const pdfText = (path: string, evidence: string) => {
  const text = execFileSync(join(POPPLER, 'pdftotext'), ['-layout', path, '-'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(`${PROOF}/${evidence}.pdftotext.txt`, text);
  return text;
};
/** A PDF's fonts (pdffonts' table), kept beside it as evidence. */
const pdfFonts = (path: string, evidence: string) => {
  const fonts = execFileSync(join(POPPLER, 'pdffonts'), [path], { encoding: 'utf8' });
  writeFileSync(`${PROOF}/${evidence}.pdffonts.txt`, fonts);
  return fonts;
};
/** The PDF's first page as a PNG beside it, for the evidence. */
const pdfPicture = (path: string, out: string) => execFileSync(join(POPPLER, 'pdftoppm'), ['-png', '-r', '96', '-f', '1', '-l', '1', '-singlefile', path, out]);
/** A figure or table as the page's engine serialises it, parsed from `html`. */
const parsedFigure = (page: Page, html: string) =>
  page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    return {
      svg: doc.querySelector('.dash-figure > svg')?.outerHTML ?? null,
      table: doc.querySelector('.dash-figure > table')?.outerHTML ?? null,
      captions: Array.from(doc.querySelectorAll('.dash-caption'), (el) => el.textContent),
      labels: Array.from(doc.querySelectorAll('.dash-source-label'), (el) => el.textContent),
    };
  }, html);
const svgOf = (page: Page, text: string) => page.evaluate((svg) => new DOMParser().parseFromString(`<!doctype html><body>${svg}`, 'text/html').querySelector('svg')!.outerHTML, text);
async function docxParts(bytes: Buffer): Promise<{ zip: JSZip; document: string; svgs: string[]; pngs: Uint8Array[] }> {
  const zip = await JSZip.loadAsync(bytes);
  const media = Object.keys(zip.files).filter((name) => name.startsWith('word/media/') && !zip.files[name].dir);
  return {
    zip,
    document: await zip.file('word/document.xml')!.async('string'),
    svgs: await Promise.all(media.filter((name) => name.endsWith('.svg')).map((name) => zip.file(name)!.async('string'))),
    pngs: await Promise.all(media.filter((name) => name.endsWith('.png')).map((name) => zip.file(name)!.async('uint8array'))),
  };
}
/** The service's export of `format`: its bytes, its copy as evidence (`<stem>.<format>`, or `<stem>-<label>.<format>` for
 * a later export of a format, so no export's evidence overwrites an earlier one's), and the exporter's own file under
 * the store, by evidence name, in `files`. */
const exportedBy = (page: Page, artifactId: string, stem: string) => {
  const files = new Map<string, string>();
  const exported = async (format: string, label?: string) => {
    const { path } = await ok<{ path: string }>(page, 'artifacts.export', { artifactId, format });
    const name = `${stem}${label === undefined ? '' : `-${label}`}.${format}`;
    copyFileSync(path, `${PROOF}/${name}`);
    files.set(name, path);
    return readFileSync(path);
  };
  return Object.assign(exported, { files });
};

test('the four exports draw the editor’s figure and native table with snapshot times, from the menu and the service; a later replacement changes only later exports', async () => {
  test.setTimeout(300_000);
  // P3-F (F7): where main's save seam puts the menu's exports (evidence beside the rest)
  const saved = resolve(PROOF, 'saved');
  rmSync(saved, { recursive: true, force: true });
  mkdirSync(saved, { recursive: true });
  app = await startApp(PROOF, { MAWS_E2E_SAVE_PATH: saved });
  const { page, launch } = app;
  const header = page.locator('[data-region="main"] [data-editor-header]');
  const pick = async (label: string) => {
    await header.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
  };
  const savedFile = (name: string) => join(saved, name);
  const appears = (name: string, check: (bytes: Buffer) => boolean) =>
    expect.poll(() => (existsSync(savedFile(name)) ? check(readFileSync(savedFile(name))) : false), { timeout: 60_000, message: `${name} saved` }).toBe(true);
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'dashboard', title: 'Export board' });
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
  const exported = exportedBy(page, id, 'export-board');

  await test.step('the header’s Export menu saves the PDF where the owner chooses, the toast saying where', async () => {
    await pick('PDF (.pdf)');
    await appears('Export board.pdf', (bytes) => bytes.subarray(0, 5).toString('latin1') === '%PDF-');
    await expect(page.getByRole('region', { name: /^Notifications/ }).getByText(`Saved to ${savedFile('Export board.pdf')}`).first()).toBeVisible();
    await expect(header.getByRole('button', { name: /^Exported / }), 'no finished export left in the header').toHaveCount(0); // P3-F (c65)
  });

  await test.step('HTML: the editor’s figure and table, captions, the label with the snapshot time; nothing executable', async () => {
    const html = (await exported('html')).toString('utf8');
    const parsed = await parsedFigure(page, html);
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
    const { document, svgs, pngs } = await docxParts(await exported('docx'));
    expect(svgs).toHaveLength(1);
    expect(pngs).toHaveLength(1);
    const svgSize = /width="([\d.]+)" height="([\d.]+)"/.exec(svgs[0])!;
    expect(pngSize(pngs[0])).toEqual({ width: Math.round(Number(svgSize[1]) * 2), height: Math.round(Number(svgSize[2]) * 2) });
    writeFileSync(`${PROOF}/export-board-docx-fallback.png`, pngs[0]);
    expect(await svgOf(page, svgs[0])).toBe(editorSvg); // Word's figure is the editor's
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

  await test.step('PDF: the captions, Korean labels, table values and the snapshot’s UTC time are its text; its first page pictured', async () => {
    const pdf = await exported('pdf');
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const text = pdfText(`${PROOF}/export-board.pdf`, 'export-board');
    pdfFonts(`${PROOF}/export-board.pdf`, 'export-board');
    for (const word of ['Totals by region.', '지역별 매출', 'Sales table', '서울', '부산', '제주', '120', '98', '40', `Sales · from sales.csv · ${OLD_TIME}`]) expect(text).toContain(word);
    expect(text).not.toContain('Chart: sales');
    pdfPicture(`${PROOF}/export-board.pdf`, `${PROOF}/export-board-pdf`);
    expect(existsSync(`${PROOF}/export-board-pdf.png`)).toBe(true);
  });

  await test.step('a replacement after the exports: the next export shows the new snapshot and time, the files written stay', async () => {
    await ok(page, 'artifacts.saveVersion', { artifactId: id, label: 'Old data' }); // P3-F (F7): the version the preview step shows
    await bindCsv(page, id, 'sales', { title: 'Sales', name: 'sales.csv', csv: NEW.csv, at: NEW.at, appSessionId: SESSION_A });
    const md = (await exported('md', 'replaced')).toString('utf8');
    expect(md).toContain('| 서울 | 310 |');
    expect(md).toContain(NEW_TIME);
    // the exporter's own earlier files under the store, not the evidence copies: a new file for the new export, and each
    // earlier one still the bytes it had when written (its evidence copy, taken then and untouched since)
    const replaced = exported.files.get('export-board-replaced.md')!;
    for (const name of ['export-board.html', 'export-board.md']) {
      const file = exported.files.get(name)!;
      expect(file, name).not.toBe(replaced);
      expect(readFileSync(file).equals(readFileSync(`${PROOF}/${name}`)), `${name}: the exporter's file is unchanged`).toBe(true);
    }
    expect(readFileSync(exported.files.get('export-board.html')!, 'utf8')).toContain(OLD_TIME);
    expect(readFileSync(exported.files.get('export-board.md')!, 'utf8')).toContain(OLD_TIME);
  });

  await test.step('P3-F (8.2, F7): during a version’s preview the menu saves that version’s data and time, while two are compared nothing, and the live data once history is left', async () => {
    await durable(main);
    await ok(page, 'artifacts.saveVersion', { artifactId: id, label: 'New data' });
    await main.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Version history' }).click();
    const rail = main.getByRole('complementary', { name: 'Version history' });
    await rail.getByRole('button', { name: /^Version Old data/ }).click();
    const bar = main.getByRole('toolbar', { name: 'Version preview' });
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await pick('Markdown (.md)');
    await appears('Export board.md', (bytes) => bytes.toString('utf8').includes('| 서울 | 120 |'));
    const previewed = readFileSync(savedFile('Export board.md'), 'utf8');
    expect(previewed).toContain(OLD_TIME);
    expect(previewed, 'the version shown, not the live data').not.toContain('| 서울 | 310 |');
    copyFileSync(savedFile('Export board.md'), `${PROOF}/export-board-preview.md`);

    await rail.getByRole('button', { name: /^Version New data/ }).click({ modifiers: ['Shift'] });
    await expect(bar.getByText('Old data → New data')).toBeVisible({ timeout: 15_000 });
    await header.getByRole('button', { name: 'Export', exact: true }).click();
    const items = page.getByRole('menuitem');
    await expect(items).toHaveCount(6);
    for (const item of await items.all()) await expect(item, 'two versions compared: nothing to export').toBeDisabled();
    await page.keyboard.press('Escape');

    await bar.getByRole('button', { name: 'Back to document' }).click();
    await expect(bar).toBeHidden();
    rmSync(savedFile('Export board.md'));
    await pick('Markdown (.md)');
    await appears('Export board.md', (bytes) => bytes.toString('utf8').includes('| 서울 | 310 |'));
    expect(readFileSync(savedFile('Export board.md'), 'utf8')).toContain(NEW_TIME);
  });
  expect(launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

test('governed by a system with uploaded faces: the editor’s figure is the exports’ byte for byte, drawn in the scope’s face, the face declared in HTML and embedded in the PDF', async () => {
  test.setTimeout(180_000);
  app = await startApp(PROOF);
  const { page, launch } = app;
  const systems = (await ok<{ artifacts: { id: string; title: string }[] }>(page, 'artifacts.list', { filter: { kind: 'design_system' } })).artifacts;
  const official = systems.find((system) => system.title === 'Official')!;
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'dashboard', title: 'Official board', designSystemId: official.id });
  const id = artifact.id;
  const main = await openInMain(page, id);
  await bindCsv(page, id, 'sales', { title: 'Sales', name: 'sales.csv', csv: OLD.csv, at: OLD.at });
  await insertBlocks(main, [paragraph('Totals by region.'), chart('sales', BAR)]);
  await durable(main);
  const svg = figures(main).first().locator('.dash-figure > svg');
  await expect(svg).toBeVisible({ timeout: 15_000 });
  const editorSvg = await svg.evaluate((el) => el.outerHTML);
  // the figure names the authored family; the page draws it in its scope's face, declared under a private name
  expect(editorSvg).toMatch(/^<svg [^>]* font-family="[^"]*&quot;Noto Serif KR&quot;/);
  expect(editorSvg).not.toContain('ds-face-');
  const drawnIn = await svg.evaluate((el) => getComputedStyle(el).fontFamily);
  expect(drawnIn).toMatch(/ds-face-[0-9a-z]+, "Noto Serif KR"/);
  const exported = exportedBy(page, id, 'official-board');

  const html = (await exported('html')).toString('utf8');
  expect((await parsedFigure(page, html)).svg).toBe(editorSvg);
  expect(html).toMatch(/@font-face \{\s*font-family: "Noto Serif KR";[^}]*src: url\("data\\3a font\/woff2/);
  const { svgs, pngs } = await docxParts(await exported('docx'));
  expect(await svgOf(page, svgs[0])).toBe(editorSvg);
  writeFileSync(`${PROOF}/official-board-docx-fallback.png`, pngs[0]);
  await exported('pdf');
  expect(pdfFonts(`${PROOF}/official-board.pdf`, 'official-board')).toMatch(/NotoSerifKR/);
  expect(pdfText(`${PROOF}/official-board.pdf`, 'official-board')).toContain('서울');
  pdfPicture(`${PROOF}/official-board.pdf`, `${PROOF}/official-board-pdf`);
  expect(launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

// E2's recorded artifact session (`pass3/p1-maws-artifacts`, as B's document export case replays it in
// e2e/maws-tools.spec.ts) with its five `maws` calls made a dashboard's create and four `artifact_export` calls; the data
// is bound between the create and the first export, as the owner's bind (the agent's `artifact_dataset` is M2's).
const ARTIFACTS = `${PASS3}/p1-maws-artifacts.jsonl`;
const CONTENT = [
  '# Sales',
  '',
  `:::chart {spec-json='{"view":"bar","x":"region","y":"total","title":"Sales by region"}'}`,
  'sales',
  ':::',
  '',
  `:::chart {spec-json='{"view":"table","title":"Sales table"}'}`,
  'sales',
  ':::',
].join('\n');

test('the agent exports a dashboard through the real server: Markdown, HTML, DOCX and PDF, each with the drawn views', async () => {
  test.setTimeout(180_000);
  const repo = recordedCwd(ARTIFACTS);
  const replayed = asDocumentReplay(
    ARTIFACTS,
    [
      { name: 'artifact_create', input: { kind: 'dashboard', title: 'Sales', handle: 'sales-board', content: CONTENT } },
      { name: 'artifact_export', input: { artifact: 'sales-board', format: 'md' } },
      { name: 'artifact_export', input: { artifact: 'sales-board', format: 'html' } },
      { name: 'artifact_export', input: { artifact: 'sales-board', format: 'docx' } },
      { name: 'artifact_export', input: { artifact: 'sales-board', format: 'pdf' } },
    ],
    'dashboard-export',
  );
  const existed = existsSync(repo);
  mkdirSync(repo, { recursive: true });
  mkdirSync(PROOF, { recursive: true });
  try {
    await scene({ titles: ['P3-E: dashboard export'], repo }, async (s) => {
      const [id] = s.ids;
      await show(s, id);
      await replay(s, id, replayed);
      await allowNext(s, id); // Write, as recorded
      await allowNext(s, id); // the create
      let artifactId = '';
      await expect
        .poll(() => {
          const rows = s.journal(id);
          const [create] = mcpCalls(rows);
          const result = create ? mcpResultOf(rows, create.requestId) : null;
          artifactId = result && !result.isError ? (JSON.parse(resultText(result)) as { artifactId: string }).artifactId : '';
          return artifactId;
        }, { timeout: 30_000, message: 'the create answered' })
        .not.toBe('');
      await bindCsv(s.page, artifactId, 'sales', { title: 'Sales', name: 'sales.csv', csv: 'region,total\nNorth,10\nSouth,20\n', at: OLD.at });
      for (let k = 0; k < 5; k++) await allowNext(s, id); // the four exports' cards as recorded, Edit
      await idle(s, id);
      const rows = s.journal(id);
      const calls = mcpCalls(rows);
      expect(calls.map((c) => c.name)).toEqual(['artifact_create', 'artifact_export', 'artifact_export', 'artifact_export', 'artifact_export']);
      const exported = (k: number) => {
        const result = mcpResultOf(rows, calls[k]!.requestId)!;
        expect(result.isError, resultText(result)).toBeUndefined();
        return JSON.parse(resultText(result)) as { status: string; format: string; path: string };
      };
      writeFileSync(`${PROOF}/agent-export-results.json`, JSON.stringify([1, 2, 3, 4].map(exported), null, 2));
      const md = readFileSync(exported(1).path, 'utf8');
      expect(md).toContain('**Sales by region**\n\n| region | total |\n| --- | ---: |\n| North | 10 |\n| South | 20 |');
      expect(md).toContain(OLD_TIME);
      const html = readFileSync(exported(2).path, 'utf8');
      expect(html).toMatch(/<div class="dash-figure"><svg /);
      expect(html).toContain('<table class="dash-table">');
      expect(html).toContain(OLD_TIME);
      const { svgs, pngs, document } = await docxParts(readFileSync(exported(3).path));
      expect([svgs.length, pngs.length]).toEqual([1, 1]);
      expect(document).toContain('Sales by region');
      const pdf = exported(4).path;
      copyFileSync(pdf, `${PROOF}/agent-export.pdf`);
      const text = pdfText(pdf, 'agent-export');
      for (const word of ['Sales by region', 'Sales table', 'North', '10', OLD_TIME]) expect(text).toContain(word);
    });
  } finally {
    if (!existed) rmSync(repo, { recursive: true, force: true });
  }
});

test('the owner’s comment on a chart, replied to in the rail, is a Word comment on the view’s caption, resolved as it is', async () => {
  test.setTimeout(180_000);
  app = await startApp(PROOF);
  const { page, launch } = app;
  // WR73: export identity is explicit, never inferred from the OS login or a generic owner role.
  const authorName = 'Morgan Rivera';
  await ok(page, 'settings.set', { artifacts: { exportAuthorName: authorName } });
  await selectPanelSession(page);
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'dashboard', title: 'Commented board' });
  const id = artifact.id;
  const record = await openInPanel(page, id);
  await bindCsv(page, id, 'sales', { title: 'Sales', name: 'sales.csv', csv: 'region,total\nNorth,10\nSouth,20\nWest,15\n', at: OLD.at });
  // M6: the layout M5's first correction run failed on (38983757083), restored: the chart is the last block the owner
  // wrote, the editor's trailing paragraph empty after it (the tracker's last-block row); the selection is watched from
  // the click to Comment, its log kept as evidence and given in any failure
  await insertBlocks(record, [paragraph('Sales rose in every region.'), chart('sales', { view: 'bar', x: 'region', y: 'total', title: 'Sales by region' })]);
  await expect(figures(record).first().locator('.dash-figure > svg')).toBeVisible({ timeout: 15_000 });
  const chartBlock = record.locator('.doc-chart');
  const layout = await record.locator('.ds-doc .ProseMirror').first().evaluate((el) => Array.from(el.children, (child) => `${child.tagName.toLowerCase()}${child.textContent ? ' text' : ' empty'}${child.classList.contains('doc-chart') ? ' chart' : ''}`));
  expect(layout.slice(-2), 'the chart the last block written, an empty paragraph after it').toEqual(['div text chart', 'p empty']);

  // the owner's comment on the chart, kept the owner's way (Resolve on the card, Reopen in the rail), and a reply
  const watched = await watchSelection(record);
  await selectChart(record);
  await page.waitForTimeout(1_500); // the selection must hold, not only be reached
  await commentSelectedChart(record, watched);
  writeFileSync(`${PROOF}/last-block-selection.txt`, `${layout.join('\n')}\n----\n${(await watched.log()).join('\n')}\n`);
  const card = page.locator('[data-comment-card]');
  await expect(card).toBeVisible();
  await expect.poll(async () => (await chartBlock.getAttribute('class'))?.match(/\bcomment-(?!active\b)([\w-]+)/)?.[1] ?? '').not.toBe('');
  const threadId = (await chartBlock.getAttribute('class'))!.match(/\bcomment-(?!active\b)([\w-]+)/)![1]!;
  await card.getByRole('button', { name: 'Resolve' }).click();
  await expect(card).toHaveCount(0);
  const rail = await railOf(record);
  await rail.locator(`article[data-thread="${threadId}"]`).getByRole('button', { name: 'Reopen' }).click();
  await reply(rail, threadId, 'Why does the west dip?');
  await expect(rail.locator(`article[data-thread="${threadId}"]`).getByRole('listitem')).toHaveText(['YouWhy does the west dip?']);
  await durable(record);

  const exported = exportedBy(page, id, 'commented-board');
  const word = async () => {
    const { zip, document } = await docxParts(await exported('docx'));
    return { document, comments: await zip.file('word/comments.xml')!.async('string'), extended: await zip.file('word/commentsExtended.xml')?.async('string') };
  };
  const open = await word();
  expect(open.comments.match(/w:author="[^"]*"/g)).toEqual([`w:author="${authorName}"`]);
  expect(open.comments).toMatch(/<w:comment w:id="0"[^>]*>.*Why does the west dip\?.*<\/w:comment>/s);
  expect(open.document).toMatch(/<w:commentRangeStart w:id="0"\/><w:r><w:rPr>.*?<\/w:rPr><w:t[^>]*>Sales by region<\/w:t><\/w:r><w:commentRangeEnd w:id="0"\/><w:r><w:commentReference w:id="0"\/><\/w:r>/s);
  expect(open.extended).toMatch(/w15:done="0"/);

  // resolved in the rail, the Word comment is done
  await rail.locator(`article[data-thread="${threadId}"]`).getByRole('button', { name: 'Resolve' }).click();
  await expect(rail.getByRole('region', { name: /Resolved/ }).locator(`article[data-thread="${threadId}"]`)).toHaveAttribute('data-status', 'resolved');
  await durable(record);
  const resolved = await word();
  expect(resolved.comments.match(/w:author="[^"]*"/g)).toEqual([`w:author="${authorName}"`]);
  expect(resolved.comments).toMatch(/<w:comment w:id="0"[^>]*>.*Why does the west dip\?.*<\/w:comment>/s);
  expect(resolved.extended).toMatch(/w15:done="1"/);
  expect(launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
