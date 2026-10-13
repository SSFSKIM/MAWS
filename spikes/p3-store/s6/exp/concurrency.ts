// S6 item 4: concurrency on two replicas. Every scenario: a common base, concurrent operations on A and B, a sync in
// both directions, then convergence (both replicas serialize to the same deck files) and the scenario's outcome. Each
// scenario repeats over many random client-id pairs, since Yjs breaks concurrent ties by client id.
import * as YJS from 'yjs' // only for the v13 XmlFragment contrast below; the model goes through src/ydoc.ts
import * as Y14 from '@y/y' // only for the v14 child-list contrast below
import { deckFiles, deleteElementTree, moveInto, moveSlide, readFlat, readSlide, repair, resolveAnchor, setStyle, slideOrder, zOrder } from '../src/model.ts'
import { publish } from '../src/publish.ts'
import * as Y from '../src/ydoc.ts'
import { Report, YJS as VERSION } from './lib.ts'

const r = new Report('concurrency')
const TRIALS = 200
const BASE = `<section id="s1" style="background:#ffffff; padding:128px">
  <div id="bg" style="position:absolute; left:0px; top:0px; width:1920px; height:1080px; background:#eeeeee"></div>
  <h2 id="title" style="font-size:64px">Title</h2>
  <div id="g1" style="position:absolute; left:100px; top:600px; width:800px; height:300px" data-group="g"></div>
  <div id="g2" style="position:absolute; left:1000px; top:600px; width:800px; height:300px" data-group="g"></div>
  <p id="e1" style="position:absolute; left:100px; top:300px; width:400px; color:#111111">One</p>
  <p id="e2" style="position:absolute; left:600px; top:300px; width:400px">Two</p>
</section>`
const SLIDE = (id: string) => `<section id="${id}" style="background:#ffffff"><h2 id="h-${id}">${id}</h2></section>`

function base(): Y.Doc {
  const d = Y.newDoc(1)
  publish(d, {
    'project/deck.json': JSON.stringify({ v: 4, title: 'T', order: ['s1', 's2', 's3', 's4'] }),
    'project/slides/s1.html': BASE, 'project/slides/s2.html': SLIDE('s2'), 'project/slides/s3.html': SLIDE('s3'), 'project/slides/s4.html': SLIDE('s4'),
  })
  return d
}
const BASE_STATE = Y.encodeStateV1(base())
function pair(): [Y.Doc, Y.Doc] {
  const ids = new Set<number>(); while (ids.size < 2) ids.add(2 + Math.floor(Math.random() * 2 ** 31))
  const [ca, cb] = [...ids]
  const a = Y.newDoc(ca), b = Y.newDoc(cb)
  Y.applyUpdate(a, BASE_STATE); Y.applyUpdate(b, BASE_STATE)
  return [a, b]
}
function sync(a: Y.Doc, b: Y.Doc): void { Y.pull(a, b); Y.pull(b, a) }
const files = (d: Y.Doc) => JSON.stringify(deckFiles(d))
const el = (d: Y.Doc, id: string, s = 's1') => readFlat(d, s).find((e) => e.id === id)

type Outcome = Record<string, number>
function run(name: string, scenario: (a: Y.Doc, b: Y.Doc) => string, expect: (o: Outcome) => boolean): void {
  const outcomes: Outcome = {}; let converged = 0
  for (let i = 0; i < TRIALS; i++) {
    const [a, b] = pair()
    const o = scenario(a, b)
    if (files(a) === files(b)) converged++
    outcomes[o] = (outcomes[o] ?? 0) + 1
  }
  r.check(`${name}: converged in ${converged}/${TRIALS}`, converged === TRIALS)
  r.check(`${name}: outcome`, expect(outcomes), outcomes)
}

// 1. both move one element: the result is ONE replica's whole position, never A's left with B's top
run('concurrent move (both set left/top)', (a, b) => {
  setStyle(a, 's1', 'e1', { left: '111px', top: '222px' }); setStyle(b, 's1', 'e1', { left: '333px', top: '444px' })
  sync(a, b)
  const s = el(a, 'e1')!.style
  return s.left === '111px' && s.top === '222px' ? 'A whole' : s.left === '333px' && s.top === '444px' ? 'B whole' : `MIXED ${s.left},${s.top}`
}, (o) => !Object.keys(o).some((k) => k.startsWith('MIXED')) && (o['A whole'] ?? 0) > 0 && (o['B whole'] ?? 0) > 0)

