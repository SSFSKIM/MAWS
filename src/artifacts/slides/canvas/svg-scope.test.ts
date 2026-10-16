// P3-C final fix wave B, finding B1: an svg drawing's stylesheet and references contained in its scope (svg-scope.ts).
// Chromium's own reading of the output is the e2e's (presentations.spec.ts); here, the text the containment writes.
import { describe, expect, it } from 'vitest';
import { cssIdent, scopeSvgAttribute, scopeSvgDeclarations, scopeSvgStyleSheet, svgKeyframesNames, type SvgNames } from './svg-scope';

const W = ':where([data-svg-scope="s1"],[data-svg-scope="s1"] *)';
const names = (ids: string[] = [], keyframes: string[] = []): SvgNames => ({
  scope: 's1',
  ids: new Map(ids.map((id) => [id, `s1_${id}`])),
  keyframes: new Map(keyframes.map((k) => [k, `s1_${k}`])),
});
const sheet = (css: string, n = names()) => scopeSvgStyleSheet(css, n);

describe('a drawing’s stylesheet, contained', () => {
  it('constrains every compound of every selector to the drawing, keeping the declarations', () => {
    expect(sheet('body{display:none!important}')).toBe(`body${W}{display:none!important;}`);
    expect(sheet('svg > g.bar rect, .a+.b{fill:red}')).toBe(`svg${W} > g.bar${W} rect${W}, .a${W} + .b${W}{fill:red;}`);
    expect(sheet('* {stroke:none}')).toBe(`*${W}{stroke:none;}`);
  });

  it('puts the constraint before a pseudo-element, never inside a functional pseudo-class', () => {
    expect(sheet('text::selection{fill:red}')).toBe(`text${W}::selection{fill:red;}`);
    expect(sheet('a:before{x:y}')).toBe(`a${W}:before{x:y;}`);
    expect(sheet('rect:not(:before){fill:red}')).toBe(`rect:not(:before)${W}{fill:red;}`);
    expect(sheet('g:is(.a, .b) rect{fill:red}')).toBe(`g:is(.a, .b)${W} rect${W}{fill:red;}`);
  });

  it('renames the drawing’s ids in selectors and references, and nothing else', () => {
    const n = names(['g', 'bars']);
    expect(sheet('#bars rect, #other{fill:url(#g); stroke:url("#g"); color:#bad}', n)).toBe(`#s1_bars${W} rect${W}, #other${W}{fill:url("#s1_g");stroke:url("#s1_g");color:#bad;}`);
    expect(sheet('rect{fill:url(#missing)}', n)).toBe(`rect${W}{fill:url("#missing");}`);
  });

  it('keeps @media and @supports with their rules contained; renames @keyframes and the animations naming them', () => {
    expect(sheet('@media (min-width: 1px){rect{fill:red}}')).toBe(`@media (min-width: 1px){rect${W}{fill:red;}}`);
    expect(sheet('@supports (display:grid){@media print{g{x:y}}}')).toBe(`@supports (display:grid){@media print{g${W}{x:y;}}}`);
    const n = names([], ['spin']);
    expect(svgKeyframesNames('@keyframes spin{from{opacity:0}} @media x{@keyframes "two"{}}')).toEqual(['spin', 'two']);
    expect(sheet('@keyframes spin{from{opacity:0}to{opacity:1}} g{animation:spin 1s steps(2, spin) infinite; animation-name:spin}', n)).toBe(
      `@keyframes s1_spin{from{opacity:0;}to{opacity:1;}}\ng${W}{animation:s1_spin 1s steps(2, spin) infinite;animation-name:s1_spin;}`,
    );
    expect(sheet('@keyframes other{from{opacity:0}}', n)).toBe(''); // not this drawing's: never the page's
  });

  it('a quoted keyframes name: the animations naming it point at the renamed definition (B1 re-review 3)', () => {
    const n = names([], ['pulse']);
    const out = sheet('@keyframes "pulse"{to{opacity:.5}} g{animation-name:"pulse"} rect{animation:"pulse" 2s infinite}', n);
    const defined = /@keyframes ([^{]+)\{/.exec(out)![1]!;
    expect(defined).toBe('s1_pulse');
    expect(out).toContain(`g${W}{animation-name:"s1_pulse";}`);
    expect(out).toContain(`rect${W}{animation:"s1_pulse" 2s infinite;}`);
    expect(scopeSvgDeclarations('animation: "pulse" 1s', n)).toBe('animation: "s1_pulse" 1s');
    // a string elsewhere, or another name, stays as written
    expect(sheet('text{font-family:"pulse"; animation-name:"other"}', n)).toBe(`text${W}{font-family:"pulse";animation-name:"other";}`);
  });

  it('attribute selectors naming the drawing’s ids or local references follow the renamed values (B1 re-review 2)', () => {
    const n = names(['r', 'g']);
    expect(sheet('[id="r"]{fill:red}', n)).toBe(`[id="s1_r"]${W}{fill:red;}`);
    expect(sheet('rect[id=r]{fill:red}', n)).toBe(`rect[id="s1_r"]${W}{fill:red;}`);
    expect(sheet('[id^="r"], [id|=g]{x:y}', n)).toBe(`[id^="s1_r"]${W}, [id|="s1_g"]${W}{x:y;}`);
    expect(sheet('use[href="#r"], use[xlink|href="#r"], use[xlink\\:href="#r"]{x:y}', n)).toBe(`use[href="#s1_r"]${W}, use[xlink|href="#s1_r"]${W}, use[xlink\\:href="#s1_r"]${W}{x:y;}`);
    expect(sheet('g:not([id="r"]){x:y}', n)).toBe(`g:not([id="s1_r"])${W}{x:y;}`);
    // a suffix or a substring still matches the renamed value as written; other attributes are not ids
    expect(sheet('[id$="r"], [id*=r], [class="r"]{x:y}', n)).toBe(`[id$="r"]${W}, [id*=r]${W}, [class="r"]${W}{x:y;}`);
  });

  it('drops every at-rule that would be the page’s', () => {
    for (const css of ['@font-face{font-family:Inter; src:url(#f)}', '@import "x.css";', '@property --x{syntax:"*"; inherits:true}', '@layer base;', '@layer base{g{x:y}}', '@page{margin:0}', '@namespace svg url(http://www.w3.org/2000/svg);', '@scope (g){rect{x:y}}', '@counter-style c{system:cyclic}'])
      expect(sheet(css)).toBe('');
  });

  it('nested rules (CSS Nesting) keep their selectors contained', () => {
    expect(sheet('g{fill:red; & > rect{fill:blue} .a &{x:y} @media print{fill:green}}')).toBe(`g${W}{fill:red;&${W} > rect${W}{fill:blue;}.a${W} &${W}{x:y;}@media print{fill:green;}}`);
    expect(sheet('g{+ rect{x:y}}')).toBe(`g${W}{+ rect${W}{x:y;}}`);
  });

  it('a rule ends where CSS ends it: braces in strings, comments, url()s and other blocks never close one', () => {
    expect(sheet('rect{font-family:"a}b"; /* } body{display:none} */ fill:red}')).toBe(`rect${W}{font-family:"a}b";fill:red;}`);
    expect(sheet('rect{x:(}) ; fill:red} p{x:y}')).toBe(`rect${W}{x:(}) ;fill:red;}\np${W}{x:y;}`);
    expect(sheet('rect{x:[}]}p{y:z}')).toBe(`rect${W}{x:[}];}\np${W}{y:z;}`);
  });

  it('a malformed selector, a stray closer or an unterminated rule never leaves an uncontained rule', () => {
    expect(sheet('a{fill:red}} body{display:none}')).toBe(`a${W}{fill:red;}`);
    expect(sheet('a, {x:y}')).toBe('');
    expect(sheet('> body{x:y}')).toBe('');
    expect(sheet('a > > b{x:y}')).toBe('');
    expect(sheet('body{display:none')).toBe(`body${W}{display:none;}`);
    expect(sheet('body')).toBe('');
    // an escape the text ends in cannot take the closer written after it
    expect(sheet('body{display:none\\')).toBe(`body${W}{display:none�;}`);
  });
});

describe('a drawing’s attributes, contained', () => {
  const n = names(['g', 'r', 'a.b']);
  const el = { tag: 'rect' };
  it('renames ids, local hrefs, url()s in any attribute and in style', () => {
    expect(scopeSvgAttribute(el, 'id', 'g', n)).toBe('s1_g');
    expect(scopeSvgAttribute(el, 'href', '#r', n)).toBe('#s1_r');
    expect(scopeSvgAttribute(el, 'xlink:href', ' #r ', n)).toBe('#s1_r');
    expect(scopeSvgAttribute(el, 'href', '#elsewhere', n)).toBe('#elsewhere');
    expect(scopeSvgAttribute(el, 'fill', 'url(#g)', n)).toBe('url("#s1_g")');
    expect(scopeSvgAttribute(el, 'clip-path', "url('#g')", n)).toBe('url("#s1_g")');
    expect(scopeSvgAttribute(el, 'fill', 'red', n)).toBe('red');
    expect(scopeSvgAttribute(el, 'style', 'fill:url(#g); opacity:.5', n)).toBe('fill:url("#s1_g"); opacity:.5');
    expect(scopeSvgAttribute(el, 'aria-labelledby', 'g other', n)).toBe('s1_g other');
    expect(scopeSvgAttribute(el, 'data-svg-scope', 's9', n)).toBeNull();
  });

  it('renames SMIL timing on an id and an animated href’s values', () => {
    expect(scopeSvgAttribute({ tag: 'animate' }, 'begin', 'r.end+1s; 2s; click', n)).toBe('s1_r.end+1s; 2s; click');
    expect(scopeSvgAttribute({ tag: 'animate' }, 'end', 'g.repeat(2)', n)).toBe('s1_g.repeat(2)');
    expect(scopeSvgAttribute({ tag: 'set', attributeName: 'href' }, 'to', '#r', n)).toBe('#s1_r');
    expect(scopeSvgAttribute({ tag: 'animate', attributeName: 'xlink:href' }, 'values', '#g;#r', n)).toBe('#s1_g;#s1_r');
  });

  it('a declaration list keeps its declarations, renaming animations of this drawing', () => {
    expect(scopeSvgDeclarations('animation: spin 2s; fill: url(#g)', { ...n, keyframes: new Map([['spin', 's1_spin']]) })).toBe('animation: s1_spin 2s; fill: url("#s1_g")');
  });

  it('identifiers are written back as CSS reads them', () => {
    expect(cssIdent('s1_a.b')).toBe('s1_a\\.b');
    expect(cssIdent('1a')).toBe('\\31 a');
    expect(cssIdent('a b')).toBe('a\\ b');
  });
});
