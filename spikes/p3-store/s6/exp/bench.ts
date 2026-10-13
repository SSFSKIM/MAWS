// S6 item 6: numbers on a 100-slide deck of realistic slides (seven shapes modelled on Claude's examples).
import { performance } from 'node:perf_hooks'
import { claudeExamples } from '../fixtures/claude-examples.ts'
import { deckFiles, readFlat, setStyle } from '../src/model.ts'
import { loadSlide } from '../src/parse.ts'
import { parseHtml } from '../src/parse5-adapter.ts'
import { publish } from '../src/publish.ts'
import { serializeSlide } from '../src/serialize.ts'
import * as Y from '../src/ydoc.ts'
import { Report } from './lib.ts'

const r = new Report('bench')
const words = 'pipeline revenue onboarding retention latency quarter forecast margin cohort launch hiring roadmap'.split(' ')
const w = (i: number, n = 3) => Array.from({ length: n }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(' ')
const foot = (i: number) => `<p style="position:absolute; left:128px; bottom:64px; font-size:24px; color:#6a7179">Source: ${w(i, 2)} review, slide ${i}</p>`

const shapes: ((id: string, i: number) => string)[] = [
  (id, i) => `<section id="${id}" data-transition="fade" style="background:linear-gradient(135deg, #0f2a3d, #2b7a78); color:#fbfbf8; padding:128px; display:flex; flex-direction:column; justify-content:center; gap:32px">
<img src="/_blob/logo${i}" alt="" style="position:absolute; right:128px; top:96px; width:160px; height:64px; object-fit:contain">
<h1 style="font-family:'Source Serif 4', Georgia, serif; font-size:120px; line-height:1.05; letter-spacing:-2px">The ${w(i)} plan</h1>
<p style="font-size:40px; color:#cfe3e2">${w(i + 1, 6)} for <b>Q${(i % 4) + 1}</b></p>
${foot(i)}<aside>Open with the ${w(i, 2)} story; ${w(i + 3, 8)}.</aside></section>`,
  (id, i) => claudeExamples['layout-kpis'].replace('id="kpis"', `id="${id}"`).replace('41%', `${20 + i}%`).replace('faster ramp', w(i, 2)),
  (id, i) => claudeExamples['skill-plan'].replace('id="plan"', `id="${id}"`).replace('Changes', `Changes in ${w(i, 1)}`),
  (id, i) => `<section id="${id}" style="background:#fbfbf8; color:#1a1a1a; padding:128px 128px 160px; display:flex; flex-direction:column; gap:40px">
<h2 style="font-size:72px; font-weight:600">${w(i)}</h2>
<ul style="font-size:36px; line-height:1.4">${Array.from({ length: 5 }, (_, k) => `<li><b>${w(i + k, 1)}:</b> ${w(i + k + 1, 6)} <span style="color:#2b7a78">${w(i + k + 2, 1)}</span></li>`).join('')}</ul>
${foot(i)}</section>`,
  (id, i) => `<section id="${id}" style="background:#ffffff; padding:128px; display:flex; flex-direction:column; gap:32px">
<h2 style="font-size:64px">${w(i)} by region</h2>
<table style="font-size:28px; color:#1a1a1a"><tr style="background:#eef2f1">${['Region', 'Q1', 'Q2', 'Q3'].map((h) => `<th style="width:25%">${h}</th>`).join('')}</tr>${Array.from({ length: 5 }, (_, k) => `<tr><td>${w(i + k, 1)}</td><td>${(i * k) % 97}</td><td>${(i + k * 13) % 89}</td><td>${(i * 3 + k) % 71}</td></tr>`).join('')}</table>
${foot(i)}</section>`,
  (id, i) => `<section id="${id}" style="background:#fbfbf8; padding:128px; display:flex; flex-direction:column; gap:40px">
<h2 style="font-size:64px">${w(i)} flow</h2>
<div style="position:relative; width:1664px; height:700px">
<svg style="position:absolute; left:0; top:0" width="1664" height="700" viewBox="0 0 1664 700"><path d="M 320 60 Q 608 180 888 60" fill="none" stroke="#2b7a78" stroke-width="4"/></svg>
${Array.from({ length: 8 }, (_, k) => `<div style="position:absolute; left:${(k % 4) * 420}px; top:${Math.floor(k / 4) * 360}px; width:320px; height:120px; background:#ffffff; border:1px solid #e3e6e4; border-radius:16px; padding:24px"><p style="font-size:28px">${w(i + k, 2)}</p></div>`).join('\n')}
${Array.from({ length: 6 }, (_, k) => `<x-connector x1="${(k % 3) * 420 + 320}" y1="${Math.floor(k / 3) * 360 + 60}" x2="${(k % 3) * 420 + 420}" y2="${Math.floor(k / 3) * 360 + 60}"></x-connector>`).join('\n')}
</div>
${foot(i)}</section>`,
  (id, i) => `<section id="${id}" style="background:#ffffff; padding:128px; display:flex; flex-direction:column; gap:48px">
<h2 style="font-size:64px">${w(i)}</h2>
<div style="display:flex; gap:64px">${[0, 1].map((k) => `<div style="flex:1; display:flex; flex-direction:column; gap:16px"><h3 style="font-size:40px">${w(i + k, 2)}</h3><p style="font-size:30px; line-height:1.4">${w(i + k, 12)} <a href="https://example.com/${i}">${w(i, 1)}</a> <i>${w(i + 5, 3)}</i>.</p></div>`).join('')}</div>
${foot(i)}<aside>${w(i, 20)}</aside></section>`,
]
const N = 100
const ids = Array.from({ length: N }, (_, i) => `s${String(i + 1).padStart(3, '0')}`)
const files: Record<string, string> = { 'project/deck.json': JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-12T18:00:00Z' }, lists: 'css', title: 'Bench', cover: ids[0], order: ids, faces: {}, designSystems: [] }) }
ids.forEach((id, i) => { files[`project/slides/${id}.html`] = shapes[i % shapes.length](id, i) })
const srcBytes = Object.values(files).reduce((n, s) => n + Buffer.byteLength(s), 0)
r.num('deck: slides, source bytes', { slides: N, bytes: srcBytes })

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
function time(fn: () => void, runs = 7): number { const t: number[] = []; for (let k = 0; k < runs; k++) { const s = performance.now(); fn(); t.push(performance.now() - s) } return Math.round(median(t) * 100) / 100 }

const slideFiles = ids.map((id) => files[`project/slides/${id}.html`])
let irs = slideFiles.map((f) => { const l = loadSlide(parseHtml(f)); if (!l.ok) throw new Error(l.held.reasons.join()); return l.slide })
const elements = irs.reduce((n, s) => { let c = 0; const v = (es: typeof s.children) => { for (const e of es) { c++; v(e.children) } }; v(s.children); return n + c }, 0)
r.num('deck: elements (incl. rows and cells)', elements)
time(() => { irs = slideFiles.map((f) => (loadSlide(parseHtml(f)) as { slide: typeof irs[0] }).slide) }, 3) // warm-up
r.num('parse 100 slide files (parse5 + loader), ms median of 7', time(() => { irs = slideFiles.map((f) => (loadSlide(parseHtml(f)) as { slide: typeof irs[0] }).slide) }))
r.num('serialize 100 slides (canonical), ms median of 7', time(() => { for (const s of irs) serializeSlide(s) }))
const canon = irs.map((s) => serializeSlide(s))
r.check('the generated deck is a fixed point after one pass', canon.every((c) => serializeSlide((loadSlide(parseHtml(c)) as { slide: typeof irs[0] }).slide) === c))

let doc = Y.newDoc(1)
r.num('import: publish the whole deck into an empty doc (one transaction), ms median of 7', time(() => { doc = Y.newDoc(1); publish(doc, files, { seed: 'b' }) }))
const v2 = Y.encodeStateV2(doc), v1 = Y.encodeStateV1(doc)
r.num('Y.Doc state size: V2 bytes, V1 bytes, ratio V2/source', { v2: v2.length, v1: v1.length, v2OverSource: Math.round((v2.length / srcBytes) * 100) / 100 })
r.num('load: apply the V2 state into a fresh doc (a replica\'s first sync), ms median of 7', time(() => { const d = Y.newDoc(); Y.applyUpdateV2(d, v2) }))
r.num('encode the V2 state, ms median of 7', time(() => { Y.encodeStateV2(doc) }))
let out: Record<string, string> = {}
r.num('read: the whole deck back to files (artifact_read), ms median of 7', time(() => { out = deckFiles(doc) }))
r.num('no-op republish of all 101 files (diff 100 slides, 0 writes), ms median of 7', time(() => { const res = publish(doc, out, { seed: 'n' }); if (res.writes !== 0) throw new Error('not a no-op') }))

// updates on the 100-slide doc
const sizes = (fn: () => void) => { const a: Uint8Array[] = [], b: Uint8Array[] = []; const o1 = Y.onUpdate(doc, (u) => a.push(u)), o2 = Y.onUpdateV2(doc, (u) => b.push(u)); fn(); o1(); o2(); return { v1: a.reduce((n, u) => n + u.length, 0), v2: b.reduce((n, u) => n + u.length, 0), updates: a.length } }
const pinned = readFlat(doc, ids[5], false).find((e) => e.style.position === 'absolute' && e.tag === 'div')!
r.num('update: move (style:left + style:top, one transaction)', sizes(() => setStyle(doc, ids[5], pinned.id, { left: '432px', top: '18px' })))
r.num('update: a second move of the same element', sizes(() => setStyle(doc, ids[5], pinned.id, { left: '440px', top: '20px' })))
const para = readFlat(doc, ids[6]).find((e) => e.tag === 'p' && e.text?.[0]?.inline.length)!
const t0 = para.text![0].inline as { text: string; marks: object }[]
r.num('update: a text edit (one character typed into a paragraph)', sizes(() => Y.transact(doc, () => Y.patchText(doc, ids[6], para.id, [{ type: 'p', inline: [{ ...t0[0], text: t0[0].text + 'x' }, ...t0.slice(1)] }]))))
const one = deckFiles(doc)[`project/slides/${ids[5]}.html`].replace('font-size:64px', 'font-size:66px')
let pubRes: ReturnType<typeof publish> | undefined
r.num('publish one slide with one property changed on the 100-slide doc: ms median of 7 (first run writes, rest are no-ops)', time(() => { pubRes = publish(doc, { [`project/slides/${ids[5]}.html`]: one }, { seed: 'o' }) }))
r.check('… and the deck still reads back canonical after all writes', Object.entries(deckFiles(doc)).every(([p, c]) => !p.endsWith('.html') || serializeSlide((loadSlide(parseHtml(c)) as { slide: typeof irs[0] }).slide) === c), pubRes?.writes)
r.num('Y.Doc V2 state after the edits', Y.encodeStateV2(doc).length)

r.write()
