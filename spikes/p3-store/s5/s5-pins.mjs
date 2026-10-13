// S5 (P3-0) items 1 to 3: the comment mark and the threads map through every ordinary edit, on Yjs v14 with real
// Tiptap 3.31.3 editors in happy-dom. Each scenario starts from a fresh world (host + panel replica A + tab replica B +
// agent replica), comments t1 "ships quarterly with design review" and t2 "design review notes" (overlapping) on p1 and
// t3 "keeps going" on p2, applies one edit, checks both replicas and the derived thread state, then undoes it and
// checks everything came back. Run:
//   node spikes/p3-store/s5/s5-pins.mjs        (writes spikes/p3-store/s5/out/pins.json and pins.txt)
import { clip, pasteHTML } from './lib/dom.mjs'
import { writeFileSync } from 'node:fs'
import {
  createWorld, Y, select, findPos, type, key, covered, highlighted, blocks, states, pmJSON, textOf, commentSelection, now
} from './lib/world.mjs'
import { getThread, listThreads, resolve, reopen, reply, locate, locateInView, liveIdsY, threadStates, refreshAnchors } from './lib/comments.mjs'
import { rewriteBlock, retypeBlock } from './lib/rewrite.mjs'
import { schema } from './lib/world.mjs'
import { revertUpdate, restoreKeepingConversation } from './lib/restore.mjs'

const results = []
const rows = []
const lines = []
const log = s => { lines.push(s); console.log(s) }
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }
const J = x => JSON.stringify(x)

const base = async (opts) => {
  const w = await createWorld(opts)
  select(w.A.editor, 'ships quarterly with design review')
  commentSelection(w.A.editor, w.A.doc, { threadId: 't1', by: 'owner', at: now(), body: 'Should this be monthly?' })
  select(w.A.editor, 'design review notes')
  commentSelection(w.A.editor, w.A.doc, { threadId: 't2', by: 'owner', at: now(), body: 'Which notes?' })
  select(w.A.editor, 'keeps going')
  commentSelection(w.A.editor, w.A.doc, { threadId: 't3', by: 'owner', at: now(), body: 'Too vague.' })
  await w.settle()
  return w
}
const BASE_COVER = { t1: 'ships quarterly with design review', t2: 'design review notes', t3: 'keeps going' }

/** Where t1's stored relative-position pair points now, as text in A's editor ('∅' unresolvable, '' collapsed). */
const anchorText = (w, id = 't1') => {
  const t = getThread(w.A.doc, id)
  const [s, e] = locateInView(w.A.view, t)
  if (s == null || e == null) return '∅'
  return s <= e ? w.A.editor.state.doc.textBetween(s, e, '¶') : `(inverted ${s}>${e})`
}

/**
 * One row of the pin table. `edit(w)` acts (A's edits go through A's undo stack); `want` is the expected covered map
 * on both replicas; `undo` names whose undo reverts it ('A', 'agent' or null).
 */
