// S1 scenario 6 helper: a deterministic editing history replayed through a version adapter, one transaction per
// keystroke-sized op (typing, backspace, word deletes, bold toggles, new paragraphs), so v13 and v14 encode the
// same history. Throwaway spike code (P3-0, S1).

const prng = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
const WORDS = 'the quick agent edits a document while the owner types notes about plans risks dates and tables'.split(' ')

/**
 * adapter: { blocks(): number, len(i): number, insert(i, pos, str), del(i, pos, n), bold(i, pos, n, on), addBlock(after, text), transact(fn) }
 */
export const simulate = (adapter, { ops = 20000, seed = 7 } = {}) => {
  const r = prng(seed)
  let typed = 0
  for (let k = 0; k < ops; k++) {
    const nb = adapter.blocks()
    const i = Math.floor(r() * nb)
    const len = adapter.len(i)
    const x = r()
    adapter.transact(() => {
      if (x < 0.80 || len < 8) {
        // type a word, one character per op, at a stable caret (end or a random word boundary)
        const pos = r() < 0.7 ? len : Math.floor(r() * (len + 1))
        const w = (pos > 0 ? ' ' : '') + WORDS[Math.floor(r() * WORDS.length)]
        adapter.insert(i, pos, w[typed % w.length] ?? 'x')
        typed++
      } else if (x < 0.92) {
        adapter.del(i, len - 1, 1) // backspace at the end
      } else if (x < 0.97) {
        const pos = Math.floor(r() * (len - 5)); adapter.del(i, pos, 1 + Math.floor(r() * 5))
      } else if (x < 0.995) {
        const pos = Math.floor(r() * (len - 4)); adapter.bold(i, pos, 4, r() < 0.6)
      } else {
        adapter.addBlock(i, WORDS[Math.floor(r() * WORDS.length)])
      }
    })
  }
}
