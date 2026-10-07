// E4c (E4c execution document, Design §5; A-33 item 5): the snapshot's cut over E4-0's three saved real snapshots
// (`spikes/browser-probe/results/pass2/snapshot-*.txt`) and a small synthetic page.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BROWSER_SNAPSHOT_MAX_CHARS_CEILING, BROWSER_SNAPSHOT_MAX_CHARS_DEFAULT, BROWSER_SNAPSHOT_OUTLINE_MAX_LINES } from '../maws/browser';
import { countRefs, cutSnapshot, outlineOf, REF_PATTERN, SNAPSHOT_OUTLINE_HEADER } from './snapshot';

const real = (name: string) => readFileSync(fileURLToPath(new URL(`../../../spikes/browser-probe/results/pass2/snapshot-${name}.txt`, import.meta.url)), 'utf8');
const GITHUB = real('github-front');
const HN = real('hn-front');
const WIKIPEDIA = real('wikipedia-main');

const SMALL = [
  '- generic [ref=e2]:',
  '  - heading "E4c order form" [level=1] [ref=e3]',
  '  - textbox "Name" [ref=e4]',
  '  - textbox "Email" [ref=e5]',
  '  - button "Submit" [disabled] [ref=e6]',
  '  - paragraph [ref=e7]: Fill in both fields; the button enables a moment after the email.',
  '  - link "Back to the start" [ref=e8] [cursor=pointer]:',
  '    - /url: /index.html',
  '  - contentinfo [ref=e9]:',
  '    - text: MAWS e2e fixture page, served on the loopback for the browser tools.',
].join('\n');

const linesOf = (text: string) => text.split('\n').filter((line, i, all) => !(i === all.length - 1 && line === ''));

// The cut's parts: the outline (header and lines), the body, the trailer.
function partsOf(text: string) {
  const lines = text.split('\n');
  const trailerAt = lines.findIndex((line) => line.startsWith('… '));
  const bodyAt = lines.indexOf('# snapshot:');
  return { outline: lines.slice(1, bodyAt), body: lines.slice(bodyAt + 1, trailerAt), trailer: lines[trailerAt]!, header: lines[0] };
}

