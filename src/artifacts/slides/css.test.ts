// P3-C M1 (D1): the inline-style half of the dialect: Claude's lines with their ranges, the applies-to column, the
// owner's var(--ds-*) superset and S6's canonical form.
import { describe, expect, it } from 'vitest';
import { appliesTo, checkValue, normValue, parseStyle, resolveVars, SHARED_DS_NAMES, type StyleDiagnostic, type StyleSite } from './css';
import type { Style } from './ir';

const DIV: StyleSite = { tag: 'div', attrs: {}, parent: { tag: 'section', style: {} } };
const P: StyleSite = { tag: 'p', attrs: {}, parent: { tag: 'section', style: {} } };
function style(css: string, site: StyleSite = DIV): { style: Style; diags: StyleDiagnostic[] } {
  const diags: StyleDiagnostic[] = [];
  return { style: parseStyle(css, site, (d) => diags.push(d)), diags };
}

describe('values: each property’s line, with its ranges', () => {
  const cases: [prop: string, value: string, canonical: string | null][] = [
    // lengths: px, bare (px), pt (×2); no em, rem, vw
    ['font-size', '24', '24px'],
    ['font-size', '24pt', '48px'],
    ['font-size', '8px', '8px'],
    ['font-size', '7px', null],
    ['font-size', '401px', null],
    ['font-size', '2em', null],
    ['width', '50%', '50%'],
    ['width', '10vw', null],
    ['width', '-1px', null],
    ['left', 'calc(50% - 120px)', 'calc(50% - 120px)'],
    ['right', 'calc(50% - 120px)', null],
    ['gap', '512px', '512px'],
    ['gap', '513px', null],
    ['gap', '8px 8px', null],
    ['padding', '0 256px', '0px 256px'],
    ['padding', '257px', null],
    ['padding', '1px 2px 3px 4px 5px', null],
    ['letter-spacing', '-24px', '-24px'],
    ['letter-spacing', '33px', null],
    ['letter-spacing', '-0.02em', '-0.02em'],
    ['line-height', '1.1', '1.1'],
    ['line-height', '0.4', null],
    ['line-height', '150%', '150%'],
    ['line-height', '34px', '34px'],
    ['opacity', '.5', '0.5'],
    ['opacity', '1.5', null],
    ['font-weight', 'bold', '700'],
    ['font-weight', '650', null],
    // colours
    ['color', 'RGB(255, 0, 0)', '#ff0000'],
    ['color', 'rgb(255 0 0 / 50%)', 'rgba(255, 0, 0, 0.5)'],
    ['color', 'Tomato', 'tomato'],
    ['color', 'currentColor', null],
    ['color', 'bogus', null],
    // flex and grid
    ['flex', '1', '1'],
    ['flex', '1 1 0%', '1 1 0%'],
    ['flex', '0 0 240px', '0 0 240px'],
    ['flex', '1 1 50%', null],
    ['grid-template-columns', 'repeat(3, 1fr)', 'repeat(3, 1fr)'],
    ['grid-template-columns', '240px 1fr auto', '240px 1fr auto'],
    ['grid-template-columns', 'repeat(24, 1fr)', 'repeat(24, 1fr)'],
    ['grid-template-columns', 'repeat(25, 1fr)', null],
    ['grid-template-columns', 'repeat(12, 1fr 1fr) 1fr', null],
    ['grid-template-columns', 'minmax(0, 1fr)', null],
    ['grid-column', 'span 2', 'span 2'],
    ['grid-column', '1 / 3', null],
    ['aspect-ratio', '16 / 9', '16 / 9'],
    // gradients: 2 to 8 stops, angle or side, radial shape and centre, repeating in px
    ['background', 'linear-gradient(135deg, #0f2a3d, #2b7a78)', 'linear-gradient(135deg, #0f2a3d, #2b7a78)'],
    ['background', 'linear-gradient(to top right, #000 0%, #fff 100%), #eee', 'linear-gradient(to top right, #000000 0%, #ffffff 100%), #eeeeee'],
    ['background', 'radial-gradient(circle at 30% 40%, #000, #fff)', 'radial-gradient(circle at 30% 40%, #000000, #ffffff)'],
    ['background', 'repeating-linear-gradient(45deg, #000 0px, #000 8px, #fff 8px, #fff 16px)', 'repeating-linear-gradient(45deg, #000000 0px, #000000 8px, #ffffff 8px, #ffffff 16px)'],
    ['background', 'linear-gradient(90deg, #000)', null],
    ['background', `linear-gradient(90deg, ${Array(9).fill('#000').join(', ')})`, null],
    ['background', 'linear-gradient(to middle, #000, #fff)', null],
    ['background', 'url(assets/paper.png) center / cover', 'url(assets/paper.png) center / cover'],
    ['background', 'url(https://example.com/a.png)', null],
    ['background', '#fff, #000', null],
    // borders and shadows
    ['border', 'SOLID 2px', '2px solid black'],
    ['border', '1px #ccc', null],
    ['border', '33px solid #000', null],
    ['border-top', 'none', 'none'],
    ['box-shadow', '0 4 24 rgba(0,0,0,.06)', '0px 4px 24px rgba(0, 0, 0, 0.06)'],
    ['box-shadow', 'inset 0 1px 0 0 #fff, 0 8px 16px #0003', 'inset 0px 1px 0px 0px #ffffff, 0px 8px 16px #00000033'],
    ['box-shadow', '0 65px 0 #000', null],
    ['box-shadow', '0 0 161px #000', null],
    ['text-shadow', '0 2px 64px #000', '0px 2px 64px #000000'],
    ['text-shadow', '0 2px 65px #000', null],
    ['-webkit-text-stroke', '2px #000', '2px #000000'],
    ['-webkit-text-stroke', '9px #000', null],
    // transforms: translate, rotate, scale, skew, in that order, each once
    ['transform', 'translate(10, -50%) rotate(5deg) scale(1.0)', 'translate(10px, -50%) rotate(5deg) scale(1)'],
    ['transform', 'translateX(-50%)', 'translatex(-50%)'],
    ['transform', 'rotate(0.25turn) skewX(60deg)', 'rotate(0.25turn) skewx(60deg)'],
    ['transform', 'scale(2.5)', null],
    ['transform', 'skew(61deg)', null],
    ['transform', 'rotate(5deg) translate(10px)', null],
    ['transform', 'rotate(5deg) rotate(5deg)', null],
    ['transform', 'translate(-25%)', null],
    ['transform', 'matrix(1, 0, 0, 1, 0, 0)', null],
    // filters
    ['filter', 'blur(4px) grayscale(1)', 'blur(4px) grayscale(1)'],
    ['filter', 'blur(21px)', null],
    ['filter', 'saturate(3) brightness(2) hue-rotate(90deg)', 'saturate(3) brightness(2) hue-rotate(90deg)'],
    ['filter', 'contrast(2.5)', null],
    ['filter', 'drop-shadow(0 0 4px #000)', null],
  ];
  it.each(cases)('%s: %s → %s', (prop, value, canonical) => expect(normValue(prop, value)).toBe(canonical));

  it('writes a length in a compound value with px, and keeps factors, counts and fr as they are (fix wave 1)', () => {
    const fixed: [string, string, string][] = [
      ['flex', '0 0 240', '0 0 240px'],
      ['flex', '1 240', '1 240'], // grow and shrink, as CSS reads two numbers
      ['flex', '2 240px', '2 240px'],
      ['flex', '1 1 0', '1 1 0px'],
      ['grid-template-columns', '240 1fr', '240px 1fr'],
      ['grid-template-columns', 'repeat(3, 240) auto', 'repeat(3, 240px) auto'],
      ['grid-template-rows', 'repeat(2, 1fr 96)', 'repeat(2, 1fr 96px)'],
      ['background', 'repeating-linear-gradient(45deg, #000 0, #000 8, #fff 8, #fff 16)', 'repeating-linear-gradient(45deg, #000000 0px, #000000 8px, #ffffff 8px, #ffffff 16px)'],
      ['background', 'repeating-linear-gradient(#000 0, #fff 8)', 'repeating-linear-gradient(#000000 0px, #ffffff 8px)'],
    ];
    for (const [prop, value, canonical] of fixed) {
      expect(normValue(prop, value), `${prop}:${value}`).toBe(canonical);
      expect(normValue(prop, canonical), `${prop}:${canonical}`).toBe(canonical);
    }
  });
});

