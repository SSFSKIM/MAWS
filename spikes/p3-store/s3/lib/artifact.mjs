// S3 (P3-0): the artifact layouts on Yjs v14 YNodes, a seeded mid-sized document, a stand-in deck, and a canonical
// reading of a whole artifact for equality checks.
//   document: tabs   YNode attrs  tabId → YNode('tab') { title, order, body: YNode('doc') bound to Tiptap }
//             threads YNode attrs threadId → YNode('thread') { quote, resolved, author, anchor? }
//   deck:     deck   YNode attrs  { title, theme, ... }
//             slides YNode attrs  slideId → YNode('slide') { order (fractional), 'style:*', notes: YNode text,
//                                   elements: YNode attrs elementId → YNode('el') { tag, z, 'style:*', text: YNode } }
//             threads as above, anchored { slideId, elementId }
// Throwaway spike code.
import * as Y from '@y/y'
import { pmnodeToDelta, ynodeToPmnode } from '@y/prosemirror'

// a small deterministic PRNG so every run builds the same document
export const prng = (seed = 7) => () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const WORDS = 'the plan ships quarterly with design review notes owners budget risks timeline metrics agents draft final table code callout launch beta scope users latency memory store version history restore compare editor comment thread slide deck element'.split(' ')
const sentence = (r, n = 8 + Math.floor(r() * 10)) => { const w = []; for (let i = 0; i < n; i++) w.push(WORDS[Math.floor(r() * WORDS.length)]); const s = w.join(' '); return s[0].toUpperCase() + s.slice(1) + '.' }

/** A §4.4-shaped PM doc of `sections` sections (about 12 top-level blocks each); every block carries an id. */
export const midDocJSON = (sections = 25, seed = 7) => {
  const r = prng(seed)
  const blocks = []
  const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text })
  const p = (id, content) => ({ type: 'paragraph', attrs: { id }, content })
  for (let s = 0; s < sections; s++) {
    const k = `s${s}`
    blocks.push({ type: 'heading', attrs: { level: 2, id: `${k}h` }, content: [t(`Section ${s} ${sentence(r, 3).slice(0, -1)}`)] })
    blocks.push(p(`${k}p1`, [t(sentence(r) + ' '), t('bold words', [{ type: 'bold' }]), t(' and '), t('italic', [{ type: 'italic' }]), t(' with a '), t('link', [{ type: 'link', attrs: { href: 'https://example.com/' + s } }]), t('. ' + sentence(r))]))
    blocks.push(p(`${k}p2`, [t(sentence(r) + ' ' + sentence(r))]))
    blocks.push({ type: 'heading', attrs: { level: 3, id: `${k}h3` }, content: [t('Details ' + s)] })
    blocks.push({ type: 'bulletList', attrs: { id: `${k}ul` }, content: [
      { type: 'listItem', attrs: { id: `${k}li1` }, content: [p(`${k}li1p`, [t(sentence(r, 6))])] },
      { type: 'listItem', attrs: { id: `${k}li2` }, content: [p(`${k}li2p`, [t(sentence(r, 6))]), { type: 'bulletList', attrs: { id: `${k}ul2` }, content: [
        { type: 'listItem', attrs: { id: `${k}li3` }, content: [p(`${k}li3p`, [t(sentence(r, 5))])] }] }] }] })
    blocks.push({ type: 'taskList', attrs: { id: `${k}tl` }, content: [
      { type: 'taskItem', attrs: { id: `${k}ti1`, checked: false }, content: [p(`${k}ti1p`, [t('Task ' + sentence(r, 4))])] },
      { type: 'taskItem', attrs: { id: `${k}ti2`, checked: true }, content: [p(`${k}ti2p`, [t('Done ' + sentence(r, 4))])] }] })
    blocks.push({ type: 'blockquote', attrs: { id: `${k}q` }, content: [p(`${k}qp`, [t(sentence(r))])] })
    blocks.push({ type: 'codeBlock', attrs: { id: `${k}c`, language: 'js' }, content: [t(`const v${s} = ${s}\nconsole.log(v${s})`)] })
    blocks.push({ type: 'table', attrs: { id: `${k}t` }, content: [0, 1, 2].map(ri => ({ type: 'tableRow', attrs: { id: `${k}r${ri}` }, content: [0, 1, 2].map(ci => ({ type: ri === 0 ? 'tableHeader' : 'tableCell', attrs: { id: `${k}r${ri}c${ci}` }, content: [p(`${k}r${ri}c${ci}p`, [t(ri === 0 ? 'Head ' + ci : `v${ri}${ci}`)])] })) })) })
    blocks.push({ type: 'callout', attrs: { id: `${k}co`, tone: 'info' }, content: [p(`${k}cop`, [t(sentence(r, 6))])] })
    blocks.push(p(`${k}p3`, [t('Figure '), { type: 'image', attrs: { src: `asset://img${s}.png`, alt: `figure ${s}`, assetId: `img${s}` } }, t(' ' + sentence(r, 5))]))
    blocks.push(p(`${k}p4`, [t(sentence(r))]))
  }
  return { type: 'doc', content: blocks }
}