describe('countRefs and REF_PATTERN', () => {
  it('count the [ref=…] marks of Playwright\'s ai snapshot and read one ref', () => {
    expect(countRefs(SMALL)).toBe(8);
    expect(countRefs('- generic:\n  - text: no refs [cursor=pointer]')).toBe(0);
    expect(REF_PATTERN.exec('  - button "Submit" [disabled] [ref=f2e6]')?.[1]).toBe('f2e6');
    expect(countRefs(GITHUB)).toBe((GITHUB.match(/\[ref=/g) ?? []).length);
  });
});

describe('outlineOf', () => {
  it('lists landmarks at any depth and level-1 and level-2 headings, with their refs and depth, in page order', () => {
    const outline = outlineOf(GITHUB, BROWSER_SNAPSHOT_OUTLINE_MAX_LINES);
    expect(outline.length).toBeLessThanOrEqual(BROWSER_SNAPSHOT_OUTLINE_MAX_LINES);
    expect(outline).toContain('    - banner [ref=f1e8]');
    expect(outline).toContain('          - navigation "Global" [ref=f1e23]');
    expect(outline).toContain('  - main [ref=f1e343]');
    expect(outline).toContain('  - contentinfo [ref=f1e966]');
    expect(outline).toContain('      - heading "Navigation Menu" [level=2] [ref=f1e9]');
    const order = outline.map((line) => GITHUB.indexOf(line));
    expect(order).toEqual([...order].sort((a, b) => a - b)); // the page's order
    expect(outline.every((line) => /^\s*- /.test(line) && !line.endsWith(':'))).toBe(true);
  });

  it('keeps landmarks before headings when the cap binds, and never exceeds it', () => {
    const outline = outlineOf(WIKIPEDIA, 5);
    expect(outline).toHaveLength(5);
    expect(outline.every((line) => /- (banner|navigation|main|contentinfo|search|complementary|region|form)\b/.test(line))).toBe(true);
    expect(outlineOf(WIKIPEDIA, BROWSER_SNAPSHOT_OUTLINE_MAX_LINES)).toContain('    - main [ref=f4e95]');
  });

  it('falls back to the ref-bearing lines at depth 0 and 1 for a page with no landmarks', () => {
    expect(outlineOf(HN, BROWSER_SNAPSHOT_OUTLINE_MAX_LINES)).toEqual(['- table [ref=f5e3]', '  - rowgroup [ref=f5e4]']);
  });

  it('fills the room left after the landmarks with depth-0 and depth-1 ref-bearing lines', () => {
    expect(outlineOf(SMALL, 40)).toEqual([
      '- generic [ref=e2]',
      '  - heading "E4c order form" [level=1] [ref=e3]',
      '  - textbox "Name" [ref=e4]',
      '  - textbox "Email" [ref=e5]',
      '  - button "Submit" [disabled] [ref=e6]',
      '  - paragraph [ref=e7]',
      '  - link "Back to the start" [ref=e8] [cursor=pointer]',
      '  - contentinfo [ref=e9]',
    ]);
    expect(outlineOf(SMALL, 2)).toEqual(['  - heading "E4c order form" [level=1] [ref=e3]', '  - contentinfo [ref=e9]']);
  });

  it('reads a role in a quoted line', () => {
    expect(outlineOf(`- 'navigation "Docs: v2" [ref=e4]':\n    - 'link "Beam: Reflection''s model" [ref=e5]'`, 40)).toEqual([`- 'navigation "Docs: v2" [ref=e4]'`]);
    expect(outlineOf(`- "heading \\"A: b\\" [level=1] [ref=e2]"`, 40)).toEqual([`- "heading \\"A: b\\" [level=1] [ref=e2]"`]);
  });
});

describe('cutSnapshot', () => {
  it('returns a page within maxChars whole', () => {
    expect(SMALL.length).toBeLessThan(1000);
    expect(cutSnapshot(SMALL, { maxChars: 1000 })).toEqual({ text: SMALL, truncated: false, chars: SMALL.length, lines: 10, refs: 8, omitted: null });
    expect(cutSnapshot(GITHUB, { maxChars: BROWSER_SNAPSHOT_MAX_CHARS_CEILING })).toMatchObject({ text: GITHUB, truncated: false, omitted: null });
  });

  it('cuts GitHub at the default 24,000 keeping about half its refs, with the landmarks in the outline', () => {
    const cut = cutSnapshot(GITHUB, { maxChars: BROWSER_SNAPSHOT_MAX_CHARS_DEFAULT });
    expect(cut).toMatchObject({ truncated: true, chars: GITHUB.length, lines: linesOf(GITHUB).length, refs: countRefs(GITHUB) });
    expect(cut.text.length).toBeLessThanOrEqual(BROWSER_SNAPSHOT_MAX_CHARS_DEFAULT);
    const kept = (cut.refs - cut.omitted!.refs) / cut.refs;
    expect(kept).toBeGreaterThan(0.42);
    expect(kept).toBeLessThan(0.52);
    const { header, outline } = partsOf(cut.text);
    expect(header).toBe(SNAPSHOT_OUTLINE_HEADER);
    for (const landmark of ['- banner [ref=f1e8]', '- navigation "Global" [ref=f1e23]', '- main [ref=f1e343]', '- contentinfo [ref=f1e966]'])
      expect(outline.some((line) => line.trimStart() === landmark), landmark).toBe(true);
  });

  it('still cuts Wikipedia at the 64,000 ceiling, with main in the outline', () => {
    const cut = cutSnapshot(WIKIPEDIA, { maxChars: BROWSER_SNAPSHOT_MAX_CHARS_CEILING });
    expect(cut.truncated).toBe(true);
    expect(cut.text.length).toBeLessThanOrEqual(BROWSER_SNAPSHOT_MAX_CHARS_CEILING);
    expect(partsOf(cut.text).outline).toContain('    - main [ref=f4e95]');
  });

  it('gives Hacker News, which has no landmarks, its depth-0 and depth-1 lines as the outline', () => {
    const cut = cutSnapshot(HN, { maxChars: BROWSER_SNAPSHOT_MAX_CHARS_DEFAULT });
    expect(partsOf(cut.text).outline).toEqual(['- table [ref=f5e3]', '  - rowgroup [ref=f5e4]']);
  });

  it('never splits a line, never exceeds maxChars, and counts exactly what it dropped', () => {
    for (const [name, page] of [['github', GITHUB], ['hn', HN], ['wikipedia', WIKIPEDIA]] as const) {
      const all = linesOf(page);
      for (const maxChars of [1000, 4000, BROWSER_SNAPSHOT_MAX_CHARS_DEFAULT, 40_000, BROWSER_SNAPSHOT_MAX_CHARS_CEILING]) {
        const cut = cutSnapshot(page, { maxChars });
        const label = `${name} at ${maxChars}`;
        expect(cut.text.length, label).toBeLessThanOrEqual(maxChars);
        if (!cut.truncated) {
          expect(cut.text, label).toBe(page);
          continue;
        }
        const { body, trailer } = partsOf(cut.text);
        expect(body, label).toEqual(all.slice(0, body.length)); // whole lines, from the top
        const dropped = all.slice(body.length);
        expect(cut.omitted, label).toEqual({ lines: dropped.length, refs: countRefs(dropped.join('\n')) });
        expect(trailer, label).toBe(`… ${dropped.length} more lines (${cut.omitted!.refs} refs) omitted; call again with root: <ref> for a subtree or raise maxChars (max 64000)`);
      }
    }
  });

  it('keeps the outline to half of a small maxChars, so the body still gets room', () => {
    const cut = cutSnapshot(WIKIPEDIA, { maxChars: 1000 });
    const { outline, body } = partsOf(cut.text);
    expect([SNAPSHOT_OUTLINE_HEADER, ...outline].join('\n').length).toBeLessThanOrEqual(500);
    expect(outline.length).toBeGreaterThan(0);
    expect(body.length).toBeGreaterThan(0);
  });
});
