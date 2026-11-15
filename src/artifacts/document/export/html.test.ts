// The HTML export (M6 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D12): one standalone file (no resource
// from outside it but `maws-artifact:` and `data:`), the editor's theme inlined with every `--ds-*` resolved, math and
// code pre-rendered, the page Letter by default. Runs under Node, as A's export service in main runs it.
import { describe, expect, it } from 'vitest';
import { exportTheme, prepareViews } from '../../dashboard/export';
import { exportDashboard, SNAPSHOTS } from '../../dashboard/fixtures/export';
import { everyKindSource } from '../convert.fixture';
import { houseSystem, type DesignSystemExport, type LocalTokens } from './design-system';
import { exportHtml } from './html';
import { defaultAuthorName, exportSource } from './source';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const loadImage = async () => ({ bytes: PNG, mime: 'image/png' });

/** Every address the page would load: src, srcset, poster, a stylesheet or icon link, CSS url() and @import. */
function loads(html: string): string[] {
  return [
    ...[...html.matchAll(/\s(?:src|srcset|poster|data|background)="([^"]*)"/g)].map(([, url]) => url),
    ...[...html.matchAll(/<link\b[^>]*href="([^"]*)"/g)].map(([, url]) => url),
    ...[...html.matchAll(/url\(\s*['"]?([^'")]*)/g)].map(([, url]) => url),
    ...[...html.matchAll(/@import\s+['"]?([^'";\s]+)/g)].map(([, url]) => url),
  ];
}

describe('exportHtml', () => {
  it('is standalone: nothing loads from outside but maws-artifact: and data:', async () => {
    for (const options of [{}, { loadImage }]) {
      const html = await exportHtml(everyKindSource(), options);
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).not.toMatch(/<script\b/i);
      expect(html).toMatch(/<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: maws-artifact:; style-src 'unsafe-inline'; font-src data: maws-artifact:">/);
      for (const url of loads(html)) expect(url).toMatch(/^(?:data:|maws-artifact:)/);
    }
  });

  it('inlines images as data: URLs keeping the stored address for a re-import', async () => {
    const html = await exportHtml(everyKindSource(), { tab: 'tab-1', loadImage });
    expect(html).toContain('<img class="doc-image" src="data:image/png;base64,iVBORw0KGgoBAgM=" data-src="https://example.com/figure.png" alt="A figure">');
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgoBAgM=" data-src="maws-artifact://asset/as1" alt="" data-asset-id="as1"');
  });

  it('without a loader shows an image by its alt text and loads nothing', async () => {
    const html = await exportHtml(everyKindSource(), { tab: 'tab-1' });
    expect(html).toContain('<img class="doc-image" data-src="https://example.com/figure.png" alt="A figure">');
  });

  it('references images by option: assets through assetUrl, https as stored', async () => {
    const html = await exportHtml(everyKindSource(), { tab: 'tab-1', images: 'reference', assetUrl: (ref) => `maws-artifact://doc-1/${ref.slice(-3)}` });
    expect(html).toContain('<img class="doc-image" src="https://example.com/figure.png" alt="A figure">');
    expect(html).toContain('src="maws-artifact://doc-1/as1" data-src="maws-artifact://asset/as1" alt="" data-asset-id="as1"');
    expect(html).toContain("img-src data: maws-artifact: https:;");
  });

  it('inlines the theme with every --ds-* resolved to the system and the document overrides', async () => {
    const source = everyKindSource();
    source.overrides = { '--ds-color-accent': '#0b5fff' };
    const html = await exportHtml(source);
    expect(html).not.toContain('--ds-');
    expect(html).not.toContain('var(');
    expect(html).toMatch(/\.ds-doc h1 \{[^}]*font-size: 26px;/); // the house system's h1
    expect(html).toMatch(/\.ds-doc \{[^}]*color: #1f1e1b;/);
    expect(html).toMatch(/\.ds-doc mark[^{]*\{[^}]*background: color-mix\(in srgb, #0b5fff 25%, #faf9f6\);[^}]*color: inherit;/); // full background, the override wins, text keeps its ink
    // P3-F (sitting candidate 11, F18): an exported link is its text's colour too, the accent's override not on it
    expect(html).toMatch(/\.ds-doc a \{[^}]*color: inherit;/);
    expect(html).not.toMatch(/\.ds-doc a \{[^}]*color: #0b5fff/);
  });

  it('takes the governing system through X28’s helpers', async () => {
    const calls: string[] = [];
    const system: DesignSystemExport<LocalTokens> = {
      ...houseSystem,
      name: 'Ledger',
      tokens: { properties: { ...houseSystem.tokens.properties, '--ds-type-h1-size': '40px' } },
      resolveDsVars: (css, tokens, medium) => {
        calls.push(medium);
        return houseSystem.resolveDsVars(css, tokens, medium);
      },
    };
    const html = await exportHtml(everyKindSource(), { system });
    expect(calls.every((medium) => medium === 'document') && calls.length > 0).toBe(true);
    expect(html).toMatch(/\.ds-doc h1 \{[^}]*font-size: 40px;/);
  });

  it('prints on Letter by default and on A4 when chosen', async () => {
    expect(await exportHtml(everyKindSource())).toContain('@page { size: 8.5in 11in; margin: 72px; }');
    expect(await exportHtml(everyKindSource(), { pageSize: 'a4' })).toContain('@page { size: 210mm 297mm; margin: 72px; }');
  });

  it('renders math as MathML and code pre-highlighted', async () => {
    const html = await exportHtml(everyKindSource(), { tab: 'tab-1' });
    expect(html).toMatch(/<span class="doc-math" data-math="" data-latex="E = mc\^2"><span class="katex"><math[^>]*>/);
    expect(html).toMatch(/<div class="doc-mathBlock" data-math-block="" data-latex="[^"]*"><span class="katex"><math[^>]*display="block"/);
    expect(html).toMatch(/<pre><code class="language-ts">(?:<span style="color:#[0-9A-F]{6}">[^<]*<\/span>)+/);
    expect(html).toMatch(/<span style="color:#[0-9A-F]{6}">log<\/span>/);
  });

  it('colours code by the system’s ground, not the app’s theme', async () => {
    const light = await exportHtml(everyKindSource(), { tab: 'tab-1' });
    const darkSystem = { ...houseSystem, tokens: { properties: { ...houseSystem.tokens.properties, '--ds-color-bg': '#1f1e1b' } } };
    const dark = await exportHtml(everyKindSource(), { tab: 'tab-1', system: darkSystem });
    expect(light).toContain('<span style="color:#D73A49">const</span>'); // github-light
    expect(dark).toContain('<span style="color:#F97583">const</span>'); // github-dark
  });

  // P4 W1-B (tracker L308): the page's native controls (a checklist's boxes) draw in its ground's scheme, as the editor's
  // do, the PDF's too (it prints this page)
  it('writes the page’s ground, and a dark ground’s colour scheme', async () => {
    const darkSystem = { ...houseSystem, tokens: { properties: { ...houseSystem.tokens.properties, '--ds-color-bg': '#1f1e1b' } } };
    const dark = await exportHtml(everyKindSource(), { tab: 'tab-1', system: darkSystem });
    const light = await exportHtml(everyKindSource(), { tab: 'tab-1' });
    expect(dark).toContain('<main class="ds-doc" data-ground="dark">');
    expect(dark).toMatch(/\.ds-doc \{ color-scheme: dark; \}/);
    expect(light).toContain('<main class="ds-doc" data-ground="light">');
    expect(light).not.toContain('color-scheme: dark');
    expect(light).toMatch(/\.ds-doc \{[^}]*color-scheme: light;/); // the theme's own
  });

  it('draws every block kind with the theme’s classes and the attributes the import reads', async () => {
    const html = await exportHtml(everyKindSource(), { tab: 'tab-1' });
    expect(html).toContain('<aside class="doc-callout" data-callout-tone="warn"><p>Mind the gap.</p></aside>');
    expect(html).toContain('<pre class="doc-diagram-source" data-diagram="">graph TD\n  A --&gt; B</pre>');
    expect(html).toContain('<div class="doc-chart" data-chart="" data-source="sales.csv" data-spec="{&quot;mark&quot;:&quot;bar&quot;}">');
    expect(html).toContain('<div class="doc-pending" data-pending="" data-intent="Write the risks section">');
    expect(html).toContain('<span class="doc-chip" data-chip="date" data-iso="2026-10-12">Oct 12, 2026</span>');
    expect(html).toContain('<span class="doc-chip" data-chip="mention" data-kind="person" data-ref="owner">Owner</span>');
    expect(html).toContain('<span class="doc-chip" data-chip="dropdown" data-options="[&quot;Todo&quot;,&quot;Doing&quot;,&quot;Done&quot;]" data-value="Doing">Doing</span>');
    expect(html).toContain('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox" disabled></label><div><p>Open task</p></div></li>');
    expect(html).toContain('<ol start="3">');
    expect(html).toContain('<th colspan="2" colwidth="160,80" style="text-align: center">');
    expect(html).toContain('<td rowspan="2">');
    expect(html).toContain('<mark data-color="#fde68a" style="background-color: #fde68a">amber</mark>');
    expect(html).toContain('<a href="https://example.com/a" title="A title">link</a>');
    expect(html).not.toContain('data-thread'); // comments stay in the document
  });

  it('writes every tab in order under its title, and escapes what it is given', async () => {
    const source = everyKindSource();
    source.title = 'Q4 <plan> & "notes"';
    const html = await exportHtml(source);
    expect(html).toContain('<title>Q4 &lt;plan&gt; &amp; "notes"</title>');
    const titles = [...html.matchAll(/<h1 class="doc-tab-title">([^<]*)<\/h1>/g)].map(([, title]) => title);
    expect(titles).toEqual(['Overview', 'Notes']);
    expect(html).toContain('<h2>회의 메모</h2>');
  });
});

// UX wave U10b (l6-artifacts-07 (b), M2 decisions 7 and 8; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §B.4):
// the exported page is spaced as the editor is, a heading is not left alone at a page's foot, and the page and its
// density are the document's unless the call names a size
describe('the exported page', () => {
  const printBlock = (html: string): string => /@media print \{([\s\S]*?)\n\}/.exec(html)?.[1] ?? '';

  // The elements the browser pads of its own accord (Chromium's html.css and mathml.css, which the PDF is drawn with:
  // the lists' inline start, a table cell's 1px, the form controls, fieldset and legend, dialog; MathML's fraction and
  // table cell). The editor's base stylesheet (Tailwind's preflight) zeroes margin and padding on every element; the page
  // mirrors its margins whole, and leaves padding to the theme, which sets it on each HTML element the export writes
  // with one. A fraction's padding is MathML's own layout: the editor draws math with KaTeX's HTML, not MathML.
  const BROWSER_PADDINGS = new Set(['ul', 'ol', 'menu', 'dir', 'td', 'th', 'fieldset', 'legend', 'dialog', 'button', 'select', 'textarea', 'option', 'mtd', 'mfrac']);

  it('removes the browser’s own margin from every element at zero specificity, as the editor’s reset does', async () => {
    const { doc } = exportDashboard();
    const views = await prepareViews(doc, { read: async ({ ref }) => SNAPSHOTS[ref], theme: exportTheme(), authorName: defaultAuthorName });
    // one of each block kind, and a drawn view (its figure, caption, SVG and table)
    const pages = [await exportHtml(everyKindSource()), await exportHtml(exportSource(doc, 'Board'), { renderView: views })];
    const written = new Set(pages.flatMap((html) => [...(/<main[\s\S]*<\/main>/.exec(html)?.[0] ?? '').matchAll(/<([a-z][a-z0-9]*)[\s>]/g)].map((match) => match[1])));
    // the padded elements the export writes (a checklist's box, its one input, is a checkbox, which the browser does not
    // pad), and the theme's padding of each HTML one
    expect([...written].filter((tag) => BROWSER_PADDINGS.has(tag)).sort()).toEqual(['mfrac', 'ol', 'td', 'th', 'ul']);
    for (const html of pages) {
      expect(html).toMatch(/\.ds-doc ul,\s*\.ds-doc ol \{[^}]*padding-left:/);
      expect(html).toMatch(/\.ds-doc th,\s*\.ds-doc td \{[^}]*padding:/);
      expect(html).toContain('\n.ds-doc :where(*) { margin: 0; }\n');
    }
    // the theme's own gap rule still stands beside it, with the spacing token resolved
    expect(pages[0]).toMatch(/\.ds-doc \.doc-content > \* \+ \* \{\s*margin-top: 12px;/);
  });

  it('spaces a tab’s blocks, under its title, by the theme’s gap, as the editor spaces that tab', async () => {
    const html = await exportHtml(everyKindSource());
    expect(html).toContain('\n.ds-doc .doc-tab > * + * { margin-top: 12px; }\n');
    expect(html).toMatch(/<section class="doc-tab" data-tab="[^"]*"><h1 class="doc-tab-title">/);
  });

  it('keeps a heading with what follows it in print', async () => {
    const print = printBlock(await exportHtml(everyKindSource()));
    expect(print).toContain('.ds-doc :where(h1, h2, h3) { break-after: avoid; }');
  });

  it('prints on the call’s size, else the document’s, else the system’s, else Letter', async () => {
    const a4System: DesignSystemExport<LocalTokens> = { ...houseSystem, tokens: { properties: { ...houseSystem.tokens.properties, '--ds-page-width': '210mm', '--ds-page-height': '297mm' } } };
    const source = everyKindSource();
    expect(await exportHtml(source)).toContain('@page { size: 8.5in 11in; margin: 72px; }');
    expect(await exportHtml(source, { system: a4System })).toContain('@page { size: 210mm 297mm; margin: 72px; }');
    source.page = { size: 'a4' };
    expect(await exportHtml(source)).toContain('@page { size: 210mm 297mm; margin: 72px; }');
    expect(await exportHtml(source, { pageSize: 'letter' })).toContain('@page { size: 8.5in 11in; margin: 72px; }');
    source.page = { size: 'letter' };
    expect(await exportHtml(source, { system: a4System })).toContain('@page { size: 8.5in 11in; margin: 72px; }');
  });

  it('draws a compact document at compact density, the document’s own override of a size still winning', async () => {
    const source = everyKindSource();
    expect(await exportHtml(source)).toMatch(/\.ds-doc h1 \{[^}]*font-size: 26px;/);
    source.page = { density: 'compact' };
    const compact = await exportHtml(source);
    expect(compact).toMatch(/\.ds-doc h1 \{[^}]*font-size: 23\.4px;/);
    expect(compact).toMatch(/\.ds-doc \.doc-content > \* \+ \* \{\s*margin-top: 9px;/);
    expect(compact).not.toContain('var(');
    source.overrides = { '--ds-type-h1-size': '30px' };
    expect(await exportHtml(source)).toMatch(/\.ds-doc h1 \{[^}]*font-size: 30px;/);
  });
});
