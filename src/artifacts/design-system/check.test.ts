import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { canonUnits, type HtmlParser } from './canon';
import { checkHardDonts, type CheckReport } from './check';
import complete from './fixtures/complete.tokens.json';
import { parseLaw } from './law';
import { parseTokens } from './tokens';

const parser = new new Window().DOMParser() as unknown as HtmlParser;
const tokens = parseTokens(complete).tokens!;

// A §8 with every tag of D5's vocabulary, an untagged don't, an unknown tag and a malformed one.
const LAW = parseLaw(`## 0. Stance
## 1. Palette
## 2. Type
## 3. Canvas
## 4. Layout
## 5. Canon
## 6. Voice
## 7. Motion
## 8. Hard don'ts

- No colour literal outside the tokens. [check: literal-color]
- No family outside font.*. [check: font-family]
- No gradient and no shadow outside shadow.*. [check: no-gradient] [check: no-shadow]
- At most one accent per slide or component. [check: accent-max:1]
- No radius above 16 px. [check: radius-max:16]
- No size off the type scale. [check: type-scale]
- At most 12 words a slide. [check: max-words:12]
- Text at 4.5:1 or better. [check: contrast:4.5]
- No stock photography.
- No sparkle. [check: sparkle]
- No more than some accents. [check: accent-max:few]
`);

// Clean canon in the system's terms: every value a var(--ds-*), one accent, a type role's size, a token shadow.
const CLEAN = {
  'layouts/title.html': `<section id="title" style="background:var(--ds-color-bg);padding:128px">
  <h1 data-ph="title" style="font-family:var(--ds-font-display);font-size:var(--ds-type-title-size);color:var(--ds-color-text)">Lab safety</h1>
  <p data-ph="subtitle" style="font-family:'Inter', sans-serif;font-size:48px;color:var(--ds-color-text-muted)">Before you pump</p>
  <aside data-ph="notes">Notes are not on the slide, so these words do not count toward the limit of twelve.</aside>
</section>`,
  'components/chip.html': `<div style="background:var(--ds-color-bg-raised);border:1px solid var(--ds-color-accent);border-radius:var(--ds-radius-md);box-shadow:var(--ds-shadow-sm)"><span style="color:var(--ds-color-text);font:400 var(--ds-type-caption-size)/1.4 var(--ds-font-body)">Due Friday</span></div>`,
  'components/card.html': `<div style="background:#ffffff;border:1px solid transparent;box-shadow:0 1px 2px #00000014;border-radius:0.5rem"><svg><rect fill="#c9663f"></rect></svg></div>`,
  'components/document.css': `.ds-doc blockquote { color: var(--ds-color-text-muted); background: var(--ds-color-bg-raised); font-size: var(--ds-type-quote-size) }
.ds-doc p { color: var(--ds-color-text) }`,
};

const DIRTY = {
  'components/loud.html': `<div style="background:linear-gradient(90deg, var(--ds-color-accent), var(--ds-color-bg));box-shadow:0 2px 4px #000;border-radius:24px;font-family:'Comic Sans MS', var(--ds-font-body)">
  <p style="color:#c00;font-size:15px">x</p><span style="background:var(--ds-color-accent)">a</span><b style="color:var(--ds-color-accent)">b</b>
  <svg><linearGradient id="g"></linearGradient></svg>
</div>`,
  'components/faint.html': `<div style="background:var(--ds-color-bg)"><p style="color:var(--ds-color-status-warn);font:1.2em Papyrus">Late</p></div>`,
  'layouts/wordy.html': `<section id="wordy" style="background:var(--ds-color-bg)"><p>One two three four five six seven</p><p>eight nine ten eleven twelve thirteen</p></section>`,
  'components/document.css': `.ds-doc mark { color: var(--ds-color-accent); background: var(--ds-color-bg); text-shadow: 0 1px 0 #fff }
.ds-doc a { color: var(--ds-color-accent); filter: drop-shadow(0 1px 1px var(--ds-color-border)) }
.ds-doc b { color: var(--ds-color-accent) }`,
};

const check = (files: Record<string, string>): CheckReport => checkHardDonts(LAW, tokens, canonUnits(files, parser));
const summary = (report: CheckReport) => report.violations.map((v) => `${v.rule} | ${v.unit} | ${v.element} | ${v.message}`);

