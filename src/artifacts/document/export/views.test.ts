// B's exporters with a kind's drawn views (P3-E2 M5; E's Decision Logs 15, 24, 32 and 35; ledger X26's exporters' hook),
// beside B's own export tests, which stay as they are: the optional `renderView` replaces a chart block's placeholder by
// the view it answers (HTML and PDF: the figure's SVG or the native table inline, under its caption, with its label and
// warnings; Word: the SVG with its PNG fallback or a native table, captioned and labelled, a block thread a Word comment
// on the caption; Markdown: the view's own Markdown, nested where the block is nested), and with no hook, or a hook
// answering nothing, every export is what it was. The views come from the dashboard's own preparation, as main's do.
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { exportTheme, prepareViews, VIEW_CSS } from '../../dashboard/export';
import { exportDashboard, SNAPSHOTS } from '../../dashboard/fixtures/export';
import { renderView } from '../../dashboard/render';
import { exportDocx } from './docx';
import { exportHtml } from './html';
import { exportMarkdown } from './markdown';
import { defaultAuthorName, exportSource, type ExportSource, type ViewRenderer } from './source';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAADjAO7rAAAAEElEQVR42mP8z8DAwMDAAAAGBwEBH5O/1QAAAABJRU5ErkJggg=='), (ch) => ch.charCodeAt(0));
const theme = exportTheme();
let source: ExportSource;
let views: ViewRenderer;
beforeAll(async () => {
  const { doc } = exportDashboard();
  source = exportSource(doc, 'Board');
  views = await prepareViews(doc, { read: async ({ ref }) => SNAPSHOTS[ref], theme, authorName: defaultAuthorName, picture: async () => PNG });
});
const bar = () => renderView({ view: 'bar', x: 'region', y: 'total', title: 'Sales by region' }, SNAPSHOTS['assets/sales.csv'], theme, 'sales');

async function parts(bytes: Uint8Array): Promise<{ xml: Record<string, string>; media: Record<string, Uint8Array> }> {
  const zip = await JSZip.loadAsync(bytes);
  const xml: Record<string, string> = {};
  const media: Record<string, Uint8Array> = {};
  for (const name of Object.keys(zip.files).filter((name) => !zip.files[name].dir)) {
    if (/\.(xml|rels)$/.test(name)) xml[name] = await zip.file(name)!.async('string');
    else if (name.startsWith('word/media/')) media[name] = await zip.file(name)!.async('uint8array');
  }
  return { xml, media };
}