// 1b. the same with each replica writing left and top in separate transactions (a drag's successive frames)
run('concurrent move, left and top in separate transactions', (a, b) => {
  setStyle(a, 's1', 'e1', { left: '111px' }); setStyle(a, 's1', 'e1', { top: '222px' })
  setStyle(b, 's1', 'e1', { top: '444px' }); setStyle(b, 's1', 'e1', { left: '333px' })
  sync(a, b)
  const s = el(a, 'e1')!.style
  return s.left === '111px' && s.top === '222px' ? 'A whole' : s.left === '333px' && s.top === '444px' ? 'B whole' : 'MIXED'
}, (o) => !o.MIXED)

// 2. move + restyle of one element: both land
run('concurrent move + restyle of one element', (a, b) => {
  setStyle(a, 's1', 'e1', { left: '111px', top: '222px' }); setStyle(b, 's1', 'e1', { color: '#ff0000', 'font-size': '40px' })
  sync(a, b)
  const s = el(a, 'e1')!.style
  return s.left === '111px' && s.top === '222px' && s.color === '#ff0000' && s['font-size'] === '40px' ? 'both' : 'lost'
}, (o) => o.both === TRIALS)

// 3a. concurrent z-order, two different maxima (A: e1 over e2; B: e2 over e1 — B's is a no-op key): deterministic, no tie
run('concurrent z-order (A: e1 to front, B: e2 to front)', (a, b) => {
  zOrder(a, 's1', 'e1', 'front'); zOrder(b, 's1', 'e2', 'front')
  sync(a, b)
  return `order ${readSlide(a, 's1').children.map((c) => c.id).join(',')}|keys distinct ${el(a, 'e1')!.z !== el(a, 'e2')!.z}`
}, (o) => o['order bg,title,g1,g2,e2,e1|keys distinct true'] === TRIALS)

// 3b. concurrent z-order with the same maximum: both mint the same key → tie broken by id; both replicas repair identically
run('concurrent z-order, same key minted (A: e1 to front, B: g1 to front)', (a, b) => {
  zOrder(a, 's1', 'e1', 'front'); zOrder(b, 's1', 'g1', 'front')
  sync(a, b)
  const tie = el(a, 'e1')!.z === el(a, 'g1')!.z
  const ord = readSlide(a, 's1').children.map((c) => c.id).join(',')
  const wa = repair(a), wb = repair(b) // both replicas repair the same state independently
  const sameRepair = el(a, 'g1')!.z === el(b, 'g1')!.z && el(a, 'e1')!.z === el(b, 'e1')!.z
  sync(a, b)
  const ord2 = readSlide(a, 's1').children.map((c) => c.id).join(',')
  return `${tie ? 'same key' : 'distinct'}|order ${ord}|repair writes ${wa}+${wb}, identical ${sameRepair}|after repair ${ord2 === ord ? 'same order' : 'CHANGED'}|keys distinct ${el(a, 'e1')!.z !== el(a, 'g1')!.z}`
}, (o) => o['same key|order bg,title,g2,e2,e1,g1|repair writes 1+1, identical true|after repair same order|keys distinct true'] === TRIALS)

// 3b. z-order against a concurrent flow insertion: a backdrop sent to the back stays under the flow layer
run('send-to-back vs a concurrent new first flow child', (a, b) => {
  zOrder(a, 's1', 'e2', 'back')
  const f = deckFiles(b)['project/slides/s1.html'].replace('  <h2 id="title"', '  <p id="newfirst">New</p>\n  <h2 id="title"')
  publish(b, { 'project/slides/s1.html': f })
  sync(a, b)
  const kids = readSlide(a, 's1').children.map((c) => c.id)
  return kids.indexOf('e2') < kids.indexOf('newfirst') ? 'backdrop under the flow layer' : 'backdrop OVER flow (would hide text)'
}, (o) => o['backdrop under the flow layer'] === TRIALS)

