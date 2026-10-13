// S5 (P3-0) item 4: comments under concurrency on Yjs v14 — the human comments while the agent rewrites the passage;
// two replicas comment overlapping (and identical) passages; one resolves while another replies; the flag-on-mark
// contrast; then a randomized run (200 trials) of offline edits on the panel, the tab and the agent replica checking
// convergence and the comment invariants. "Concurrent" = the replicas' ports are disconnected from the host hub while
// they act, then reconnected (the y-protocols handshake both ways). Run:
//   node spikes/p3-store/s5/s5-concurrency.mjs      (writes spikes/p3-store/s5/out/concurrency.json and .txt)
import './lib/dom.mjs'
import { writeFileSync } from 'node:fs'
import { createWorld, Y, select, findPos, type, covered, highlighted, states, pmJSON, textOf, commentSelection, now, schema } from './lib/world.mjs'
import { getThread, listThreads, resolve, reopen, reply, liveIdsY, threadStates, threadsRoot, liveRanges, isCommentKey } from './lib/comments.mjs'
import { rewriteBlock, findById } from './lib/rewrite.mjs'

const results = []
const lines = []
const log = s => { lines.push(s); console.log(s) }
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }
const J = x => JSON.stringify(x)

const base = async () => {
  const w = await createWorld()
  select(w.A.editor, 'ships quarterly with design review')
  commentSelection(w.A.editor, w.A.doc, { threadId: 't1', by: 'owner', at: now(), body: 'Should this be monthly?' })
  await w.settle()
  return w
}
const offline = (w, ...rs) => rs.forEach(r => w.hub.disconnect(r.port))
const online = async (w, ...rs) => { rs.forEach(r => r.reconnect()); await w.settle() }
const converged = w => {
  const h = pmJSON(w.host)
  return h === pmJSON(w.A.doc.get('default')) && h === pmJSON(w.B.doc.get('default')) && h === pmJSON(w.agent.root) &&
    J(threadsRoot(w.hostDoc).toJSON()) === J(threadsRoot(w.A.doc).toJSON()) && J(threadsRoot(w.hostDoc).toJSON()) === J(threadsRoot(w.agent.doc).toJSON())
}

log('── the human comments on a passage while the agent rewrites it ──')
for (const [label, text, want] of [
  ['agent rewords one word inside', 'The plan ships monthly with design review notes. Owners track the budget.', { t1: 'ships monthly with design review', t9: 'monthly with design' }],
  ['agent rewrites the whole sentence', 'Shipping is monthly now. Owners track the budget.', {}],
  ['agent deletes the commented words', 'The plan. Owners track the budget.', {}]
]) {
  const w = await createWorld()
  offline(w, w.agent)
  rewriteBlock(w.agent.doc, w.agent.root, 'p1', text)
  select(w.A.editor, 'ships quarterly with design review'); commentSelection(w.A.editor, w.A.doc, { threadId: 't1', by: 'owner', at: now(), body: 'Q' })
  select(w.A.editor, 'quarterly with design'); commentSelection(w.A.editor, w.A.doc, { threadId: 't9', by: 'owner', at: now(), body: 'Q2' })
  await w.settle()
  await online(w, w.agent)
  const c = covered(w.A.editor)
  check(`concurrent comment × ${label}: converged; marks ${J(c)}`, converged(w) && J(c) === J(want), `${states(w.hostDoc, w.host)}; text ${J(textOf(w.A.editor).split('\n')[1])}`)
}
// t9 starts exactly at the word the agent replaces: the agent's insertion and the comment's format boundary share a
// left origin, so Yjs orders them by client id. Count over random client ids.
{
  const tally = { start: { inside: 0, outside: 0 }, end: { inside: 0, outside: 0 } }
  for (let i = 0; i < 40; i++) {
    for (const edge of ['start', 'end']) {
      const w = await createWorld()
      offline(w, w.agent)
      rewriteBlock(w.agent.doc, w.agent.root, 'p1', 'The plan ships monthly with design review notes. Owners track the budget.')
      if (edge === 'start') select(w.A.editor, 'quarterly with design'); else select(w.A.editor, 'plan ships quarterly')
      commentSelection(w.A.editor, w.A.doc, { threadId: 'tE', by: 'owner', at: now(), body: 'edge' })
      await w.settle(); await online(w, w.agent)
      const c = covered(w.A.editor).tE ?? ''
      tally[edge][c.includes('monthly') ? 'inside' : 'outside']++
      w.A.editor.destroy(); w.B.editor.destroy()
    }
  }
  check('a concurrent replacement of a new comment\'s first word lands inside it; of its last word, inside or outside by client-id order', tally.start.inside === 40 && tally.end.inside > 0 && tally.end.outside > 0, J(tally))
}

