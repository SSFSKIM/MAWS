import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { canonElements, canonUnits, stylesheetElements, validateCanon, type CanonElement, type HtmlParser } from './canon';
import complete from './fixtures/complete.tokens.json';
import { parseTokens } from './tokens';

const parser = new new Window().DOMParser() as unknown as HtmlParser;
const tokens = parseTokens(complete).tokens!;

const TITLE = `<section id="title" style="background:var(--ds-color-bg);padding:128px">
  <h1 data-ph="title" style="font-size:var(--ds-type-title-size);color:var(--ds-color-text)">Lab safety</h1>
  <p data-ph="subtitle">Before <b>you</b> pump</p>
  <img data-ph="image" src="assets/beaker.png" alt="">
  <aside data-ph="notes">Speak slowly.</aside>
</section>`;
const CHIP = `<div style="display:flex;gap:var(--ds-space-2);border-radius:var(--ds-radius-full);background:var(--ds-color-accent)"><span style="color:var(--ds-color-accent-text)">Due Friday</span></div>`;
const DOCUMENT_CSS = `.ds-doc blockquote { border-left: 2px solid var(--ds-color-accent); color: var(--ds-color-text-muted); }
.ds-doc [data-callout-tone="warn"], .ds-doc table > tr:first-child { background: var(--ds-color-bg-raised); }
@media print { .ds-doc h1 { font-size: var(--ds-type-h1-size) } }
.ds-doc mark { background: var(--ds-color-highlight); }`;
const CANON = { 'layouts/title.html': TITLE, 'components/chip.html': CHIP, 'components/document.css': DOCUMENT_CSS, 'DESIGN.md': '# x', 'tokens.tokens.json': '{}' };

const tags = (elements: readonly CanonElement[]): unknown[] => elements.map((e) => (e.children.length ? [e.tag, tags(e.children)] : e.tag));

describe('the canon: the HTML adapter to the element stream', () => {
  it('reads a canon file into elements with their attributes, parsed style, own text and a locator', () => {
    const [section, ...rest] = canonElements(TITLE, parser);
    expect(rest).toEqual([]);
    expect(tags([section!])).toEqual([['section', ['h1', ['p', ['b']], 'img', 'aside']]]);
    expect(section!.attrs).toEqual({ id: 'title' });
    expect(section!.style).toEqual([
      { property: 'background', value: 'var(--ds-color-bg)' },
      { property: 'padding', value: '128px' },
    ]);
    expect(section!.at).toBe('section#title');
    const [h1, p] = section!.children;
    expect(h1!.at).toBe('section#title > h1:nth-child(1)');
    expect(h1!.attrs).toEqual({ 'data-ph': 'title' });
    expect(h1!.text).toBe('Lab safety');
    expect(p!.text).toBe('Before pump');
    expect(p!.children[0]!.text).toBe('you');
  });

  it('reads a stylesheet into one element per rule, its selector as the locator', () => {
    const rules = stylesheetElements(DOCUMENT_CSS);
    expect(rules.map((r) => r.at)).toEqual([
      '.ds-doc blockquote',
      '.ds-doc [data-callout-tone="warn"], .ds-doc table > tr:first-child',
      '@media print .ds-doc h1',
      '.ds-doc mark',
    ]);
    expect(rules[0]!.style.map((d) => d.property)).toEqual(['border-left', 'color']);
  });

  it('gives the check one unit per canon file: layouts are slides, components components, document.css a stylesheet', () => {
    expect(canonUnits(CANON, parser).map((u) => [u.name, u.kind, u.elements.length])).toEqual([
      ['components/chip.html', 'component', 1],
      ['components/document.css', 'stylesheet', 4],
      ['layouts/title.html', 'slide', 1],
    ]);
  });
});

