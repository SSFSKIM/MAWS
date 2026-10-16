// P3-E2 M1 spike: the renderer comparison's real-Electron proof, the same closed inputs through both candidates.
// Cross-runtime bytes (Node and Chromium), the standalone HTML page captured and printed by MAWS's own PDF printer and
// request policy (JavaScript off), the PDF compared pixel for pixel with the page, a DOCX carrying the canonical SVG
// with a picture fallback (and LibreOffice's rendering of it where installed), Korean label geometry measured in
// Chromium against the renderer's estimates, hover and keyboard reach through a host's handlers, and a positive
// control for the network detector. Evidence lines start `SPIKE ` (JSON) and `SPIKE-PNG ` (base64 PNG chunks).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { Document, ImageRun, Packer, Paragraph, TextRun } from 'docx';
import JSZip from 'jszip';
import type * as LibModule from '../src/lib';

type Lib = typeof LibModule;
const SPIKE = resolve(__dirname, '..');
const OUT = join(SPIKE, 'out');
const PROOF = join(OUT, 'proof');
const BIN = '/opt/homebrew/bin';
const POPPLER = existsSync(join(BIN, 'pdftoppm')) ? BIN : null;
const SOFFICE = ['/opt/homebrew/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'].find((p) => existsSync(p)) ?? null;
const CANDIDATES = ['d3', 'house'] as const;
const PAGE_W = 816;

const report = (key: string, value: unknown) => console.log(`SPIKE ${JSON.stringify({ key, value })}`);
const emitPng = (name: string, base64: string) => {
  const chunks = base64.match(/.{1,8000}/g) ?? [];
  chunks.forEach((chunk, i) => console.log(`SPIKE-PNG ${name} ${i + 1}/${chunks.length} ${chunk}`));
};
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const html = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const svgHeight = (svg: string) => Number(/height="([\d.]+)"/.exec(svg)![1]);

let lib: Lib;
let app: ElectronApplication;
let page: Page;
const call = <T>(fn: string, ...args: unknown[]): Promise<T> =>
  app.evaluate(async (_electron, [name, rest]) => (globalThis as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>).spike[name as string](...(rest as unknown[])) as T, [fn, args] as const);

