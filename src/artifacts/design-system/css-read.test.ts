import { describe, expect, it } from 'vitest';
import { colorToCss } from './color';
import { colorLiterals, parseBoxShadow, parseCssColor, parseDeclarations, parseFontStack, parseLength, parseStylesheet, splitTopLevel, urlsIn, varNamesIn } from './css-read';

const css = (text: string) => {
  const color = parseCssColor(text);
  return color ? colorToCss(color) : null;
};

describe('reading CSS text: values', () => {
  it('parses colour literals into DTCG colour values', () => {
    expect(css('#C00')).toBe('#cc0000');
    expect(css('#11223344')).toBe('#11223344');
    expect(css('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(css('rgba(0,0,0,.5)')).toBe('#00000080');
    expect(css('rgb(100% 0% 0% / 25%)')).toBe('#ff000040');
    expect(css('hsl(120deg 100% 25%)')).toBe('hsl(120 100% 25%)');
    expect(css('hsla(0.5turn, 50%, 50%, 0.5)')).toBe('hsl(180 50% 50% / 0.5)');
    expect(css('oklch(70% 0.1 250)')).toBe('oklch(0.7 0.1 250)');
    expect(css('lab(50% 40 59.5)')).toBe('lab(50 40 59.5)');
    expect(css('color(display-p3 1 0.5 0)')).toBe('color(display-p3 1 0.5 0)');
    expect(css('RebeccaPurple')).toBe('#663399');
    expect(css('transparent')).toBe('#00000000');
    for (const bad of ['#12', 'rgb(1,2)', 'var(--x)', 'color-mix(in srgb, red, blue)', 'solid', 'oklch(70% 0.1)', 'color(cmyk 1 0 0)']) expect(css(bad)).toBeNull();
  });

  it('finds the colour literals inside a value, but not inside var(), url() or strings', () => {
    expect(colorLiterals('1px solid #ccc')).toEqual(['#ccc']);
    expect(colorLiterals('0 1px 2px rgba(0, 0, 0, 0.2), inset 0 0 0 1px red')).toEqual(['rgba(0, 0, 0, 0.2)', 'red']);
    expect(colorLiterals('var(--ds-color-accent, #f00) url(#abc) "#fff"')).toEqual([]);
    expect(colorLiterals('transparent currentColor inherit none')).toEqual([]);
  });

  it('parses lengths, font stacks and box shadows', () => {
    expect(parseLength('12px')).toEqual({ value: 12, unit: 'px' });
    expect(parseLength('-.5rem')).toEqual({ value: -0.5, unit: 'rem' });
    expect(parseLength('0')).toEqual({ value: 0, unit: '' });
    expect(parseLength('50%')).toEqual({ value: 50, unit: '%' });
    expect(parseLength('calc(1px + 2px)')).toBeNull();
    expect(parseFontStack('"Acme Sans", system-ui, \'Noto Serif KR\', var(--ds-font-body)')).toEqual(['Acme Sans', 'system-ui', 'Noto Serif KR', 'var(--ds-font-body)']);
    expect(parseFontStack('Iowan Old Style, serif')).toEqual(['Iowan Old Style', 'serif']);
    expect(parseBoxShadow('0 1px 2px rgba(0,0,0,.08), inset 0 0 0 1px #000')).toEqual([
      { color: parseCssColor('rgba(0,0,0,.08)'), offsetX: { value: 0, unit: 'px' }, offsetY: { value: 1, unit: 'px' }, blur: { value: 2, unit: 'px' }, spread: { value: 0, unit: 'px' } },
      { color: parseCssColor('#000'), offsetX: { value: 0, unit: 'px' }, offsetY: { value: 0, unit: 'px' }, blur: { value: 0, unit: 'px' }, spread: { value: 1, unit: 'px' }, inset: true },
    ]);
    expect(parseBoxShadow('0 4px')).toEqual([{ color: parseCssColor('#000'), offsetX: { value: 0, unit: 'px' }, offsetY: { value: 4, unit: 'px' }, blur: { value: 0, unit: 'px' }, spread: { value: 0, unit: 'px' } }]);
    expect(parseBoxShadow('none')).toEqual([]);
    expect(parseBoxShadow('0 1em 2px black')).toBeNull();
  });

  it('splits at the top level only, and finds var() names and url() targets', () => {
    expect(splitTopLevel('a, f(b, c), "d, e"', ',')).toEqual(['a', 'f(b, c)', '"d, e"']);
    expect(varNamesIn('var(--ds-a) calc(var(--x, var(--ds-b)) * 2)')).toEqual(['--ds-a', '--x', '--ds-b']);
    expect(urlsIn('url(assets/a.png), url("assets/b c.svg") url( \'https://x\' )')).toEqual(['assets/a.png', 'assets/b c.svg', 'https://x']);
  });
});

describe('reading CSS text: declarations and stylesheets', () => {
  it('parses a declaration list, keeping a ; inside url() or a string', () => {
    expect(parseDeclarations('Color: Red ; background:url("a;b.png") !important; /* c: d */ --Custom: 1;;broken')).toEqual([
      { property: 'color', value: 'Red' },
      { property: 'background', value: 'url("a;b.png")' },
      { property: '--Custom', value: '1' },
    ]);
  });

  it('parses rules, nested at-rules and statements, and names what it cannot read', () => {
    const sheet = parseStylesheet(`/* head */
.ds-doc p { color: var(--ds-color-text); }
@media print { .ds-doc h1 { font-size: 20px } }
@import url(x.css);
@font-face { font-family: X; src: url(assets/x.woff2) }
.ds-doc { & p { color: red } }
.ds-doc q { color: red`);
    expect(sheet.nodes).toEqual([
      { kind: 'rule', selector: '.ds-doc p', declarations: [{ property: 'color', value: 'var(--ds-color-text)' }], within: [] },
      { kind: 'rule', selector: '.ds-doc h1', declarations: [{ property: 'font-size', value: '20px' }], within: ['@media print'] },
      { kind: 'at', name: 'import', prelude: 'url(x.css)', declarations: null, within: [] },
      { kind: 'at', name: 'font-face', prelude: '', declarations: [{ property: 'font-family', value: 'X' }, { property: 'src', value: 'url(assets/x.woff2)' }], within: [] },
      { kind: 'rule', selector: '.ds-doc', declarations: [], within: [] },
    ]);
    expect(sheet.problems).toEqual(['the rule ".ds-doc" nests a rule; nested rules are not read', 'a block is not closed: ".ds-doc q"']);
  });
});
