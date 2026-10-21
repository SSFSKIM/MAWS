// The host's canon parser (P4, the tracker row of 2026-10-14) against the page's: the page validates with the renderer's
// DOMParser, the host with parse5 read as DOM nodes, and the two must give `validateCanon` the same tree. happy-dom (the
// other tests' parser) builds the spec's tree for most canon, not all of it; where it does not, the expectations below
// are the spec's, as Chromium's DOMParser built them when this was written.
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { canonElements, validateCanon, type HtmlParser } from './canon';
import complete from './fixtures/complete.tokens.json';
import { parse5Parser } from './parse5-parser';
import { parseTokens } from './tokens';

const happyDom = new new Window().DOMParser() as unknown as HtmlParser;
const tokens = parseTokens(complete).tokens!;
const messages = (path: string, html: string) => validateCanon({ [path]: html }, parse5Parser, tokens).map((p) => p.message);

describe('the parse5 parser: the spec’s tree, as the page’s DOMParser builds it', () => {
  it('splits head from body: what the parser puts in the head sits outside the root, as text before the root does', () => {
    expect(messages('components/a.html', '<style>p{}</style><base href="assets/"><p>x</p>')).toEqual([
      '<style> sits outside the root element; canon styles inline, with var(--ds-*) values',
      '<base> sits outside the root element; canon styles inline, with var(--ds-*) values',
    ]);
    expect(messages('components/b.html', 'Note <p>x</p><!-- a comment is no node canon reads -->')).toEqual(['text sits outside the root element: "Note"']);
  });

  it('closes and implies elements as the spec does, so a block in a <p> or HTML in an <svg> makes more roots', () => {
    expect(messages('components/a.html', '<p>Due <div>Friday</div></p>')).toEqual(['a canon file is one root element; this one has 3']);
    expect(messages('layouts/b.html', '<p><section id="b"></section></p>')).toEqual(['a canon file is one root element; this one has 3']);
    expect(messages('components/c.html', '<svg><p>x</p></svg>')).toEqual(['a canon file is one root element; this one has 2']);
    // a table's rows sit in the implied <tbody>; an <image> is an <img>
    const [table] = canonElements('<table><tr><td>a</td></tr></table>', parse5Parser);
    expect(table!.children.map((e) => [e.tag, e.children.map((r) => r.tag)])).toEqual([['tbody', ['tr']]]);
    expect(messages('components/d.html', '<div><image src="https://x/a.png"></div>')).toEqual(['div > img:nth-child(1): src="https://x/a.png" points outside assets/; canon reads only its own assets/ files']);
  });

  it('parses with scripting disabled, as a DOMParser document is: <noscript> holds markup, in the head and in the root', () => {
    expect(messages('components/a.html', '<div><noscript><p onclick="go()">y</p></noscript></div>')).toEqual([
      'div > noscript:nth-child(1): <noscript> is not allowed in canon',
      'div > noscript:nth-child(1) > p:nth-child(1): the event handler onclick runs script; canon holds no script',
    ]);
    // before the root, the head's <noscript> ends at the <p>, which starts the body
    expect(messages('components/b.html', '<noscript><p>x</p></noscript><div></div>')).toEqual([
      '<noscript> sits outside the root element; canon styles inline, with var(--ds-*) values',
      'a canon file is one root element; this one has 2',
    ]);
  });

  it('keeps raw text raw and a template’s contents out of its children', () => {
    expect(messages('components/a.html', '<div><iframe><p onclick="go()">x</p></iframe><template><p onclick="go()">y</p></template></div>')).toEqual([
      'div > iframe:nth-child(1): <iframe> is not allowed in canon',
      'div > template:nth-child(2): <template> is not allowed in canon',
    ]);
  });

  it('names attributes as the DOM does: a foreign one by its qualified name, the first of two the same', () => {
    expect(messages('components/a.html', '<svg><use xlink:href="https://x/y.svg#a"></use></svg>')).toEqual([
      'svg > use:nth-child(1): xlink:href="https://x/y.svg#a" points outside assets/; canon reads only its own assets/ files',
    ]);
    const [div] = canonElements('<DIV ID="a" id="b" Data-PH="title"><svg viewbox="0 0 1 1"></svg></DIV>', parse5Parser);
    expect(div!.attrs).toEqual({ id: 'a', 'data-ph': 'title' });
    expect(div!.children[0]!.attrs).toEqual({ viewBox: '0 0 1 1' });
  });

  it('takes a <frameset> for the body, as the DOM’s document.body does', () => {
    expect(parse5Parser.parseFromString('<frameset><frame src="x"></frameset>', 'text/html').body?.nodeName).toBe('FRAMESET');
    expect(messages('components/a.html', '<frameset><frame src="assets/x.html"></frameset>')).toEqual(['frame: <frame> is not allowed in canon']);
  });
});