log('── two replicas comment concurrently ──')
{
  const w = await createWorld()
  offline(w, w.A, w.B)
  select(w.A.editor, 'plan ships quarterly'); commentSelection(w.A.editor, w.A.doc, { threadId: 't5', by: 'owner', at: now(), body: 'A' })
  select(w.B.editor, 'quarterly with design'); commentSelection(w.B.editor, w.B.doc, { threadId: 't6', by: 'owner', at: now(), body: 'B' })
  select(w.A.editor, 'Owners track'); commentSelection(w.A.editor, w.A.doc, { threadId: 't7', by: 'owner', at: now(), body: 'A2' })
  select(w.B.editor, 'Owners track'); commentSelection(w.B.editor, w.B.doc, { threadId: 't8', by: 'owner', at: now(), body: 'B2' })
  await online(w, w.A, w.B)
  const c = covered(w.A.editor)
  check('overlapping passages from two replicas: both marks, both threads, everywhere', converged(w) && c.t5 === 'plan ships quarterly' && c.t6 === 'quarterly with design' && J(covered(w.B.editor)) === J(c), J(c))
  check('the identical passage from two replicas: two threads, two marks (distinct hashed keys)', c.t7 === 'Owners track' && c.t8 === 'Owners track' && states(w.hostDoc, w.host) === 't5:open t6:open t7:open t8:open', states(w.hostDoc, w.host))
  check('both highlighted on B', J(Object.keys(highlighted(w.B))) === J(['t5', 't6', 't7', 't8']))
}

log('── one replica resolves while another replies ──')
{
  const w = await base()
  offline(w, w.A, w.agent)
  resolve(w.A.doc, 't1', 'owner', now())
  reply(w.agent.doc, 't1', { id: 't1:m1', by: 'agent:s1', at: now(), body: 'Changed it to monthly.' })
  await online(w, w.A, w.agent)
  const t = getThread(w.hostDoc, 't1')
  check('nested thread node: the resolve and the reply both land', converged(w) && t.status === 'resolved' && t.messages.length === 2, `${t.status}, ${t.messages.length} messages`)
  // contrast: the thread as one JSON value (setAttr of a whole record) loses one of the two writes
  const doc = new Y.Doc(); const flat = doc.get('threadsFlat')
  flat.setAttr('t1', { status: 'open', messages: [{ id: 'm0' }] })
  const d1 = new Y.Doc(); Y.applyUpdateV2(d1, Y.encodeStateAsUpdateV2(doc)); const d2 = new Y.Doc(); Y.applyUpdateV2(d2, Y.encodeStateAsUpdateV2(doc))
  const r1 = d1.get('threadsFlat').getAttr('t1'); d1.get('threadsFlat').setAttr('t1', { ...r1, status: 'resolved' })
  const r2 = d2.get('threadsFlat').getAttr('t1'); d2.get('threadsFlat').setAttr('t1', { ...r2, messages: [...r2.messages, { id: 'm1' }] })
  Y.applyUpdateV2(d1, Y.encodeStateAsUpdateV2(d2)); Y.applyUpdateV2(d2, Y.encodeStateAsUpdateV2(d1))
  const m = d1.get('threadsFlat').getAttr('t1')
  check('CONTRAST thread as one JSON value: one of the two writes is lost', !(m.status === 'resolved' && m.messages.length === 2), J(m))
}
{
  const w = await base()
  offline(w, w.A, w.B)
  resolve(w.A.doc, 't1', 'owner', now()); reopen(w.B.doc, 't1', 'owner', now())
  await online(w, w.A, w.B)
  check('concurrent resolve and reopen: one status wins, the same on every replica', converged(w) && ['open', 'resolved'].includes(getThread(w.hostDoc, 't1').status) && getThread(w.A.doc, 't1').status === getThread(w.B.doc, 't1').status, getThread(w.hostDoc, 't1').status)
}
{
  const w = await base()
  offline(w, w.A, w.B)
  select(w.A.editor, 'ships quarterly with design review'); w.A.editor.commands.keyboardShortcut('Backspace')
  resolve(w.B.doc, 't1', 'owner', now())
  await online(w, w.A, w.B)
  check('A deletes the passage while B resolves: resolved, not orphaned', states(w.hostDoc, w.host) === 't1:resolved', states(w.hostDoc, w.host))
}

