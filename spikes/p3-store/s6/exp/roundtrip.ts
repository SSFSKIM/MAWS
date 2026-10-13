// S6 item 2: the canonical parser and serializer. Fixed point after one pass on Claude's examples and on messy input;
// equality by meaning under formatting variants; parse5 (host) and DOMParser-shaped parsing (renderer) agree; the
// model round trip; var(--ds-*) kept, and resolved for the Claude-compatible export; held slides with reasons.
import { Window } from 'happy-dom'
import { claudeExamples, messy } from '../fixtures/claude-examples.ts'
import { parseHtmlDom } from '../src/dom-adapter.ts'
import { importSlide, readSlide } from '../src/model.ts'
import { loadSlide } from '../src/parse.ts'
import { parseHtml } from '../src/parse5-adapter.ts'
import { serializeSlide } from '../src/serialize.ts'
import * as Y from '../src/ydoc.ts'
import { Report } from './lib.ts'

const r = new Report('roundtrip')
const canon = (html: string) => { const l = loadSlide(parseHtml(html)); if (!l.ok) throw new Error('held: ' + l.held.reasons.join('; ')); return serializeSlide(l.slide) }
const win = new Window()

const corpus = { ...claudeExamples, messy }
for (const [name, html] of Object.entries(corpus)) {
  const once = canon(html)
  const twice = canon(once)
  r.check(`${name}: serialize(parse(x)) is a fixed point after one pass`, once === twice)
  const domLoad = loadSlide(parseHtmlDom(win.document as never, html))
  r.check(`${name}: the DOM adapter (renderer path) gives the same canonical file as parse5`, domLoad.ok && serializeSlide(domLoad.slide) === once)
  const doc = Y.newDoc()
  const l = loadSlide(parseHtml(html)); if (!l.ok) continue
  Y.transact(doc, () => importSlide(doc, l.slide, 'a0'))
  r.check(`${name}: IR → Y.Doc → IR → file equals the canonical file`, serializeSlide(readSlide(doc, l.slide.id)) === once)
  r.check(`${name}: diagnostics are only warnings and notes (not held)`, l.diagnostics.every((d) => d.severity === 'warning' || d.severity === 'note'), l.diagnostics.length)
}

// --- equality by meaning: formatting variants of the same slide canonicalize to the same bytes
const variants = (html: string): Record<string, string> => ({
  'attribute order reversed': html.replace(/<([a-z][a-z0-9-]*)((?:\s+[a-z-]+="[^"]*")+)\s*>/g, (_, tag: string, attrs: string) =>
    `<${tag}${(attrs.match(/\s+[a-z-]+="[^"]*"/g) ?? []).reverse().join('')}>`),
  'declaration order reversed': html.replace(/style="([^"]*)"/g, (_, s: string) => `style="${s.split(';').map((d) => d.trim()).filter(Boolean).reverse().join(';')}"`),
  'whitespace and case': html.replace(/style="([^"]*)"/g, (_, st: string) => `style="  ${st.replace(/;/g, ' ;  ').replace(/:/g, ' : ').replace(/#([0-9a-f]{6})/g, (m) => m.toUpperCase())}  "`).replace(/\n/g, '\n\n   '),
  'bare numbers for px': html.replace(/(?<![\w-])(left|top|width|height|font-size|gap)\s*:\s*(\d+)px/g, '$1:$2'),
  'rgb() for hex': html.replace(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})\b/g, (_, a: string, b: string, c: string) => `rgb(${parseInt(a, 16)}, ${parseInt(b, 16)}, ${parseInt(c, 16)})`),
  'entities': html.replace(/Source/g, '&#83;ource').replace(/→/g, '&rarr;'),
})
for (const [name, html] of Object.entries(claudeExamples)) {
  if (name === 'diagrams-connectors') continue // svg internals are opaque and kept verbatim; variants would change them
  const base = canon(html)
  for (const [v, vh] of Object.entries(variants(html))) r.check(`${name}: "${v}" canonicalizes to the same file`, canon(vh) === base)
}

// --- what normalized in the messy slide (the record for the findings)
const ml = loadSlide(parseHtml(messy))
r.log('\nmessy canonical form:\n' + canon(messy))
if (ml.ok) for (const d of ml.diagnostics) r.log(`  ${d.severity}: ${d.where}: ${d.message}`)

