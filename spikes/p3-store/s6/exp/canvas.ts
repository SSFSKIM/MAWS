// S6 item 5: a minimal canvas on two replicas (happy-dom). R1 and R2 are live replicas of the host H (updates
// forwarded as they happen, as the port provider would). A drag on R1's canvas writes style:left/top; R2's DOM follows
// with minimal patches; z-order, a remote text edit and an agent publish do too. After every step R2's patched DOM must
// equal a fresh render of R2's model.
import { Window } from 'happy-dom'
import { claudeExamples } from '../fixtures/claude-examples.ts'
import { CANVAS_CSS, SlideCanvas } from '../src/canvas.ts'
import { deckFiles } from '../src/model.ts'
import { publish } from '../src/publish.ts'
import * as Y from '../src/ydoc.ts'
import { Report } from './lib.ts'

const r = new Report('canvas')
const H = Y.newDoc(1), R1 = Y.newDoc(2), R2 = Y.newDoc(3), AG = Y.newDoc(4)
publish(H, {
  'project/deck.json': JSON.stringify({ v: 4, title: 'T', order: ['plan'] }),
  'project/slides/plan.html': claudeExamples['skill-plan'].replace('<p style="position:absolute;left:128px;bottom:64px', '<p id="foot" style="position:absolute;left:128px;bottom:64px')
    .replace('<h2 ', '<div id="backdrop" style="position:absolute;left:0;top:0;width:1920px;height:400px;background:#eef"></div>\n<h2 id="head" '),
}, { seed: 'init' })
for (const d of [R1, R2, AG]) Y.pull(d, H)
// live forwarding: R1 ↔ H ↔ R2 (the agent's replica only on its own publish)
const wire = (from: Y.Doc, tos: Y.Doc[]) => Y.onUpdate(from, (u, origin) => { for (const t of tos) if (origin !== t) Y.applyUpdate(t, u, from) })
wire(R1, [H]); wire(R2, [H]); wire(H, [R1, R2])

function mount(doc: Y.Doc) {
  const win = new Window({ width: 1920, height: 1080 })
  const style = win.document.createElement('style'); style.textContent = CANVAS_CSS; win.document.head.appendChild(style)
  const host = win.document.createElement('div'); win.document.body.appendChild(host)
  const canvas = new SlideCanvas(doc, 'plan', win.document as unknown as Document, host as unknown as HTMLElement)
  const records: { type: string; attr?: string | null; target: string }[] = []
  const mo = new win.MutationObserver((rs) => { for (const m of rs) records.push({ type: m.type, attr: m.attributeName, target: (m.target as unknown as HTMLElement).dataset?.eid ?? (m.target as unknown as HTMLElement).tagName }) })
  mo.observe(host as never, { subtree: true, attributes: true, childList: true, characterData: true })
  return { win, canvas, records, flush: async () => { await new Promise((res) => setTimeout(res, 0)) } }
}
/** A fresh render of the doc's current state, for the "patched DOM equals full render" invariant. */
function fresh(doc: Y.Doc): string {
  const w = new Window(); const host = w.document.createElement('div')
  const c = new SlideCanvas(doc, 'plan', w.document as unknown as Document, host as unknown as HTMLElement)
  const html = c.root.outerHTML; c.dispose(); return html
}
const c1 = mount(R1), c2 = mount(R2)
r.check('both replicas render the same DOM', c1.canvas.root.outerHTML === c2.canvas.root.outerHTML)
r.check('pinned-under backdrop rendered first with data-layer=under; the section isolates', c2.canvas.root.firstElementChild?.getAttribute('data-eid') === 'backdrop'
  && c2.canvas.root.firstElementChild?.getAttribute('data-layer') === 'under')

async function step(name: string, act: () => void, expect: (recs: typeof c2.records) => boolean) {
  c2.records.length = 0
  const w0 = { ...c2.canvas.writes }
  act()
  await c2.flush()
  const recs = [...c2.records]
  const writes = Object.fromEntries(Object.entries(c2.canvas.writes).map(([k, v]) => [k, v - (w0 as Record<string, number>)[k]]).filter(([, v]) => v))
  r.check(`${name}: R2's patched DOM equals a fresh render of its model`, c2.canvas.root.outerHTML === fresh(R2))
  r.check(`${name}: R2's DOM mutations minimal`, expect(recs), { mutations: recs.length, byKind: recs.map((m) => `${m.type}${m.attr ? ':' + m.attr : ''}@${m.target}`), canvasWrites: writes })
}

