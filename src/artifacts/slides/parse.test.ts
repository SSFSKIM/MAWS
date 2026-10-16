// P3-C M1, Acceptance 1 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md): the loader over the corpus (Claude's
// own examples, D's layouts, S6's bench shapes and inputs), its holds, its drops and its ids (D4).
import { describe, expect, it } from 'vitest';
import manifest from './fixtures/claude/manifest.json';
import { BENCH_SLIDES, CLAUDE_SLIDES, CORPUS, LAYOUT_SLIDES, MESSY_IMAGE_URL, S6_SLIDES } from './fixtures/corpus';
import { claudeExamples, heldCases, messy } from './fixtures/s6';
import type { Diagnostic, ElementIR, SlideIR } from './ir';
import { hash4, loadSlide, SLIDE_LIMITS, type LoadOptions } from './parse';
import { serializeSlide } from './serialize';

function load(html: string, opts?: LoadOptions): { slide: SlideIR; diagnostics: Diagnostic[] } {
  const l = loadSlide(html, opts);
  if (!l.ok) throw new Error(`held: ${l.held.reasons.join('; ')}`);
  return l;
}
const canon = (html: string) => serializeSlide(load(html).slide);
const reasons = (html: string, opts?: LoadOptions) => {
  const l = loadSlide(html, opts);
  return l.ok ? null : l.held.reasons.join('; ');
};
const all = (els: ElementIR[]): ElementIR[] => els.flatMap((e) => [e, ...all(e.children)]);
const warnings = (l: { diagnostics: Diagnostic[] }) => l.diagnostics.filter((d) => d.severity === 'warning');