describe('var(--ds-*): a token in any value position, its fallback held to the property’s grammar', () => {
  it('keeps a token alone or inside a value, with or without a fallback', () => {
    expect(normValue('color', 'var(--ds-color-accent)')).toBe('var(--ds-color-accent)');
    expect(normValue('color', 'var(--ds-color-accent, #C00)')).toBe('var(--ds-color-accent, #cc0000)');
    expect(normValue('padding', 'var(--ds-space-4) 8')).toBe('var(--ds-space-4) 8px');
    expect(normValue('border', '2px solid var(--ds-color-border)')).toBe('2px solid var(--ds-color-border)');
    expect(normValue('border', 'solid var(--ds-color-border)')).toBe('1px solid var(--ds-color-border)');
    expect(normValue('font-weight', 'var(--ds-type-h1-weight)')).toBe('var(--ds-type-h1-weight)');
    expect(normValue('display', 'var(--ds-layout)')).toBe('var(--ds-layout)');
    expect(normValue('background', 'linear-gradient(90deg, var(--ds-color-accent), #fff)')).toBe('linear-gradient(90deg, var(--ds-color-accent), #ffffff)');
    expect(normValue('transform', 'rotate(var(--ds-tilt, 5deg))')).toBe('rotate(var(--ds-tilt, 5deg))');
  });

  it('drops a token whose fallback the property does not take, and any other var()', () => {
    expect(checkValue('color', 'var(--ds-color-accent, 12px)')).toEqual({ ok: false, reason: 'color:var(--ds-color-accent, 12px) is outside its grammar (color: COLOR)' });
    expect(normValue('font-size', 'var(--ds-type-h1-size, 500px)')).toBeNull();
    expect(checkValue('color', 'var(--brand)').ok).toBe(false);
    expect(checkValue('color', 'var(--ds-Bad)').ok).toBe(false);
  });

  it('places a border token by its fallback, else by its position, and reaches a fixed point (fix wave 1)', () => {
    const fixed = (value: string, canonical: string) => {
      expect(normValue('border', value), value).toBe(canonical);
      expect(normValue('border', canonical), canonical).toBe(canonical);
    };
    fixed('solid var(--ds-ink, red)', '1px solid var(--ds-ink, red)');
    fixed('var(--ds-ink, red) solid', '1px solid var(--ds-ink, red)');
    fixed('var(--ds-hairline, 3) solid', 'var(--ds-hairline, 3px) solid black');
    fixed('var(--ds-hairline) solid var(--ds-ink)', 'var(--ds-hairline) solid var(--ds-ink)');
    fixed('solid var(--ds-color-border)', '1px solid var(--ds-color-border)');
    fixed('2px var(--ds-line-style) red', '2px var(--ds-line-style) red');
    fixed('var(--ds-border)', 'var(--ds-border)');
    fixed('solid var(--ds-ink, 12px) red', 'var(--ds-ink, 12px) solid red');
    expect(normValue('border', 'solid var(--ds-a, red) var(--ds-b, blue)')).toBeNull();
  });

  it('notes a name outside the shared list that has no fallback', () => {
    expect(SHARED_DS_NAMES.has('--ds-type-caption-size')).toBe(true);
    expect(SHARED_DS_NAMES.size).toBe(7 + 4 + 3 + 8 * 3 + 8 + 4 + 3);
    const { style: s, diags } = style('color:var(--ds-color-highlight); background:var(--ds-color-wash, #eee); font-family:var(--ds-font-body)', P);
    expect(s).toEqual({ color: 'var(--ds-color-highlight)', background: 'var(--ds-color-wash, #eeeeee)', 'font-family': 'var(--ds-font-body)' });
    expect(diags).toEqual([{ severity: 'note', property: 'color', message: '--ds-color-highlight is not one every design system defines; give a fallback: var(--ds-color-highlight, <value>)' }]);
  });

  it('resolves tokens to literals for the mirror and the Claude export: the value, else the fallback, else nothing', () => {
    const tokens: Record<string, string> = { '--ds-color-bg': '#fbfbf8', '--ds-space-4': '32px' };
    const resolve = (name: string) => tokens[name];
    expect(resolveVars('var(--ds-space-4) 8px', resolve)).toBe('32px 8px');
    expect(resolveVars('var(--ds-color-x, rgba(0, 0, 0, 0.5))', resolve)).toBe('rgba(0, 0, 0, 0.5)');
    expect(resolveVars('var(--ds-color-x, var(--ds-color-bg))', resolve)).toBe('#fbfbf8');
    expect(resolveVars('2px solid var(--ds-color-x)', resolve)).toBeNull();
  });
});

