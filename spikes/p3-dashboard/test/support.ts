// P3-E2 M1 spike: the unit tests' inputs (the vendored datasets, the house theme) and the SVG grade checks both
// candidates are held to.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { HOUSE_TOKENS } from '../../../src/artifacts/document/export/design-system';
import { cases, type DatasetTexts } from '../src/fixtures';
import { themeFrom } from '../src/svg';

const DIR = join(__dirname, '../datasets');
export const texts: DatasetTexts = {
  monthly: readFileSync(join(DIR, 'gistemp-monthly.csv'), 'utf8'),
  annual: readFileSync(join(DIR, 'gistemp-annual.csv'), 'utf8'),
  gdp: readFileSync(join(DIR, 'gdp-growth.csv'), 'utf8'),
  penguins: readFileSync(join(DIR, 'penguins.csv'), 'utf8'),
};
export const CASES = cases(texts);
export const theme = themeFrom(HOUSE_TOKENS.properties).theme;

const ELEMENTS = new Set(['svg', 'title', 'desc', 'g', 'path', 'rect', 'circle', 'text', 'tspan']);
const ATTRIBUTES = new Set([
  'xmlns', 'viewBox', 'width', 'height', 'role', 'aria-label', 'font-family', 'font-size', 'font-weight', 'fill', 'fill-opacity', 'style',
  'd', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linejoin', 'stroke-linecap', 'paint-order', 'transform',
  'x', 'y', 'dy', 'rx', 'cx', 'cy', 'r', 'text-anchor', 'data-tip',
]);

export interface Grade {
  elements: number;
  texts: string[];
  problems: string[];
}

/** Parses the SVG as XML and lists every grade violation: unknown elements or attributes, references, scripts. */
export function grade(svg: string): Grade {
  const problems: string[] = [];
  const doc = new DOMParser({ errorHandler: { warning: (m: string) => void problems.push(`xml warning: ${m}`), error: (m: string) => void problems.push(`xml error: ${m}`), fatalError: (m: string) => void problems.push(`xml fatal: ${m}`) } }).parseFromString(svg, 'image/svg+xml');
  const texts: string[] = [];
  let elements = 0;
  const walk = (node: Element) => {
    elements += 1;
    if (!ELEMENTS.has(node.tagName)) problems.push(`element <${node.tagName}>`);
    for (let i = 0; i < node.attributes.length; i += 1) {
      const { name, value } = node.attributes[i];
      if (!ATTRIBUTES.has(name)) problems.push(`attribute ${name} on <${node.tagName}>`);
      if (name === 'style' && (node.tagName !== 'svg' || value !== 'font-variant-numeric:tabular-nums')) problems.push(`style "${value}"`);
      if (/url\(|javascript:|https?:|data:/i.test(value) && name !== 'xmlns' && name !== 'data-tip' && name !== 'aria-label') problems.push(`reference in ${name}="${value}"`);
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) walk(child as Element);
      else if (child.nodeType === 3 && child.nodeValue!.trim() !== '') texts.push(child.nodeValue!);
      else if (child.nodeType !== 3) problems.push(`node type ${child.nodeType}`);
    }
  };
  if (doc.documentElement) walk(doc.documentElement as unknown as Element);
  else problems.push('no document element');
  if (doc.documentElement?.getAttribute('xmlns') !== 'http://www.w3.org/2000/svg') problems.push('not an SVG root');
  return { elements, texts, problems };
}
