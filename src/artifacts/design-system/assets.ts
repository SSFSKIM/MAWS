// A system's own files where something renders it (D14, Decision Log 17): canon and `components/document.css` name a
// system's files as `assets/<name>`, and a renderer loads them through `ArtifactHost.assetUrl`. The page's frames take
// every asset reference rewritten; a scope in the app takes the system's faces, the `@font-face` blocks of its
// `document.css` (D6 as amended by Decision Log 11), so a type specimen, a document or a deck outside a frame is set in
// the face the system bundles. Portable (§4.10).
import { assetPathOf } from './canon';
import { cssString, fontFamilyCss } from './css';
import { parseStylesheet, urlsIn } from './css-read';
import { resolveTokens } from './resolve';
import type { TokenSet } from './tokens';

/** An asset's URL from its path in the system (`assets/<name>`): `ArtifactHost.assetUrl` bound to the system's id. */
export type AssetUrl = (ref: string) => string;

const URL_CALL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;

/** CSS text with each `url()` that names an asset loading it through `toUrl`; any other is left as written. */
export function rewriteCssUrls(css: string, toUrl: AssetUrl): string {
  return css.replace(URL_CALL, (call, double?: string, single?: string, bare?: string) => {
    const ref = assetPathOf((double ?? single ?? bare ?? '').trim());
    return ref ? `url(${cssString(toUrl(ref))})` : call;
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

/**
 * The `@font-face` blocks of a system's `document.css` that a renderer outside a frame may declare: a face of a family
 * the system's tokens set, every source of it one of the system's assets (rewritten through `toUrl`). A face loading
 * anything else, or naming a family the system never sets, is left out: a face is declared for the whole window, so it
 * may neither fetch from elsewhere nor stand in for a family the system does not name. Without `toUrl` (the built-in
 * floor, which has no store), none.
 */
export function fontFaceCss(documentCss: string | undefined, tokens: TokenSet, toUrl: AssetUrl | null): string {
  if (!documentCss || !toUrl) return '';
  const families = systemFamilies(tokens);
  const faces: string[] = [];
  for (const node of parseStylesheet(documentCss).nodes) {
    if (node.kind !== 'at' || node.name !== 'font-face' || node.within.length || !node.declarations) continue;
    const declarations = node.declarations.filter((d) => FACE_DESCRIPTORS.has(d.property));
    const family = declarations.find((d) => d.property === 'font-family');
    const src = declarations.find((d) => d.property === 'src');
    if (!family || !src || !families.has(unquote(family.value).toLowerCase())) continue;
    const urls = urlsIn(src.value);
    if (!urls.length || urls.some((url) => assetPathOf(url) === null)) continue;
    if (declarations.some((d) => STRUCTURAL.test(d.value))) continue; // nothing that could end the block or the element
    const lines = declarations.map((d) => {
      if (d.property === 'font-family') return `  font-family: ${fontFamilyCss(unquote(d.value))};`;
      return `  ${d.property}: ${d.property === 'src' ? rewriteCssUrls(d.value, toUrl) : d.value};`;
    });
    faces.push(['@font-face {', ...lines, '}'].join('\n'));
  }
  return faces.length ? `${faces.join('\n')}\n` : '';
}
