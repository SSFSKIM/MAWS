// S6 item 3: diff-apply of a published slide file as one transaction from the agent's replica.
// Topology: H = the host's doc, U = the human's replica (live), A = the agent's replica, brought up to H only when the
// agent reads (so A is exactly the agent's base when it publishes).
import { claudeExamples } from '../fixtures/claude-examples.ts'
import { deckFiles, readFlat, resolveAnchor, setStyle, slideOrder } from '../src/model.ts'
import { publish } from '../src/publish.ts'
import * as Y from '../src/ydoc.ts'
import { Report, YJS } from './lib.ts'

const r = new Report('publish')
const H = Y.newDoc(1), U = Y.newDoc(2), A = Y.newDoc(3)
const live = () => { Y.pull(U, H); Y.pull(H, U) }
/** The agent reads: its replica catches up with the host; it gets the files. */
const agentRead = () => { Y.pull(A, H); return deckFiles(A) }
/** The agent's publish lands: one update from A to H; returns its bytes (V1 and V2). */
function agentPublish(files: Record<string, string | null>, seed: string) {
  const v1: Uint8Array[] = [], v2: Uint8Array[] = []
  const off1 = Y.onUpdate(A, (u) => v1.push(u)), off2 = Y.onUpdateV2(A, (u) => v2.push(u))
  const res = publish(A, files, { seed, origin: 'agent' })
  off1(); off2()
  for (const u of v1) Y.applyUpdate(H, u, 'agent')
  live()
  return { res, updates: v1.length, v1: v1.reduce((n, u) => n + u.length, 0), v2: v2.reduce((n, u) => n + u.length, 0) }
}

// --- first publish: a deck from Claude's examples (no element ids: the host mints them)
const deckJson = JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-12T18:00:00Z' }, lists: 'css', title: 'Q3', cover: 'plan',
  order: ['plan', 'kpis', 'map'], sections: { s1: { description: 'Numbers', start: 'plan' } }, faces: {}, designSystems: [], xUnknown: { keep: true } })
const first = agentPublish({
  'project/deck.json': deckJson,
  'project/slides/plan.html': claudeExamples['skill-plan'],
  'project/slides/kpis.html': claudeExamples['layout-kpis'],
  'project/slides/map.html': claudeExamples['recipes-label'],
}, 'pub1')
r.check('first publish lands as ONE update', first.updates === 1, first)
r.check('deck.json: unknown keys kept, order applied', JSON.parse(deckFiles(H)['project/deck.json']).xUnknown?.keep === true && slideOrder(H).join() === 'plan,kpis,map')

// --- a no-op republish writes nothing
let files = agentRead()
const noop = agentPublish(files, 'pub2')
r.check('no-op republish of the files just read: 0 writes, no update emitted', noop.res.writes === 0 && noop.updates === 0, noop)
const messyEqual = Object.fromEntries(Object.entries(files).map(([p, c]) => [p, p.endsWith('.html')
  ? c.replace(/style="([^"]*)"/g, (_, s: string) => `style="${s.split('; ').reverse().join(';').replace(/#([0-9a-f]{6})/g, (m) => m.toUpperCase())}"`).replace(/\n\s*/g, '\n')
  : JSON.stringify(JSON.parse(c))]))
const noop2 = agentPublish(messyEqual, 'pub3')
r.check('republish equal by meaning (reordered declarations, uppercase hex, other whitespace, compact JSON): 0 writes', noop2.res.writes === 0 && noop2.updates === 0, noop2)

// --- one property
files = agentRead()
const plan = files['project/slides/plan.html']
const footerId = /<p id="([^"]+)" style="position:absolute; left:128px; bottom:64px/.exec(plan)![1]
const one = agentPublish({ 'project/slides/plan.html': plan.replace('left:128px; bottom:64px', 'left:160px; bottom:64px') }, 'pub4')
r.check('one-property change: exactly 1 write', one.res.writes === 1, one.res.writes)
r.num('update bytes, one-property publish (V1, V2)', { v1: one.v1, v2: one.v2 })