describe('the applies-to column', () => {
  const site = (tag: StyleSite['tag'], parentStyle: Style = {}, attrs: StyleSite['attrs'] = {}, parentTag: StyleSite['tag'] = 'div'): StyleSite => ({ tag, attrs, parent: { tag: parentTag, style: parentStyle } });

  it('takes text lines on text elements and, inherited, on the section and a div', () => {
    for (const tag of ['h1', 'p', 'ul', 'section', 'div'] as const) expect(appliesTo('letter-spacing', site(tag), {}), tag).toBe(true);
    for (const tag of ['img', 'td', 'x-icon', 'svg'] as const) expect(appliesTo('letter-spacing', site(tag), {}), tag).toBe(false);
    expect(appliesTo('color', site('table'), {})).toBe(true);
    expect(appliesTo('font-weight', site('th'), {})).toBe(true);
    expect(appliesTo('font-weight', site('td'), {})).toBe(false);
  });

  it('takes offsets on pinned elements only, and flex child lines on flow children only', () => {
    expect(style('left:10px; top:0', P).style).toEqual({});
    expect(style('position:absolute; left:10px; top:0', P).style).toEqual({ position: 'absolute', left: '10px', top: '0px' });
    expect(style('position:relative; left:10px', DIV).style).toEqual({ position: 'relative' });
    expect(style('flex:1; align-self:center', DIV).style).toEqual({ flex: '1', 'align-self': 'center' });
    expect(style('position:absolute; flex:1', DIV).style).toEqual({ position: 'absolute' });
    expect(style('grid-column:span 2', site('div', { display: 'grid' })).style).toEqual({ 'grid-column': 'span 2' });
    expect(style('grid-column:span 2', site('div', { display: 'flex' })).style).toEqual({});
  });

  it('takes a box’s layout lines by its own display', () => {
    expect(style('display:grid; justify-content:center; grid-template-columns:1fr 1fr; justify-items:center', DIV).style).toEqual({ display: 'grid', 'grid-template-columns': '1fr 1fr', 'justify-items': 'center' });
    expect(style('display:flex; flex-direction:column; flex-wrap:wrap', DIV).style).toEqual({ display: 'flex', 'flex-direction': 'column' });
    expect(style('display:flex; flex-wrap:wrap', DIV).style).toEqual({ display: 'flex', 'flex-wrap': 'wrap' });
    expect(style('display:flex', P).style).toEqual({});
  });

  it('holds each element to the limits its line states beside the column', () => {
    expect(style('background:linear-gradient(#000, #fff)', site('tr', {}, {}, 'table')).style).toEqual({});
    expect(style('background:#eee', site('tr', {}, {}, 'table')).style).toEqual({ background: '#eeeeee' });
    expect(style('border:20px solid #000', DIV).style).toEqual({});
    expect(style('border:20px solid #000', site('x-shape')).style).toEqual({ border: '20px solid #000000' });
    expect(style('padding:65px', site('td', {}, {}, 'tr')).style).toEqual({});
    expect(style('padding:64px', site('td', {}, {}, 'tr')).style).toEqual({ padding: '64px' });
    expect(style('transform:rotate(10deg) scale(2)', site('x-shape')).style).toEqual({});
    expect(style('transform:rotate(10deg)', site('x-shape')).style).toEqual({ transform: 'rotate(10deg)' });
    expect(style('transform:rotate(10deg)', site('x-connector')).style).toEqual({});
    expect(style('border-radius:8px', site('x-shape', {}, { kind: 'rect' })).style).toEqual({ 'border-radius': '8px' });
    expect(style('border-radius:8px', site('x-shape', {}, { kind: 'ellipse' })).style).toEqual({});
    const connector = site('x-connector', {}, { x1: '0', y1: '0', x2: '10', y2: '10' });
    expect(style('color:#2b7a78; border-width:3px; border-style:dashed; left:0; width:10px', connector).style).toEqual({ color: '#2b7a78', 'border-width': '3px', 'border-style': 'dashed' });
    expect(style('width:96px', site('x-connector')).style).toEqual({ width: '96px' });
  });

  it('holds a token to those limits through its fallback; a token with none may be anything (fix wave 1)', () => {
    const td = site('td', {}, {}, 'tr');
    expect(style('padding:var(--ds-pad, 65px)', td).style).toEqual({});
    expect(style('padding:var(--ds-pad, 64px) 8px', td).style).toEqual({ padding: 'var(--ds-pad, 64px) 8px' });
    expect(style('padding:var(--ds-pad)', td).style).toEqual({ padding: 'var(--ds-pad)' });
    expect(style('border:var(--ds-w, 20px) solid red', DIV).style).toEqual({});
    expect(style('border:var(--ds-w) solid red', DIV).style).toEqual({ border: 'var(--ds-w) solid red' });
    expect(style('border:var(--ds-w, 20px) solid red', site('x-shape')).style).toEqual({ border: 'var(--ds-w, 20px) solid red' });
    expect(style('transform:var(--ds-tilt, scale(2))', site('x-shape')).style).toEqual({});
    expect(style('transform:var(--ds-tilt, rotate(4deg))', site('x-shape')).style).toEqual({ transform: 'var(--ds-tilt, rotate(4deg))' });
    expect(style('background:var(--ds-wash, linear-gradient(#000, #fff))', site('tr', {}, {}, 'table')).style).toEqual({});
  });

  it('reads a section or div without display as a flex column (fix wave 1)', () => {
    expect(style('justify-content:center; flex-direction:row-reverse; flex-wrap:wrap', DIV).style).toEqual({ 'justify-content': 'center', 'flex-direction': 'row-reverse', 'flex-wrap': 'wrap' });
    expect(style('justify-content:center; flex-wrap:wrap', DIV).style).toEqual({ 'justify-content': 'center' }); // a column: no wrap
    expect(style('justify-content:center', { tag: 'section', attrs: {}, parent: null }).style).toEqual({ 'justify-content': 'center' });
    expect(style('display:none; justify-content:center', DIV).style).toEqual({ display: 'none' });
  });

  it('takes the inheritable typography rows only on the section and a div (fix wave 1)', () => {
    const section: StyleSite = { tag: 'section', attrs: {}, parent: null };
    expect(style('color:#111; font-family:Georgia; letter-spacing:1px; text-shadow:0 1px 2px #000; border:1px solid red; filter:blur(2px); box-shadow:0 1px 2px #000; text-decoration:underline; background-clip:text', section).style).toEqual({
      color: '#111111',
      'font-family': 'Georgia',
      'letter-spacing': '1px',
      'text-shadow': '0px 1px 2px #000000',
    });
    expect(style('text-decoration:underline; background-clip:text; border:1px solid red', DIV).style).toEqual({ border: '1px solid red' });
  });

  it('warns naming the property and the elements it applies to', () => {
    expect(style('gap:8px', P).diags).toEqual([{ severity: 'warning', property: 'gap', message: 'gap does not apply to <p> (it applies to: section div); dropped' }]);
  });
});