/** The standalone page an HTML export would write for one view: caption, figure (the canonical SVG), source label. */
function figurePage(svg: string, caption: string, label: string): { page: string; height: number } {
  const { theme } = lib;
  const height = Math.ceil(svgHeight(svg) + 116);
  const page =
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${html(caption)}</title><style>` +
    `@page { size: ${PAGE_W}px ${height}px; margin: 0 } html, body { margin: 0; background: ${theme.ground} }` +
    `main { box-sizing: border-box; width: ${PAGE_W}px; height: ${height}px; padding: 24px 72px; font-family: ${theme.fontBody}; color: ${theme.ink}; word-break: keep-all }` +
    `.caption { margin: 0 0 8px; font-size: 17px; line-height: 1.55; font-weight: 600 } figure { margin: 0 } figure svg { display: block; width: 672px; height: auto }` +
    `figcaption { margin-top: 8px; font-size: 13px; line-height: 1.55; color: ${theme.muted} }</style></head>` +
    `<body><main><p class="caption">${html(caption)}</p><figure>${svg}<figcaption>${html(label)}</figcaption></figure></main></body></html>`;
  return { page, height };
}

const svgOnlyPage = (svg: string) => `<!doctype html><html><head><meta charset="utf-8"><style>html, body { margin: 0; background: #ffffff } svg { display: block }</style></head><body>${svg}</body></html>`;

function rasterizePdf(pdf: string, width: number, height: number): string {
  const base = pdf.replace(/\.pdf$/, '-page');
  execFileSync(join(POPPLER!, 'pdftoppm'), ['-png', '-singlefile', '-f', '1', '-l', '1', '-scale-to-x', String(width), '-scale-to-y', String(height), pdf, base]);
  return readFileSync(`${base}.png`).toString('base64');
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  lib = (await import(pathToFileURL(join(OUT, 'spike-lib.mjs')).href)) as Lib;
  mkdirSync(PROOF, { recursive: true });
  app = await _electron.launch({ args: [join(OUT, 'spike-main.cjs'), '--lang=en-US'], env: { ...process.env, MAWS_E2E: '1' } as Record<string, string> });
  page = await app.firstWindow();
  report('environment', { electron: await app.evaluate(() => process.versions.electron), node: process.version, poppler: POPPLER !== null, soffice: SOFFICE });
});

test.afterAll(async () => {
  await app?.close();
});

test('the same input gives byte-equal SVG in Node and in Chromium, for both candidates and every case', async () => {
  await page.addScriptTag({ path: join(OUT, 'spike-browser.js') });
  const inPage = await page.evaluate(() => {
    const l = (globalThis as unknown as { spikeLib: Lib }).spikeLib;
    return { d3: l.renderAll('d3').map((r) => r.svg), house: l.renderAll('house').map((r) => r.svg) };
  });
  for (const candidate of CANDIDATES) {
    const first = lib.renderAll(candidate);
    const again = lib.renderAll(candidate);
    const node = first.map((r) => sha(r.svg));
    expect(again.map((r) => sha(r.svg))).toEqual(node);
    expect(inPage[candidate].map((svg) => sha(svg))).toEqual(node);
    report(`determinism-${candidate}`, { cases: node.length, bytes: first.reduce((n, r) => n + r.svg.length, 0), digest: sha(node.join('')) });
  }
});

const sheets = () => lib.CASES.filter((c) => c.sheet);

test('HTML and PDF: the canonical SVG captured and printed through MAWS’s printer, the PDF matching the page, nothing requested', async () => {
  test.skip(POPPLER === null, 'poppler (pdftoppm, pdftotext) is not installed on this runner: PDF fidelity unproved here');
  const captures: Record<string, Record<string, string>> = { d3: {}, house: {} };
  for (const candidate of CANDIDATES) {
    for (const c of sheets()) {
      const { svg } = lib.renderers[candidate](c.spec, c.table, lib.theme, c.datasetId);
      const caption = (c.spec as { title: string }).title;
      const { page: doc, height } = figurePage(svg, caption, lib.sourceLabel(c.datasetId));
      expect(doc).toContain(svg); // the HTML export inlines the canonical bytes unchanged
      const shot = await call<{ png: string; blocked: string[]; scale: number }>('capture', doc, PAGE_W, height);
      const printed = await call<{ pdf: string; blocked: string[] }>('print', doc);
      expect(shot.blocked, c.id).toEqual([]);
      expect(printed.blocked, c.id).toEqual([]);
      const pdfPath = join(PROOF, `${candidate}-${c.id}.pdf`);
      writeFileSync(pdfPath, Buffer.from(printed.pdf, 'base64'));
      writeFileSync(join(PROOF, `${candidate}-${c.id}.html`), doc);
      const info = execFileSync(join(POPPLER!, 'pdfinfo'), [pdfPath], { encoding: 'utf8' });
      const words = execFileSync(join(POPPLER!, 'pdftotext'), ['-layout', pdfPath, '-'], { encoding: 'utf8' });
      const fonts = execFileSync(join(POPPLER!, 'pdffonts'), [pdfPath], { encoding: 'utf8' });
      expect(info).toMatch(/Pages:\s+1\n/);
      expect(words.replace(/\s+/g, ' ')).toContain(caption.replace(/\s+/g, ' ').slice(0, 12));
      expect(words).toContain('updated 2026-10-16 10:00 UTC by Claude');
      const raster = rasterizePdf(pdfPath, PAGE_W, height);
      const diff = await call<number>('compare', shot.png, raster, PAGE_W, height);
      captures[candidate][c.id] = shot.png;
      report(`pdf-${candidate}-${c.id}`, { height, captureScale: shot.scale, pdfVsPage: Number(diff.toFixed(5)), pdfBytes: Buffer.from(printed.pdf, 'base64').length, fonts: fonts.split('\n').slice(2).map((l) => l.split(/\s+/)[0]).filter(Boolean) });
      expect(diff, `${candidate} ${c.id}: PDF raster against the page's capture`).toBeLessThan(0.03);
      if (candidate === 'd3') emitPng(`html-d3-${c.id}`, shot.png);
      if (candidate === 'd3' && (c.id === 'bar-gdp-2024' || c.id === 'scatter-penguins')) emitPng(`pdf-d3-${c.id}`, raster);
    }
  }
  // The two candidates draw the same picture.
  for (const c of sheets()) {
    const height = Math.ceil(svgHeight(lib.renderers.d3(c.spec, c.table, lib.theme, c.datasetId).svg) + 116);
    const diff = await call<number>('compare', captures.d3[c.id], captures.house[c.id], PAGE_W, height);
    report(`candidates-${c.id}`, { d3VsHouse: Number(diff.toFixed(5)) });
    expect(diff, c.id).toBeLessThan(0.002);
  }
});

test('DOCX: the canonical SVG embedded byte for byte with a picture fallback, captions beside it; LibreOffice renders it where installed', async () => {
  for (const candidate of CANDIDATES) {
    const children: Paragraph[] = [];
    const svgs: string[] = [];
    for (const c of sheets()) {
      const { svg } = lib.renderers[candidate](c.spec, c.table, lib.theme, c.datasetId);
      svgs.push(svg);
      const h = svgHeight(svg);
      const fallback = await call<{ png: string; blocked: string[]; scale: number }>('capture', svgOnlyPage(svg), lib.theme.width, Math.ceil(h));
      expect(fallback.blocked).toEqual([]);
      const scale = 624 / lib.theme.width; // Letter with one-inch margins: 6.5 in at 96 px
      children.push(
        new Paragraph({ children: [new TextRun({ text: (c.spec as { title: string }).title, bold: true, size: 26 })], spacing: { before: 240, after: 120 } }),
        new Paragraph({ children: [new ImageRun({ type: 'svg', data: Buffer.from(svg, 'utf8'), fallback: { type: 'png', data: Buffer.from(fallback.png, 'base64') }, transformation: { width: Math.round(lib.theme.width * scale), height: Math.round(h * scale) }, altText: { name: (c.spec as { title: string }).title, description: (c.spec as { title: string }).title, title: (c.spec as { title: string }).title } })] }),
        new Paragraph({ children: [new TextRun({ text: lib.sourceLabel(c.datasetId), size: 20, color: lib.theme.muted.slice(1) })], spacing: { after: 240 } }),
      );
    }
    const bytes = await Packer.toBuffer(new Document({ sections: [{ children }] }));
    const docx = join(PROOF, `${candidate}.docx`);
    writeFileSync(docx, bytes);
    const zip = await JSZip.loadAsync(bytes);
    const media = Object.keys(zip.files).filter((name) => name.startsWith('word/media/'));
    const embedded = await Promise.all(media.filter((name) => name.endsWith('.svg')).map((name) => zip.file(name)!.async('string')));
    expect(new Set(embedded.map(sha))).toEqual(new Set(svgs.map(sha)));
    const documentXml = await zip.file('word/document.xml')!.async('string');
    for (const c of sheets()) expect(documentXml).toContain(html((c.spec as { title: string }).title));
    expect(documentXml).toContain('asvg:svgBlip');
    report(`docx-${candidate}`, { bytes: bytes.length, svgMedia: embedded.length, pngMedia: media.filter((n) => n.endsWith('.png')).length, svgByteEqual: true });

    if (SOFFICE === null || POPPLER === null) {
      report(`docx-render-${candidate}`, 'LibreOffice or poppler not installed: the DOCX rendering is unproved here (Word was never available)');
      continue;
    }
    const lo = mkdtempSync(join(tmpdir(), 'spike-lo-'));
    execFileSync(SOFFICE, [`-env:UserInstallation=file://${join(lo, 'profile')}`, '--headless', '--convert-to', 'pdf', '--outdir', lo, docx], { timeout: 240_000, stdio: 'ignore' });
    const pdf = join(lo, `${candidate}.pdf`);
    const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync(join(POPPLER, 'pdfinfo'), [pdf], { encoding: 'utf8' }))![1]);
    const words = execFileSync(join(POPPLER, 'pdftotext'), [pdf, '-'], { encoding: 'utf8' });
    const missing = sheets().filter((c) => !words.replace(/\s+/g, '').includes((c.spec as { title: string }).title.replace(/\s+/g, '').slice(0, 10))).map((c) => c.id);
    report(`docx-render-${candidate}`, { pages, captionsMissing: missing, axisKoreanPresent: words.includes('대한민국') });
    if (candidate === 'd3')
      for (let p = 1; p <= Math.min(pages, 3); p += 1) {
        execFileSync(join(POPPLER, 'pdftoppm'), ['-png', '-singlefile', '-f', String(p), '-l', String(p), '-r', '80', pdf, join(lo, `p${p}`)]);
        emitPng(`docx-lo-d3-page${p}`, readFileSync(join(lo, `p${p}.png`)).toString('base64'));
      }
  }
});