/** S6's six meaning-preserving variants, here applied outside `<svg>`, whose inner markup is opaque and kept verbatim. */
function variants(html: string): Record<string, string> {
  const outsideSvg = (f: (s: string) => string) => (s: string) => s.split(/(<svg[\s\S]*?<\/svg>)/).map((part, i) => (i % 2 ? part : f(part))).join('');
  return {
    'attribute order reversed': outsideSvg((s) => s.replace(/<([a-z][a-z0-9-]*)((?:\s+[a-z-]+="[^"]*")+)\s*>/g, (_, tag: string, attrs: string) => `<${tag}${(attrs.match(/\s+[a-z-]+="[^"]*"/g) ?? []).reverse().join('')}>`))(html),
    'declaration order reversed': outsideSvg((s) => s.replace(/style="([^"]*)"/g, (_, st: string) => `style="${st.split(';').map((d) => d.trim()).filter(Boolean).reverse().join(';')}"`))(html),
    'whitespace and case': outsideSvg((s) =>
      s
        .replace(/style="([^"]*)"/g, (_, st: string) => `style="  ${st.replace(/;/g, ' ;  ').replace(/:/g, ' : ').replace(/#([0-9a-f]{6})/g, (m) => m.toUpperCase())}  "`)
        .replace(/<(\/?)(p|div|h[1-3]|section|img|x-connector)\b/g, (_, slash: string, tag: string) => `<${slash}${tag.toUpperCase()}`)
        .replace(/\n/g, '\n\n   '),
    )(html),
    'bare numbers for px': outsideSvg((s) => s.replace(/(?<![\w-])(left|top|width|height|font-size|gap)\s*:\s*(\d+)px/g, '$1:$2'))(html),
    'rgb() for hex': outsideSvg((s) => s.replace(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})\b/g, (_, a: string, b: string, c: string) => `rgb(${parseInt(a, 16)}, ${parseInt(b, 16)}, ${parseInt(c, 16)})`))(html),
    entities: outsideSvg((s) => s.replace(/>([^<>"=]+)</g, (_, text: string) => `>${text.replace(/e/g, '&#101;').replace(/→/g, '&rarr;')}<`))(html),
  };
}

describe('the corpus (Acceptance 1)', () => {
  it('holds Claude’s examples (every one the type files carry), D’s layouts, S6’s bench shapes and S6’s inputs', () => {
    expect(CLAUDE_SLIDES.map((s) => s.name.slice('claude/'.length) + '.html').sort()).toEqual(manifest.extracted.map((e) => e.file).sort());
    for (const s of CLAUDE_SLIDES) expect(s.html, s.name).toMatch(/^<!-- provenance: T\/slides\/\S+:\d+(-\d+)? \(sha256 [0-9a-f]{12}…\), extracted by /);
    expect(CLAUDE_SLIDES.length).toBeGreaterThanOrEqual(6);
    expect(LAYOUT_SLIDES.length).toBe(12); // three systems, four layouts each
    expect(BENCH_SLIDES.length).toBe(7);
  });

  it('loads every corpus slide with no slide held', () => {
    for (const s of CORPUS) expect(reasons(s.html), s.name).toBeNull();
  });

  it('loads Claude’s examples, D’s layouts and the bench shapes without a warning', () => {
    for (const s of [...CLAUDE_SLIDES, ...LAYOUT_SLIDES, ...BENCH_SLIDES]) expect(warnings(load(s.html)), s.name).toEqual([]);
  });

  it('brings every corpus slide to a fixed point after one pass', () => {
    for (const s of CORPUS) {
      const once = canon(s.html);
      expect(canon(once), s.name).toBe(once);
    }
  });

  it('canonicalizes six meaning-preserving variants of each Claude example to identical bytes', () => {
    const examples = [...CLAUDE_SLIDES.map((s) => [s.name, s.html] as const), ...Object.entries(claudeExamples)];
    for (const [name, html] of examples) {
      const base = canon(html);
      for (const [variant, text] of Object.entries(variants(html))) expect(canon(text), `${name}: ${variant}`).toBe(base);
    }
  });

  it('rejects nothing S6 accepted (its messy slide aside: D6 holds its https image)', () => {
    for (const s of S6_SLIDES) expect(reasons(s.html), s.name).toBeNull();
    expect(reasons(messy)).toBe(`an <img> src "${MESSY_IMAGE_URL}" is not assets/<name>, /_blob/<id> or project/ds/<folder>/<file> (never a URL, a data: URI or another path): upload the image`);
  });
});

describe('held slides: a structural failure holds the slide with its reason, never trims it', () => {
  it('holds each of S6’s structural failures', () => {
    const expected: Record<string, RegExp> = {
      'two sections': /exactly one <section>/,
      'unknown tag': /unknown or misplaced tag <iframe>/,
      'text directly in a div': /text "loose text" directly inside <div>/,
      'aside not last': /<aside> \(the notes\) is not the section’s last child/,
      'nested list': /a nested list/,
      'embed inside a div': /<x-embed> is not a direct child of the section/,
      'svg with script': /<svg> holding <script>/,
      colspan: /colspan on a table cell/,
      '16 nested divs': /more than 15 nested <div>s/,
      '201 elements': /201 elements \(over 200\)/,
      'bad section id': /section id "a b" is not/,
      'unknown inline tag': /<code> inside the text of <p>/,
    };
    expect(Object.keys(heldCases).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, html] of Object.entries(heldCases)) expect(reasons(html), name).toMatch(expected[name]!);
    expect(reasons('<section id="a"></section>', { fileId: 'b' })).toMatch(/section id "a" differs from the file name "b"/);
  });

  it('holds a slide past the limits Claude states', () => {
    const pinned = (n: number) => Array.from({ length: n }, (_, i) => `<p style="position:absolute; left:${i}px; top:0px">x</p>`).join('');
    expect(reasons(`<section id="a">${pinned(24)}</section>`)).toBeNull();
    expect(reasons(`<section id="a">${pinned(25)}</section>`)).toMatch(/25 pinned children in <section> \(over 24/);
    expect(reasons(`<section id="a"><div id="host" style="position:relative">${pinned(25)}</div></section>`)).toMatch(/25 pinned children in <div id="host">/);
    const rows = (n: number, cols: number) => `<section id="a"><table>${`<tr>${'<td>x</td>'.repeat(cols)}</tr>`.repeat(n)}</table></section>`;
    expect(reasons(rows(100, 24))).toBeNull();
    expect(reasons(rows(101, 1))).toMatch(/101 rows \(over 100\)/);
    expect(reasons(rows(1, 25))).toMatch(/25 columns \(over 24\)/);
    expect(reasons(`<section id="a"><aside>${'n'.repeat(SLIDE_LIMITS.notes)}</aside></section>`)).toBeNull();
    expect(reasons(`<section id="a"><aside>${'n'.repeat(SLIDE_LIMITS.notes + 1)}</aside></section>`)).toMatch(/4001 characters of speaker notes/);
    expect(reasons(`<section id="a"><p>${'x'.repeat(SLIDE_LIMITS.textChars + 1)}</p></section>`)).toMatch(/20001 characters of text/);
    expect(reasons(`<section id="a"><p>${'<b>x</b> '.repeat(101)}</p></section>`)).toMatch(/101 inline marks/);
    expect(reasons(`<section id="a"><svg>${'<path d="M0 0"/>'.repeat(4000)}</svg></section>`)).toMatch(/<svg> over 52 KB/);
    const embed = (body: string) => `<x-embed style="position:absolute; left:0px; top:0px; width:10px; height:10px">${body}</x-embed>`;
    expect(reasons(`<section id="a">${embed('x'.repeat(16 * 1024 + 1))}</section>`)).toMatch(/<x-embed> over 16 KB/);
    expect(reasons(`<section id="a">${embed('x').repeat(9)}</section>`)).toMatch(/more than 8 <x-embed>s/);
    expect(reasons(`<section id="a"><x-embed style="width:10px">x</x-embed></section>`)).toMatch(/<x-embed> is not pinned/);
  });

  it('holds an image that is a URL, a data: URI or another path (D6), and takes the three asset forms', () => {
    for (const src of ['https://example.com/a.png', 'http://example.com/a.png', '//cdn/a.png', 'data:image/png;base64,AAAA', 'photos/reef.jpg', 'assets/../x', 'project/ds/Bad Folder/a.png']) {
      expect(reasons(`<section id="a"><img src="${src}" alt=""></section>`), src).toMatch(/is not assets\/<name>, \/_blob\/<id> or project\/ds\/<folder>\/<file>/);
    }
    for (const src of ['assets/logo.png', '/_blob/<id>', '/_blob/abc123', 'project/ds/maws/assets/logo.png']) {
      expect(load(`<section id="a"><img src="${src}" alt=""></section>`).slide.children[0]!.attrs.src, src).toBe(src);
    }
    const empty = load('<section id="a"><img src="" alt="Placeholder"></section>');
    expect(empty.slide.children[0]!.attrs.src).toBeUndefined();
  });

  it('holds an svg whose root or any descendant holds script, a handler or any reference but a local #id (fix wave 1)', () => {
    const svg = (inner: string, root = '') => `<section id="a"><svg${root} width="10" height="10">${inner}</svg></section>`;
    const held: Record<string, [string, RegExp]> = {
      'root onload': [svg('<path d="M0 0"/>', ' onload="alert(1)"'), /event handler \(onload\)/],
      'root reference': [svg('', ' href="x.svg"'), /referencing "x.svg"/],
      'image href': [svg('<image href="other.svg"/>'), /referencing "other.svg"/],
      'image xlink:href': [svg('<image xlink:href="data:image/png;base64,AA"/>'), /referencing "data:image/],
      'use another file': [svg('<use href="sprites.svg#a"/>'), /referencing "sprites.svg#a"/],
      'url() in an attribute': [svg('<path fill="url(other.svg#g)" d="M0 0"/>'), /referencing url\(other\.svg#g\)/],
      'url() in a style': [svg('<path style="fill:url(\'https://x.test/a\')" d="M0 0"/>'), /referencing url\(https:\/\/x\.test\/a\)/],
      'url() in a <style>': [svg('<style>.a{fill:url(https://x.test/a)}</style>'), /referencing url\(https/],
      '@import': [svg('<style>@import "x.css";</style>'), /@import/],
      'a script URL': [svg('<a href="javascript:alert(1)"><path d="M0 0"/></a>'), /script URL \(href\)/],
      'animated to another file': [svg('<a href="#x"><set attributeName="href" to="other.svg#y"/></a>'), /animating href to "other\.svg#y"/],
      'animated through values': [svg('<use href="#a"><animate attributeName="xlink:href" values="#a; https://x.test/b" dur="2s"/></use>'), /animating xlink:href to "https:\/\/x\.test\/b"/],
      'an escaped url()': [svg('<path style="fill:u\\72l(https://x.test/a)" d="M0 0"/>'), /referencing url\(https:\/\/x\.test\/a\)/],
      'an escaped url() in a <style>': [svg('<style>.a{fill:\\75 rl(https://x.test/a)}</style>'), /referencing url\(https/],
      'an escaped @import': [svg('<style>@\\69mport "x.css";</style>'), /@import/],
      'an image function': [svg('<style>.a{fill:image-set("x.png" 1x)}</style>'), /with image-set\(\)/],
      'a line continuation in a quoted url (fix wave 3)': [svg('<style>.a{fill:url("https://example.com/\\\na.svg#g")}</style>'), /referencing url\(https:\/\/example\.com\/a\.svg#g\)/],
      'nested handler': [svg('<g><g><circle onclick="x()" r="1"/></g></g>'), /event handler \(onclick\)/],
      foreignObject: [svg('<foreignObject><p>x</p></foreignObject>'), /holding <foreignobject>/i],
      script: [svg('<script>alert(1)</script>'), /holding <script>/],
    };
    for (const [name, [html, reason]] of Object.entries(held)) expect(reasons(html), name).toMatch(reason);
    const fine = svg('<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient><marker id="h"><path d="M0 0"/></marker></defs><style>.a{fill:url(#g)} .b{stroke:url("#g")} .c{fill:url(\'#\\\nh\')}</style><use href="#h" xlink:href="#h"><set attributeName="href" to="#g" begin="1s"/><animate attributeName="xlink:href" values="#g; #h" dur="2s"/></use><path class="a" fill="u\\72l(#g)" marker-end="url( \'#h\' )" d="M0 0"/>', ' aria-label="A chart"');
    expect(reasons(fine)).toBeNull();
    expect(load(fine).slide.children[0]!.attrs).toEqual({ 'aria-label': 'A chart', width: '10', height: '10' });
  });

  it('holds an x-shape kind or x-icon name it does not know, or none (Claude’s build errors); a cosmetic enum is dropped (fix wave 1)', () => {
    expect(reasons('<section id="a"><x-shape kind="star"></x-shape></section>')).toBe('kind="star" on <x-shape> is not one of rect, rounded, ellipse, diamond, arrow-right, arrow-left, arrow-up, arrow-down, line');
    expect(reasons('<section id="a"><x-shape></x-shape></section>')).toMatch(/an <x-shape> without a kind/);
    expect(reasons('<section id="a"><x-icon name="Rocket"></x-icon></section>')).toMatch(/^name="Rocket" on <x-icon> is not one of Activity/);
    expect(reasons('<section id="a"><x-icon></x-icon></section>')).toMatch(/an <x-icon> without a name/);
    const cosmetic = load('<section id="a"><x-connector id="c" x1="0" y1="0" x2="1" y2="1" head="sideways"></x-connector><p id="p" data-fit="squash">x</p></section>');
    expect(cosmetic.slide.children.map((c) => c.attrs.head ?? c.attrs['data-fit'])).toEqual([undefined, undefined]);
    expect(warnings(cosmetic).map((d) => `${d.element} ${d.property}`)).toEqual(['c head', 'p data-fit']);
  });

  it('holds document markup around or inside the section, before parse5 repairs it away (fix wave 1)', () => {
    const section = '<section id="a"><p>x</p></section>';
    const held: Record<string, string> = {
      'html and body': `<html><body>${section}</body></html>`,
      'a head': `<head><title>Deck</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=A"></head>${section}`,
      'body alone': `<body>${section}</body>`,
      'a doctype': `<!DOCTYPE html>${section}`,
      'a style': `<style>p{color:red}</style>${section}`,
      'a meta inside': '<section id="a"><meta charset="utf-8"><p>x</p></section>',
      'a script inside': '<section id="a"><script>alert(1)</script></section>',
    };
    for (const [name, html] of Object.entries(held)) expect(reasons(html), name).toMatch(/^a slide file holds no <(html|head|body|title|link|style|script|meta|!DOCTYPE)>/);
    expect(reasons(`<html><body>${section}</body></html>`)).toBe('a slide file holds no <html>, <body>: only its one <section> (deck.json carries the title and the faces)');
    // inside an x-embed (a whole small page) and an svg (its own title and style) the same tags are theirs
    const embed = '<x-embed style="position:absolute; left:0px; top:0px; width:400px; height:300px"><!DOCTYPE html><html><head><title>t</title><style>b{}</style><script>if (1 < 2) {}</script></head><body><p>live</p></body></html></x-embed>';
    expect(reasons(`<section id="a">${embed}<svg><title>Chart</title><style>.a{fill:#000}</style><path class="a" d="M0 0"/></svg></section>`)).toBeNull();
  });

  it('reads an embed’s script as the tree builder does, so tags in its strings neither open nor close it (fix wave 2)', () => {
    const at = 'style="position:absolute; left:0px; top:0px; width:400px; height:300px"';
    // a "<x-embed>" string in the script does not open a second embed, so the body written after the real close counts
    expect(reasons(`<section id="a"><x-embed ${at}><script>var s = "<x-embed>";</script></x-embed><body><p>x</p></body></section>`)).toMatch(/^a slide file holds no <body>/);
    // a "</x-embed><body>" string in the script neither closes the embed nor writes a body
    expect(reasons(`<section id="a"><x-embed ${at}><script>var s = "</x-embed><body>";</script><p>live</p></x-embed></section>`)).toBeNull();
    // an svg's own title, and a closing body tag outside it
    expect(reasons('<section id="a"><svg><title>t</title></svg></section></body>')).toMatch(/^a slide file holds no <body>/);
  });

  it('holds a connector given some coordinates but not all, or one that is not a number', () => {
    expect(reasons('<section id="a"><x-connector x1="0" y1="0" x2="10"></x-connector></section>')).toMatch(/with x1, y1, x2 but not y2/);
    expect(reasons('<section id="a"><x-connector x1="PC" y1="0" x2="10" y2="0"></x-connector></section>')).toMatch(/x1="PC" is not a number/);
    expect(load('<section id="a"><x-connector x1="10%" y1="0" x2="10px" y2="5"></x-connector></section>').slide.children[0]!.attrs).toEqual({ x1: '10%', y1: '0', x2: '10', y2: '5' });
    expect(reasons('<section id="a"><x-connector style="width:96px" from="tr"></x-connector></section>')).toBeNull();
  });
});