// --- the human restyled meanwhile: the agent's base is its last read; its publish keeps the human's color
files = agentRead() // agent reads...
setStyle(U, 'plan', footerId, { color: '#c0392b' }, 'human'); live() // ...the human recolours the footer after the read
const stale = files['project/slides/plan.html'] // still has the old colour
const moved = stale.replace('left:160px; bottom:64px', 'left:200px; bottom:80px')
const merged = agentPublish({ 'project/slides/plan.html': moved }, 'pub5')
const after = readFlat(H, 'plan', false).find((e) => e.id === footerId)!
r.check('agent republish over a concurrent human restyle: the agent\'s moved properties land, the human\'s colour stays',
  after.style.left === '200px' && after.style.bottom === '80px' && after.style.color === '#c0392b', after.style)
r.check('… and the agent wrote only the 2 properties it changed', merged.res.writes === 2, merged.res.writes)
// contrast: diffing against live state (no base) would write the stale colour back
const contrast = Y.newDoc(9); Y.pull(contrast, H)
setStyle(U, 'plan', footerId, { color: '#16a085' }, 'human'); live(); Y.pull(contrast, H)
publish(contrast, { 'project/slides/plan.html': stale }, { seed: 'x' })
r.check('contrast: the same file diffed against the LIVE doc (no base) clobbers the human\'s colour',
  readFlat(contrast, 'plan', false).find((e) => e.id === footerId)!.style.color === '#6a7179')

// --- remove and re-add with the same id
files = agentRead()
const anchor = { slideId: 'plan', elementId: footerId }
const footerLine = files['project/slides/plan.html'].split('\n').find((l) => l.includes(`id="${footerId}"`))!
const removed = agentPublish({ 'project/slides/plan.html': files['project/slides/plan.html'].replace(footerLine + '\n', '') }, 'pub6')
r.check('removed element: its id is gone from the model, anchor orphaned', !readFlat(H, 'plan', false).some((e) => e.id === footerId) && !resolveAnchor(H, anchor).live, removed.res.writes)
files = agentRead()
const readd = agentPublish({ 'project/slides/plan.html': files['project/slides/plan.html'].replace('  <aside>', footerLine + '\n  <aside>') }, 'pub7')
r.check('re-added with the same id: the same element (the anchor resolves again)', resolveAnchor(H, anchor).live, readd.res.writes)

// --- text: a word changed by the agent while the human types elsewhere in the same text box
files = agentRead()
const kpis = files['project/slides/kpis.html']
const labelId = /<p id="([^"]+)"[^>]*>faster ramp<\/p>/.exec(kpis)![1]
// human types " (YoY)" at the end of the same paragraph, after the agent's read
const doc = U; Y.transact(doc, () => Y.patchText(doc, 'kpis', labelId, [{ type: 'p', inline: [{ text: 'faster ramp (YoY)', marks: {} }] }]), 'human'); live()
const t = agentPublish({ 'project/slides/kpis.html': kpis.replace('>faster ramp<', '>much <b>faster</b> ramp<') }, 'pub8')
const merged2 = Y.readText(H, 'kpis', labelId)
r.check('text: agent\'s word change + bold merges with the human\'s concurrent typing in the same box',
  JSON.stringify(merged2) === JSON.stringify([{ type: 'p', inline: [{ text: 'much ', marks: {} }, { text: 'faster', marks: { b: {} } }, { text: ' ramp (YoY)', marks: {} }] }]), merged2)
r.num('update bytes, text publish ("much " inserted + bold on a word) (V1, V2)', { v1: t.v1, v2: t.v2, writes: t.res.writes })

