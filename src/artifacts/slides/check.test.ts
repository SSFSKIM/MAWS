// P3-C M6 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D10, "Check against the design system"): the deck as
// D's check units, run by D's `checkHardDonts` against the governing system's law and tokens, each violation naming the
// slide and the element the editor selects.
import { describe, expect, it } from 'vitest';
import { checkHardDonts } from '../design-system/check';
import { parseLaw } from '../design-system/law';
import { parseTokens } from '../design-system/tokens';
import { defaultSystem, HOUSE_KEY } from '../types/design_system/defaults';
import { newDoc, transact, type Doc } from '../yjs';
import { checkDeck, elementOfLocator, unitsOfDeck } from './check';
import { importSlide, writeDeckKeys } from './model';
import { loadSlide } from './parse';

const house = defaultSystem(HOUSE_KEY)!;
const law = house.files['DESIGN.md']!;
const tokens = parseTokens(JSON.parse(house.files['tokens.tokens.json']!)).tokens!;

function deckOf(files: Record<string, string>): Doc {
  const doc = newDoc();
  const ids = Object.keys(files);
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: ids });
    ids.forEach((id, i) => {
      const loaded = loadSlide(files[id]!, { fileId: id });
      if (!loaded.ok) throw new Error(`fixture ${id}: ${loaded.held.reasons.join('; ')}`);
      importSlide(doc, loaded.slide, `a${i}`);
    });
  });
  return doc;
}

const CLEAN = `<section id="clean" style="background:var(--ds-color-bg); padding:128px"><h1 id="title" style="font-family:var(--ds-font-display); font-size:var(--ds-type-h1-size); color:var(--ds-color-text)">Air has mass</h1></section>`;
const PLANTED = `<section id="planted" style="background:var(--ds-color-bg); padding:128px"><div id="card" style="display:flex; flex-direction:column"><p id="loud" style="font-size:var(--ds-type-body-size); color:#ff0044">Red alert</p></div><table id="t" style="font-size:24px"><tr id="r1"><th>Mass</th></tr><tr id="r2"><td style="color:#00ff00">1 g</td></tr></table><aside>Notes are not on the slide: #123456 is fine here.</aside></section>`;

describe('the deck as check units', () => {
  it('makes one slide unit per slide, in deck order, its elements by id with their own text and declarations', () => {
    const units = unitsOfDeck(deckOf({ clean: CLEAN, planted: PLANTED }));
    expect(units.map((u) => [u.name, u.kind])).toEqual([
      ['clean', 'slide'],
      ['planted', 'slide'],
    ]);
    const [section] = units[1]!.elements;
    expect(section!.at).toBe('section#planted');
    const card = section!.children[0]!;
    expect(card.at).toBe('section#planted > div#card');
    const loud = card.children[0]!;
    expect(loud).toMatchObject({ tag: 'p', text: 'Red alert', at: 'section#planted > div#card > p#loud' });
    expect(loud.style).toContainEqual({ property: 'color', value: '#ff0044' });
    // a cell is named by its row and place; its text is its own
    const cell = section!.children[1]!.children[1]!.children[0]!;
    expect(cell).toMatchObject({ tag: 'td', text: '1 g', at: 'section#planted > table#t > tr#r2 > td:nth-child(1)' });
  });

  it('finds a planted literal colour against the house system, and nothing on a clean slide', () => {
    const report = checkHardDonts(parseLaw(law), tokens, unitsOfDeck(deckOf({ clean: CLEAN, planted: PLANTED })));
    const literal = report.violations.filter((v) => v.rule === 'literal-color');
    expect(literal.map((v) => [v.unit, v.element])).toEqual([
      ['planted', 'section#planted > div#card > p#loud'],
      ['planted', 'section#planted > table#t > tr#r2 > td:nth-child(1)'],
    ]);
    expect(report.violations.filter((v) => v.unit === 'clean')).toEqual([]);
  });

  it('reads an svg’s own markup, so a gradient drawn inside it is found', () => {
    const svg = `<section id="s" style="background:var(--ds-color-bg)"><svg id="pic" aria-label="Bars" viewBox="0 0 10 10" style="width:200px; height:200px"><defs><linearGradient id="g"><stop offset="0" stop-color="var(--ds-color-accent)"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg></section>`;
    const report = checkHardDonts(parseLaw(law), tokens, unitsOfDeck(deckOf({ s: svg })));
    expect(report.violations.filter((v) => v.rule === 'no-gradient').map((v) => v.element)).toEqual([expect.stringMatching(/^section#s > svg#pic > /)]);
  });

  it('runs the whole check in one call and names what each violation selects', () => {
    const result = checkDeck(deckOf({ clean: CLEAN, planted: PLANTED }), law, tokens);
    expect(result.donts.length).toBeGreaterThan(0);
    const first = result.report.violations.find((v) => v.rule === 'literal-color')!;
    expect(elementOfLocator(first.element)).toBe('loud');
    // a cell selects its table (cells are not selectable); the section selects nothing
    expect(elementOfLocator('section#planted > table#t > tr#r2 > td:nth-child(1)')).toBe('t');
    expect(elementOfLocator('section#planted')).toBeNull();
    expect(elementOfLocator('section#s > svg#pic > defs:nth-child(1) > lineargradient#g')).toBe('pic');
  });

  // M6 fix wave 1 (finding 3): an inline colour mark is on the slide too
  it('checks an inline colour mark, in a paragraph and in a table cell, selecting its owner, its words counted once', () => {
    const marked = `<section id="m" style="background:var(--ds-color-bg); padding:128px"><p id="say" style="font-size:var(--ds-type-body-size); color:var(--ds-color-text)">Calm words and <span style="color:#ff0044">loud ones</span> here</p><table id="t" style="font-size:24px"><tr id="r1"><th>Mass</th></tr><tr id="r2"><td>one <span style="color:#00ff00">green</span></td></tr></table></section>`;
    const report = checkHardDonts(parseLaw(law), tokens, unitsOfDeck(deckOf({ m: marked })));
    const literal = report.violations.filter((v) => v.rule === 'literal-color');
    expect(literal.map((v) => [v.element, elementOfLocator(v.element)])).toEqual([
      ['section#m > p#say > span:nth-of-type(1)', 'say'],
      ['section#m > table#t > tr#r2 > td:nth-child(1) > span:nth-of-type(1)', 't'],
    ]);
    expect(literal[0]!.message).toContain('#ff0044');
    // every word once: "Calm words and loud ones here" (6), "Mass" (1), "one green" (2)
    const words = (els: readonly { text: string; children: readonly unknown[] }[]): number =>
      els.reduce((n, e) => n + (e.text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) + words(e.children as never), 0);
    expect(words(unitsOfDeck(deckOf({ m: marked }))[0]!.elements)).toBe(9);
  });
});