describe('drops: an unknown property or attribute is dropped with a warning naming slide, element and property', () => {
  it('names the slide, the element and the property', () => {
    const l = load('<section id="s1" onclick="x()"><p id="t" style="float:left; z-index:2; color:red" title="t" data-foo="1">a</p></section>');
    expect(warnings(l)).toEqual([
      { severity: 'warning', slide: 's1', property: 'onclick', message: 'onclick is not in the dialect; dropped' },
      { severity: 'warning', slide: 's1', element: 't', property: 'title', message: 'title is not in the dialect; dropped' },
      { severity: 'warning', slide: 's1', element: 't', property: 'float', message: 'float is not in the dialect; dropped' },
      { severity: 'warning', slide: 's1', element: 't', property: 'z-index', message: 'z-index is not in the dialect; dropped' },
    ]);
    expect(l.slide.children[0]!.style).toEqual({ color: 'red' });
    expect(l.diagnostics).toContainEqual({ severity: 'note', slide: 's1', element: 't', property: 'data-foo', message: 'data-foo ignored' });
  });

  it('names an id-less element by the id it is minted, and a cell by its row and column', () => {
    const l = load('<section id="s"><p style="float:left">a</p><table><tr id="r"><td>1</td><td style="font-size:30px">2</td></tr></table></section>');
    const minted = l.slide.children[0]!.id;
    expect(warnings(l)).toEqual([
      { severity: 'warning', slide: 's', element: minted, property: 'float', message: 'float is not in the dialect; dropped' },
      { severity: 'warning', slide: 's', element: 'r', property: 'font-size', message: 'cell 2: font-size does not apply to <td> (it applies to: text table; inherits into p/li, not h1–h3); dropped' },
    ]);
  });

  it('drops a value outside its line, a property its element does not take, and any var() but var(--ds-*)', () => {
    const l = load(`<section id="s"><p id="p" style="font-size:500px; gap:8px; color:var(--brand); background:currentcolor; letter-spacing:40px">a</p><img id="i" src="assets/a.png" alt="" style="font-size:24px; left:0px"></section>`);
    expect(warnings(l).map((d) => `${d.element} ${d.property}: ${d.message}`)).toEqual([
      'p font-size: font-size:500px is outside its grammar (font-size: LEN 8–400 (Npt converts)); dropped',
      'p color: color:var(--brand) uses a var() other than var(--ds-*) (the design system\'s tokens); dropped',
      'p background: background:currentcolor uses currentcolor; dropped',
      'p letter-spacing: letter-spacing:40px is outside its grammar (letter-spacing: LEN | Nem (−24–32px) | normal); dropped',
      'p gap: gap does not apply to <p> (it applies to: section div); dropped',
      'i font-size: font-size does not apply to <img> (it applies to: text table; inherits into p/li, not h1–h3); dropped',
      'i left: left does not apply to <img> (it applies to: pinned only (relative does not offset)); dropped',
    ]);
  });
});