const scenario = async (name, edit, want, { undo = 'A', opts, orphans = [] } = {}) => {
  const w = await base(opts)
  const text0 = textOf(w.A.editor)
  const agentUM = new Y.UndoManager(w.agent.root, { trackedOrigins: new Set(['agent']) })
  w.A.um().stopCapturing()
  const log0 = w.hub.log.length
  const note = (await edit(w)) ?? ''
  await w.settle()
  const editBytes = w.hub.log.slice(log0).map(e => e.v2.length)
  const a = covered(w.A.editor); const b = covered(w.B.editor)
  const st = states(w.hostDoc, w.host)
  check(`${name}: replicas converge (A, B, host, agent)`, pmJSON(w.A.doc.get('default')) === pmJSON(w.B.doc.get('default')) && pmJSON(w.host) === pmJSON(w.A.doc.get('default')) && pmJSON(w.agent.root) === pmJSON(w.host))
  check(`${name}: marks on both replicas as expected`, J(a) === J(want) && J(b) === J(want), `A ${J(a)}${J(a) === J(b) ? '' : ' B ' + J(b)}`)
  const wantStates = ['t1', 't2', 't3'].map(id => `${id}:open${orphans.includes(id) ? ':orphan' : ''}`).join(' ')
  check(`${name}: thread states`, st === wantStates, st)
  check(`${name}: threads map untouched (3 threads, no duplicate)`, listThreads(w.hostDoc).length === 3)
  const anchor = anchorText(w)
  const loc = orphans.map(id => `${id}→${J(locate(w.hostDoc, getThread(w.hostDoc, id)))}`).join(' ')
  // the host's anchor refresh (comments.mjs refreshAnchors), then the pair again
  const log1 = w.hub.log.length
  const refreshed = refreshAnchors(w.hostDoc, w.host)
  await w.settle()
  const refreshBytes = w.hub.log.slice(log1).filter(e => e.actor === 'host').map(e => e.v2.length)
  const anchorAfter = anchorText(w)
  const brackets = anchorAfter === covered(w.A.editor).t1?.replaceAll('|', '¶')
  if (name.startsWith('CONTRAST')) check(`${name}: a duplicated mark has no single extent (the refresh brackets both copies)`, !brackets, J(anchorAfter).slice(0, 60) + '…')
  else if (covered(w.A.editor).t1) check(`${name}: after the host's refresh, t1's pair brackets its mark`, brackets, `${J(anchorAfter)} (refreshed ${refreshed.join(',') || 'none'})`)
  let undone = '—'
  if (undo) {
    if (undo === 'A') { while (w.A.um().canUndo()) w.A.editor.commands.undo() } else { while (agentUM.canUndo()) agentUM.undo() }
    await w.settle()
    const ua = covered(w.A.editor); const ub = covered(w.B.editor)
    const ust = states(w.hostDoc, w.host)
    const ok = J(ua) === J(BASE_COVER) && J(ub) === J(BASE_COVER) && textOf(w.A.editor) === text0 && ust === 't1:open t2:open t3:open'
    check(`${name}: undo restores text, marks and thread state on both`, ok, ok ? '' : `A ${J(ua)} B ${J(ub)} ${ust} text ${J(textOf(w.A.editor))}`)
    undone = ok ? 'restored' : `NOT restored: ${J(ua)} ${ust}`
  }
  rows.push({ edit: name, marks: a, both: J(a) === J(b), threads: st, anchorT1: anchor, refreshed, refreshBytes, anchorAfter, editBytes, orphanLocate: loc, undo: undone, note })
  return w
}

