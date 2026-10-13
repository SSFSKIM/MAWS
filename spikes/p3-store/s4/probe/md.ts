// S4 probe: which marks the agent's markdown can express (serialize → parse keeps the mark).
import { extensions } from '../src/schema.ts'
import { getSchema } from '@tiptap/core'
import { DocMarkdown } from '../src/markdown.ts'
const exts = extensions({ generateID: () => 'x' })
const schema = getSchema(exts)
const md = new DocMarkdown(schema, exts)
for (const name of Object.keys(schema.marks)) {
  const attrs = name === 'link' ? { href: 'https://e.x' } : name === 'comment' ? { threadId: 't1' } : null
  const p = schema.nodes.paragraph.create({ id: 'p' }, [schema.text('a '), schema.text('word', [schema.marks[name].create(attrs)]), schema.text(' b')])
  let s = '', back = ''
  try { s = md.block(p); const blocks = md.parse(s); back = JSON.stringify(blocks[0].toJSON().content) } catch (e) { back = 'ERR ' + (e as Error).message }
  console.log(name.padEnd(22), JSON.stringify(s).padEnd(40), back.includes(`"${name}"`) ? 'KEPT' : 'lost', back.slice(0, 160))
}
const p = schema.nodes.paragraph.create({ id: 'p' }, [schema.text('Line one'), schema.nodes.hardBreak.create(), schema.text('two')])
console.log('hardBreak', JSON.stringify(md.block(p)), JSON.stringify(md.parse(md.block(p))[0].toJSON()))
console.log(md.parse('## Head ^abc\n\nPara *x* ^p2\n\n- a\n- b\n^l1')[1].toJSON())