describe('the canon: structural validation (D6)', () => {
  it('passes clean canon, ignoring the files that are not canon', () => {
    expect(validateCanon(CANON, parser, tokens)).toEqual([]);
  });

  it('names a layout that is not one <section id>, and a component with two roots', () => {
    const problems = validateCanon(
      {
        'layouts/a.html': '<div id="a"></div>',
        'layouts/b.html': '<section></section>',
        'layouts/c.html': '<section id="c"></section><section id="d"></section> text',
        'components/e.html': '<span></span><span></span>',
        'components/f.html': '<style>p{}</style><p>x</p>',
        'components/g.html': '',
      },
      parser,
    );
    expect(problems).toEqual([
      { path: 'components/e.html', message: 'a canon file is one root element; this one has 2' },
      { path: 'components/f.html', message: '<style> sits outside the root element; canon styles inline, with var(--ds-*) values' },
      { path: 'components/g.html', message: 'a canon file is one root element; this one has none' },
      { path: 'layouts/a.html', message: 'a layout is one <section id>; its root is <div>' },
      { path: 'layouts/b.html', message: 'the layout’s <section> needs an id of 1 to 64 letters, digits, - or _' },
      { path: 'layouts/c.html', message: 'text sits outside the root element: "text"' },
      { path: 'layouts/c.html', message: 'a canon file is one root element; this one has 2' },
    ]);
  });

  it('refuses script, frames, URLs outside assets/, foreign var() names and custom properties', () => {
    const problems = validateCanon(
      {
        'components/bad.html': `<div onclick="x()" style="--ds-color-accent:red;color:var(--brand);background:url(https://x/y.png);border-color:var(--ds-color-highlight)">
  <script>alert(1)</script><iframe src="assets/a.html"></iframe>
  <a href="javascript:alert(1)">x</a><img src="../assets/x.png" srcset="assets/a.png 1x, https://cdn/b.png 2x"><svg><use href="#glyph"></use></svg>
  <p data-ph="Body Text">y</p>
</div>`,
      },
      parser,
    );
    expect(problems.map((p) => p.message)).toEqual([
      'div: the event handler onclick runs script; canon holds no script',
      'div: declares --ds-color-accent; canon reads tokens, it never sets them',
      'div: var(--brand) is not a design-system name (--ds-*)',
      'div: url(https://x/y.png) points outside assets/; canon reads only its own assets/ files',
      'div: var(--ds-color-highlight) is not one of X28’s names; a system’s extra tokens are for documents, not slides or components',
      'div > script:nth-child(1): <script> is not allowed in canon',
      'div > iframe:nth-child(2): <iframe> is not allowed in canon',
      'div > a:nth-child(3): href="javascript:alert(1)" points outside assets/; canon reads only its own assets/ files',
      'div > img:nth-child(4): src="../assets/x.png" points outside assets/; canon reads only its own assets/ files',
      'div > img:nth-child(4): srcset="https://cdn/b.png" points outside assets/; canon reads only its own assets/ files',
      'div > p:nth-child(6): data-ph="Body Text" is not a placeholder role (title, subtitle, body, image, caption, notes, or a lower-case name)',
    ]);
  });

  it('holds document.css to .ds-doc, element and attribute selectors, and the system’s own --ds-* names', () => {
    const problems = validateCanon(
      {
        'components/document.css': `body { color: var(--ds-color-text) }
.ds-doc .callout, .ds-doc p, .ds-doc #x { color: var(--ds-color-nope) }
.ds-docs p { color: var(--ds-color-text) }
@import url(other.css);
@page { margin: 1in }
@font-face { font-family: X; src: url(assets/x.woff2), url(https://fonts/x.woff2) }
.ds-doc p::after { content: "</style>" }`,
      },
      parser,
      tokens,
    );
    expect(problems.map((p) => p.message)).toEqual([
      'the stylesheet holds "</style", which would end the <style> it is inlined into',
      'the selector "body" must sit under .ds-doc and use element and attribute selectors only',
      'the selector ".ds-doc .callout" must sit under .ds-doc and use element and attribute selectors only',
      'the selector ".ds-doc #x" must sit under .ds-doc and use element and attribute selectors only',
      '.ds-doc .callout, .ds-doc p, .ds-doc #x: var(--ds-color-nope) names no token of this system',
      'the selector ".ds-docs p" must sit under .ds-doc and use element and attribute selectors only',
      '@import loads another stylesheet; document.css stands alone',
      '@page is not allowed in document.css; it reaches outside .ds-doc',
      '@font-face: url(https://fonts/x.woff2) points outside assets/; canon reads only its own assets/ files',
    ]);
  });

  it('names a stray canon path and holds the limits of D12', () => {
    const many = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`components/c${i}.html`, '<div></div>']));
    const problems = validateCanon({ ...many, 'layouts/sub/x.html': '<section id="x"></section>', 'components/big.html': `<div>${'x'.repeat(64 * 1024)}</div>` }, parser);
    expect(problems).toEqual([
      { path: '', message: '67 canon files; a system holds at most 64' },
      { path: 'components/big.html', message: `${64 * 1024 + 11} bytes; a canon file holds at most ${64 * 1024}` },
      { path: 'layouts/sub/x.html', message: 'not a canon path: layouts are layouts/<name>.html, components components/<name>.html or components/document.css' },
    ]);
  });
});