// 4. slide re-order: the same slide moved two ways → one wins, no duplicate; different slides to the same gap → tie + repair
run('concurrent re-order of the same slide (A: s3 first, B: s3 after s4)', (a, b) => {
  moveSlide(a, 's3', null); moveSlide(b, 's3', 's4')
  sync(a, b)
  const ord = slideOrder(a)
  return `${ord.length === 4 && new Set(ord).size === 4 ? 'no duplicate' : 'DUPLICATE'} ${ord.join(',')}`
}, (o) => Object.keys(o).every((k) => k.startsWith('no duplicate')))
run('two slides moved to the same gap (A: s3 after s1, B: s4 after s1): same key minted', (a, b) => {
  moveSlide(a, 's3', 's1'); moveSlide(b, 's4', 's1')
  sync(a, b)
  const k3 = Y.slideScalars(a, 's3').order, k4 = Y.slideScalars(a, 's4').order
  const ord = slideOrder(a).join(',')
  const w = repair(a); repair(b); sync(a, b)
  return `${k3 === k4 ? 'same key' : 'distinct'}|${ord}|repair ${w}|${slideOrder(a).join(',') === ord ? 'order kept' : 'CHANGED'}|distinct after ${Y.slideScalars(a, 's3').order !== Y.slideScalars(a, 's4').order}`
}, (o) => Object.keys(o).every((k) => k.startsWith('same key|s1,s3,s4,s2') && k.endsWith('order kept|distinct after true')))

// 5. delete vs edit: the delete wins, the edit (style and text) is gone, the anchor is orphaned
run('concurrent delete of an element vs an edit to it', (a, b) => {
  deleteElementTree(a, 's1', 'e1')
  setStyle(b, 's1', 'e1', { color: '#ff0000' }); Y.transact(b, () => Y.patchText(b, 's1', 'e1', [{ type: 'p', inline: [{ text: 'One edited', marks: {} }] }]))
  sync(a, b)
  return `${el(a, 'e1') ? 'ALIVE' : 'deleted'} anchor ${resolveAnchor(a, { slideId: 's1', elementId: 'e1' }).live ? 'live' : 'orphaned'}`
}, (o) => o['deleted anchor orphaned'] === TRIALS)

// 6. element moved into a group concurrently with the element's deletion
run('move into a group vs deletion of the element', (a, b) => {
  moveInto(a, 's1', 'e1', 'g1'); deleteElementTree(b, 's1', 'e1')
  sync(a, b)
  return `${el(a, 'e1') ? 'ALIVE' : 'deleted'} g1 ${el(a, 'g1') ? 'intact' : 'GONE'}`
}, (o) => o['deleted g1 intact'] === TRIALS)

// 7. element moved into a group concurrently with the group's deletion → orphan → shown at the section, repaired
run('move into a group vs deletion of the group', (a, b) => {
  moveInto(a, 's1', 'e1', 'g1'); deleteElementTree(b, 's1', 'g1')
  sync(a, b)
  const stored = el(a, 'e1')!.parent
  const shown = readSlide(a, 's1').children.some((c) => c.id === 'e1')
  const w = repair(a); repair(b); sync(a, b)
  return `stored parent ${stored || 'section'}|shown at section ${shown}|repair ${w}|after ${el(a, 'e1')!.parent || 'section'}`
}, (o) => o['stored parent g1|shown at section true|repair 1|after section'] === TRIALS)

// 8. a parent cycle: A moves g1 into g2, B moves g2 into g1
run('concurrent cycle (A: g1 into g2, B: g2 into g1)', (a, b) => {
  moveInto(a, 's1', 'g1', 'g2'); moveInto(b, 's1', 'g2', 'g1')
  sync(a, b)
  const shown = readSlide(a, 's1')
  const top = shown.children.map((c) => c.id)
  const w = repair(a); repair(b); sync(a, b)
  return `both rendered ${JSON.stringify(shown).includes('"g1"') && JSON.stringify(shown).includes('"g2"')}|g1 at section ${top.includes('g1')}|repair ${w}|g2 in g1 ${el(a, 'g2')!.parent === 'g1'}`
}, (o) => o['both rendered true|g1 at section true|repair 1|g2 in g1 true'] === TRIALS)