describe('element identity (D4)', () => {
  const html = '<section id="s"><p>a</p><p id="keep">b</p><div id="box"><p>c</p></div></section>';

  it('keeps authored ids and mints e<n>-<hash4(slide, parent path, index, tag)> for the rest, the same on every load', () => {
    const ids = (l: ReturnType<typeof load>) => all(l.slide.children).map((e) => e.id);
    const first = ids(load(html));
    expect(first).toEqual([`e1-${hash4('s\u0000s\u00000\u0000p')}`, 'keep', 'box', `e2-${hash4('s\u0000s/box\u00000\u0000p')}`]);
    expect(ids(load(html))).toEqual(first);
    expect(canon(canon(html))).toBe(canon(html)); // the minted ids are written into the file
  });

  it('takes the base slot’s id when the writer offers one it uses nowhere else, and skips taken ids when it mints', () => {
    const calls: [string, number, string][] = [];
    const mint = (path: string, index: number, tag: string) => {
      calls.push([path, index, tag]);
      return path === 's' ? 'title' : 'keep'; // 'keep' is used elsewhere in the file: not taken
    };
    const l = load(html, { mint });
    expect(calls).toEqual([['s', 0, 'p'], ['s/box', 0, 'p']]);
    expect(all(l.slide.children).map((e) => e.id)).toEqual(['title', 'keep', 'box', `e2-${hash4('s\u0000s/box\u00000\u0000p')}`]);
    const minted = `e1-${hash4('s\u0000s\u00000\u0000p')}`;
    expect(load(html, { taken: new Set([minted]) }).slide.children[0]!.id).toBe(`e2-${hash4('s\u0000s\u00000\u0000p')}`);
    expect(load(html, { mint: () => 'not valid!' }).slide.children[0]!.id).toBe(minted);
  });

  it('mints a new id for a duplicate or invalid one, with a warning', () => {
    const l = load('<section id="s"><p id="x">a</p><p id="x">b</p><p id="bad id">c</p></section>');
    expect(l.slide.children.map((e) => e.id)).toEqual(['x', expect.stringMatching(/^e\d+-/), expect.stringMatching(/^e\d+-/)]);
    expect(warnings(l).map((d) => d.message)).toEqual(['duplicate id "x"; a new id is minted', 'id "bad id" is not [A-Za-z0-9_-]{1,64}; a new id is minted']);
  });

  it('gives rows ids and leaves cells positional, written without ids', () => {
    const l = load('<section id="s"><table id="t"><tr><th id="h">A</th></tr><tr id="r2"><td>1</td></tr></table></section>');
    const table = l.slide.children[0]!;
    expect(table.children.map((r) => r.id)).toEqual([expect.stringMatching(/^e\d+-/), 'r2']);
    expect(table.children.flatMap((r) => r.children.map((c) => c.id))).toEqual(['', '']);
    expect(l.diagnostics).toContainEqual(expect.objectContaining({ severity: 'note', property: 'id', message: 'cell 1: a cell’s id is ignored (cells are positional)' }));
    expect(serializeSlide(l.slide)).not.toMatch(/<t[hd] id=/);
  });
});

