// @vitest-environment happy-dom
// The naming side (E4d execution document, Design §4 and §13): E0b's four targets keep their css, role, name and path
// (S2e's round trip), every emitted selector resolves to its element and stays inside `CSS_PATH`, and the discriminating
// cases name what Playwright's `getByRole` computes, or nothing, so E4c's `css.and(getByRole(role, {name, exact}))`
// never fails on a correct css.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document as HappyDocument, Element as HappyElement } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { a11yPath, accessibleNameOf, cssPath, CSS_PATH, CSS_PATH_MAX, describeElement, roleOf } from './describe';

const PAGE = readFileSync(join(__dirname, '../../../test/fixtures/browser/probe-page.html'), 'utf8');
const doc = (): HappyDocument => (globalThis as unknown as { document: HappyDocument }).document;
const target = (name: string): HappyElement => {
  const el = doc().querySelector(`[data-target="${name}"]`);
  if (el === null) throw new Error(`no target ${name}`);
  return el;
};
function append(parent: HappyElement, tag: string): HappyElement {
  const child = doc().createElement(tag);
  parent.appendChild(child);
  return child;
}
// A fragment under a fresh container, for the role and name tables.
function fragment(html: string): HappyElement {
  const host = doc().createElement('div');
  host.innerHTML = html;
  doc().body.appendChild(host);
  return host.querySelector('[data-t]') ?? host.firstElementChild!;
}

const SHY = String.fromCharCode(0xad);
const ZWSP = String.fromCharCode(0x200b);

// happy-dom 20 does not decode CSS escapes in a selector (`#\37 ` finds nothing, `#a\ b` throws) where Chromium does.
// The suite's document reads selectors through this shim, which rewrites a leading escaped `#id` step into the
// attribute selector happy-dom matches, so the round trip below is the one Chromium gives (e2e case 3 runs it there).
// eslint-disable-next-line no-control-regex -- the range is the grammar's "any code point at or above U+0080"
const ESCAPED_ID = /^#((?:\\[0-9a-fA-F]{1,6} ?|\\[^0-9a-fA-F]|[\w-]|[^\x00-\x7f])+)/u;
const unescapeIdent = (text: string) =>
  text.replace(/\\([0-9a-fA-F]{1,6}) ?|\\(.)/gu, (_, hex: string | undefined, char: string | undefined) => (hex !== undefined ? String.fromCodePoint(Number.parseInt(hex, 16)) : char!));
function chromiumSelector(selector: string): string {
  const match = ESCAPED_ID.exec(selector);
  if (match === null || !match[1]!.includes('\\')) return selector;
  const id = unescapeIdent(match[1]!);
  const quote = id.includes('"') ? "'" : '"'; // happy-dom reads no escape inside a string either
  return `[id=${quote}${id}${quote}]${selector.slice(match[0].length)}`;
}
{
  const page = doc();
  const all = page.querySelectorAll.bind(page);
  const one = page.querySelector.bind(page);
  page.querySelectorAll = ((selector: string) => all(chromiumSelector(selector))) as typeof page.querySelectorAll;
  page.querySelector = ((selector: string) => one(chromiumSelector(selector))) as typeof page.querySelector;
}

// Replaces the `CSS` global for one test (happy-dom answers a fresh `CSS` object per read, so its `escape` cannot be
// reassigned in place); `undefined` is a context without `CSS.escape`.
const realCss = Object.getOwnPropertyDescriptor(globalThis, 'CSS');
const setCssEscape = (escape: ((value: string) => string) | undefined) =>
  Object.defineProperty(globalThis, 'CSS', { value: escape === undefined ? {} : { escape }, configurable: true, writable: true });

beforeEach(() => {
  doc().open();
  doc().write(PAGE);
  doc().close();
});
afterEach(() => {
  if (realCss !== undefined) Object.defineProperty(globalThis, 'CSS', realCss);
  else delete (globalThis as { CSS?: unknown }).CSS;
});

describe('E0b’s four targets (S2e)', () => {
  it('keep their css, role, name and accessibility path, and the css resolves to the element', () => {
    const expected = {
      increment: { css: '#increment', role: 'button', name: 'Increment', a11y: 'main > region “A form” > button “Increment”', tag: 'button' },
      act: { css: 'body > main > section:nth-of-type(2) > ul > li:nth-of-type(2) > button', role: 'button', name: 'Act', a11y: 'main > list > listitem > button “Act”', tag: 'button' },
      name: { css: '#name', role: 'textbox', name: 'Name', a11y: 'main > region “A form” > textbox “Name”', tag: 'input' },
      'local-link': { css: '#\\37  > a', role: 'link', name: 'local link', a11y: 'main > paragraph > link “local link”', tag: 'a' },
    };
    for (const [name, want] of Object.entries(expected)) {
      const el = target(name);
      expect(describeElement(el), name).toEqual({ ...want, confident: true });
      expect(doc().querySelector(want.css), name).toBe(el);
    }
  });
});

