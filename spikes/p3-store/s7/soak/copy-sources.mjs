// S7a (P3-0): copies the S6 deck model and fixture into soak/deck/ with a provenance header, so the soak loads one
// @y/y and one prosemirror-model (S6's pitfalls: a cross-package import trips v14's duplicate guard). Re-run to refresh.
// Usage: node spikes/p3-store/s7/soak/copy-sources.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const store = join(here, '..', '..')
const head = execFileSync('git', ['-C', store, 'rev-parse', '--short', 'HEAD']).toString().trim()
const files = [
  ['s6/src/ydoc.ts', 'deck/ydoc.ts'], ['s6/src/model.ts', 'deck/model.ts'], ['s6/src/publish.ts', 'deck/publish.ts'],
  ['s6/src/parse.ts', 'deck/parse.ts'], ['s6/src/parse5-adapter.ts', 'deck/parse5-adapter.ts'], ['s6/src/ir.ts', 'deck/ir.ts'],
  ['s6/src/order.ts', 'deck/order.ts'], ['s6/src/serialize.ts', 'deck/serialize.ts'], ['s6/src/css.ts', 'deck/css.ts'],
  ['s6/fixtures/claude-examples.ts', 'deck/claude-examples.ts'],
  // history: showEditors also returns the raw time (`atMs`), so the soak can compare dates across months
  ['s3/lib/history.mjs', 'doc/history.mjs', s => s.replace('.map(e => ({ who: e.who, at: iso(e.at),', () => '.map(e => ({ who: e.who, at: iso(e.at), atMs: e.at /* S7a edit */,')],
['s3/lib/restore.mjs', 'doc/restore.mjs'], ['s3/lib/provenance.mjs', 'doc/provenance.mjs'],
  ['s1/lib/tiptap.mjs', 'doc/tiptap.mjs'],
  // the bench's seven slide shapes (s6/exp/bench.ts, from `const words` to `const N = 100`), exported
  ['s6/exp/bench.ts', 'deck/shapes.ts', s => "import { claudeExamples } from './claude-examples.ts'\n" +
    s.slice(s.indexOf('const words = '), s.indexOf('const N = 100')).replace('const shapes:', 'export const shapes:') + 'export { w, foot }\n'],
  // schema: two import lines re-pointed (S1's helper copied beside it; S3's collab.mjs pulls the editor binding, so its
  // one-line `isBindingTransaction` is inlined)
  ['s3/lib/schema.mjs', 'doc/schema.mjs', s => s
    .replace("import { tiptapSub } from '../../s1/lib/tiptap.mjs'", () => "import { tiptapSub } from './tiptap.mjs'")
    .replace("import { isBindingTransaction } from './collab.mjs'", () => "const isBindingTransaction = tr =>\n  tr.getMeta('y-sync-transaction') != null || tr.getMeta('y-sync-append') != null || tr.getMeta('y-sync$') != null // inlined from s3/lib/collab.mjs")
    .replace("new URL('../node_modules', import.meta.url)", () => "new URL('../../node_modules', import.meta.url)")]
]
for (const [from, to, edit] of files) {
  let src = readFileSync(join(store, from), 'utf8')
  const note = edit ? 'edited as s7/soak/copy-sources.mjs describes' : 'unchanged below this line'
  if (edit) { const before = src; src = edit(src); if (src === before) throw new Error('edit did not apply: ' + from) }
  const out = join(here, to)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `// COPY of spikes/p3-store/${from} at ${head} for S7a (${note}).\n` + src)
}
console.log(`copied ${files.length} files at ${head}`)