log('── resolve while another replica types inside the passage ──')
{
  const w = await base()
  offline(w, w.A, w.B)
  resolve(w.A.doc, 't1', 'owner', now())
  type(w.B.editor, findPos(w.B.editor, 'quarterly'), 'very ')
  await online(w, w.A, w.B)
  check('map resolve × typing inside: nothing highlighted, the mark covers the typed word', converged(w) && !('t1' in highlighted(w.A)) && covered(w.A.editor).t1 === 'ships very quarterly with design review', J(covered(w.A.editor)))
}
{
  const w = await base()
  offline(w, w.A, w.B)
  // BlockNote-style resolve: re-mark the passage with orphan: true (a new hashed key) instead of writing the map
  w.A.editor.chain().command(({ tr, state }) => { const m = state.schema.marks.comment; state.doc.descendants((n, pos) => { if (!n.isText) return; for (const mk of n.marks) if (mk.type === m && mk.attrs.threadId === 't1') { tr.removeMark(pos, pos + n.nodeSize, mk); tr.addMark(pos, pos + n.nodeSize, m.create({ threadId: 't1', orphan: true })) } }); return true }).run()
  type(w.B.editor, findPos(w.B.editor, 'quarterly'), 'very ')
  await online(w, w.A, w.B)
  const flags = []
  w.A.editor.state.doc.descendants(n => { if (n.isText) for (const mk of n.marks) if (mk.attrs.threadId === 't1') flags.push(`${J(n.text)}:${mk.attrs.orphan}`) })
  // hypothesis was a split state; Yjs formats are boundary items, so a concurrent insertion inside the range is covered
  check('CONTRAST flag-on-mark resolve × typing inside: no split (Yjs format boundaries cover the concurrent insert)', converged(w) && flags.every(f => f.endsWith(':true')), flags.join(' '))
}

