// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12; Decision Log 37 (3); the final review's A16): an svg
// drawing written into the export page, contained as the canvas contains it (canvas/elements.ts `containSvg`, over
// canvas/svg-scope.ts): the page is one document, so an svg's `<style>` would restyle the page and every other slide,
// and its `#id`s would collide with another drawing's. Its ids and their references are renamed into the drawing's
// scope, every stylesheet in it (an HTML `<style>` the parser makes under `<desc>` or `<title>`, integration points, as
// well as the svg's own) is constrained to its elements, and the root carries the scope. Over markup (the page is
// text): the drawing is parsed by parse5, the dialect's one HTML front end, and written back. Portable.
import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';
import { scopeSvgAttribute, scopeSvgStyleSheet, SVG_SCOPE_ATTR, svgKeyframesNames, type SvgNames } from '../canvas/svg-scope';
import { escAttr } from '../serialize';

type Element = DefaultTreeAdapterMap['element'];
type Text = DefaultTreeAdapterMap['textNode'];

const isElement = (n: DefaultTreeAdapterMap['childNode']): n is Element => 'tagName' in n;
const nameOf = (a: Element['attrs'][number]) => (a.prefix ? `${a.prefix}:${a.name}` : a.name);

/** An svg's root attributes and inner markup, contained in `scope` (unique to the drawing within its page). */
export function containSvgMarkup(attrs: Readonly<Record<string, string>>, raw: string, scope: string): { attrs: Record<string, string>; inner: string } {
  const fragment = parseFragment(`<svg${Object.entries(attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('')}>${raw}</svg>`);
  const root = fragment.childNodes.find(isElement);
  if (!root) return { attrs: { ...attrs, [SVG_SCOPE_ATTR]: scope }, inner: '' };
  const all: Element[] = [];
  const walk = (el: Element) => {
    all.push(el);
    for (const child of el.childNodes) if (isElement(child)) walk(child);
  };
  walk(root);
  const ids = new Map<string, string>();
  for (const el of all) {
    const id = el === root ? undefined : el.attrs.find((a) => nameOf(a) === 'id')?.value;
    if (id) ids.set(id, `${scope}_${id}`);
  }
  // every stylesheet in the drawing, whatever its namespace
  const sheets = all.filter((el) => el.tagName.toLowerCase() === 'style');
  const textOf = (el: Element) =>
    el.childNodes
      .filter((c): c is Text => c.nodeName === '#text')
      .map((c) => c.value)
      .join('');
  const keyframes = new Map<string, string>();
  for (const sheet of sheets) for (const name of svgKeyframesNames(textOf(sheet))) keyframes.set(name, `${scope}_${name}`);
  const names: SvgNames = { scope, ids, keyframes };
  for (const el of all) {
    const element = { tag: el.tagName, attributeName: el.attrs.find((a) => nameOf(a) === 'attributeName')?.value ?? null };
    el.attrs = el.attrs.flatMap((a) => {
      if (el === root && nameOf(a) === 'id') return [a];
      const next = scopeSvgAttribute(element, nameOf(a), a.value, names);
      return next === null ? [] : [{ ...a, value: next }];
    });
  }
  for (const sheet of sheets) {
    const css = scopeSvgStyleSheet(textOf(sheet), names);
    const text = sheet.childNodes.find((c): c is Text => c.nodeName === '#text');
    sheet.childNodes = sheet.childNodes.filter((c) => c.nodeName !== '#text');
    if (text) {
      text.value = css;
      sheet.childNodes.push(text);
    } else if (css) sheet.childNodes.push({ nodeName: '#text', value: css, parentNode: sheet } as Text);
  }
  const out: Record<string, string> = {};
  for (const a of root.attrs) out[nameOf(a)] = a.value;
  out[SVG_SCOPE_ATTR] = scope;
  return { attrs: out, inner: serialize(root) };
}