// The one place parse5 7 and the page part: inside a <select>, which parse5 parses as the spec once did and Chromium
// (Electron 44's 152, and 156) as it does now. The page's DOMParser builds this as one <select>.
describe('the parse5 parser’s known gap: a <select>', () => {
  const MENU = '<select><textarea>A</textarea><option>B</option></select>';

  it('builds another tree there than the page, says so, and validateCanon leaves the file’s structure to the page', () => {
    expect(canonElements(MENU, parse5Parser).map((e) => e.tag)).toEqual(['select', 'textarea', 'option']);
    expect([MENU, '<div><SELECT name="x"></SELECT></div>'].map((html) => parse5Parser.buildsPageTree?.(html))).toEqual([false, false]);
    expect(messages('components/menu.html', MENU)).toEqual([]);
    // its limits still hold; a file with no <select> keeps the whole check
    expect(messages('components/menu.html', `${MENU}${'x'.repeat(64 * 1024)}`)).toEqual([`${MENU.length + 64 * 1024} bytes; a canon file holds at most ${64 * 1024}`]);
    expect(parse5Parser.buildsPageTree?.('<div data-select="1"><selection-chip></selection-chip></div>')).toBe(true);
    expect(messages('components/chip.html', '<div data-select="1"></div><selection-chip></selection-chip>')).toEqual(['a canon file is one root element; this one has 2']);
  });
});

// Canon whose tree happy-dom builds as the spec does: the two parsers must find the same problems and the same elements.
const AGREED: Record<string, string> = {
  'layouts/title.html': `<section id="title" style="background:var(--ds-color-bg);padding:128px">
  <h1 data-ph="title" style="font-size:var(--ds-type-title-size);color:var(--ds-color-text)">Lab safety</h1>
  <p data-ph="subtitle">Before <b>you</b> pump</p>
  <img data-ph="image" src="assets/beaker.png" alt="">
  <aside data-ph="notes">Speak slowly.</aside>
</section>`,
  'layouts/a.html': '<div id="a"></div>',
  'layouts/b.html': '<section></section>',
  'layouts/c.html': '<section id="c"></section><section id="d"></section> text',
  'components/chip.html': '<div style="display:flex;gap:var(--ds-space-2);background:var(--ds-color-accent)"><span style="color:var(--ds-color-accent-text)">Due Friday</span></div>',
  'components/e.html': '<span></span><span></span>',
  'components/g.html': '',
  'components/h.html': '<div></div><script>go()</script>',
  'components/bad.html': `<div onclick="x()" style="--ds-color-accent:red;color:var(--brand);background:url(https://x/y.png);border-color:var(--ds-color-highlight)">
  <script>alert(1)</script><iframe src="assets/a.html"></iframe>
  <a href="javascript:alert(1)">x</a><img src="../assets/x.png" srcset="assets/a.png 1x, https://cdn/b.png 2x"><svg><use href="#glyph"></use></svg>
  <p data-ph="Body Text">y</p>
</div>`,
  'components/icon.html':
    '<svg fill="url(https://example.com/a.svg#paint)"><rect fill="url(#g)" mask="url(assets/m.svg#x)"></rect><image href="assets/%2e%2e/private.png"></image><lineargradient id="g"></lineargradient></svg>',
  'components/table.html': '<table style="color:var(--ds-color-text)">\n  <tr><th style="padding:var(--ds-space-2)">A</th></tr>\n  <tr><td>a &amp; b</td></tr>\n</table>',
  'components/nested-a.html': '<div><a href="assets/x"><a href="https://y">z</a></a></div>',
  'components/comment.html': '<!-- c --><div><!-- d -->x <b>y</b></div>',
  'components/noscript.html': '<div><noscript><p onclick="x()">y</p></noscript></div>',
};

describe('the parse5 parser agrees with happy-dom where both build the spec’s tree', () => {
  it.each(Object.entries(AGREED))('%s', (path, html) => {
    expect(validateCanon({ [path]: html }, parse5Parser, tokens)).toEqual(validateCanon({ [path]: html }, happyDom, tokens));
    expect(canonElements(html, parse5Parser)).toEqual(canonElements(html, happyDom));
  });
});