describe('cssPath', () => {
  it('names every element of the page with a selector inside the grammar that resolves to it', () => {
    const all = [...doc().querySelectorAll('*')];
    expect(all.length).toBeGreaterThan(60);
    for (const el of all) {
      const css = cssPath(el);
      expect(css, el.outerHTML.slice(0, 60)).not.toBeNull();
      expect(CSS_PATH.test(css!), css!).toBe(true);
      expect(doc().querySelector(css!), css!).toBe(el);
    }
    expect(cssPath(doc().documentElement)).toBe('html');
    expect(cssPath(doc().body)).toBe('body');
  });

  it('takes non-ASCII ids as they are', () => {
    expect(cssPath(target('hangul-id'))).toBe('#한글-id');
    expect(cssPath(target('cafe-id'))).toBe('#café');
  });

  it('skips an id that is not unique, and names a shadow host but nothing inside its tree', () => {
    const twin = doc().createElement('span');
    twin.id = 'increment';
    doc().body.appendChild(twin);
    expect(cssPath(target('increment'))).toBe('body > main > section:nth-of-type(1) > div:nth-of-type(4) > button:nth-of-type(1)');
    const host = target('shadow-host');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<button type="button">Inside</button>';
    expect(cssPath(host)).toBe('#shadow-host');
    expect(cssPath(root.querySelector('button')!)).toBeNull();
    expect(cssPath(doc().createElement('div'))).toBeNull(); // detached
  });

  it('escapes ids as CSS.escape does when the DOM has no CSS.escape (the fallback)', () => {
    doc().body.innerHTML = ''; // the page's own `#7` would make that id not unique
    const ids = ['7', '-7', '-', 'a b', 'x"y', 'a\\b', '한글', 'a\u0001b', '_x', '--a', '\u0000z', '1a2'];
    const els = ids.map((id) => {
      const el = doc().createElement('i');
      el.id = id;
      doc().body.appendChild(el);
      return el;
    });
    const withEscape = els.map((el) => cssPath(el));
    setCssEscape(undefined);
    expect(els.map((el) => cssPath(el))).toEqual(withEscape);
    expect(withEscape.slice(0, 5)).toEqual(['#\\37 ', '#-\\37 ', '#\\-', '#a\\ b', '#x\\"y']);
    els.forEach((el, index) => expect(doc().querySelector(withEscape[index]!), ids[index]).toBe(el));
  });

  it('continues with nth-of-type steps when an id step falls outside the grammar', () => {
    setCssEscape((value) => value); // an escaper that leaves the space in `a b`
    const el = doc().createElement('i');
    el.id = 'a b';
    doc().body.appendChild(el);
    expect(cssPath(el)).toBe('body > i');
  });

  it('answers null past 2,000 characters, with no step cap below that', () => {
    let parent: HappyElement = doc().body;
    for (let depth = 0; depth < 150; depth++) parent = append(parent, 'section');
    const css = cssPath(parent)!;
    expect(css.length).toBeLessThanOrEqual(CSS_PATH_MAX);
    expect(doc().querySelector(css)).toBe(parent);
    for (let depth = 0; depth < 100; depth++) parent = append(parent, 'section');
    expect(cssPath(parent)).toBeNull();
  });

  // M1 review: the id is page-chosen text the agent's prompt carries three times (css, locator, lead)
  it('skips an id step whose escaped form is past 200 characters', () => {
    const el = append(doc().body, 'i');
    el.id = 'k'.repeat(199);
    expect(cssPath(el)).toBe(`#${'k'.repeat(199)}`);
    el.id = 'k'.repeat(200);
    expect(cssPath(el)).toBe('body > i');
  });

  // M1 review: Playwright's `css=` pierces open shadow roots, so an id inside one makes the light-DOM id not unique
  it('skips an id step that an element inside an open shadow root also carries', () => {
    const host = target('shadow-host');
    const outer = host.attachShadow({ mode: 'open' });
    outer.innerHTML = '<div><span id="nested-host"></span></div>';
    expect(cssPath(target('increment'))).toBe('#increment');
    outer.querySelector('#nested-host')!.attachShadow({ mode: 'open' }).innerHTML = '<b id="increment">twin</b>';
    expect(cssPath(target('increment'))).toBe('body > main > section:nth-of-type(1) > div:nth-of-type(4) > button:nth-of-type(1)');
  });

  // M1 review: a custom element's name may hold `.` or non-ASCII characters
  it('names elements whose local names are outside ASCII letters, escaped as CSS.escape does', () => {
    const host = fragment('<my-élément data-t><emoji-😀></emoji-😀><emoji-😀 data-u></emoji-😀></my-élément>');
    expect(cssPath(host)).toBe('body > div > my-élément');
    expect(cssPath(host.querySelector('[data-u]')!)).toBe('body > div > my-élément > emoji-😀:nth-of-type(2)');
    expect(doc().querySelector(cssPath(host.querySelector('[data-u]')!)!)).toBe(host.querySelector('[data-u]'));
    const dotted = append(doc().body, 'x.y');
    expect(cssPath(dotted)).toBe('body > x\\.y');
    expect(CSS_PATH.test(cssPath(dotted)!)).toBe(true);
  });
});

