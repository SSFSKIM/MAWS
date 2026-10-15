// Each default's law and canon (Acceptance 8): the law parses into its nine sections with known check tags, the canon is
// structurally valid (D6), its own hard don'ts find nothing in it, and its slide-dialect HTML keeps to the dialect's
// shape. The dialect is the presentation kind's (§4.5 of docs/doperpowers/plans/2026-10-12-p3-co-work.md: Claude's
// closed list, adopted property for property, plus `var(--ds-*)`); the shape rules below are the ones a design
// system's canon can break, checked here until C's parser is the authority.
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { canonElements, canonUnits, CHECK_RULES, checkHardDonts, parseLaw, parseTokens, validateCanon, type CanonElement, type HtmlParser } from '../../design-system';
import { DEFAULT_SYSTEMS } from './defaults';

const parser = new new Window().DOMParser() as unknown as HtmlParser;

// The dialect's text elements, its inline set (the only content of an `li`), and the elements that hold no text of
// their own (text goes in a text element inside them).
const INLINE = new Set(['b', 'i', 'u', 'a', 'span', 'br']);
const NO_OWN_TEXT = new Set(['section', 'div', 'table', 'tr', 'ul', 'ol']);
// Where the dialect lets a property apply (Claude's list: `gap`, `display`, `align-items` on section and div;
// `justify-content` and `flex-direction` on a flex box; `color` on text, span, cells and (its Tables note) the table;
// `font-size` on text and table; `line-height` on text). Cells take only their own few properties; a row takes only a background.
const BOX = new Set(['section', 'div']);
const TEXT = new Set(['h1', 'h2', 'h3', 'p', 'ul', 'ol']);
const WHERE: Record<string, ReadonlySet<string>> = {
  display: BOX,
  gap: BOX,
  'align-items': BOX,
  'justify-content': BOX,
  'flex-direction': BOX,
  color: new Set([...TEXT, 'span', 'td', 'th', 'hr', 'table']),
  'font-size': new Set([...TEXT, 'table']),
  'line-height': TEXT,
  'font-variant-numeric': TEXT,
};
const CELL = new Set(['width', 'height', 'padding', 'text-align', 'color']);
const NEVER = new Set(['margin', 'border-collapse', 'vertical-align', 'z-index', 'float']);

/** Every way an element breaks the dialect's shape, by its locator. */
function shapeProblems(element: CanonElement): string[] {
  const problems: string[] = [];
  const { tag, at } = element;
  if (NO_OWN_TEXT.has(tag) && element.text.trim()) problems.push(`${at}: text directly in a <${tag}>`);
  if (tag === 'li') for (const child of element.children) if (!INLINE.has(child.tag)) problems.push(`${at}: <${child.tag}> inside an <li>`);
  for (const { property } of element.style) {
    if (NEVER.has(property)) problems.push(`${at}: ${property} is not in the dialect`);
    else if (tag === 'td' || tag === 'th') {
      if (!CELL.has(property) && !(tag === 'th' && property === 'font-weight')) problems.push(`${at}: ${property} on a cell`);
    } else if (tag === 'tr') {
      if (property !== 'background') problems.push(`${at}: ${property} on a row`);
    } else if (WHERE[property] && !WHERE[property]!.has(tag)) problems.push(`${at}: ${property} on a <${tag}>`);
  }
  return [...problems, ...element.children.flatMap(shapeProblems)];
}

describe('the shape rules themselves', () => {
  it('catch text in a div, a block in an li, a misplaced property and a property outside the dialect', () => {
    const html = `<section id="x" style="display:flex"><div>B</div><ul><li><div><p>step</p></div></li></ul>
      <ul style="display:flex"><li>ok</li></ul><table style="border-collapse:collapse"><tr><td style="vertical-align:top;font-size:12px">a</td></tr></table></section>`;
    const problems = canonElements(html, parser).flatMap(shapeProblems);
    expect(problems.join('\n')).toMatch(/text directly in a <div>/);
    expect(problems.join('\n')).toMatch(/<div> inside an <li>/);
    expect(problems.join('\n')).toMatch(/display on a <ul>/);
    expect(problems.join('\n')).toMatch(/border-collapse is not in the dialect/);
    expect(problems.join('\n')).toMatch(/vertical-align is not in the dialect/);
    expect(problems.join('\n')).toMatch(/font-size on a cell/);
    const clean = `<section id="x" style="display:flex;gap:8px"><div style="display:flex"><p style="color:red">B</p></div><ul><li>a <b>b</b></li></ul></section>`;
    expect(canonElements(clean, parser).flatMap(shapeProblems)).toEqual([]);
  });
});

describe.each(DEFAULT_SYSTEMS.map((system) => [system.key, system] as const))('the %s default', (_key, system) => {
  const tokens = parseTokens(system.files['tokens.tokens.json']).tokens!;
  const law = parseLaw(system.files['DESIGN.md']!);
  const canonPaths = Object.keys(system.files).filter((path) => path.startsWith('layouts/') || path.startsWith('components/'));

  it('writes its law in the nine sections, about 300 lines, with known check tags and every canon file named in §5', () => {
    expect(law.problems).toEqual([]);
    expect(law.sections.map((s) => s.number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(law.title).toBe(system.name);
    expect(system.files['DESIGN.md']!.split('\n').length).toBeLessThanOrEqual(320);
    const tags = law.donts.flatMap((d) => d.tags.map((t) => t.name));
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(CHECK_RULES).toContain(tag);
    const section5 = law.sections.find((s) => s.number === 5)!.body;
    for (const path of canonPaths) expect(section5, path).toContain(path);
  });

  it('has a structurally valid canon', () => {
    expect(validateCanon(system.files, parser, tokens)).toEqual([]);
  });

  it('passes its own law’s mechanical checks on its own canon', () => {
    const report = checkHardDonts(law, tokens, canonUnits(system.files, parser));
    expect(report.unknown).toEqual([]);
    expect(report.violations).toEqual([]);
    expect(report.checks.length).toBe(law.donts.reduce((n, d) => n + d.tags.length, 0));
  });

  it('keeps its slide-dialect HTML to the dialect’s shape', () => {
    for (const path of canonPaths.filter((p) => p.endsWith('.html'))) {
      expect(canonElements(system.files[path]!, parser).flatMap(shapeProblems), path).toEqual([]);
    }
  });
});
