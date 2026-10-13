// S4 (P3-0): the word diff under the patch writer. A textblock's content is a sequence of cells (one per Y slot: a
// character, or an inline node as one embed slot) each with its Y format record (marks keyed as @y/prosemirror
// stores them: `bold`, `link`, `comment--<hash>`). Two cell sequences are diffed at word granularity (words, runs of
// whitespace, single punctuation, each embed) with fast-diff over a token alphabet, giving hunks in old coordinates.
// Throwaway spike code meant to be copied by P3-B.
import fastDiff from 'fast-diff'

export type Fmt = Record<string, any>
export interface Cell { ch: string, fmt: Fmt, embed?: unknown }
/** A change of old cells [from, to) into new cells [nFrom, nTo). Equal runs between hunks are implied. */
export interface Hunk { from: number, to: number, nFrom: number, nTo: number }

export const EMBED = '￼'

/** Cells of a lib0 delta's children (a Y node's `toDelta()` or `pmnodeToDelta(textblock)`). */
export const cellsOf = (d: any): Cell[] => {
  const out: Cell[] = []
  for (const op of d.children) {
    const fmt: Fmt = op.format ? { ...op.format } : {}
    if (typeof op.insert === 'string') for (const ch of op.insert) out.push({ ch, fmt })
    else for (const e of op.insert) out.push({ ch: EMBED, fmt, embed: e })
  }
  return out
}

const TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu

/** Token boundaries (UTF-16 offsets) of a cell string; embeds are always single tokens. */
const tokenize = (s: string): string[] => s.match(TOKEN) ?? []

/**
 * Word-level hunks between two cell sequences. Embeds compare by their JSON, text by characters; marks do not take
 * part (format changes on equal text are the caller's business).
 */
export const diffCells = (a: Cell[], b: Cell[], { mergeWhitespace = true } = {}): Hunk[] => {
  const key = (c: Cell) => (c.embed === undefined ? c.ch : EMBED + JSON.stringify(c.embed))
  const sa = a.map(c => c.ch).join('')
  const sb = b.map(c => c.ch).join('')
  // fast-diff works on UTF-16 strings; map each distinct token to one private-use code unit
  const alphabet = new Map<string, string>()
  const enc = (s: string, cells: Cell[]) => {
    let out = ''; const lens: number[] = []; let i = 0
    for (const t of tokenize(s)) {
      const k = t === EMBED ? key(cells[i]) : t
      let c = alphabet.get(k)
      if (c === undefined) {
        if (alphabet.size >= 0x18ff) throw new Error('diffCells: token alphabet exhausted')
        c = String.fromCharCode(0xe000 + alphabet.size); alphabet.set(k, c)
      }
      out += c; lens.push(t.length); i += t.length
    }
    return { out, lens }
  }
  // cells index by code point while strings index by UTF-16 unit: compare via code point arrays
  if ([...sa].length !== a.length || [...sb].length !== b.length) throw new Error('diffCells: astral characters unsupported in the spike')
  const ea = enc(sa, a); const eb = enc(sb, b)
  const hunks: Hunk[] = []
  let ia = 0; let ib = 0; let ta = 0; let tb = 0 // cell and token cursors
  let open: Hunk | null = null
  const span = (lens: number[], t: number, n: number) => { let s = 0; for (let k = t; k < t + n; k++) s += lens[k]; return s }
  for (const [op, text] of fastDiff(ea.out, eb.out)) {
    const n = text.length
    if (op === 0) {
      if (open) { hunks.push(open); open = null }
      ia += span(ea.lens, ta, n); ib += span(eb.lens, tb, n); ta += n; tb += n
    } else {
      open ??= { from: ia, to: ia, nFrom: ib, nTo: ib }
      if (op === -1) { ia += span(ea.lens, ta, n); ta += n; open.to = ia } else { ib += span(eb.lens, tb, n); tb += n; open.nTo = ib }
    }
  }
  if (open) hunks.push(open)
  if (!mergeWhitespace) return hunks
  // §4.4 A5 (S5): two hunks separated only by whitespace are one change; a token diff otherwise matches the spaces
  // of a rewritten sentence and leaves comments on stray words
  const merged: Hunk[] = []
  for (const h of hunks) {
    const prev = merged[merged.length - 1]
    if (prev && /^\s*$/.test(sa.slice(prev.to, h.from))) { prev.to = h.to; prev.nTo = h.nTo } else merged.push({ ...h })
  }
  return merged
}

/** Old-index → new-index map for the equal cells of a diff (undefined where the old cell was changed). */
export const equalMap = (aLen: number, hunks: Hunk[]): (number | undefined)[] => {
  const map: (number | undefined)[] = new Array(aLen)
  let shift = 0; let i = 0
  for (const h of hunks) {
    for (; i < h.from; i++) map[i] = i + shift
    i = h.to; shift += (h.nTo - h.nFrom) - (h.to - h.from)
  }
  for (; i < aLen; i++) map[i] = i + shift
  return map
}

export const sameFmtValue = (a: any, b: any) => a === b || JSON.stringify(a) === JSON.stringify(b)