describe('S6’s canonical form', () => {
  it('applies the cascade inside the attribute and folds the longhands Claude lacks', () => {
    expect(style('padding-top:10px; PADDING:128px; background-color:#FFF; margin:0; box-sizing:border-box; position:static', DIV).style).toEqual({ padding: '128px', background: '#ffffff' });
    expect(style('padding:8px; padding-left:16px; border-top-left-radius:8px', DIV).style).toEqual({ padding: '8px 8px 8px 16px', 'border-radius': '8px 0px 0px' });
    expect(style('border-top:none; border:2px solid red', DIV).style).toEqual({ border: '2px solid red' });
    expect(style("font: italic bold 96px/1.1 'Inter', Arial, sans-serif", P).style).toEqual({ 'font-style': 'italic', 'font-weight': '700', 'font-size': '96px', 'line-height': '1.1', 'font-family': 'Inter, Arial, sans-serif' });
    expect(style('margin:8px', DIV).diags[0]).toEqual({ severity: 'warning', property: 'margin', message: 'margin:8px dropped (only accepted as a no-op: margin:0, box-sizing:border-box, grid-template:none)' });
  });

  it('drops line-height outside 0.5–4× its own font-size', () => {
    expect(style('font-size:24px; line-height:34px', P).style).toEqual({ 'font-size': '24px', 'line-height': '34px' });
    expect(style('font-size:24px; line-height:120px', P).style).toEqual({ 'font-size': '24px' });
  });
});