// a line break added by the agent while the human types elsewhere in the same box: v14 keeps <br> in the text's own
// sequence (a character-level edit); v13 keeps text in XmlText nodes split around <br> elements (the block is replaced)
files = agentRead()
const kpis2 = files['project/slides/kpis.html']
Y.transact(U, () => Y.patchText(U, 'kpis', labelId, [{ type: 'p', inline: [{ text: 'much ', marks: {} }, { text: 'faster', marks: { b: {} } }, { text: ' ramp (YoY) now', marks: {} }] }]), 'human'); live()
agentPublish({ 'project/slides/kpis.html': kpis2.replace('</b> ramp (YoY)<', '</b><br>ramp (YoY)<') }, 'pub8b')
const brText = JSON.stringify(Y.readText(H, 'kpis', labelId)[0].inline)
const kept = brText.includes('now') && brText.includes('"br":true')
r.log(`line break vs concurrent typing in the same box (${YJS === '13' ? 'v13' : 'v14'}): ${brText}`)
r.check(YJS === '13' ? 'v13: the agent\'s added <br> replaces the block, the human\'s concurrent " now" is lost (recorded limitation)' : 'v14: the agent\'s added <br> and the human\'s concurrent " now" both survive',
  YJS === '13' ? !brText.includes('now') && brText.includes('"br":true') : kept, brText)

// --- order: a z-order change and a flow re-order in the file write 1 key each
files = agentRead()
const kp = files['project/slides/kpis.html'].split('\n')
const tiles = kp.map((l, i) => [l, i] as const).filter(([l]) => l.startsWith('    <div id='))
// swap the two tiles (flow re-order inside the grid): move tile 2's block above tile 1's
const t1 = tiles[0][1], t2 = tiles[1][1]
const block1 = kp.slice(t1, t2), block2 = kp.slice(t2, t2 + block1.length)
const swapped = [...kp.slice(0, t1), ...block2, ...block1, ...kp.slice(t2 + block1.length)].join('\n')
const re = agentPublish({ 'project/slides/kpis.html': swapped }, 'pub9')
r.check('flow re-order of two siblings: 1 key written', re.res.writes === 1, re.res.writes)
const mapFile = agentRead()['project/slides/map.html']
const lines = mapFile.split('\n'); const pinned = lines[1]
// move the pinned label from under the flow layer (first) to over it (last): a z change
const zs = agentPublish({ 'project/slides/map.html': [lines[0], ...lines.slice(2, -2), pinned, ...lines.slice(-2)].join('\n') }, 'pub10')
r.check('pinned element moved from under to over the flow layer: 1 key written', zs.res.writes === 1, zs.res.writes)

// --- held slide: last good model kept, the read returns the held source; fixing it clears the hold
files = agentRead()
const bad = files['project/slides/map.html'].replace('</section>', '<iframe></iframe></section>')
const hp = agentPublish({ 'project/slides/map.html': bad }, 'pub11')
r.check('a structurally invalid file is held (slideHeld with reasons), not trimmed; read returns it verbatim',
  hp.res.held.map?.[0]?.includes('iframe') && deckFiles(H)['project/slides/map.html'] === bad && readFlat(H, 'map', false).length === 2, hp.res.held)
const fix = agentPublish({ 'project/slides/map.html': files['project/slides/map.html'] }, 'pub12')
r.check('republishing a valid file clears the hold', !('held' in Y.slideScalars(H, 'map')) && fix.res.ok)

// --- atomicity: one bad path refuses the whole map, nothing written
const sv = Y.stateVector(A)
const atomic = publish(A, { 'project/slides/plan.html': plan.replace('Changes', 'Changed'), 'project/../x.html': 'x' }, { seed: 's' })
r.check('a publish with one invalid entry is refused whole; the replica is unchanged', !atomic.ok && Buffer.compare(Buffer.from(sv), Buffer.from(Y.stateVector(A))) === 0, atomic.refused)

// --- deck.json republish: order change writes the moved slide's key only; removal of a slide file
files = agentRead()
const dj = JSON.parse(files['project/deck.json']); dj.order = ['kpis', 'plan', 'map']
const ord = agentPublish({ 'project/deck.json': JSON.stringify(dj) }, 'pub13')
r.check('deck.json order change: 1 slide key written', ord.res.writes === 1 && slideOrder(H).join() === 'kpis,plan,map', ord.res.writes)
dj.order = ['kpis', 'plan']
const rm = agentPublish({ 'project/deck.json': JSON.stringify(dj), 'project/slides/map.html': null }, 'pub14')
r.check('slide removal (file null + order) in one transaction', rm.updates === 1 && !Y.hasSlide(H, 'map'), rm.res.writes)

r.write()