log('── item 2: the pin through ordinary edits ──')
await scenario('type before the passage (start of paragraph)', w => type(w.A.editor, findPos(w.A.editor, 'The plan'), 'Today, '), BASE_COVER)
await scenario('type right before the passage (at its start)', w => type(w.A.editor, findPos(w.A.editor, 'ships'), 'now '), BASE_COVER)
await scenario('type inside the passage', w => type(w.A.editor, findPos(w.A.editor, 'quarterly'), 'very '), { ...BASE_COVER, t1: 'ships very quarterly with design review' })
await scenario('type right after t1 (inside t2)', w => type(w.A.editor, findPos(w.A.editor, 'design review') + 13, 'X'), { ...BASE_COVER, t2: 'design reviewX notes' })
await scenario('type right after the passage', w => type(w.A.editor, findPos(w.A.editor, 'notes') + 5, '!'), BASE_COVER)
await scenario('delete a word inside the passage', w => { select(w.A.editor, 'quarterly '); w.A.editor.commands.keyboardShortcut('Backspace') }, { ...BASE_COVER, t1: 'ships with design review' })
await scenario('Enter in the middle of the passage', w => key(w.A.editor, findPos(w.A.editor, 'with design'), 'Enter'), { ...BASE_COVER, t1: 'ships quarterly |with design review' })
await scenario('Enter before the passage (mid-paragraph)', w => key(w.A.editor, findPos(w.A.editor, 'ships'), 'Enter'), BASE_COVER)
await scenario('Enter at the start of the paragraph', w => key(w.A.editor, findPos(w.A.editor, 'The plan'), 'Enter'), BASE_COVER)
await scenario('Backspace joining p2 into p1', w => key(w.A.editor, findPos(w.A.editor, 'Second'), 'Backspace'), BASE_COVER, { note: 'p2 joined' })
await scenario('Backspace joining p1 into the heading', w => key(w.A.editor, findPos(w.A.editor, 'The plan'), 'Backspace'), BASE_COVER)
await scenario('type change: paragraph → heading', w => { w.A.editor.chain().setTextSelection(findPos(w.A.editor, 'ships')).setNode('heading', { level: 2 }).run(); return blocks(w.A.editor).join(' ') }, BASE_COVER)
await scenario('type change: paragraph → bullet list item', w => { w.A.editor.chain().setTextSelection(findPos(w.A.editor, 'ships')).toggleBulletList().run(); return blocks(w.A.editor).join(' ') }, BASE_COVER)
await scenario('type change: paragraph → quote', w => { w.A.editor.chain().setTextSelection(findPos(w.A.editor, 'ships')).toggleBlockquote().run(); return blocks(w.A.editor).join(' ') }, BASE_COVER)
await scenario('type change: paragraph → code block (S1\'s codeBlock admits only the attribution marks)', w => { w.A.editor.chain().setTextSelection(findPos(w.A.editor, 'ships')).setNode('codeBlock').run(); return blocks(w.A.editor).join(' ') }, { t3: 'keeps going' }, { orphans: ['t1', 't2'] })
await scenario('cut the whole passage and paste it into p3', async w => {
  select(w.A.editor, 'ships quarterly with design review notes'); const c = clip(w.A.view, 'cut'); await w.settle()
  const mid = states(w.hostDoc, w.host)
  w.A.um().stopCapturing()
  w.A.editor.commands.setTextSelection(findPos(w.A.editor, 'Third paragraph.') + 16); pasteHTML(w.A.view, c.html, c.text)
  return `between cut and paste: ${mid}; clipboard ${c.html.length} B html`
}, BASE_COVER)
await scenario('cut part of the passage ("quarterly ") and paste into p3', async w => {
  select(w.A.editor, 'quarterly '); const c = clip(w.A.view, 'cut'); await w.settle(); w.A.um().stopCapturing()
  w.A.editor.commands.setTextSelection(findPos(w.A.editor, 'Third paragraph.') + 16); pasteHTML(w.A.view, c.html, c.text)
}, { ...BASE_COVER, t1: 'ships with design review' })
await scenario('copy the passage and paste it into p3', async w => {
  select(w.A.editor, 'ships quarterly with design review notes'); const c = clip(w.A.view, 'copy')
  w.A.editor.commands.setTextSelection(findPos(w.A.editor, 'Third paragraph.') + 16); pasteHTML(w.A.view, c.html, c.text)
  return `pasted text "${textOf(w.A.editor).split('\n')[3]}"`
}, BASE_COVER)
await scenario('cut, paste, then paste the same clipboard again', async w => {
  select(w.A.editor, 'ships quarterly with design review notes'); const c = clip(w.A.view, 'cut'); await w.settle(); w.A.um().stopCapturing()
  w.A.editor.commands.setTextSelection(findPos(w.A.editor, 'Third paragraph.') + 16); pasteHTML(w.A.view, c.html, c.text); await w.settle(); w.A.um().stopCapturing()
  w.A.editor.commands.setTextSelection(findPos(w.A.editor, 'Second paragraph')); pasteHTML(w.A.view, c.html, c.text)
}, BASE_COVER)
await scenario('paste a foreign comment span (another document)', w => {
  w.A.editor.commands.setTextSelection(findPos(w.A.editor, 'Third paragraph.') + 16)
  pasteHTML(w.A.view, '<span data-thread="tX">foreign</span> and <span data-thread="t1">a stray t1</span>', 'foreign')
}, BASE_COVER)
await scenario('CONTRAST without the paste dedupe: copy and paste', async w => {
  select(w.A.editor, 'ships quarterly with design review notes'); const c = clip(w.A.view, 'copy')
  w.A.editor.commands.setTextSelection(findPos(w.A.editor, 'Third paragraph.') + 16); pasteHTML(w.A.view, c.html, c.text)
}, { t1: 'ships quarterly with design review|ships quarterly with design review', t2: 'design review notes|design review notes', t3: 'keeps going' }, { opts: { paste: false } })
await scenario('delete the whole passage (orphans t1 and t2)', w => { select(w.A.editor, 'ships quarterly with design review notes'); w.A.editor.commands.keyboardShortcut('Backspace') }, { t3: 'keeps going' }, { orphans: ['t1', 't2'] })
await scenario('delete the whole paragraph p1 (block gone)', w => {
  const p = findPos(w.A.editor, 'The plan') - 1
  w.A.editor.chain().setNodeSelection(p).deleteSelection().run()
  return blocks(w.A.editor).join(' ')
}, { t3: 'keeps going' }, { orphans: ['t1', 't2'] })