test('Korean labels and values fit: every text box inside the frame, no two labels overlapping, estimates never narrower than Chromium', async () => {
  const ids = [...sheets().map((c) => c.id), 'edge-long-korean', 'edge-long-korean-table', 'edge-hostile', 'edge-missing-column'];
  let widest = 0;
  for (const candidate of CANDIDATES)
    for (const id of ids) {
      const c = lib.CASES.find((item) => item.id === id)!;
      const { svg } = lib.renderers[candidate](c.spec, c.table, lib.theme, c.datasetId);
      const { page: doc } = figurePage(svg, (c.spec as { title?: string }).title ?? id, lib.sourceLabel(c.datasetId));
      await page.goto(await call<string>('writeTemp', `measure-${candidate}-${id}.html`, doc));
      await page.addScriptTag({ path: join(OUT, 'spike-browser.js') });
      const m = await page.evaluate(() => {
        const l = (globalThis as unknown as { spikeLib: Lib }).spikeLib;
        const root = document.querySelector('figure svg') as SVGSVGElement;
        const [, , w, h] = root.getAttribute('viewBox')!.split(' ').map(Number);
        const boxes: { text: string; x: number; y: number; w: number; h: number; est: number }[] = [];
        for (const el of root.querySelectorAll('text')) {
          const lines = el.querySelectorAll('tspan').length > 0 ? [...el.querySelectorAll('tspan')] : [el];
          for (const line of lines) {
            const box = (line as SVGTextContentElement).getBBox ? (line as SVGGraphicsElement).getBBox() : el.getBBox();
            const size = Number(el.getAttribute('font-size') ?? root.getAttribute('font-size'));
            const mono = el.getAttribute('font-family')?.includes('mono') ?? false;
            boxes.push({ text: line.textContent!, x: box.x, y: box.y, w: (line as SVGTextContentElement).getComputedTextLength(), h: box.height, est: l.textWidth(line.textContent!, size, mono) });
          }
        }
        const outside = boxes.filter((b) => b.x < -0.5 || b.x + b.w > w + 0.5 || b.y < -0.5 || b.y + b.h > h + 0.5).map((b) => b.text);
        const overlaps: string[] = [];
        for (let i = 0; i < boxes.length; i += 1)
          for (let j = i + 1; j < boxes.length; j += 1) {
            const [a, b] = [boxes[i], boxes[j]];
            const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            if (ix > 1 && iy > 2) overlaps.push(`${a.text} / ${b.text}`);
          }
        const under = boxes.filter((b) => b.w > b.est + 0.5).map((b) => `${b.text}: ${b.w.toFixed(1)} > ${b.est.toFixed(1)}`);
        return { texts: boxes.length, outside, overlaps, under, ratio: Math.max(0, ...boxes.map((b) => (b.est > 0 ? b.w / b.est : 0))) };
      });
      widest = Math.max(widest, m.ratio);
      report(`geometry-${candidate}-${id}`, m);
      expect(m.outside, `${candidate} ${id}`).toEqual([]);
      expect(m.overlaps, `${candidate} ${id}`).toEqual([]);
      expect(m.under, `${candidate} ${id}`).toEqual([]);
      if (candidate === 'd3' && id === 'edge-long-korean') emitPng('chromium-long-korean', (await page.screenshot({ fullPage: true })).toString('base64'));
    }
  report('geometry-widest-real-over-estimate', Number(widest.toFixed(3)));
});