describe('attributes', () => {
  it('keeps data-ph, data-section, data-video*, data-group, hidden and the transition', () => {
    const l = load('<section id="s" data-section=" The plan. " hidden data-transition="Magic"><h1 data-ph="title">T</h1><div data-group=""></div><img src="/_blob/a" data-video="/_blob/clip" data-video-loop="" alt=""></section>');
    expect(l.slide.attrs).toEqual({ 'data-section': 'The plan.', hidden: '', 'data-transition': 'magic' });
    const [h1, group, img] = l.slide.children;
    expect(h1!.attrs).toEqual({ 'data-ph': 'title' });
    expect(group!.attrs).toEqual({ 'data-group': '' });
    expect(img!.attrs).toEqual({ src: '/_blob/a', 'data-video': '/_blob/clip', 'data-video-loop': '', alt: '' });
  });

  it('takes builds on pinned elements only, normalized to EFFECT [ORDER] [auto]', () => {
    const pinned = (build: string) => `<section id="s"><p id="p" style="position:absolute; left:0px; top:0px" data-build-in="${build}">x</p></section>`;
    expect(load(pinned('Rise  auto 3')).slide.children[0]!.attrs['data-build-in']).toBe('rise 3 auto');
    expect(load(pinned('pop')).slide.children[0]!.attrs['data-build-in']).toBe('pop');
    for (const bad of ['spin', 'fade 51', 'fade 0', 'fade fade', 'fade 2 3', '']) {
      const l = load(pinned(bad));
      expect(l.slide.children[0]!.attrs['data-build-in'], bad).toBeUndefined();
      expect(warnings(l)[0]?.property).toBe('data-build-in');
    }
    const flow = load('<section id="s"><p data-build-out="fade">x</p></section>');
    expect(flow.slide.children[0]!.attrs).toEqual({});
    expect(warnings(flow)[0]?.message).toBe('data-build-out applies to pinned (position:absolute) elements only; dropped');
  });

  it('checks a crop as ZOOM X% Y% with a zoom of 1 to 50', () => {
    const crop = (v: string) => load(`<section id="s"><img src="assets/a" alt="" data-crop="${v}"></section>`).slide.children[0]!.attrs['data-crop'];
    expect(crop(' 2.50  40%  60% ')).toBe('2.5 40% 60%');
    expect(crop('51 0% 0%')).toBeUndefined();
    expect(crop('2 40 60')).toBeUndefined();
  });

  it('drops a placeholder role that is not a name', () => {
    expect(load('<section id="s"><p data-ph="a b">x</p></section>').slide.children[0]!.attrs).toEqual({});
  });
});