log('── item 2: the agent rewrites the sentence (word diff on its replica) ──')
const P1 = 'The plan ships quarterly with design review notes. Owners track the budget.'
const agentRewrite = (text, opts) => w => { const r = rewriteBlock(w.agent.doc, w.agent.root, 'p1', text, opts); return `hunks ${J(r.hunks.map(h => P1.slice(h.from, h.to) + '→' + text.slice(h.nFrom, h.nTo)))}` }
await scenario('agent: one word inside (quarterly → monthly)', agentRewrite('The plan ships monthly with design review notes. Owners track the budget.'), { ...BASE_COVER, t1: 'ships monthly with design review' }, { undo: 'agent' })
await scenario('agent: rewords t2 in place (design review notes → a short summary)', agentRewrite('The plan ships quarterly with a short summary. Owners track the budget.'), { ...BASE_COVER, t1: 'ships quarterly with ', t2: 'a short summary' }, { undo: 'agent' })
await scenario('agent: same, strict rule (insertions only inside a comment)', agentRewrite('The plan ships quarterly with a short summary. Owners track the budget.', { inherit: 'inside' }), { t1: 'ships quarterly with ', t3: 'keeps going' }, { undo: 'agent', orphans: ['t2'] })
await scenario('agent: same, word hunks not merged across spaces (contrast)', agentRewrite('The plan ships quarterly with a short summary. Owners track the budget.', { mergeWhitespace: false }), { ...BASE_COVER, t1: 'ships quarterly with a short', t2: 'a short summary' }, { undo: 'agent' })
await scenario('agent: deletes t2\'s words', agentRewrite('The plan ships quarterly. Owners track the budget.'), { t1: 'ships quarterly', t3: 'keeps going' }, { undo: 'agent', orphans: ['t2'] })
await scenario('agent: rewrites the whole sentence', agentRewrite('Shipping is monthly now. Owners track the budget.'), { t3: 'keeps going' }, { undo: 'agent', orphans: ['t1', 't2'] })
await scenario('agent: type change (paragraph → heading, marks carried)', w => { retypeBlock(w.agent.doc, w.agent.root, 'p1', schema, 'heading', { level: 2 }); return w.agent.root.toArray().map(n => `${n.name}#${n.getAttr('id')}`).join(' ') }, BASE_COVER, { undo: 'agent' })
await scenario('agent: whole sentence, hunks not merged across spaces (contrast)', agentRewrite('Shipping is monthly now. Owners track the budget.', { mergeWhitespace: false }), { t1: ' is monthly', t2: 'is monthly now', t3: 'keeps going' }, { undo: 'agent' })