describe('exportHtml with drawn views', () => {
  it('inlines each figure’s own SVG and each table’s HTML under its caption, labelled, nested where the block is', async () => {
    const html = await exportHtml(source, { renderView: views, viewCss: VIEW_CSS });
    expect(html).toContain(`<div class="dash-figure">${bar().svg}</div>`);
    expect(html).toContain('<div class="dash-caption">Sales by region</div>');
    expect(html).toContain('<span class="dash-source-label">Sales · from sales.csv · updated 2026-10-01 09:00 UTC by Claude</span>');
    expect(html).toMatch(/<blockquote><div class="doc-chart dash-export" data-chart="" data-source="sales" data-spec-json="[^"]*"><figure class="dash-view"><div class="dash-caption">Quoted table<\/div><div class="dash-figure"><table class="dash-table">/);
    expect(html).toContain('<th class="dash-num">total</th>');
    expect(html).not.toContain('<span class="doc-placeholder-label">');
    expect(html).not.toMatch(/<script|\son[a-z]+=|href=|url\(/i);
  });

  it('styles the views through the system’s resolver: no var(--ds-*) left', async () => {
    const html = await exportHtml(source, { renderView: views, viewCss: VIEW_CSS });
    expect(html).toContain('.ds-doc .dash-table .dash-num');
    expect(html).not.toContain('var(--ds-');
  });

  it('notes what a view could not show under its label', async () => {
    const html = await exportHtml(source, { renderView: views });
    // the unreadable spec's figure says so itself; the views over `sales` have nothing to note
    expect(html).toContain('This view cannot be drawn: unknown view');
    expect(html).not.toContain('class="dash-notes"');
  });

  it('is B’s page exactly without a hook, or with one answering nothing', async () => {
    const plain = await exportHtml(source);
    expect(plain).toContain('<span class="doc-placeholder-label">Chart</span>');
    expect(await exportHtml(source, { renderView: () => undefined })).toBe(plain);
  });
});

describe('exportMarkdown with drawn views', () => {
  it('writes each view’s Markdown where its block is, nested in the quote', async () => {
    const md = exportMarkdown(source, { renderView: views });
    expect(md).toContain('**Sales by region**\n\n| region | total |\n| --- | ---: |\n| North | 10 |\n| South | 20 |\n| West \\| \\*star\\* | 30 |\n\n*Sales · from sales.csv · updated 2026-10-01 09:00 UTC by Claude*');
    expect(md).toContain('> **Quoted table**\n>\n> | region | total |');
    expect(md).toContain('**Unbound view**\n\nno dataset "refunds"');
    expect(md).not.toContain(':::chart');
  });

  it('is B’s lossless dialect without a hook', () => {
    const plain = exportMarkdown(source);
    expect(plain).toContain(':::chart {spec-json=');
    expect(exportMarkdown(source, { renderView: () => undefined })).toBe(plain);
  });
});

describe('exportDocx with drawn views', () => {
  it('embeds each chart as its SVG with the PNG fallback, at its size within the text column', async () => {
    const { xml, media } = await parts(await exportDocx(source, { renderView: views }));
    const svgs = Object.entries(media).filter(([name]) => name.endsWith('.svg'));
    const pngs = Object.entries(media).filter(([name]) => name.endsWith('.png'));
    expect(svgs.map(([, bytes]) => new TextDecoder().decode(bytes))).toContain(bar().svg);
    expect(pngs.length).toBeGreaterThan(0);
    expect(pngs.every(([, bytes]) => bytes.length === PNG.length)).toBe(true);
    const document = xml['word/document.xml'];
    expect(document).toContain('http://schemas.microsoft.com/office/drawing/2016/SVG/main'); // the svgBlip beside the PNG blip
    expect(document).toMatch(/<wp:docPr [^>]*descr="Sales by region[^"]*"/);
  });

  it('converts a table view to a native table: header row, right-aligned numbers, the preview’s cells', async () => {
    const { xml } = await parts(await exportDocx(source, { renderView: views }));
    const document = xml['word/document.xml'];
    const tables = [...document.matchAll(/<w:tbl>.*?<\/w:tbl>/gs)].map(([table]) => table);
    expect(tables).toHaveLength(2); // the table view and the quoted one
    const text = (table: string) => [...table.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(([, t]) => t);
    expect(text(tables[0])).toEqual(['region', 'total', 'North', '10', 'South', '20', 'West | *star*', '30']);
    expect(tables[0]).toContain('<w:tblHeader/>');
    expect(tables[0]).toMatch(/<w:jc w:val="(right|end)"\/>.*?<w:t[^>]*>10<\/w:t>/s);
    expect(document).not.toContain('Placeholder');
  });

  it('captions and labels each view; a block’s thread is a Word comment on its caption, its replies kept', async () => {
    const { xml } = await parts(await exportDocx(source, { renderView: views }));
    const document = xml['word/document.xml'];
    // the thread and its reply, each a comment on the caption (B writes a reply as its own anchored comment)
    expect(document).toMatch(/<w:commentRangeStart w:id="0"\/><w:commentRangeStart w:id="1"\/><w:r><w:rPr>.*?<\/w:rPr><w:t[^>]*>Sales by region<\/w:t><\/w:r><w:commentRangeEnd w:id="0"\/>/s);
    expect(document).toContain('Sales · from sales.csv · updated 2026-10-01 09:00 UTC by Claude');
    const comments = xml['word/comments.xml'];
    expect(comments).toContain('Why is West so high?');
    expect(comments).toContain('A one-off order.');
    expect(comments).toMatch(/w:author="Comment author"/);
  });

  it('writes B’s placeholder without a hook', async () => {
    const { xml } = await parts(await exportDocx(source));
    expect(xml['word/document.xml']).toContain('<w:pStyle w:val="Placeholder"/>');
    expect(Object.keys((await parts(await exportDocx(source))).media)).toHaveLength(0);
    const hooked = await parts(await exportDocx(source, { renderView: () => undefined }));
    expect(hooked.xml['word/document.xml']).toBe(xml['word/document.xml']);
  });
});
