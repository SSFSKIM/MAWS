// S4 (P3-0): the agent's markdown, minimal version. GFM through @tiptap/markdown (the schema module's own extension
// list, so every block type serializes the way the editor parses it) with Obsidian-style `^id` markers: at the end of
// a one-line block, on its own line after a multi-line one (list, table, code, quote). Reads give ids; writes strip any
// markers and mint fresh ids for everything parsed (the writer re-applies a kept id where an op says so).
// Throwaway spike code; P3-B owns the real reader (ranges, `sinceRevision`, chips).
import { MarkdownManager } from '@tiptap/markdown'
import { generateUniqueIds } from '@tiptap/extension-unique-id'
import type { AnyExtension } from '@tiptap/core'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { ynodeToPmnode } from '@y/prosemirror'

const MARKER_EOL = / \^[a-z0-9]{2,16}$/gm
const MARKER_LINE = /^\^[a-z0-9]{2,16}\n?/gm

export class DocMarkdown {
  readonly md: MarkdownManager
  readonly schema: Schema
  readonly exts: AnyExtension[]
  constructor (schema: Schema, exts: AnyExtension[]) {
    this.schema = schema; this.exts = exts
    this.md = new MarkdownManager({ extensions: exts })
  }

  /** One block's markdown, no marker. */
  block (node: PMNode): string {
    return this.md.serialize(this.schema.nodes.doc.create(null, [node]).toJSON()).trim()
  }

  /** The whole document (a Y root) as the agent reads it: blocks separated by blank lines, each with its `^id`. */
  read (root: any): string {
    const doc = ynodeToPmnode(root, this.schema)
    const out: string[] = []
    doc.forEach(b => {
      const text = this.block(b)
      const id = b.attrs.id
      out.push(id == null ? text : (text.includes('\n') || b.type.name === 'codeBlock' ? `${text}\n^${id}` : `${text} ^${id}`))
    })
    return out.join('\n\n') + '\n'
  }

  /** Parse agent markdown into top-level PM blocks, markers stripped, every block id'd fresh by `generateID`. */
  parse (markdown: string): PMNode[] {
    const clean = markdown.replace(MARKER_EOL, '').replace(MARKER_LINE, '')
    const json = generateUniqueIds(this.md.parse(clean), this.exts)
    const doc = this.schema.nodeFromJSON(json)
    doc.check()
    const blocks: PMNode[] = []
    doc.forEach(b => blocks.push(b))
    return blocks
  }
}