log('── item 1: create, overlap, resolve, reopen ──')
{
  const w = await base()
  const byteLog = () => w.hub.log.length
  check('create: overlapping t1 and t2 stored under two hashed keys', (() => { const d = J(w.agent.root.toArray()[1].toDelta().toJSON()); return (d.match(/comment--[A-Za-z0-9+/=]{8}/g) ?? []).filter((x, i, a) => a.indexOf(x) === i).length === 2 })())
  check('create: B highlights both open threads (decorations)', J(highlighted(w.B)) === J({ t1: 'ships quarterly with design review', t2: 'design review notes', t3: 'keeps going' }), J(highlighted(w.B)))
  const n0 = byteLog()
  resolve(w.B.doc, 't1', 'owner', now()); await w.settle()
  const resolveBytes = w.hub.log.slice(n0).map(e => e.v2.length)
  check('resolve on B: A stops highlighting t1, the mark stays in the text', !('t1' in highlighted(w.A)) && covered(w.A.editor).t1 === BASE_COVER.t1, `highlighted ${J(highlighted(w.A))}`)
  check('resolve: t1 listed as resolved on the agent replica', states(w.agent.doc, w.agent.root) === 't1:resolved t2:open t3:open')
  check('resolve: one update, no text write', resolveBytes.length === 1, `${resolveBytes.join(',')} B (V2)`)
  check('resolve: not in the owner\'s undo stack (Ctrl+Z does not reopen)', !w.B.um().canUndo())
  // the owner edits inside the resolved passage meanwhile; reopen from the agent's replica
  type(w.A.editor, findPos(w.A.editor, 'quarterly'), 'very '); await w.settle()
  reopen(w.agent.doc, 't1', 'agent:s1', now()); await w.settle()
  check('reopen (by the agent): A and B highlight t1 again, edits made while resolved included', highlighted(w.A).t1 === 'ships very quarterly with design review' && highlighted(w.B).t1 === highlighted(w.A).t1, highlighted(w.A).t1)
  // resolved and then its text deleted: reopening shows an orphan
  resolve(w.A.doc, 't2', 'owner', now()); await w.settle()
  select(w.A.editor, ' notes'); w.A.editor.commands.keyboardShortcut('Backspace'); select(w.A.editor, 'design review'); w.A.editor.commands.keyboardShortcut('Backspace'); await w.settle()
  check('resolved thread whose text is deleted is listed resolved, not orphaned', states(w.hostDoc, w.host).includes('t2:resolved') && !states(w.hostDoc, w.host).includes('t2:resolved:orphan'))
  reopen(w.B.doc, 't2', 'owner', now()); await w.settle()
  check('reopening it shows it orphaned (open, no live text)', states(w.hostDoc, w.host).includes('t2:open:orphan'), states(w.hostDoc, w.host))
  // a reply and the message list
  reply(w.agent.doc, 't1', { id: 't1:m1', by: 'agent:s1', at: now(), body: 'Changed to monthly.' }); await w.settle()
  check('reply: the thread lists both messages on A', getThread(w.A.doc, 't1').messages.map(m => m.by).join(',') === 'owner,agent:s1')
  // CONTRAST: resolve by flagging the mark (BlockNote's orphan attribute) instead of the map
  const n1 = byteLog()
  const rs = covered(w.A.editor)
  w.A.editor.chain().command(({ tr, state }) => { const m = state.schema.marks.comment; state.doc.descendants((n, pos) => { if (!n.isText) return; for (const mk of n.marks) if (mk.type === m && mk.attrs.threadId === 't3') { tr.removeMark(pos, pos + n.nodeSize, mk); tr.addMark(pos, pos + n.nodeSize, m.create({ threadId: 't3', orphan: true })) } }); return true }).run()
  await w.settle()
  const flagBytes = w.hub.log.slice(n1).map(e => e.v2.length)
  const keys = J(w.agent.root.toArray()[2].toDelta().toJSON()).match(/comment--[A-Za-z0-9+/=]{8}/g)
  check('CONTRAST flag-on-mark: rewrites the text\'s format under a new hashed key (orphan is part of the hash)', keys && !J(w.agent.root.toArray()[2].toDelta().toJSON()).includes('"orphan":false'), `${flagBytes.join(',')} B (V2) vs ${resolveBytes.join(',')} B for the map write; keys ${J([...new Set(keys)])}; marks ${J(rs.t3)}`)
}

log('── item 2: restart (reload from the stored state) ──')
{
  const w = await base()
  resolve(w.A.doc, 't2', 'owner', now()); type(w.A.editor, findPos(w.A.editor, 'quarterly'), 'very '); await w.settle()
  const state = Y.encodeStateAsUpdateV2(w.hostDoc)
  const w2 = await createWorld({ hostState: state })
  check('restart: marks back on both new editors', J(covered(w2.A.editor)) === J({ ...BASE_COVER, t1: 'ships very quarterly with design review' }) && J(covered(w2.B.editor)) === J(covered(w2.A.editor)), J(covered(w2.A.editor)))
  check('restart: threads and statuses back', states(w2.hostDoc, w2.host) === 't1:open t2:resolved t3:open')
  check('restart: resolved t2 not highlighted, t1 and t3 are', J(Object.keys(highlighted(w2.A))) === J(['t1', 't3']), J(highlighted(w2.A)))
  check('restart: t1\'s stored anchor still resolves to its passage', anchorText(w2) === 'ships very quarterly with design review', anchorText(w2))
  // the host's own load of the stored state is logged as actor 'host'; any editor write would be an owner:* row
  check('restart: no normalization write on bind', w2.hub.log.filter(e => e.actor.startsWith('owner')).length === 0, J(w2.hub.log.map(e => e.actor)))
}