describe('the hard-don’ts check (Acceptance 5)', () => {
  it('passes clean canon, every tagged rule run', () => {
    const report = check(CLEAN);
    expect(summary(report)).toEqual([]);
    expect(report.checks.map((c) => [c.dont, c.rule, c.violations])).toEqual([
      [0, 'literal-color', 0],
      [1, 'font-family', 0],
      [2, 'no-gradient', 0],
      [2, 'no-shadow', 0],
      [3, 'accent-max:1', 0],
      [4, 'radius-max:16', 0],
      [5, 'type-scale', 0],
      [6, 'max-words:12', 0],
      [7, 'contrast:4.5', 0],
    ]);
  });

  it('lists the untagged don’ts as manual, and reports unknown and malformed tags rather than ignoring them', () => {
    const report = check(CLEAN);
    expect(report.manual.map((d) => d.text)).toEqual(['No stock photography.', 'No sparkle.', 'No more than some accents.']);
    expect(report.unknown).toEqual([
      { dont: 9, tag: 'sparkle', message: 'MAWS does not know the check "sparkle"; judge this don’t by hand' },
      { dont: 10, tag: 'accent-max:few', message: '"accent-max" takes a whole number, as accent-max:1' },
    ]);
  });

  it('flags a literal colour, a foreign family, a gradient, a stray shadow, the accent over its limit and the rest, by unit and element', () => {
    expect(summary(check(DIRTY))).toEqual([
      'literal-color | components/loud.html | div | box-shadow: the colour literal #000 is not a token value; use a var(--ds-color-*)',
      'literal-color | components/loud.html | div > p:nth-child(1) | color: the colour literal #c00 is not a token value; use a var(--ds-color-*)',
      'font-family | components/faint.html | div > p:nth-child(1) | font: "Papyrus" is not one of the system’s families (font.*)',
      'font-family | components/loud.html | div | font-family: "Comic Sans MS" is not one of the system’s families (font.*)',
      'no-gradient | components/loud.html | div | background: a gradient',
      'no-gradient | components/loud.html | div > svg:nth-child(4) > lineargradient#g | <lineargradient> draws a gradient',
      'no-shadow | components/document.css | .ds-doc mark | text-shadow: 0 1px 0 #fff is not a shadow token (shadow.*)',
      'no-shadow | components/document.css | .ds-doc a | filter: a drop-shadow() is not a shadow token (shadow.*)',
      'no-shadow | components/loud.html | div | box-shadow: 0 2px 4px #000 is not a shadow token (shadow.*)',
      'accent-max:1 | components/loud.html | div > span:nth-child(2) | 3 elements are painted with the accent; at most 1 per component: div, div > span:nth-child(2), div > b:nth-child(3)',
      'radius-max:16 | components/loud.html | div | border-radius: 24px is above 16px',
      'type-scale | components/faint.html | div > p:nth-child(1) | font: 1.2em is not a type role’s size (13, 16, 18, 20, 22, 24, 32, 40, 48, 96 px)',
      'type-scale | components/loud.html | div > p:nth-child(1) | font-size: 15px is not a type role’s size (13, 16, 18, 20, 22, 24, 32, 40, 48, 96 px)',
      'max-words:12 | layouts/wordy.html | section#wordy | 13 words; at most 12 per slide',
      'contrast:4.5 | components/document.css | .ds-doc mark | text #c9663f on #faf9f6 is 3.66:1, below 4.5:1',
      'contrast:4.5 | components/faint.html | div > p:nth-child(1) | text #b86a1a on #faf9f6 is 3.9:1, below 4.5:1',
    ]);
  });

  it('checks a stream from elsewhere (a document) without the per-slide counts', () => {
    const report = checkHardDonts(LAW, tokens, [
      {
        name: 'Field trip letter',
        kind: 'document',
        elements: [
          { tag: 'p', attrs: {}, style: [{ property: 'color', value: 'var(--ds-color-accent)' }], text: 'one two three four five six seven eight nine ten eleven twelve thirteen', children: [], at: 'p#a1' },
          { tag: 'p', attrs: {}, style: [{ property: 'background', value: 'var(--ds-color-accent)' }], text: '', children: [], at: 'p#a2' },
        ],
      },
    ]);
    expect(summary(report)).toEqual(['contrast:4.5 | Field trip letter | p#a1 | text #c9663f on #faf9f6 is 3.66:1, below 4.5:1']);
  });
});