describe('fix wave 1: the canon’s escapes', () => {
  it('refuses a document.css selector whose subject is a sibling of the .ds-doc root', () => {
    const problems = validateCanon(
      { 'components/document.css': '.ds-doc + p { color: var(--ds-color-text) }\n.ds-doc ~ p, .ds-doc>p, .ds-doc  p + p, .ds-doc:hover, .ds-doc[data-x] ~ div, .ds-doc p ~ ul { }' },
      parser,
    );
    expect(problems.map((p) => p.message)).toEqual([
      'the selector ".ds-doc + p" selects outside .ds-doc (a sibling of the root); its subject must be .ds-doc or sit under it',
      'the selector ".ds-doc ~ p" selects outside .ds-doc (a sibling of the root); its subject must be .ds-doc or sit under it',
      'the selector ".ds-doc[data-x] ~ div" selects outside .ds-doc (a sibling of the root); its subject must be .ds-doc or sit under it',
    ]);
  });

  it('finds the root-level combinator past nested functional pseudo-classes, and keeps what stays under the root', () => {
    const sibling = (selector: string) => `the selector "${selector}" selects outside .ds-doc (a sibling of the root); its subject must be .ds-doc or sit under it`;
    const css = [
      '.ds-doc:is(:not(p) div) + p { }',
      '.ds-doc:is(:where(a, b) :not(i:is(u v))) ~ p { }',
      '.ds-doc:is(:not(p) div) p + p { }',
      '.ds-doc:is(:not(p) div) > p { }',
      '.ds-doc:not(:is(p) div) { }',
      '.ds-doc[data-x="(+"]:is(:not(p) div) + p { }',
    ].join('\n');
    const problems = validateCanon({ 'components/document.css': css }, parser);
    expect(problems.map((p) => p.message)).toEqual([
      sibling('.ds-doc:is(:not(p) div) + p'),
      sibling('.ds-doc:is(:where(a, b) :not(i:is(u v))) ~ p'),
      sibling('.ds-doc[data-x="(+"]:is(:not(p) div) + p'),
    ]);
  });

  it('checks SVG presentation attributes as declarations, and an asset path once decoded and normalized', () => {
    const problems = validateCanon(
      {
        'components/icon.html':
          '<svg fill="url(https://example.com/a.svg#paint)"><rect fill="url(#g)" mask="url(assets/m.svg#x)"></rect><image href="assets/%2e%2e/private.png"></image><image href="assets/%252e%252e/p.png"></image><image href="assets/./a/../b.png"></image><image href="assets/%zz.png"></image><image href="/assets/a.png"></image></svg>',
      },
      parser,
    );
    expect(problems.map((p) => p.message)).toEqual([
      'svg: url(https://example.com/a.svg#paint) points outside assets/; canon reads only its own assets/ files',
      'svg > image:nth-child(2): href="assets/%2e%2e/private.png" points outside assets/; canon reads only its own assets/ files',
      'svg > image:nth-child(3): href="assets/%252e%252e/p.png" points outside assets/; canon reads only its own assets/ files',
      'svg > image:nth-child(5): href="assets/%zz.png" points outside assets/; canon reads only its own assets/ files',
      'svg > image:nth-child(6): href="/assets/a.png" points outside assets/; canon reads only its own assets/ files',
    ]);
  });
});
