// S5 (P3-0) item 5: how a comment appears in the agent's markdown read, and one worked example of the agent answering
// a comment through artifact_comments / artifact_edit (replace_text, `answering`) / artifact_reply / artifact_resolve,
// all on the agent's replica, with the owner's editors watching. Run:
//   node spikes/p3-store/s5/s5-read.mjs     (writes spikes/p3-store/s5/out/read.txt and read.json)
import './lib/dom.mjs'
import { writeFileSync } from 'node:fs'
import { createWorld, select, findPos, covered, highlighted, states, commentSelection, now, schema } from './lib/world.mjs'
import { extensions } from './lib/schema.mjs'
import { getThread, resolve } from './lib/comments.mjs'
import { createReader, artifactComments, artifactReply, artifactResolve, replaceText, stripMarkers } from './lib/read.mjs'

const results = []
const lines = []
const log = s => { lines.push(s); console.log(s) }
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }
const J = x => JSON.stringify(x)

const w = await createWorld()
const { A, B, agent } = w
// bold inside a comment, two overlapping comments, one resolved, one orphaned
A.editor.chain().setTextSelection({ from: findPos(A.editor, 'quarterly'), to: findPos(A.editor, 'quarterly') + 9 }).setMark('bold').run()
select(A.editor, 'ships quarterly with design review'); commentSelection(A.editor, A.doc, { threadId: 't1', by: 'owner', at: now(), body: 'Should this be monthly?' })
select(A.editor, 'design review notes'); commentSelection(A.editor, A.doc, { threadId: 't2', by: 'owner', at: now(), body: 'Which notes? Link them.' })
select(A.editor, 'keeps going'); commentSelection(A.editor, A.doc, { threadId: 't3', by: 'owner', at: now(), body: 'Too vague.' })
select(A.editor, 'Third'); commentSelection(A.editor, A.doc, { threadId: 't4', by: 'owner', at: now(), body: 'Rename this.' })
await w.settle()
resolve(B.doc, 't3', 'owner', now())
select(A.editor, 'Third '); A.editor.commands.keyboardShortcut('Backspace')
await w.settle()

const reader = createReader(schema, extensions())
const r1 = reader.read(agent.doc, agent.root)
log('── the agent\'s read (artifact_read) ──\n' + r1)
check('read: open comments as milestones, overlap expressed by named closing tags', r1.includes('The plan <c:t1>ships **quarterly** with <c:t2>design review</c:t1> notes</c:t2>. Owners track the budget. ^p1'), r1.split('\n')[2])
check('read: the resolved thread is not marked', !r1.includes('c:t3>') && r1.includes('Second paragraph keeps going here. ^p2'))
check('read: the footer lists open threads, the orphan with its quote and nearest block', /c:t4 orphaned \(its text was deleted; was "Third", near \^p3\)/.test(r1) && r1.includes('1 resolved'))
check('read: stripping the markers gives the plain markdown', stripMarkers(r1.split('\n---\n')[0]).includes('The plan ships **quarterly** with design review notes. Owners track the budget. ^p1'))

const list = artifactComments(agent.doc, agent.root, { status: 'open' })
log('── artifact_comments {status: "open"} ──\n' + JSON.stringify(list, null, 1))
check('artifact_comments: t1, t2 and orphaned t4, each with quote, block and messages', J(list.map(t => `${t.threadId}:${t.block ?? 'orphan@' + t.near}`)) === J(['t1:p1', 't2:p1', 't4:orphan@p3']))

// the agent answers t1: artifact_edit {ops: [replace_text {block: p1, old, new}], answering: 't1'}; `old` copied from
// its read with a marker in it (stripped by the host before matching)
const log0 = w.hub.log.length
const res = replaceText(agent.doc, agent.root, { block: 'p1', old: '<c:t1>ships quarterly', new: 'ships monthly' })
artifactReply(agent.doc, 't1', { by: 'agent:s1', at: now(), body: 'Edited ^p1: "ships quarterly" → "ships monthly".' }) // `answering: t1`
await w.settle()
check('edit answering t1: the comment stays on the reworded passage on both editors', covered(A.editor).t1 === 'ships monthly with design review' && covered(B.editor).t1 === covered(A.editor).t1, `${J(covered(A.editor))}; hunks ${J(res.hunks)}`)
check('edit answering t1: the reply is in the thread on the owner\'s side', getThread(A.doc, 't1').messages.map(m => m.by).join(',') === 'owner,agent:s1')
artifactResolve(agent.doc, 't1', { by: 'agent:s1', at: now() })
artifactReply(agent.doc, 't2', { by: 'agent:s1', at: now(), body: 'The notes are the review minutes; linking them needs the URL. Which one?' })
await w.settle()
const bytes = w.hub.log.slice(log0).map(e => `${e.actor}:${e.v2.length}`)
check('artifact_resolve t1: gone from A\'s highlight, still listed resolved; t2 open with the agent\'s question', !('t1' in highlighted(A)) && 't2' in highlighted(A) && states(w.hostDoc, w.host) === 't1:resolved t2:open t3:resolved t4:open:orphan', `${states(w.hostDoc, w.host)}; updates ${bytes.join(' ')}`)
const r2 = reader.read(agent.doc, agent.root)
log('── the read after the agent\'s turn ──\n' + r2)
check('read after: t1 unmarked (resolved), t2 still marked', !r2.includes('c:t1>') && r2.includes('<c:t2>design review notes</c:t2>'))
let refused = ''
try { replaceText(agent.doc, agent.root, { block: 'p1', old: 'ships **monthly**', new: 'x' }) } catch (e) { refused = e.message }
check('replace_text: markdown emphasis in `old` does not match plain text (S4\'s matching rule decides)', refused.includes('absent'), refused)

writeFileSync(new URL('./out/read.txt', import.meta.url), lines.join('\n') + '\n')
writeFileSync(new URL('./out/read.json', import.meta.url), J({ results, read: r1, comments: list, readAfter: r2 }, null, 2))
log(`\n${results.filter(r => r.ok).length}/${results.length} checks passed`)
process.exit(0)
