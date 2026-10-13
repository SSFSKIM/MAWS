// The `claude` export of a design system (D12 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md): Claude's
// files from the system's document as it stands: `tokens.json` in Claude's list grammar and `README.md` from the law
// (`toClaude`), the system's faces (the `@font-face` blocks of `components/document.css` a scope declares) as Claude's
// `type.fonts` with their files under `fonts/`, and every other asset the system's files name under `assets/`. What
// main's exporter (`src/main/design-systems/`) writes for `artifact_export {format: 'claude'}` and the page's "Export
// for Claude", zipped. Portable (§4.10).
import type { Doc } from '../yjs';
import { systemFaces } from './assets';
import { assetPathOf, DOCUMENT_CSS_PATH, PRESENTATION_ATTRS } from './canon';
import { urlsIn } from './css-read';
import { toClaude, type ClaudeFont } from './claude';
import { readSystem } from './model';

/** A file of Claude's shape: text, or an asset's bytes. */
export type ClaudeExportFile = string | Uint8Array;

// An `assets/…` name in prose (the law, a comment): a supplementary reference, such as a face's licence. Prose has no
// delimiters, so a name read this way ends at a space; what the renderer loads is read from the markup instead.
const ASSET_MENTION = /(?<![\w/.-])assets\/[^\s"'`()<>,;\\]+/g;
const COMMENT = /\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g;

// The attributes whose value is one URL, as the canon frames rewrite them (page/frame.ts).
const URL_ATTRS = new Set(['src', 'href', 'poster', 'xlink:href', 'background', 'data']);
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const TAG = /<[a-zA-Z][^\s/>]*((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: '\u00a0' };
// A numeric reference's character as HTML parses it: zero, a surrogate or one past U+10FFFF is U+FFFD, never an error.
function codePoint(body: string): string {
  const value = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
  const valid = Number.isInteger(value) && value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff);
  return valid ? String.fromCodePoint(value) : '\ufffd';
}
// The character references of an attribute value: numeric ones, and the few named ones a URL plausibly holds (a fuller
// table is not needed once A's export context lists the assets).
const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => (body[0] === '#' ? codePoint(body) : (ENTITIES[body.toLowerCase()] ?? entity)));

/**
 * The URLs a canon HTML file loads, read as the canon frames read them (`rewriteHtmlAssets`, which has the renderer's
 * DOMParser; main has none): the URL attributes, each `srcset` candidate, the CSS of `style` and the SVG presentation
 * attributes, and `<style>` blocks. Comments are not markup.
 */
function htmlUrls(html: string): string[] {
  const markup = html.replace(/<!--[\s\S]*?-->/g, '');
  const urls: string[] = [];
  for (const [, css = ''] of markup.matchAll(STYLE_BLOCK)) urls.push(...urlsIn(css));
  for (const [, attributes = ''] of markup.replace(STYLE_BLOCK, '').matchAll(TAG)) {
    for (const [, rawName = '', double, single, bare] of attributes.matchAll(ATTRIBUTE)) {
      const name = rawName.toLowerCase();
      const value = () => decodeEntities(double ?? single ?? bare ?? ''); // only the attributes read are decoded
      if (URL_ATTRS.has(name)) urls.push(value());
      else if (name === 'srcset') urls.push(...value().split(',').map((candidate) => candidate.trim().split(/\s+/)[0] ?? ''));
      else if (name === 'style' || PRESENTATION_ATTRS.has(name)) urls.push(...urlsIn(value()));
    }
  }
  return urls;
}

function readExportable(doc: Doc) {
  const system = readSystem(doc);
  if (!system.meta) throw new Error('the document holds no design system yet');
  return { ...system, meta: system.meta };
}

/**
 * The assets the export reads (`assets/<name>`, sorted): what the renderer loads from the system's files, read with its
 * semantics (`assetPathOf`, the CSS URL reader): the faces of `components/document.css` (`systemFaces`), every `url()`
 * of a stylesheet, and the URLs of canon HTML; and, as supplementary references, the names the law and the files'
 * comments mention (a face's licence travels with the face). An asset nothing names is not exported.
 */
export function claudeExportAssetRefs(doc: Doc): string[] {
  const { law, tokens, files } = readExportable(doc);
  const refs = new Set<string>();
  const add = (url: string) => {
    const ref = assetPathOf(url.trim()); // as the renderer's `assetUrlOf` takes it
    if (ref) refs.add(ref);
  };
  for (const face of systemFaces(files[DOCUMENT_CSS_PATH], tokens)) for (const ref of face.refs) refs.add(ref);
  for (const [path, text] of Object.entries(files)) {
    if (path.endsWith('.css')) urlsIn(text).forEach(add);
    else if (path.endsWith('.html')) htmlUrls(text).forEach(add);
  }
  const prose = [law, ...Object.values(files).flatMap((text) => text.match(COMMENT) ?? [])];
  for (const text of prose) for (const [mention] of text.matchAll(ASSET_MENTION)) add(mention.replace(/\.+$/, '')); // a sentence's full stop is not the name's
  return [...refs].sort();
}

const nameOf = (ref: string) => ref.slice('assets/'.length);

/** A face's `font-weight` as Claude's descriptor: a weight or a range; `normal` and `bold` as numbers; absent, 400. */
function weightOf(value: string | undefined): string {
  const words = (value ?? 'normal').trim().toLowerCase().split(/\s+/).map((word) => (word === 'normal' ? '400' : word === 'bold' ? '700' : word));
  return words.join(' ');
}
const styleOf = (value: string | undefined): ClaudeFont['style'] => {
  const style = value?.trim().toLowerCase().split(/\s+/)[0];
  return style === 'italic' || style === 'oblique' ? style : 'normal';
};

/**
 * Claude's files for the system in `doc`; `assets` are the bytes of the system's assets by ref (`assets/<name>`), those
 * of `claudeExportAssetRefs` the store holds. A face's entry names the first of its sources the store holds, and each of
 * its sources goes under `fonts/`; a face none of whose files are held is left out. Throws `ClaudeShapeError` when
 * Claude's grammar cannot hold the system, and an error when the document holds no system.
 */
export function claudeExportFiles(doc: Doc, assets: Readonly<Record<string, Uint8Array>> = {}): Record<string, ClaudeExportFile> {
  const { meta, law, tokens, files: canon } = readExportable(doc);
  const held = (ref: string) => Object.hasOwn(assets, ref);
  const fonts: ClaudeFont[] = [];
  const fontRefs = new Set<string>();
  for (const face of systemFaces(canon[DOCUMENT_CSS_PATH], tokens)) {
    const file = face.refs.find(held);
    if (!file) continue;
    const descriptor = (property: string) => face.declarations.find((d) => d.property === property)?.value;
    const name = nameOf(file);
    fonts.push({ family: face.family, file: name.includes('/') ? `fonts/${name}` : name, weight: weightOf(descriptor('font-weight')), style: styleOf(descriptor('font-style')) });
    for (const ref of face.refs) fontRefs.add(ref);
  }
  const files: Record<string, ClaudeExportFile> = toClaude({ name: meta.name, law, tokens, fonts });
  for (const [ref, bytes] of Object.entries(assets)) {
    if (!ref.startsWith('assets/')) continue;
    files[fontRefs.has(ref) ? `fonts/${nameOf(ref)}` : ref] = bytes;
  }
  return files;
}