test('a host reads hover values and opens the source table by keyboard around the figure; the figure is a named image', async () => {
  const c = lib.CASES.find((item) => item.id === 'bar-gdp-2024')!;
  const { svg } = lib.renderers.d3(c.spec, c.table, lib.theme, c.datasetId);
  const rows = c.table!.rows.slice(0, 8).map((r) => `<tr>${r.map((v) => `<td>${html(String(v ?? ''))}</td>`).join('')}</tr>`).join('');
  const host =
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><figure><div class="plot">${svg}</div>` +
    `<button type="button" class="source" aria-expanded="false">${html(lib.sourceLabel(c.datasetId))}</button><div class="tip" role="status"></div>` +
    `<table hidden><thead><tr>${c.table!.columns.map((col) => `<th>${html(col.name)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></figure>` +
    `<script>const plot=document.querySelector('.plot'),tip=document.querySelector('.tip'),button=document.querySelector('.source'),table=document.querySelector('table');` +
    `plot.addEventListener('pointerover',e=>{const t=e.target.closest('[data-tip]');if(t)tip.textContent=t.getAttribute('data-tip')});` +
    `button.addEventListener('click',()=>{table.hidden=!table.hidden;button.setAttribute('aria-expanded',String(!table.hidden))});</script></body></html>`;
  await page.goto(await call<string>('writeTemp', 'host.html', host));
  const first = page.locator('[data-tip]').first();
  await first.hover();
  await expect(page.locator('.tip')).toHaveText('미국 · growth_pct: 2.79');
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Tab');
  await expect(page.locator('button.source')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('table')).toBeVisible();
  await expect(page.locator('table tbody tr')).toHaveCount(8);
  const aria = await page.locator('figure').ariaSnapshot();
  report('aria', aria);
  expect(aria).toContain('img "2024년 실질 GDP 성장률 (%)"');
});

test('positive control: the printer’s request policy reports a page that names the network', async () => {
  const leaky = `<!doctype html><html><body><img src="https://example.invalid/pixel.png"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="https://example.invalid/i.png" width="10" height="10"/></svg></body></html>`;
  const printed = await call<{ pdf: string; blocked: string[] }>('print', leaky);
  const shot = await call<{ png: string; blocked: string[] }>('capture', leaky, 200, 100);
  report('network-control', { printBlocked: printed.blocked, captureBlocked: shot.blocked });
  expect(printed.blocked.some((url) => url.startsWith('https://example.invalid/'))).toBe(true);
  expect(shot.blocked.some((url) => url.startsWith('https://example.invalid/'))).toBe(true);
});