// 9. the agent republishes a slide while the human moves the same element: different properties merge
run('agent publish (text + colour) vs human move of the same element', (a, b) => {
  const f = deckFiles(a)['project/slides/s1.html']
  publish(a, { 'project/slides/s1.html': f.replace('>One<', '>One, rewritten<').replace('width:400px; color:#111111', 'width:400px; color:#2b7a78') })
  setStyle(b, 's1', 'e1', { left: '900px', top: '100px' })
  sync(a, b)
  const e = el(a, 'e1')!
  return e.style.left === '900px' && e.style.color === '#2b7a78' && JSON.stringify(e.text).includes('One, rewritten') ? 'merged' : 'lost'
}, (o) => o.merged === TRIALS)

// contrast: the same concurrent re-order as delete + insert of a child (v13: Y.XmlFragment, research §6 Spike 4;
// v14: a Y.Node's children — v14 has no move op either) duplicates the slide
{
  let dup = 0
  for (let i = 0; i < TRIALS; i++) {
    if (VERSION === '13') {
      const d0 = new YJS.Doc(); const f0 = d0.getXmlFragment('slides')
      f0.insert(0, ['s1', 's2', 's3', 's4'].map((id) => { const e = new YJS.XmlElement('section'); e.setAttribute('id', id); return e }))
      const [a, b] = [new YJS.Doc(), new YJS.Doc()]
      YJS.applyUpdate(a, YJS.encodeStateAsUpdate(d0)); YJS.applyUpdate(b, YJS.encodeStateAsUpdate(d0))
      const mv = (d: YJS.Doc, to: number) => { const f = d.getXmlFragment('slides'); const c = (f.get(2) as YJS.XmlElement).clone(); d.transact(() => { f.delete(2, 1); f.insert(to, [c]) }) }
      mv(a, 0); mv(b, 3)
      YJS.applyUpdate(a, YJS.encodeStateAsUpdate(b)); YJS.applyUpdate(b, YJS.encodeStateAsUpdate(a))
      if (a.getXmlFragment('slides').length !== 4) dup++
    } else {
      const d0 = new Y14.Doc(); const f0 = d0.get('slides')
      d0.transact(() => f0.insert(0, ['s1', 's2', 's3', 's4'].map((id) => { const e = new Y14.Node('section'); e.setAttr('id', id); return e })))
      const [a, b] = [new Y14.Doc(), new Y14.Doc()]
      Y14.applyUpdate(a, Y14.encodeStateAsUpdate(d0)); Y14.applyUpdate(b, Y14.encodeStateAsUpdate(d0))
      const mv = (d: Y14.Doc, to: number) => { const f = d.get('slides'); const c = (f.get(2) as Y14.Node).clone(); d.transact(() => { f.delete(2, 1); f.insert(to, [c]) }) }
      mv(a, 0); mv(b, 3)
      Y14.applyUpdate(a, Y14.encodeStateAsUpdate(b)); Y14.applyUpdate(b, Y14.encodeStateAsUpdate(a))
      if (a.get('slides').length !== 4) dup++
    }
  }
  r.check(`contrast: the same re-order as child delete+insert duplicates the slide (${dup}/${TRIALS})`, dup === TRIALS)
}

// anchors: one id stays one element through everything above that does not delete it
{
  const [a, b] = pair()
  const anchor = { slideId: 's1', elementId: 'e2' }
  setStyle(a, 's1', 'e2', { left: '1px' }); zOrder(b, 's1', 'e2', 'back'); moveSlide(a, 's1', 's4'); moveInto(b, 's1', 'e2', 'g2')
  const f = deckFiles(a)['project/slides/s1.html']; publish(a, { 'project/slides/s1.html': f.replace('>Two<', '>Deux<') })
  sync(a, b)
  const s = resolveAnchor(a, anchor)
  r.check('object anchor {slideId, elementId} resolves to the same element after move + z-order + slide re-order + regroup + republish', s.live && s.parent === 'g2', s)
}

r.write()