log('── item 2: restore an older version (state-level, S3\'s revert) ──')
{
  const w = await base()
  const v1 = Y.encodeStateAsUpdateV2(w.hostDoc)
  resolve(w.B.doc, 't1', 'owner', now()); await w.settle()
  reply(w.agent.doc, 't1', { id: 't1:m1', by: 'agent:s1', at: now(), body: 'Done.' }); await w.settle()
  rewriteBlock(w.agent.doc, w.agent.root, 'p1', 'The plan ships quarterly. Owners track the budget.'); await w.settle()
  select(w.A.editor, 'Third'); commentSelection(w.A.editor, w.A.doc, { threadId: 't4', by: 'owner', at: now(), body: 'New one' }); await w.settle()
  check('before restore: t2 orphaned, t1 resolved, t4 new', states(w.hostDoc, w.host) === 't1:resolved t2:open:orphan t3:open t4:open', states(w.hostDoc, w.host))
  const live = Y.encodeStateAsUpdateV2(w.hostDoc)
  const t0 = performance.now()
  const upd = revertUpdate(v1, live)
  const ms = performance.now() - t0
  Y.applyUpdateV2(w.hostDoc, upd, { actor: 'owner:restore' }); await w.settle()
  check('restore: text and marks of v1 back on both editors (t2 un-orphaned by restore)', J(covered(w.A.editor)) === J(BASE_COVER) && J(covered(w.B.editor)) === J(BASE_COVER), J(covered(w.A.editor)))
  check('restore: thread statuses of v1 (t1 open again), t4 gone with its mark', states(w.hostDoc, w.host) === 't1:open t2:open t3:open', states(w.hostDoc, w.host))
  check('restore: replies made after v1 are reverted too (a product call; see findings)', getThread(w.hostDoc, 't1').messages.length === 1, `${getThread(w.hostDoc, 't1').messages.length} message(s)`)
  check('restore: A highlights the v1 open set', J(Object.keys(highlighted(w.A))) === J(['t1', 't2', 't3']))
  log(`  restore update ${upd.length} B (V2), computed in ${ms.toFixed(1)} ms`)
}
{
  // the variant: conversations are not document content (lib/restore.mjs restoreKeepingConversation)
  const w = await base()
  const v1 = Y.encodeStateAsUpdateV2(w.hostDoc)
  resolve(w.B.doc, 't1', 'owner', now()); await w.settle()
  reply(w.agent.doc, 't1', { id: 't1:m1', by: 'agent:s1', at: now(), body: 'Done.' }); await w.settle()
  rewriteBlock(w.agent.doc, w.agent.root, 'p1', 'The plan ships quarterly. Owners track the budget.'); await w.settle()
  select(w.A.editor, 'Third'); commentSelection(w.A.editor, w.A.doc, { threadId: 't4', by: 'owner', at: now(), body: 'New one' }); await w.settle()
  const n0 = w.hub.log.length
  restoreKeepingConversation(w.hostDoc, v1, { actor: 'owner:restore' }); await w.settle()
  check('restore keeping conversations: v1\'s text, marks and statuses; t1 keeps the reply; t4 kept as an orphan; one update',
    J(covered(w.A.editor)) === J(BASE_COVER) && states(w.hostDoc, w.host) === 't1:open t2:open t3:open t4:open:orphan' && getThread(w.hostDoc, 't1').messages.length === 2 && w.hub.log.slice(n0).filter(e => e.actor === 'owner:restore').length === 1,
    `${states(w.hostDoc, w.host)}; t1 ${getThread(w.hostDoc, 't1').messages.length} messages; ${w.hub.log.slice(n0).map(e => `${e.actor}:${e.v2.length}`).join(' ')}`)
}