describe('CSS_PATH', () => {
  it('admits only the grammar cssPath writes', () => {
    for (const css of ['html', 'body > main > section:nth-of-type(2) > ul', '#increment', '#\\37  > a', '#한글-id', '#a\\ b > i', '#x\\"y', 'svg > linearGradient', 'my-widget:nth-of-type(3)', 'body > my-élément > x\\.y:nth-of-type(2)'])
      expect(CSS_PATH.test(css), css).toBe(true);
    for (const css of ['div, body', 'a[href]', ':has(a)', 'body >> a', 'text=x', 'body a', 'body>a', 'body > #x', '#a b', 'div:nth-of-type(0)', 'div:nth-child(2)', '', '#', 'a > ', '*', '7a', 'body > -7', 'a:hover', 'a::before', 'a.b'])
      expect(CSS_PATH.test(css), css).toBe(false);
  });

  it('answers in linear time on a long near-miss', () => {
    const started = performance.now();
    expect(CSS_PATH.test(`#${'\\3 '.repeat(600)}!`)).toBe(false);
    expect(CSS_PATH.test(`#${'\\111111'.repeat(280)}!`)).toBe(false); // a hex run has one reading, so no backtracking blow-up
    expect(CSS_PATH.test(`${'a > '.repeat(500)}!`)).toBe(false);
    expect(CSS_PATH.test(`${'x\\3 '.repeat(500)}!`)).toBe(false);
    expect(CSS_PATH.test(`${'a\\111111'.repeat(280)}!`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe('roleOf, as Playwright’s getByRole computes it (or null)', () => {
  const cases: [string, string | null][] = [
    ['<a data-t href="/x">x</a>', 'link'],
    ['<a data-t>x</a>', null],
    ['<button data-t>x</button>', 'button'],
    ['<h3 data-t>x</h3>', 'heading'],
    ['<input data-t>', 'textbox'],
    ['<input data-t type="EMAIL">', 'textbox'],
    ['<input data-t type="nonsense">', 'textbox'],
    ['<input data-t type="search">', 'searchbox'],
    ['<input data-t type="checkbox">', 'checkbox'],
    ['<input data-t type="submit">', 'button'],
    ['<input data-t type="range">', 'slider'],
    ['<input data-t type="number">', 'spinbutton'],
    ['<input data-t type="hidden">', null],
    ['<input data-t type="file">', null],
    ['<input data-t list="dl1"><datalist id="dl1"></datalist>', 'combobox'],
    ['<select data-t></select>', 'combobox'],
    ['<select data-t multiple></select>', 'listbox'],
    ['<select data-t size="4"></select>', 'listbox'],
    ['<textarea data-t></textarea>', 'textbox'],
    ['<img data-t alt="Logo">', 'img'],
    ['<img data-t>', 'img'],
    ['<img data-t alt="">', null],
    ['<img data-t alt="" title="t">', 'img'],
    ['<ul data-t></ul>', 'list'],
    ['<menu data-t></menu>', 'list'],
    ['<ul><li data-t>x</li></ul>', 'listitem'],
    ['<ul role="none"><li data-t>x</li></ul>', null],
    ['<section data-t></section>', null],
    ['<section data-t aria-label="Results"></section>', 'region'],
    ['<form data-t></form>', null],
    ['<form data-t aria-labelledby="x"></form>', 'form'],
    ['<header data-t></header>', 'banner'],
    ['<article><header data-t></header></article>', null],
    ['<div role="main"><footer data-t></footer></div>', null],
    ['<footer data-t></footer>', 'contentinfo'],
    ['<summary data-t>x</summary>', null],
    ['<details data-t></details>', 'group'],
    ['<dialog data-t></dialog>', 'dialog'],
    ['<dl data-t><dt>t</dt><dd>d</dd></dl>', null],
    ['<dl><dt data-t>t</dt></dl>', 'term'],
    ['<dl><dd data-t>d</dd></dl>', 'definition'],
    ['<fieldset data-t></fieldset>', 'group'],
    ['<hr data-t>', 'separator'],
    ['<progress data-t></progress>', 'progressbar'],
    ['<meter data-t></meter>', 'meter'],
    ['<output data-t></output>', 'status'],
    ['<blockquote data-t></blockquote>', 'blockquote'],
    ['<p data-t>x</p>', 'paragraph'],
    ['<code data-t>x</code>', 'code'],
    ['<strong data-t>x</strong>', 'strong'],
    ['<em data-t>x</em>', 'emphasis'],
    ['<time data-t>x</time>', 'time'],
    ['<iframe data-t></iframe>', null],
    ['<div data-t>x</div>', null],
    ['<span data-t>x</span>', null],
    ['<table><tbody data-t><tr><td>1</td></tr></tbody></table>', 'rowgroup'],
    ['<table><tr data-t><td>1</td></tr></table>', 'row'],
    ['<table><tr><td data-t>1</td></tr></table>', 'cell'],
    ['<table role="grid"><tr><td data-t>1</td></tr></table>', 'gridcell'],
    ['<table><tr><th data-t scope="row">h</th><td>1</td></tr></table>', 'rowheader'],
    ['<table><tr><th data-t>h</th><th>i</th></tr><tr><td>1</td><td>2</td></tr></table>', 'columnheader'],
    ['<table><tr><th data-t>h</th><td>1</td></tr><tr><th>i</th><td>2</td></tr></table>', 'rowheader'],
    ['<div data-t role="foo button">x</div>', 'button'],
    ['<div data-t role="tab">x</div>', 'tab'],
    ['<button data-t role="none">x</button>', null],
    ['<div data-t role="presentation">x</div>', null],
    ['<div data-t role="Button">x</div>', null],
    ['<svg data-t></svg>', 'img'],
  ];
  it.each(cases)('%s → %s', (html, role) => {
    expect(roleOf(fragment(html))).toBe(role);
  });
});

describe('accessibleNameOf', () => {
  const cases: [string, string][] = [
    ['<span id="l1">Hello</span><span id="l2">world</span><button data-t aria-labelledby="l1 l2" aria-label="ignored">x</button>', 'Hello world'],
    ['<button data-t aria-label="  Close  dialog ">x</button>', 'Close dialog'],
    ['<button data-t aria-labelledby="missing" aria-label="Fallback">x</button>', 'Fallback'],
    ['<label for="f1">First name</label><input data-t id="f1" placeholder="p">', 'First name'],
    ['<label>Email <input data-t type="email"></label>', 'Email'],
    ['<input data-t type="search" placeholder="Search docs">', 'Search docs'],
    ['<input data-t placeholder="Ignored" title="Title wins">', 'Title wins'],
    ['<input data-t type="checkbox" placeholder="never">', ''],
    ['<input data-t type="button" value="Go">', 'Go'],
    ['<input data-t type="submit">', 'Submit'],
    ['<input data-t type="reset">', 'Reset'],
    ['<img data-t alt="Company logo" title="t">', 'Company logo'],
    ['<img data-t title="Only title">', 'Only title'],
    ['<img data-t alt="">', ''],
    ['<button data-t>  Save\n  all  </button>', 'Save all'],
    ['<button data-t>Save<span aria-hidden="true"> ✓</span></button>', 'Save'],
    ['<button data-t>Save <span hidden>draft</span></button>', 'Save'],
    ['<button data-t><span aria-label="Delete"></span></button>', 'Delete'],
    ['<button data-t>Go <img alt="next"></button>', 'Go next'],
    ['<button data-t>A<div>B</div></button>', 'A B'],
    ['<a data-t href="#"><img alt="Home"></a>', 'Home'],
    ['<a data-t href="#">Home<script>x()</script></a>', 'Home'],
    ['<h2 data-t>Heading <em>text</em></h2>', 'Heading text'],
    ['<ul data-t><li>a</li><li>b</li></ul>', ''],
    ['<div data-t>plain text</div>', ''],
    ['<div data-t title="Tip">plain text</div>', 'Tip'],
    ['<p data-t aria-label="no">paragraph</p>', ''],
    ['<section data-t aria-label="Results"><h2>R</h2></section>', 'Results'],
    ['<fieldset data-t><legend>Shipping</legend><input></fieldset>', 'Shipping'],
    ['<table data-t><caption>Totals</caption><tr><td>1</td></tr></table>', 'Totals'],
    [`<button data-t>soft${SHY}hyphen${ZWSP}zero</button>`, 'softhyphenzero'],
    ['<button data-t>x<select><option>1</option></select></button>', ''],
    ['<button data-t aria-label="a\u0007b">x</button>', ''],
  ];
  it.each(cases)('%s → %j', (html, name) => {
    expect(accessibleNameOf(fragment(html))).toBe(name);
  });

  // M1 review: Playwright reads an open shadow root's children (and slotted light children) into a content name
  it('answers no name for content that holds an open shadow root', () => {
    const el = fragment('<button data-t>Go <span data-host></span></button>');
    expect(accessibleNameOf(el)).toBe('Go');
    el.querySelector('[data-host]')!.attachShadow({ mode: 'open' }).innerHTML = '<b>now</b>';
    expect(accessibleNameOf(el)).toBe('');
    const host = fragment('<div data-t role="button">x</div>');
    host.attachShadow({ mode: 'open' }).innerHTML = '<slot></slot>';
    expect(accessibleNameOf(host)).toBe('');
  });

  // M1 review: inside a label, legend or caption every descendant contributes its content, whatever its role
  it('reads a label’s descendants whatever their role', () => {
    expect(accessibleNameOf(fragment('<label for="r1"><div role="group">Email</div></label><input data-t id="r1">'))).toBe('Email');
    expect(accessibleNameOf(fragment('<fieldset data-t><legend><nav>Shipping</nav></legend></fieldset>'))).toBe('Shipping');
    expect(accessibleNameOf(fragment('<span id="r2"><div role="group">Grouped</div></span><button data-t aria-labelledby="r2">x</button>'))).toBe('Grouped');
  });

  it('survives a labelledby cycle', () => {
    const el = fragment('<button data-t id="c1" aria-labelledby="c2">x</button><span id="c2" aria-labelledby="c1">y<b aria-labelledby="c1">z</b></span>');
    expect(accessibleNameOf(el)).toBe('yz');
  });
});

describe('describeElement and a11yPath', () => {
  it('names the discriminating cases as Playwright would, or not at all', () => {
    const pick = (name: string) => describeElement(target(name));
    expect(pick('list')).toMatchObject({ css: 'body > main > section:nth-of-type(2) > ul', role: 'list', name: '', a11y: 'main > list', tag: 'ul', confident: true });
    expect(pick('plain-div')).toMatchObject({ role: null, name: '', tag: 'div', a11y: 'main > region “Discriminating cases”' });
    expect(pick('hidden-button')).toMatchObject({ role: 'button', name: 'Hidden action', confident: false });
    expect(pick('no-href')).toMatchObject({ role: null, name: '', tag: 'a' });
    expect(pick('decorative-img')).toMatchObject({ role: null, name: '', tag: 'img' });
    expect(pick('icon-button')).toMatchObject({ role: 'button', name: 'Save', a11y: 'main > region “Discriminating cases” > button “Save”' });
    expect(pick('placeholder-input')).toMatchObject({ role: 'searchbox', name: 'Search docs' });
    expect(pick('article-header')).toMatchObject({ role: null, name: '', a11y: 'main > region “Discriminating cases” > article' });
    expect(pick('hangul-id')).toMatchObject({ css: '#한글-id', role: 'button', name: '한글' });
    expect(pick('cafe-id')).toMatchObject({ css: '#café', role: null, name: '' });
    expect(pick('shadow-host')).toMatchObject({ css: '#shadow-host', role: null, name: '', tag: 'div' });
  });

  it('answers null for an element it cannot name with a css', () => {
    expect(describeElement(doc().createElement('div'))).toBeNull();
  });

  it('cuts each segment’s name at 40 and the whole path at 300 from the start', () => {
    const long = 'n'.repeat(60);
    const el = fragment(`<nav aria-label="${long}"><button data-t>${long}</button></nav>`);
    expect(a11yPath(el)).toBe(`navigation “${'n'.repeat(39)}…” > button “${'n'.repeat(39)}…”`);
    let parent: HappyElement = doc().body;
    for (let depth = 0; depth < 40; depth++) {
      parent = append(parent, 'nav');
      parent.setAttribute('aria-label', `Level ${depth}`);
    }
    const deep = append(parent, 'button');
    deep.textContent = 'Deep';
    const path = a11yPath(deep);
    expect(path.length).toBe(300);
    expect(path.startsWith('…')).toBe(true);
    expect(path.endsWith('navigation “Level 39” > button “Deep”')).toBe(true);
  });
});
