// v14 only: can v14's native attributions (ContentMaps built per update from the host's author log, S1's shape) carry
// per-element provenance for the deck's history? Two stored V2 states of a gc-on host doc, the log window between
// them, a DiffRenderer over the deck: which elements changed, which properties, by whom and when.
import * as Y from '@y/y'
import { claudeExamples } from '../fixtures/claude-examples.ts'
import { deckFiles, deleteElementTree, setStyle } from '../src/model.ts'
import { publish } from '../src/publish.ts'
import * as M from '../src/ydoc.ts'
import { Report } from './lib.ts'

const r = new Report('provenance')
const H = M.newDoc(1)
const log: { seq: number; actor: string; at: number; v2: Uint8Array }[] = []
let clock = Date.parse('2026-10-12T19:00:00Z')
/** The host applies a replica's update and logs it with its actor (the artifact_updates row). */
function land(from: M.Doc, actor: string, fn: () => void) {
  M.pull(from, H)
  const sv = M.stateVector(from)
  fn()
  const v2 = Y.encodeStateAsUpdateV2(from, sv)
  if (v2.length > 2) { Y.applyUpdateV2(H, v2, actor); log.push({ seq: log.length + 1, actor, at: (clock += 60_000), v2 }) }
}
const agent = M.newDoc(10), human = M.newDoc(20), agent2 = M.newDoc(30)
land(agent, 'session:A', () => publish(agent, { 'project/deck.json': JSON.stringify({ v: 4, title: 'P', order: ['plan'] }), 'project/slides/plan.html': claudeExamples['skill-plan']
  .replace('<h2 ', '<h2 id="title" ').replace('<p style="position:absolute', '<p id="foot" style="position:absolute').replace('<img ', '<img id="pic" ').replace('<h3 ', '<h3 id="card" ') }, { seed: 'a' }))
const v1 = Y.encodeStateAsUpdateV2(H), seq1 = log.length
land(human, 'human', () => setStyle(human, 'plan', 'foot', { left: '200px', bottom: '80px' }))
land(agent2, 'session:B', () => {
  const f = deckFiles(agent2)['project/slides/plan.html']
  publish(agent2, { 'project/slides/plan.html': f.replace('font-size:72px', 'font-size:80px').replace('>One path<', '>One clear path<')
    .replace('  <aside>', '  <p id="note" style="position:absolute; right:128px; top:64px; font-size:24px">Draft</p>\n  <aside>') }, { seed: 'b' })
})
land(human, 'human', () => deleteElementTree(human, 'plan', 'pic'))
const v2 = Y.encodeStateAsUpdateV2(H)
const window = log.filter((e) => e.seq > seq1)
r.log('log window: ' + window.map((e) => `${e.seq}:${e.actor} ${e.v2.length}B`).join(', '))

const t0 = performance.now()
const attributions = Y.mergeContentMaps(window.map((e) => Y.createContentMapFromContentIds(
  Y.createContentIdsFromUpdateV2(e.v2),
  [Y.createContentAttribute('insert', e.actor), Y.createContentAttribute('insertAt', e.at)],
  [Y.createContentAttribute('delete', e.actor), Y.createContentAttribute('deleteAt', e.at)],
)))
const prevDoc = new Y.Doc({ gc: false }); Y.applyUpdateV2(prevDoc, v1)
const nextDoc = new Y.Doc({ gc: false }); Y.applyUpdateV2(nextDoc, v2)
const renderer = Y.createDiffRenderer(prevDoc, nextDoc, { attributions })
const delta = nextDoc.get('slides').toDeltaDeep({ renderer }).toJSON() as Record<string, unknown>
const ms = performance.now() - t0
r.num('attributed deck diff: ms, encoded ContentMap bytes', { ms: Math.round(ms * 10) / 10, contentMapBytes: Y.encodeContentMap(attributions).length })

// walk the attributed delta: with a renderer, toDeltaDeep returns the whole current document and puts `attribution` on
// exactly the leaves the window changed (a deleted element comes back as content attributed {delete, deleteAt})
type Op = { type: string; value?: unknown; insert?: unknown; attribution?: Record<string, unknown> }
type D = { attrs?: Record<string, Op>; children?: Op[] }
const rows: string[] = []
const short = (a: Record<string, unknown>) => Object.entries(a).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : new Date(v as number).toISOString().slice(11, 16)}`).join(' ')
function collect(d: D, path: string) {
  for (const [k, op] of Object.entries(d.attrs ?? {})) {
    const here = path ? `${path}.${k}` : k
    if (op.attribution) rows.push(`${here} = ${typeof op.value === 'object' ? '<node>' : JSON.stringify(op.value)}  [${short(op.attribution)}]`)
    if (op.value && typeof op.value === 'object') collect(op.value as D, here)
  }
  for (const op of d.children ?? []) {
    if (op.attribution) rows.push(`${path}#text ${JSON.stringify(typeof op.insert === 'string' ? op.insert : '<node>')}  [${short(op.attribution)}]`)
    if (Array.isArray(op.insert)) for (const c of op.insert) if (c && typeof c === 'object') collect(c as D, path)
  }
}
collect(delta as D, '')
const prefix = 'plan.elements.'
for (const row of rows) r.log('  ' + row)
r.log('raw attributed delta (first 1500 chars): ' + JSON.stringify(delta).slice(0, 1500))
const els = rows.filter((x) => x.startsWith(prefix)).map((x) => x.slice(prefix.length))
const has = (re: RegExp) => els.some((x) => re.test(x))
const of = (id: string) => els.filter((x) => x.startsWith(id))
r.check('the human\'s move: foot.style:left and style:bottom attributed to the human with a time', has(/^foot\.style:left = "200px" +\[insert=human insertAt=/) && has(/^foot\.style:bottom = "80px" +\[insert=human/), of('foot'))
r.check('the agent\'s restyle: title.style:font-size attributed to session:B', has(/^title\.style:font-size = "80px" +\[insert=session:B/), of('title'))
r.check('the agent\'s text edit in card: attributed inside the text delta', has(/^card\.text#text "clear " +\[insert=session:B/), of('card'))
r.check('the agent\'s new element note: an insert attributed to session:B', has(/^note = <node> +\[insert=session:B/), of('note'))
r.check('the human\'s deletion of pic: a delete attributed to the human', has(/^pic = <node> +\[delete=human deleteAt=/), of('pic'))
r.check('untouched elements and the slide\'s own keys carry no attribution', !has(/^e\d/) && !rows.some((x) => !x.startsWith(prefix)), rows.filter((x) => !x.startsWith(prefix) || /^e\d/.test(x.slice(prefix.length))))
const touched = [...new Set(els.map((x) => x.split(/[.# ]/)[0]))].sort().join(',')
r.check('the attributed elements are exactly the ones the window changed (per-element provenance, no noise)', touched === 'card,foot,note,pic,title', touched)
r.write()