/** Seed a document artifact: tab t1 (the mid-sized body), tab t2 (a small appendix), two open threads. */
export const seedDocument = (doc, schema, { sections = 25 } = {}) => {
  doc.transact(() => {
    const tabs = doc.get('tabs')
    const mk = (id, title, order, json) => {
      const t = new Y.Node('tab'); tabs.setAttr(id, t)
      t.setAttr('title', title); t.setAttr('order', order)
      const body = new Y.Node('doc'); t.setAttr('body', body)
      body.applyDelta(pmnodeToDelta(schema.nodeFromJSON(json)))
    }
    const main = midDocJSON(sections)
    // two comment marks: th1 on "bold words" of s0p1, th2 on the first sentence of s1p2
    const s0p1 = main.content.find(b => b.attrs.id === 's0p1')
    s0p1.content[1].marks.push({ type: 'comment', attrs: { threadId: 'th1', orphan: false } })
    const s1p2 = main.content.find(b => b.attrs.id === 's1p2')
    s1p2.content[0].marks = [{ type: 'comment', attrs: { threadId: 'th2', orphan: false } }]
    mk('t1', 'Main', 'a0', main)
    mk('t2', 'Appendix', 'a1', { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1, id: 'x1' }, content: [{ type: 'text', text: 'Appendix' }] },
      { type: 'paragraph', attrs: { id: 'x2' }, content: [{ type: 'text', text: 'Raw numbers live here.' }] },
      { type: 'paragraph', attrs: { id: 'x3' }, content: [{ type: 'text', text: 'This paragraph will be deleted.' }] }] })
    const threads = doc.get('threads')
    const th = (id, quote, author) => { const n = new Y.Node('thread'); threads.setAttr(id, n); n.setAttr('quote', quote); n.setAttr('resolved', false); n.setAttr('author', author) }
    th('th1', 'bold words', 'human')
    th('th2', s1p2.content[0].text, 'human')
  }, { actor: 'import' })
}

export const tabBody = (doc, tabId) => doc.get('tabs').getAttr(tabId)?.getAttr('body')

/** Seed a stand-in deck: `n` slides, five elements each, notes, a thread anchored to an element. */
export const seedDeck = (doc, { n = 12 } = {}) => {
  doc.transact(() => {
    const deck = doc.get('deck')
    deck.setAttr('title', 'Launch review'); deck.setAttr('theme', 'maws-default'); deck.setAttr('v', 4)
    const slides = doc.get('slides')
    for (let i = 1; i <= n; i++) {
      const s = new Y.Node('slide'); slides.setAttr(`s${i}`, s)
      s.setAttr('order', `a${String(i).padStart(2, '0')}`)
      s.setAttr('style:background', i % 2 ? '#ffffff' : '#f4f4f4')
      const notes = new Y.Node('notes'); s.setAttr('notes', notes); notes.insert(0, `Speaker notes for slide ${i}.`)
      const els = new Y.Node('elements'); s.setAttr('elements', els)
      for (let j = 1; j <= 5; j++) {
        const e = new Y.Node('el'); els.setAttr(`e${j}`, e)
        e.setAttr('tag', j === 1 ? 'h1' : j === 5 ? 'img' : 'div')
        e.setAttr('z', `a${j}`)
        e.setAttr('style:left', `${128 + j * 40}px`); e.setAttr('style:top', `${128 + j * 90}px`); e.setAttr('style:width', '600px')
        if (j !== 5) { const tx = new Y.Node('text'); e.setAttr('text', tx); tx.insert(0, j === 1 ? `Slide ${i} title` : `Body text ${i}.${j}`) }
        else e.setAttr('attr:src', `asset://s${i}.png`)
      }
    }
    const threads = doc.get('threads')
    const t = new Y.Node('thread'); threads.setAttr('dk1', t); t.setAttr('quote', 'Slide 3 title'); t.setAttr('resolved', false); t.setAttr('anchor', { slideId: 's3', elementId: 'e1' })
  }, { actor: 'import' })
}

/** Canonical JSON of a whole artifact: every root type rendered deep (attrs, children, text formats). */
export const canon = (doc, schema) => {
  const out = {}
  for (const name of [...doc.share.keys()].sort()) {
    const root = doc.get(name)
    if (name === 'tabs') {
      out.tabs = {}
      for (const [id, tab] of Object.entries(root.getAttrs()).sort()) {
        if (!(tab instanceof Y.Node)) continue
        out.tabs[id] = { title: tab.getAttr('title'), order: tab.getAttr('order'), body: ynodeToPmnode(tab.getAttr('body'), schema).toJSON() }
      }
    } else {
      out[name] = root.toDeltaDeep().toJSON()
    }
  }
  return out
}

/** Block ids of a tab body in document order. */
export const blockIds = body => { const ids = []; const walk = n => { for (const c of n.toArray()) if (c instanceof Y.Node) { const id = c.getAttr('id'); if (id != null) ids.push(id); walk(c) } }; walk(body); return ids }

/** Comment marks (threadId set) present in a PM JSON doc. */
export const commentThreads = json => { const s = new Set(); const walk = n => { for (const m of n.marks ?? []) if (m.type === 'comment') s.add(m.attrs.threadId); for (const c of n.content ?? []) walk(c) }; walk(json); return [...s].sort() }
