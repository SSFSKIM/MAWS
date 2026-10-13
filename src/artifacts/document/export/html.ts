// The HTML export (D12 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): one standalone page. The document is
// drawn through html-render.ts with the editor's own theme.css inlined, every `--ds-*` in it resolved to a literal by
// the governing system's `resolveDsVars(cssText, tokens, 'document')` (X28) after the document's `dsOverrides`, so the
// file needs neither the app's tokens nor D's scope; math is MathML and code is highlighted before it is written.
// The text's whitespace is kept as stored: the page sets `white-space: pre-wrap` on its article, marked
// `data-whitespace="preserve"`, which the HTML import reads as "parse with whitespace kept". A loader or highlighter
// that fails fails the export (a loader answering null shows the alt text; an unknown language is plain code).
// Nothing loads from outside the file: a Content-Security-Policy says so, images are inlined as `data:` URLs through
// the caller's loader (`images: 'inline'`, the default; the stored address rides in `data-src` for a re-import) or
// referenced by address (`images: 'reference'`: assets as `maws-artifact:` URLs through `assetUrl`, https as stored).
//
// The PDF route (D12; A's export service registers it in M8): A's service renders this page in its hidden capture
// window on the `maws-capture` partition and calls `webContents.printToPDF({preferCSSPageSize: true,
// printBackground: true, generateDocumentOutline: true})`. The page's `@page` rule carries the size (Letter unless
// A4 is chosen or the system's page tokens say otherwise, Decision Log 43) and the margin (`--ds-page-margin`, else
// 1in), so the service passes no size or margins of its own; headings become the PDF's outline. Images: `inline`
// with the asset reader, or `reference` where the capture partition serves `maws-artifact:`. Diagrams print as their
// mermaid source unless the capture window draws `pre[data-diagram]` first.
import type { Node as PMNode } from '@tiptap/pm/model';
import themeCss from '../editor/theme.css?raw';
import { dsValue, exportDesign, houseSystem, pageOf, type ExportDesign } from './design-system';
import { escapeAttr, escapeText, renderBody, type RenderedImage } from './html-render';
import { codeTokensFor, isDarkGround, type CodeTokens } from './highlight';
import { tabsOf, type ExportOptions, type ExportSource, type ImageLoader } from './source';

export interface HtmlExportOptions<T> extends ExportOptions<T> {
  /** `inline` (default): every image a `data:` URL through `loadImage`; `reference`: images by their address. */
  images?: 'inline' | 'reference';
  /** Reads an image's bytes for `inline`: null shows the image by its alt text; a rejection fails the export. */
  loadImage?: ImageLoader;
  /** An asset's URL for `reference` (the renderer's `ArtifactHost.assetUrl` bound to the artifact); as stored if absent. */
  assetUrl?: (ref: string) => string;
}

// What the page adds to the editor's theme: the printed page, a title per tab, an empty paragraph's line, the
// placeholders' labels. `--ds-*` only, resolved with the theme.
const pageCss = (page: { width: string; height: string; margin: string }) => `
html, body { margin: 0; }
body { background: var(--ds-color-bg); }
.ds-doc { min-height: 100vh; }
.ds-doc-page { max-width: ${page.width}; }
.ds-doc-page[data-whitespace="preserve"] { white-space: pre-wrap; }
.ds-doc-page p:empty::after { content: "\\a0"; }
.ds-doc .doc-tab + .doc-tab { margin-top: var(--ds-space-8); }
.ds-doc .doc-tab-title { font-family: var(--ds-font-display); font-size: var(--ds-type-title-size); line-height: var(--ds-type-title-line); font-weight: var(--ds-type-title-weight); }
.ds-doc pre[data-diagram]::before { content: "Diagram"; display: block; font-family: var(--ds-font-body); font-size: var(--ds-type-caption-size); color: var(--ds-color-text-muted); text-transform: uppercase; }
.ds-doc .doc-math math[display="block"] { margin: 0 auto; }
@page { size: ${page.width} ${page.height}; margin: ${page.margin}; }
@media print {
  body, .ds-doc { background: none; min-height: 0; }
  .ds-doc-page { max-width: none; padding: 0; }
  .ds-doc .doc-tab + .doc-tab { margin-top: 0; break-before: page; }
}
`;

// The theme as the file needs it: no comments (they name `--ds-*`), and no rule keyed to the app's theme (the editor's
// interim dark code colours): a file has no app theme, and the system's ground picks the code colours (highlight.ts).
const themeForFile = (css: string): string =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/[^{}]*\[data-theme[^{}]*\{[^{}]*\}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function imagesOf(bodies: PMNode[], options: HtmlExportOptions<unknown>): Promise<(node: PMNode) => RenderedImage> {
  const mode = options.images ?? 'inline';
  if (mode === 'reference') {
    return (node) => {
      const src = String(node.attrs.src ?? '');
      if (node.attrs.assetId) return { src: options.assetUrl ? options.assetUrl(src) : src };
      return { src: /^(?:https:|maws-artifact:)/i.test(src) ? src : null };
    };
  }
  const inlined = new Map<string, string | null>();
  const pending: Array<Promise<void>> = [];
  for (const body of bodies) {
    body.descendants((node) => {
      if (node.type.name !== 'image') return true;
      const src = String(node.attrs.src ?? '');
      const assetId = (node.attrs.assetId as string | null) ?? null;
      const key = `${assetId ?? ''}\u0000${src}`;
      if (inlined.has(key)) return false;
      inlined.set(key, null);
      if (options.loadImage)
        pending.push(
          options.loadImage({ src, assetId }).then((image) => {
            if (image && /^image\/[\w.+-]+$/i.test(image.mime)) inlined.set(key, `data:${image.mime.toLowerCase()};base64,${base64(image.bytes)}`);
          }),
        );
      return false;
    });
  }
  await Promise.all(pending);
  return (node) => ({ src: inlined.get(`${(node.attrs.assetId as string | null) ?? ''}\u0000${String(node.attrs.src ?? '')}`) ?? null });
}

/** The document (one tab, or every tab under its title) as one standalone HTML page. */
export async function exportHtml<T>(source: ExportSource, options: HtmlExportOptions<T> = {}): Promise<string> {
  const tabs = tabsOf(source, options.tab);
  const design: ExportDesign = options.system ? exportDesign(options.system, source.overrides) : exportDesign(houseSystem, source.overrides);
  const dark = isDarkGround(dsValue(design, '--ds-color-bg'));
  const tokens: CodeTokens = await codeTokensFor(tabs.map(({ body }) => body));
  const image = await imagesOf(
    tabs.map(({ body }) => body),
    options as HtmlExportOptions<unknown>,
  );
  const env = { tokens, dark, image };
  const content =
    tabs.length === 1
      ? renderBody(tabs[0].body, env)
      : tabs.map(({ id, title, body }) => `<section class="doc-tab" data-tab="${escapeAttr(id)}"><h1 class="doc-tab-title">${escapeText(title)}</h1>${renderBody(body, env)}</section>`).join('');
  const css = design.resolveCss(`${themeForFile(themeCss)}\n${pageCss(pageOf(design, options.pageSize))}`);
  const imgSrc = options.images === 'reference' ? 'data: maws-artifact: https:' : 'data: maws-artifact:';
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data: maws-artifact:">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="MAWS">',
    `<title>${escapeText(source.title)}</title>`,
    `<style>\n${css}\n</style>`,
    '</head>',
    '<body>',
    // no whitespace between blocks: the text's own whitespace is content (`data-whitespace`, read back by the import)
    `<main class="ds-doc"><article class="ds-doc-page doc-content" data-whitespace="preserve">${content}</article></main>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