// --- var(--ds-*) superset (Decision Log 12) through the round trip, and the resolving export
const tokens = `<section id="tok" style="background:var(--ds-color-bg); font-family:var(--ds-font-body)">
<h2 style="color:var(--ds-color-accent, #C00); padding:var(--ds-space-4) var(--ds-space-6); font-size:var(--ds-type-h2-size)">T</h2>
<div style="gap:var(--ds-space-3); border:2px solid var(--ds-color-border); background:var(--x-other)"></div></section>`
const tl = loadSlide(parseHtml(tokens))
const tOnce = canon(tokens)
r.check('var(--ds-*): kept through parse/serialize, fixed point', tOnce === canon(tOnce) && (tOnce.match(/var\(--ds-/g) ?? []).length === 8, tOnce.match(/var\([^)]*\)/g))
r.check('var() outside --ds-* dropped with a warning', tl.diagnostics.some((d) => d.severity === 'warning' && d.message.includes('--x-other')))
const resolved = tl.ok ? serializeSlide(tl.slide, { resolveVar: (n) => ({ '--ds-color-bg': '#fbfbf8', '--ds-color-accent': '#2b7a78', '--ds-space-4': '32px' } as Record<string, string>)[n] }) : ''
r.check('the Claude-compatible export resolves tokens to literals (fallback when unresolved)', !resolved.includes('var(') && resolved.includes('color:#2b7a78') && resolved.includes('background:#fbfbf8'), resolved.match(/style="[^"]*"/g)?.slice(0, 2))

// --- held: structural failures are held with reasons, never trimmed
const held: Record<string, string> = {
  'two sections': '<section id="a"></section><section id="b"></section>',
  'unknown tag': '<section id="a"><iframe src="x"></iframe></section>',
  'text directly in a div': '<section id="a"><div>loose text</div></section>',
  'aside not last': '<section id="a"><aside>n</aside><p>after</p></section>',
  'nested list': '<section id="a"><ul><li>a<ul><li>b</li></ul></li></ul></section>',
  'embed inside a div': '<section id="a"><div><x-embed style="position:absolute;left:0;top:0;width:10px;height:10px">x</x-embed></div></section>',
  'svg with script': '<section id="a"><svg><script>alert(1)</script></svg></section>',
  'colspan': '<section id="a"><table><tr><td colspan="2">x</td></tr></table></section>',
  '16 nested divs': `<section id="a">${'<div>'.repeat(16)}${'</div>'.repeat(16)}</section>`,
  '201 elements': `<section id="a">${'<p>x</p>'.repeat(201)}</section>`,
  'bad section id': '<section id="a b"></section>',
  'unknown inline tag': '<section id="a"><p>a <code>b</code></p></section>',
}
for (const [name, html] of Object.entries(held)) {
  const l = loadSlide(parseHtml(html))
  r.check(`held: ${name}`, !l.ok, l.ok ? 'NOT HELD' : l.held.reasons)
}
const fileMismatch = loadSlide(parseHtml('<section id="a"></section>'), { fileId: 'b' })
r.check('held: section id differs from the file name', !fileMismatch.ok)
// dropped, not held: unknown properties and attributes
const dropped = loadSlide(parseHtml('<section id="a" onclick="x()"><p style="float:left; z-index:2; color:red" title="t" data-foo="1">a</p></section>'))
r.check('unknown properties and attributes are dropped with diagnostics, the slide loads',
  dropped.ok && dropped.diagnostics.filter((d) => d.severity === 'warning').length === 4, dropped.diagnostics.map((d) => `${d.severity}: ${d.message}`))

// --- ids: minted when absent, kept when present, deterministic under the same seed, distinct across seeds
const noIds = '<section id="s"><p>a</p><p id="keep">b</p><p>c</p></section>'
const a1 = loadSlide(parseHtml(noIds), { seed: 'rev7' }), a2 = loadSlide(parseHtml(noIds), { seed: 'rev7' }), a3 = loadSlide(parseHtml(noIds), { seed: 'rev8' })
const ids = (l: typeof a1) => (l.ok ? l.slide.children.map((c) => c.id) : [])
r.check('minted ids: e<n>-<hash>, authored ids kept, same seed → same ids (idempotent replay)', JSON.stringify(ids(a1)) === JSON.stringify(ids(a2)) && ids(a1)[1] === 'keep' && /^e\d+-[0-9a-z]{4}$/.test(ids(a1)[0]), ids(a1))
r.check('minted ids: a different seed (a later publish) mints different ids', ids(a1)[0] !== ids(a3)[0], [ids(a1)[0], ids(a3)[0]])
const taken = loadSlide(parseHtml(noIds), { seed: 'rev7', taken: new Set([ids(a1)[0]]) })
r.check('minted ids never reuse an id the live slide holds', ids(taken)[0] !== ids(a1)[0], ids(taken))

r.write()