log('── randomized: 200 trials of offline edits on A, B and the agent, then sync ──')
{
  let seed = 42
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
  const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'monthly', 'review', 'owner']
  const textblocks = ed => { const out = []; ed.state.doc.descendants((n, pos) => { if (n.isTextblock) { out.push({ n, pos }); return false } return true }); return out }
  const randRange = ed => {
    const tbs = textblocks(ed).filter(t => t.n.content.size > 1)
    if (!tbs.length) return null
    const t = tbs[rnd(tbs.length)]
    const a = rnd(t.n.content.size); const b = Math.min(t.n.content.size, a + 1 + rnd(12))
    return { from: t.pos + 1 + a, to: t.pos + 1 + b }
  }
  let tid = 100
  const ops = {
    type: r => { const g = randRange(r.editor); if (g) type(r.editor, g.from, WORDS[rnd(WORDS.length)] + ' ') },
    del: r => { const g = randRange(r.editor); if (g) { r.editor.commands.setTextSelection(g); r.editor.commands.keyboardShortcut('Backspace') } },
    enter: r => { const g = randRange(r.editor); if (g) { r.editor.commands.setTextSelection(g.from); r.editor.commands.keyboardShortcut('Enter') } },
    comment: r => { const g = randRange(r.editor); if (g) { r.editor.commands.setTextSelection(g); commentSelection(r.editor, r.doc, { threadId: 't' + (++tid), by: r.actor, at: now(), body: 'c' }) } },
    resolve: r => { const ts = listThreads(r.doc); if (ts.length) { const t = ts[rnd(ts.length)]; (t.status === 'open' ? resolve : reopen)(r.doc, t.id, r.actor, now()) } },
    reply: r => { const ts = listThreads(r.doc); if (ts.length) reply(r.doc, ts[rnd(ts.length)].id, { id: 'm' + (++tid), by: r.actor, at: now(), body: 'r' }) },
    retype: r => { if (rnd(2)) r.editor.chain().setTextSelection(randRange(r.editor)?.from ?? 1).setNode('heading', { level: 2 }).run(); else r.editor.chain().setTextSelection(randRange(r.editor)?.from ?? 1).toggleBulletList().run() }
  }
  const names = Object.keys(ops)
  const agentOp = w => {
    const blocksY = w.agent.root.toArray().filter(n => n instanceof Y.Node && n.getAttr('id') && schema.nodes[n.name]?.isTextblock)
    if (!blocksY.length) return
    const b = blocksY[rnd(blocksY.length)]
    const words = b.toDelta().children.map(o => (typeof o.insert === 'string' ? o.insert : '')).join('').split(' ')
    if (words.length < 2) return
    const i = rnd(words.length); const k = rnd(3)
    if (k === 0) words[i] = WORDS[rnd(WORDS.length)]; else if (k === 1) words.splice(i, 1 + rnd(3)); else words.splice(i, 0, WORDS[rnd(WORDS.length)])
    rewriteBlock(w.agent.doc, w.agent.root, b.getAttr('id'), words.join(' '))
  }
  let ok = 0; const fails = []; let orphans = 0; let threadsTotal = 0; const t0 = performance.now()
  for (let trial = 0; trial < 200; trial++) {
    const w = await base()
    offline(w, w.A, w.B, w.agent)
    for (const r of [w.A, w.B]) for (let k = 0; k < 1 + rnd(3); k++) { try { ops[names[rnd(names.length)]](r) } catch (e) { fails.push(`trial ${trial} op error ${e.message}`) } }
    for (let k = 0; k < 1 + rnd(2); k++) agentOp(w)
    if (rnd(2)) { const ts = listThreads(w.agent.doc); if (ts.length) reply(w.agent.doc, ts[0].id, { id: 'am' + trial, by: 'agent:s1', at: now(), body: 'a' }) }
    await online(w, w.A, w.B, w.agent)
    const live = liveIdsY(w.host)
    const known = new Set(listThreads(w.hostDoc).map(t => t.id))
    const sA = J(threadStates(w.A.doc, liveIdsY(w.A.doc.get('default')))); const sH = J(threadStates(w.hostDoc, live))
    const noFlag = !JSON.stringify(w.host.toDeltaDeep().toJSON()).includes('"orphan":true')
    const markedHaveThreads = [...live].every(id => known.has(id))
    const sameCover = J(covered(w.A.editor)) === J(covered(w.B.editor))
    const good = converged(w) && sA === sH && markedHaveThreads && noFlag && sameCover
    if (good) ok++; else fails.push(`trial ${trial}: converged ${converged(w)} states ${sA === sH} marks→threads ${markedHaveThreads} cover ${sameCover}`)
    const st = threadStates(w.hostDoc, live); threadsTotal += st.length; orphans += st.filter(t => t.orphan).length
    w.A.editor.destroy(); w.B.editor.destroy()
  }
  check('randomized: 200/200 trials converge (PM docs, threads maps, derived states, covered text on A and B; every mark has a thread; no mark flagged)', ok === 200, `${ok}/200; ${threadsTotal} thread outcomes, ${orphans} orphaned by concurrent deletes and rewrites; ${(performance.now() - t0).toFixed(0)} ms${fails.length ? '; ' + fails.slice(0, 5).join(' | ') : ''}`)
}

const failed = results.filter(r => !r.ok)
log(`\n${results.length - failed.length}/${results.length} checks passed`)
writeFileSync(new URL('./out/concurrency.json', import.meta.url), J({ results }, null, 2))
writeFileSync(new URL('./out/concurrency.txt', import.meta.url), lines.join('\n') + '\n')
process.exit(0)