// 1. drag on R1 (a pointer gesture through the canvas's own handlers), three moves
c1.canvas.attachDrag(1)
await step('drag "backdrop" on R1 (3 pointer moves)', () => {
  const n = c1.canvas.node('backdrop')!
  const ev = (type: string, x: number, y: number) => n.dispatchEvent(new c1.win.PointerEvent(type, { clientX: x, clientY: y, bubbles: true }) as unknown as Event)
  ev('pointerdown', 500, 500); ev('pointermove', 510, 505); ev('pointermove', 540, 530); ev('pointermove', 600, 560); ev('pointerup', 600, 560)
}, (recs) => recs.every((m) => m.type === 'attributes' && m.attr === 'style' && m.target === 'backdrop') && recs.length === 6)
const b2 = c2.canvas.node('backdrop')!
r.check('R2 follows the drag: backdrop at left:100px, top:60px', b2.style.left === '100px' && b2.style.top === '60px', { left: b2.style.left, top: b2.style.top })

// 2. z-order on R1: bring the backdrop to the front (over the flow layer), then send it back
await step('bring "backdrop" to front on R1', () => c1.canvas.bringToFront('backdrop'),
  (recs) => recs.filter((m) => m.type === 'childList').length <= 2 && recs.every((m) => m.target === 'backdrop' || m.type === 'childList'))
r.check('R2: backdrop is now the last child, no longer under', c2.canvas.root.lastElementChild?.getAttribute('data-eid') === 'backdrop' && !c2.canvas.node('backdrop')!.dataset.layer)
await step('send "backdrop" to back on R1', () => c1.canvas.sendToBack('backdrop'), (recs) => recs.filter((m) => m.type === 'childList').length <= 2)
r.check('R2: backdrop first again, under the flow layer', c2.canvas.root.firstElementChild?.getAttribute('data-eid') === 'backdrop' && c2.canvas.node('backdrop')!.dataset.layer === 'under')

// 3. a remote text edit on R1 (as a Tiptap binding would write it): only that box re-renders on R2
await step('text edit in "head" on R1', () => Y.transact(R1, () => Y.patchText(R1, 'plan', 'head', [{ type: 'p', inline: [{ text: 'Changes ', marks: {} }, { text: 'ahead', marks: { i: {} } }] }])),
  (recs) => recs.every((m) => m.target === 'head' || m.target === undefined || m.type === 'childList'))
r.check('R2 shows the new text', c2.canvas.node('head')!.innerHTML === 'Changes <i>ahead</i>', c2.canvas.node('head')!.innerHTML)

// 4. the agent publishes (one transaction from its replica, through the host): an element added, one restyled, one removed
Y.pull(AG, H)
const file = deckFiles(AG)['project/slides/plan.html']
await step('agent publish: add a pinned note, restyle the heading, remove the image', () => {
  const next = file.replace(/\n {4}<img [^\n]*/, '').replace('font-size:72px', 'font-size:80px')
    .replace('  <aside>', '  <p id="note" style="position:absolute; right:128px; top:64px; font-size:24px; color:#c0392b">Draft</p>\n  <aside>')
  const sv = Y.stateVector(H)
  publish(AG, { 'project/slides/plan.html': next }, { seed: 'p2', origin: 'agent' })
  Y.applyUpdate(H, Y.diffSince(AG, sv), AG)
}, (recs) => recs.length <= 6)
r.check('R1 and R2 both show the agent\'s change', !!c1.canvas.node('note') && !!c2.canvas.node('note') && c2.canvas.root.querySelector('img') === null && c2.canvas.node('head')!.style.getPropertyValue('font-size') === '80px')
r.check('R1 and R2 DOMs identical after everything', c1.canvas.root.outerHTML === c2.canvas.root.outerHTML)

r.write()
