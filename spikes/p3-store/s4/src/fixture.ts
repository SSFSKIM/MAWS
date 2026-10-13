// S4 fixture: a document with ids, overlapping comments, bold and links, a list, a table, code, and a threads map;
// `midSized(n)` repeats sections to a mid-sized document for the numbers. Throwaway spike code.
import * as Y from '@y/y'
import { pmnodeToDelta } from '@y/prosemirror'
import type { Schema } from '@tiptap/pm/model'

export const seed = (schema: Schema, sections = 1) => {
  const s = schema
  const t = (text: string, marks: any[] = []) => s.text(text, marks)
  const b = s.marks.bold.create(); const link = s.marks.link.create({ href: 'https://example.com' })
  const c = (id: string) => s.marks.comment.create({ threadId: id })
  const blocks: any[] = []
  const threads: Record<string, { quote: string, orphan: boolean, by: string }> = {}
  for (let k = 0; k < sections; k++) {
    const x = sections === 1 ? '' : `s${k}`
    const th = (n: string) => `${n}${x}`
    blocks.push(s.nodes.heading.create({ id: `h${x}1`, level: 2 }, t(`Section ${k + 1} plan`)))
    // p1: "The quick brown fox jumps over the lazy dog." t1 over "quick brown", t2 over "brown fox" (overlap), bold "lazy", link "dog"
    blocks.push(s.nodes.paragraph.create({ id: `p${x}1` }, [
      t('The '), t('quick ', [c(th('t1'))]), t('brown', [c(th('t1')), c(th('t2'))]), t(' fox', [c(th('t2'))]),
      t(' jumps over the '), t('lazy', [b]), t(' '), t('dog', [link]), t('. It has two sentences.')
    ]))
    threads[th('t1')] = { quote: 'quick brown', orphan: false, by: 'human' }
    threads[th('t2')] = { quote: 'brown fox', orphan: false, by: 'human' }
    // p2: t3 over "scheduled for Friday"
    blocks.push(s.nodes.paragraph.create({ id: `p${x}2` }, [t('The review is '), t('scheduled for Friday', [c(th('t3'))]), t(' and the owner signs off after it.')]))
    threads[th('t3')] = { quote: 'scheduled for Friday', orphan: false, by: 'human' }
    blocks.push(s.nodes.paragraph.create({ id: `p${x}3` }, [t('A plain paragraph the human types into. '), t('Words', [c(th('t4'))]), t(' to keep.')]))
    threads[th('t4')] = { quote: 'Words', orphan: false, by: 'human' }
    blocks.push(s.nodes.bulletList.create({ id: `l${x}1` }, [
      s.nodes.listItem.create({ id: `li${x}1` }, s.nodes.paragraph.create({ id: `lp${x}1` }, t('first item'))),
      s.nodes.listItem.create({ id: `li${x}2` }, s.nodes.paragraph.create({ id: `lp${x}2` }, [t('second item with '), t('bold', [b])]))
    ]))
    const cell = (id: string, text: string, header = false) => s.nodes[header ? 'tableHeader' : 'tableCell'].create({ id }, s.nodes.paragraph.create({ id: `${id}p` }, text ? t(text) : undefined))
    blocks.push(s.nodes.table.create({ id: `tb${x}1` }, [
      s.nodes.tableRow.create({ id: `tr${x}0` }, [cell(`th${x}a`, 'Name', true), cell(`th${x}b`, 'Value', true)]),
      s.nodes.tableRow.create({ id: `tr${x}1` }, [cell(`td${x}1a`, 'alpha'), cell(`td${x}1b`, '1')]),
      s.nodes.tableRow.create({ id: `tr${x}2` }, [cell(`td${x}2a`, 'beta'), cell(`td${x}2b`, '2')])
    ]))
    blocks.push(s.nodes.codeBlock.create({ id: `c${x}1`, language: 'ts' }, t('const x = 1')))
    blocks.push(s.nodes.paragraph.create({ id: `p${x}4` }, t('Closing paragraph of this section, with enough words to look like prose that a person wrote.')))
  }
  const doc = s.nodes.doc.create(null, blocks)
  doc.check()
  return { doc, threads }
}

/** Write a seed into a Y.Doc's prose root and threads map. */
export const load = (ydoc: Y.Doc, schema: Schema, sections = 1, origin: unknown = { actor: 'import' }) => {
  const { doc, threads } = seed(schema, sections)
  ydoc.transact(() => {
    (ydoc.get('default') as any).applyDelta(pmnodeToDelta(doc))
    const th = ydoc.get('threads') as any
    for (const [k, v] of Object.entries(threads)) th.setAttr(k, v)
  }, origin)
  return doc
}