log('── item 3: orphan display ──')
{
  // (a) the passage deleted in place: the pair collapses to the gap where it was
  {
    const w = await base()
    select(w.A.editor, 'ships quarterly with design review notes'); w.A.editor.commands.keyboardShortcut('Backspace'); await w.settle()
    const t1 = threadStates(w.hostDoc, liveIdsY(w.host)).find(t => t.id === 't1')
    const where = locate(w.hostDoc, t1)
    const [s] = locateInView(w.A.view, t1)
    const ctx = s == null ? '∅' : w.A.editor.state.doc.textBetween(s - 9, s) + '‸' + w.A.editor.state.doc.textBetween(s, s + 7)
    check('orphan (a) passage deleted: quote, author, time and messages are in the record', t1.orphan && t1.quote === 'ships quarterly with design review' && t1.createdBy === 'owner' && t1.messages.length === 1)
    check('orphan (a): the pair resolves to the gap where the passage was, in p1', where.how === 'text' && where.blockId === 'p1' && ctx === 'The plan ‸. Owner', `${J(where)} ${J(ctx)}`)
    while (w.A.um().canUndo()) w.A.editor.commands.undo()
    await w.settle()
    check('orphan (a): un-orphaned by undo, with no thread write', states(w.hostDoc, w.host) === 't1:open t2:open t3:open' && J(covered(w.A.editor)) === J(BASE_COVER), states(w.hostDoc, w.host))
  }
  // (b) the whole block deleted: the block's own position in the root names the nearest surviving block
  {
    const w = await base()
    w.A.editor.chain().setNodeSelection(findPos(w.A.editor, 'The plan') - 1).deleteSelection().run(); await w.settle()
    const where = locate(w.hostDoc, getThread(w.hostDoc, 't1'))
    check('orphan (b) block deleted: the nearest surviving block is named', where.how === 'block-gap' && ['h1', 'p2'].includes(where.blockId), J(where))
  }
  // (c) Enter before the passage, then the passage deleted: without a refresh the pair points at the split point
  for (const refresh of [false, true]) {
    const w = await base()
    key(w.A.editor, findPos(w.A.editor, 'ships'), 'Enter'); await w.settle()
    if (refresh) { refreshAnchors(w.hostDoc, w.host); await w.settle() }
    select(w.A.editor, 'ships quarterly with design review notes'); w.A.editor.commands.keyboardShortcut('Backspace'); await w.settle()
    const where = locate(w.hostDoc, getThread(w.hostDoc, 't1'))
    const second = blocks(w.A.editor)[2].split('#')[1]
    check(`orphan (c) split then deleted, ${refresh ? 'after' : 'without'} the host refresh: the pair names ${refresh ? 'the passage\'s own block' : 'the block before (p1, the split point)'}`, refresh ? where.blockId === second && where.index === 0 : where.blockId === 'p1', `${J(where)}; blocks ${blocks(w.A.editor).join(' ')}`)
  }
  // (d) un-orphan by restore is in the restore section above; un-orphan by a remote peer's undo:
  {
    const w = await base()
    w.B.um().stopCapturing()
    select(w.B.editor, 'design review notes'); w.B.editor.commands.keyboardShortcut('Backspace'); await w.settle()
    const mid = states(w.hostDoc, w.host)
    type(w.A.editor, findPos(w.A.editor, 'Third'), 'Meanwhile. '); await w.settle()
    w.B.editor.commands.undo(); await w.settle()
    check('orphan (d): B deletes t2\'s text, A types elsewhere, B undoes: t2 live again on A', mid.includes('t2:open:orphan') && covered(w.A.editor).t2 === 'design review notes' && textOf(w.A.editor).includes('Meanwhile. Third'), `${mid} → ${states(w.hostDoc, w.host)}`)
  }
}

// ── the table ─────────────────────────────────────────────────────────────────────────────────────────────────
log('\n| Edit | t1 / t2 / t3 after (both replicas) | Threads | Edit update(s), V2 B | t1\'s stored pair resolves to | After the host refresh | Undo |')
log('|---|---|---|---|---|---|---|')
for (const r of rows) log(`| ${r.edit} | ${['t1', 't2', 't3'].map(k => r.marks[k] ?? '—').join(' / ')}${r.both ? '' : ' (B differs)'} | ${r.threads} | ${r.editBytes.join('+')} | ${J(r.anchorT1)} | ${r.refreshed.length ? `${J(r.anchorAfter)} (${r.refreshed.join(',')} rewritten, ${r.refreshBytes.join('+')} B)` : 'no rewrite'} | ${r.undo} |`)
for (const r of rows) { const n = typeof r.note === 'string' ? r.note : ''; if (r.orphanLocate || n) log(`  ${r.edit}: ${[n, r.orphanLocate].filter(Boolean).join('; ')}`) }
const failed = results.filter(r => !r.ok)
log(`\n${results.length - failed.length}/${results.length} checks passed`)
writeFileSync(new URL('./out/pins.json', import.meta.url), J({ results, rows }, null, 2))
writeFileSync(new URL('./out/pins.txt', import.meta.url), lines.join('\n') + '\n')
process.exit(0)
