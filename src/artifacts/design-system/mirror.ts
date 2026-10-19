// The design system's linked-directory mirror (Decision Log 18 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md;
// P3-L's `registerMirrorWriter`, the P3 interface ledger §7): a system in a Space linked to a project directory is
// mirrored as a folder named by its slug holding exactly the agent's file view (`readFiles`): the law, the token file,
// the canon, the kept Claude sources, and the generated `tokens.css` and `office-theme.json`, so the project holds the
// system its code is styled by, with `tokens.css` ready to import. Beside them, every asset the store lists for the
// system under `assets/` (its faces included, read through L's `readAsset`), so the canon's and `document.css`'s
// `assets/…` references resolve in the mirrored folder: canon names an asset from the system's root while a browser
// resolves a URL from the file that holds it, so a canon file's asset references are written relative to its directory
// (`../assets/…` under `components/`), every other byte as it is. Portable (§4.10); registered by the engine host's
// design-system module.
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import type { MirrorWriter } from '../library/mirror';
import { mirrorSlug } from '../library/mirror';
import { assetPathOf, canonKind, PRESENTATION_ATTRS } from './canon';
import { readFiles, readOrigin } from './model';

// The references the in-app frames load through `assetUrl` (page/frame.ts): the URL attributes, `srcset`, and the
// `url()`s of `style`, the SVG presentation attributes and `<style>` blocks.
const URL_ATTRS = new Set(['src', 'href', 'poster', 'xlink:href', 'background', 'data']);
const CSS_ATTRS = new Set(['style', ...PRESENTATION_ATTRS]);
const URL_CALL = /(url\(\s*)(?:"([^"]*)"|'([^']*)'|([^)\s]*))(?=\s*\))/gi;

/** A URL with `up` before it when it names one of the system's assets; any other as written. */
const relative = (url: string, up: string) => (assetPathOf(url.trim()) === null ? url : url.replace(/^\s*/, (space) => space + up));
const cssRelative = (css: string, up: string) =>
  css.replace(URL_CALL, (_call, open: string, double?: string, single?: string, bare?: string) => {
    const quote = double !== undefined ? '"' : single !== undefined ? "'" : '';
    return `${open}${quote}${relative(double ?? single ?? bare ?? '', up)}${quote}`;
  });
const srcsetRelative = (srcset: string, up: string) => srcset.replace(/(^|,)(\s*)([^\s,]+)/g, (_match, comma: string, space: string, url: string) => comma + space + relative(url, up));

const attrValue = (value: string) => `"${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;

/** Canon HTML (read by parse5, as the slide dialect is) with only the attributes and style text that name an asset rewritten. */
function htmlRelative(html: string, up: string): string {
  const edits: { start: number; end: number; text: string }[] = [];
  const walk = (node: DefaultTreeAdapterMap['node']) => {
    if ('attrs' in node) {
      for (const attr of node.attrs) {
        const name = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name;
        const value = URL_ATTRS.has(name) ? relative(attr.value, up) : name === 'srcset' ? srcsetRelative(attr.value, up) : CSS_ATTRS.has(name) ? cssRelative(attr.value, up) : attr.value;
        const at = node.sourceCodeLocation?.attrs?.[name];
        if (value === attr.value || !at) continue;
        const written = /^[^\s=]+/.exec(html.slice(at.startOffset, at.endOffset))![0]; // the name as written
        edits.push({ start: at.startOffset, end: at.endOffset, text: `${written}=${attrValue(value)}` });
      }
    }
    if ('value' in node && node.parentNode && 'tagName' in node.parentNode && node.parentNode.tagName === 'style' && node.sourceCodeLocation) {
      const { startOffset: start, endOffset: end } = node.sourceCodeLocation;
      const value = cssRelative(node.value, up);
      // an HTML <style> is raw text; an SVG one reads character references, so its text is escaped again
      if (value !== node.value) edits.push({ start, end, text: html.slice(start, end) === node.value ? value : value.replace(/&/g, '&amp;').replace(/</g, '&lt;') });
    }
    if ('childNodes' in node) node.childNodes.forEach(walk);
  };
  walk(parseFragment(html, { sourceCodeLocationInfo: true }));
  let out = html;
  for (const { start, end, text } of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, start) + text + out.slice(end);
  return out;
}

/** A file of the view as the mirror writes it: a canon file's asset references relative to its directory, any other file as it is. */
function mirrored(path: string, text: string): string {
  const kind = canonKind(path);
  if (kind === null || kind === 'stray') return text;
  const up = '../'.repeat(path.split('/').length - 1);
  return kind === 'stylesheet' ? cssRelative(text, up) : htmlRelative(text, up);
}

export const designSystemMirrorWriter: MirrorWriter = ({ artifact, doc, assets = [], readAsset }) => {
  if (!doc || readOrigin(doc) === null) return { files: {} }; // nothing written into it yet
  const folder = mirrorSlug(artifact);
  const files: Record<string, string | Uint8Array> = Object.fromEntries(Object.entries(readFiles(doc)).map(([path, text]) => [`${folder}/${path}`, mirrored(path, text)]));
  if (readAsset) for (const { ref } of assets) files[`${folder}/${ref}`] = readAsset(ref);
  return { files };
};
