// S7a: the timing bounds re-measured on a finished soak store (6 months), medians of several runs, apart from the soak
// so a busy machine during the soak does not decide them. Opens the store as the host would: the live doc is the load.
// Usage: node spikes/p3-store/s7/soak/bench.mjs doc-normal-delta [runs=7]
import * as Y from '@y/y'
import { ynodeToPmnode } from '@y/prosemirror'
import { performance } from 'node:perf_hooks'
import { writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import { Store, DAY } from './store.mjs'
import { schemaFor, attributedNodes } from './doc/schema.mjs'
import { openDiff, renderDiff, changeList, showEditors } from './doc/history.mjs'
import { revertUpdateFixed as revertUpdate } from './revert.mjs'

const tag = process.argv[2] ?? 'doc-normal-delta'
const runs = Number(process.argv[3] ?? 7)
const kind = tag.split('-')[0]; const encoding = tag.split('-')[2]
const store = new Store(`/tmp/p3-s7a/${tag}.sqlite`, { encoding }, { fresh: false })
const med = xs => { const s = [...xs].sort((a, b) => a - b); return +s[Math.floor(s.length / 2)].toFixed(1) }
const p90 = xs => { const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(s.length * 0.9))].toFixed(1) }
const time = (fn, n = runs) => { const t = []; let x; for (let k = 0; k < n; k++) { const t0 = performance.now(); x = fn(); t.push(performance.now() - t0) } return { ms: med(t), p90: p90(t), x } }
const out = { tag, loadavgStart: loadavg(), runs }

const load = time(() => { const l = store.load(); l.doc.destroy(); return l.tailRows })
out.load = { ms: load.ms, p90: load.p90, tailRows: load.x }
const { doc: live } = store.load()
const vs = store.versions()
const newest = vs.at(-1)
const target = [...vs].reverse().find(v => v.at <= newest.at - 90 * DAY)
out.versions = vs.length
out.target = { at: new Date(target.at).toISOString(), kind: target.kind, enc: target.enc }
const steps = {}
const step = (k, fn) => { const r = time(fn); steps[k] = r.ms; return r.x }
const prevState = step('state', () => store.stateAt(target.seq).state)
const nextState = step('encodeLive', () => Y.encodeStateAsUpdateV2(live))
const attrs = step('attributions', () => store.attributions(target.seq))
out.provenanceRowsInWindow = attrs.rows
if (kind === 'doc') {
  const schema = schemaFor({ uniqueId: false })
  const pick = d => d.get('tabs').getAttr('t1').getAttr('body')
  const tot = time(() => {
    const s = store.stateAt(target.seq).state; const n = Y.encodeStateAsUpdateV2(live); const a = store.attributions(target.seq)
    const diff = openDiff({ prevState: s, nextState: n, attributions: a.map, pick }); const pm = renderDiff(diff, schema, attributedNodes); const c = changeList(pm).length; diff.destroy(); return c
  })
  step('openDiff', () => { const d = openDiff({ prevState, nextState, attributions: attrs.map, pick }); d.destroy() })
  const diff = openDiff({ prevState, nextState, attributions: attrs.map, pick })
  step('render', () => renderDiff(diff, schema, attributedNodes))
  diff.destroy()
  out.preview = { totalMs: tot.ms, p90: tot.p90, changes: tot.x, steps }
  // Show editors on 20 paragraphs of the live doc
  const body = pick(live)
  const merge = time(() => store.attributions(0).map)
  const prov = merge.x
  const pmDoc = ynodeToPmnode(body, schema)
  const ranges = []; pmDoc.forEach((n, off) => { if (n.type.name === 'paragraph' && n.content.size > 40 && ranges.length < 400) ranges.push([off + 1, off + 1 + n.content.size]) })
  const sel = ranges.filter((_, i) => i % 20 === 0).slice(0, 20)
  const per = sel.map(([a, b]) => time(() => showEditors({ pmDoc, from: a, to: b, liveRoot: body, provenance: prov }), 3).ms)
  const toPm = time(() => ynodeToPmnode(body, schema), 3)
  out.showEditors = { mergeAllProvenanceMs: merge.ms, perSelectionMedianMs: med(per), perSelectionMaxMs: Math.max(...per), liveToPmMs: toPm.ms }
} else {
  const tot = time(() => {
    const s = store.stateAt(target.seq).state; const n = Y.encodeStateAsUpdateV2(live); const a = store.attributions(target.seq)
    const p = new Y.Doc({ gc: false }); Y.applyUpdateV2(p, s); const q = new Y.Doc({ gc: false }); Y.applyUpdateV2(q, n)
    const renderer = Y.createDiffRenderer(p, q, { attributions: a.map }); const d = q.get('slides').toDeltaDeep({ renderer }).toJSON(); renderer.destroy(); p.destroy(); q.destroy(); return Object.keys(d.attrs ?? {}).length
  })
  out.preview = { totalMs: tot.ms, p90: tot.p90, slidesInDelta: tot.x, steps }
  const merge = time(() => store.attributions(0).map)
  out.showEditors = { mergeAllProvenanceMs: merge.ms }
}
const rs = time(() => revertUpdate(prevState, nextState).length)
out.restore = { ms: rs.ms, p90: rs.p90, bytes: rs.x }
out.versionList = time(() => store.versions().length).ms
out.loadavgEnd = loadavg()
console.log(JSON.stringify(out, null, 1))
writeFileSync(new URL(`../out/bench-${tag}.json`, import.meta.url), JSON.stringify(out, null, 1))
process.exit(0)
