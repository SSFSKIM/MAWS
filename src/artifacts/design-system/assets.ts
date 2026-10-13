// A system's own files where something renders it (D14, Decision Log 17): canon and `components/document.css` name a
// system's files as `assets/<name>`, and a renderer loads them through `ArtifactHost.assetUrl`. The page's frames take
// every asset reference rewritten; a scope in the app takes the system's faces, the `@font-face` blocks of its
// `document.css` (D6 as amended by Decision Log 11), so a type specimen, a document or a deck outside a frame is set in
// the face the system bundles, under a family name private to the system and its revision. Portable (§4.10).
import { assetPathOf } from './canon';
import { cssString, fontFamilyCss } from './css';
import { stableHash } from './hash';
import { parseStylesheet, urlsIn, type Declaration } from './css-read';
import { resolveTokens } from './resolve';
import type { TokenSet } from './tokens';

/** An asset's URL from its path in the system (`assets/<name>`): `ArtifactHost.assetUrl` bound to the system's id. */
export type AssetUrl = (ref: string) => string;

/**
 * Where a canon URL that names one of the system's assets loads from: `toUrl` of the asset, its fragment kept (an SVG
 * symbol's or paint server's id), or null for a URL that names no asset.
 */
export function assetUrlOf(url: string, toUrl: AssetUrl): string | null {
  const trimmed = url.trim();
  const ref = assetPathOf(trimmed);
  if (ref === null) return null;
  const at = trimmed.indexOf('#');
  return toUrl(ref) + (at < 0 ? '' : trimmed.slice(at));
}

const URL_CALL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;

/** CSS text with each `url()` that names an asset loading it through `toUrl` (its fragment kept); any other as written. */
export function rewriteCssUrls(css: string, toUrl: AssetUrl): string {
  return css.replace(URL_CALL, (call, double?: string, single?: string, bare?: string) => {
    const url = assetUrlOf(double ?? single ?? bare ?? '', toUrl);
    return url ? `url(${cssString(url)})` : call;
  });
}

/** Every family name a system's fonts and type roles set, lower-cased. */
export function systemFamilies(tokens: TokenSet): Set<string> {
  const names = new Set<string>();
  const add = (value: string | string[]) => {
    for (const name of typeof value === 'string' ? [value] : value) names.add(name.toLowerCase());
  };
  for (const token of resolveTokens(tokens).tokens.values()) {
    if (token.type === 'fontFamily') add(token.value);
    else if (token.type === 'typography') add(token.value.fontFamily);
  }
  return names;
}

// The descriptors an `@font-face` block may carry; anything else in one is dropped.
const FACE_DESCRIPTORS = new Set([
  'font-family', 'src', 'font-weight', 'font-style', 'font-stretch', 'font-display', 'unicode-range', 'font-feature-settings',
  'font-variation-settings', 'ascent-override', 'descent-override', 'line-gap-override', 'size-adjust',
]);
const STRUCTURAL = /[{};<>\\]/;
const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/s, '$2');

/** One `@font-face` block of a system's `document.css` that a renderer may declare (`systemFaces`). */
export interface SystemFace {
  /** The authored family name, unquoted. */
  family: string;
  /** Its descriptors on the allowlist, as written. */
  declarations: readonly Declaration[];
  /** The assets its `src` loads, in order (`assets/<name>`). */
  refs: readonly string[];
}

/**
 * The `@font-face` blocks of a system's `document.css` that a renderer may declare: a face of a family the system's
 * tokens set, with exactly one `font-family` and one `src` (a duplicate would make which one counts the engine's guess),
 * every source one of the system's assets, its descriptors on the allowlist with nothing that could end the block or the
 * element. A face loading anything else, or naming a family the system never sets, is left out.
 */
export function systemFaces(documentCss: string | undefined, tokens: TokenSet): SystemFace[] {
  if (!documentCss) return [];
  const families = systemFamilies(tokens);
  const faces: SystemFace[] = [];
  for (const node of parseStylesheet(documentCss).nodes) {
    if (node.kind !== 'at' || node.name !== 'font-face' || node.within.length || !node.declarations) continue;
    const declarations = node.declarations.filter((d) => FACE_DESCRIPTORS.has(d.property));
    const named = declarations.filter((d) => d.property === 'font-family');
    const sources = declarations.filter((d) => d.property === 'src');
    if (named.length !== 1 || sources.length !== 1) continue;
    const family = unquote(named[0]!.value);
    if (!families.has(family.toLowerCase())) continue;
    const refs = urlsIn(sources[0]!.value).map(assetPathOf);
    if (!refs.length || refs.some((ref) => ref === null)) continue;
    if (declarations.some((d) => STRUCTURAL.test(d.value))) continue; // nothing that could end the block or the element
    faces.push({ family, declarations, refs: refs as string[] });
  }
  return faces;
}

/** A system's faces as a scope declares them: the blocks, and each authored family's private name (lower-cased → alias). */
export interface SystemFaces {
  css: string;
  aliases: ReadonlyMap<string, string>;
}

/**
 * The system's faces (`systemFaces`) as CSS, every source rewritten through `toUrl`. Without `toUrl` (the built-in
 * floor, which has no store), none.
 *
 * `aliased` declares each family under a private name, unique to the system, its revision of `document.css` and the
 * family (`ds-face-…`), and returns the names for the scope's family values to put first: a face is declared for the
 * whole window, so under its authored name two systems' (or two revisions') files would compete for one family, and a
 * system could stand in for a family the app itself uses. A frame, a window of its own, keeps the authored names.
 */
export function fontFaces(documentCss: string | undefined, tokens: TokenSet, toUrl: AssetUrl | null, options: { aliased: boolean }): SystemFaces {
  const aliases = new Map<string, string>();
  if (!documentCss || !toUrl) return { css: '', aliases };
  const faces: string[] = [];
  for (const { family, declarations } of systemFaces(documentCss, tokens)) {
    let name = family;
    if (options.aliased) {
      const key = family.toLowerCase();
      name = aliases.get(key) ?? `ds-face-${stableHash(`${toUrl('assets/')}\n${documentCss}\n${key}`)}`;
      aliases.set(key, name);
    }
    const lines = declarations.map((d) => {
      if (d.property === 'font-family') return `  font-family: ${fontFamilyCss(name)};`;
      return `  ${d.property}: ${d.property === 'src' ? rewriteCssUrls(d.value, toUrl) : d.value};`;
    });
    faces.push(['@font-face {', ...lines, '}'].join('\n'));
  }
  return { css: faces.length ? `${faces.join('\n')}\n` : '', aliases };
}

/** The system's faces under their authored names, for a frame (a document of its own). */
export const fontFaceCss = (documentCss: string | undefined, tokens: TokenSet, toUrl: AssetUrl | null): string => fontFaces(documentCss, tokens, toUrl, { aliased: false }).css;
