// S7a (P3-0): the 200-page document (about 100k words) and the prose generator the simulated human and agent type from.
// Sections are shaped like a long design document: an h2, an optional h3, five paragraphs of 30 to 55 words with bold,
// italic, code and link marks, and in rotation a bullet list, a table (4 x 3 with row and cell ids), a code block, a
// callout, a task list, a quote and an inline image; comment marks on one paragraph in seven with a thread each.
// Built through the S1/S3 v14 writer (`pmnodeToDelta` with the S3 schema). Throwaway spike code.

// a deterministic PRNG (mulberry32) so a profile replays identically
export const rng = (seed = 1) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// ~330 words with a Zipf-like draw (common words much more frequent), so text compresses like prose
const WORDS = ('the of and to a in is that for it as with be on by this are we not or at from which an have will our can more ' +
  'one all their has but they its also these other been when there would each only than into should about such may two time ' +
  'new first after most use data work system design store version history document agent session editor review change model ' +
  'user team plan state update owner page block table slide deck section comment thread restore compare preview author ' +
  'release budget risk cost growth latency memory disk process host window panel library space project file export import ' +
  'format schema writer reader sync replica server client network cache index query search result report metric target ' +
  'baseline quarter month week day hour minute second level layer layout style theme token colour font type size width height ' +
  'margin border shadow image chart diagram code test build deploy merge branch commit issue ticket board wave child parent ' +
  'contract decision ruling finding spike bound policy rule limit default option setting value field record row column cell ' +
  'list item task note draft final summary context reason because however therefore although while during before between ' +
  'within without across against under over through around toward upon still already again often usually rarely never always ' +
  'quickly slowly carefully clearly simply directly roughly exactly nearly fully partly mostly largely strongly weakly ' +
  'important useful simple complex large small fast slow early late recent old current previous next last main local remote ' +
  'shared private public stable unstable safe risky open closed visible hidden active idle heavy light normal common rare ' +
  'measure compute render compress thin bucket compact merge split insert delete move rewrite replace keep drop grow shrink ' +
  'load save open close start stop read write send receive accept reject propose approve ship land track test verify check').split(/\s+/).filter(Boolean)
const zipf = WORDS.map((_, i) => 1 / Math.pow(i + 1, 0.9))
const cum = []; { let s = 0; for (const z of zipf) { s += z; cum.push(s) } }
const total = cum[cum.length - 1]
export const word = r => { const x = r() * total; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m } return WORDS[lo] }
export const sentence = (r, n = 10 + Math.floor(r() * 14)) => {
  const w = []; for (let i = 0; i < n; i++) w.push(word(r))
  if (n > 9 && r() < 0.4) w[Math.floor(n / 2)] += ','
  const s = w.join(' '); return s[0].toUpperCase() + s.slice(1) + '.'
}
export const words = (r, n) => { const w = []; for (let i = 0; i < n; i++) w.push(word(r)); return w.join(' ') }

const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text })
const para = (id, content) => ({ type: 'paragraph', attrs: { id }, content })

/** Plain paragraph content: sentences up to ~`n` words, with marks sprinkled in. */
export const proseContent = (r, nWords, { marks = true } = {}) => {
  const out = []
  let count = 0
  while (count < nWords) {
    const s = sentence(r)
    count += s.split(' ').length
    if (marks && r() < 0.25) {
      const ws = s.split(' '); const k = 1 + Math.floor(r() * (ws.length - 3))
      const mk = [[{ type: 'bold' }], [{ type: 'italic' }], [{ type: 'code' }], [{ type: 'link', attrs: { href: 'https://example.com/' + Math.floor(r() * 1e6) } }]][Math.floor(r() * 4)]
      out.push(t(ws.slice(0, k).join(' ') + ' '), t(ws[k], mk), t(' ' + ws.slice(k + 1).join(' ') + ' '))
    } else out.push(t(s + ' '))
  }
  const last = out[out.length - 1]; last.text = last.text.trimEnd()
  // merge adjacent unmarked runs (PM would)
  const merged = []
  for (const n of out) { const p = merged[merged.length - 1]; if (p && !p.marks && !n.marks) p.text += n.text; else merged.push({ ...n }) }
  return merged
}

/** One section's blocks. `k` names ids; `variant` rotates the extras. Returns {blocks, threads}. */
export const sectionBlocks = (r, k, variant, { comments = true } = {}) => {
  const blocks = []; const threads = []
  blocks.push({ type: 'heading', attrs: { level: 2, id: `${k}h` }, content: [t(`${k.toUpperCase()} ${words(r, 3 + Math.floor(r() * 4))}`)] })
  if (variant % 3 === 0) blocks.push({ type: 'heading', attrs: { level: 3, id: `${k}h3` }, content: [t(words(r, 4))] })
  for (let i = 1; i <= 5; i++) {
    const content = proseContent(r, 30 + Math.floor(r() * 26))
    if (comments && i === 2 && variant % 7 === 0) {
      const thId = `th-${k}`
      const first = content[0]; const cut = first.text.indexOf(' ', 20)
      if (cut > 0) {
        content.splice(0, 1, t(first.text.slice(0, cut), [{ type: 'comment', attrs: { threadId: thId, orphan: false } }]), t(first.text.slice(cut)))
        threads.push({ id: thId, quote: first.text.slice(0, cut) })
      }
    }
    blocks.push(para(`${k}p${i}`, content))
    if (i === 3 && variant % 11 === 5) blocks.push(para(`${k}img`, [t('Figure: '), { type: 'image', attrs: { src: `asset://img-${k}.png`, alt: words(r, 3), assetId: `img-${k}` } }, t(' ' + sentence(r, 8))]))
  }
  if (variant % 2 === 0) blocks.push({ type: 'bulletList', attrs: { id: `${k}ul` }, content: [1, 2, 3, 4].map(j => ({ type: 'listItem', attrs: { id: `${k}li${j}` }, content: [para(`${k}li${j}p`, proseContent(r, 8 + Math.floor(r() * 8), { marks: false }))] })) })
  if (variant % 4 === 1) blocks.push({ type: 'table', attrs: { id: `${k}t` }, content: [0, 1, 2, 3].map(ri => ({ type: 'tableRow', attrs: { id: `${k}r${ri}` }, content: [0, 1, 2].map(ci => ({ type: ri === 0 ? 'tableHeader' : 'tableCell', attrs: { id: `${k}r${ri}c${ci}` }, content: [para(`${k}r${ri}c${ci}p`, [t(ri === 0 ? words(r, 2) : ci === 0 ? words(r, 3) : String(Math.floor(r() * 10000)))])] })) })) })
  if (variant % 5 === 2) blocks.push({ type: 'codeBlock', attrs: { id: `${k}c`, language: ['js', 'ts', 'sql', 'json'][variant % 4] }, content: [t(Array.from({ length: 6 }, (_, j) => `const ${word(r)}${j} = ${word(r)}(${Math.floor(r() * 100)}) // ${words(r, 4)}`).join('\n'))] })
  if (variant % 6 === 3) blocks.push({ type: 'callout', attrs: { id: `${k}co`, tone: ['info', 'warn', 'tip'][variant % 3] }, content: [para(`${k}cop`, proseContent(r, 20))] })
  if (variant % 8 === 6) blocks.push({ type: 'taskList', attrs: { id: `${k}tl` }, content: [1, 2, 3].map(j => ({ type: 'taskItem', attrs: { id: `${k}ti${j}`, checked: r() < 0.5 }, content: [para(`${k}ti${j}p`, [t(sentence(r, 6))])] })) })
  if (variant % 9 === 4) blocks.push({ type: 'blockquote', attrs: { id: `${k}q` }, content: [para(`${k}qp`, proseContent(r, 25, { marks: false }))] })
  return { blocks, threads }
}

/** The whole document: `sections` sections (~250 words each; 400 ≈ 100k words ≈ 200 pages). */
export const bigDocJSON = (sections = 400, seed = 42) => {
  const r = rng(seed)
  const content = []; const threads = []
  for (let s = 0; s < sections; s++) {
    const out = sectionBlocks(r, `s${s}`, s)
    content.push(...out.blocks); threads.push(...out.threads)
  }
  return { json: { type: 'doc', content }, threads }
}

/** Word and character counts of a PM JSON doc. */
export const countText = json => {
  let chars = 0; let wordsN = 0; let blocks = 0
  const walk = n => { if (n.attrs?.id) blocks++; if (n.text) { chars += n.text.length; wordsN += n.text.split(/\s+/).filter(Boolean).length } for (const c of n.content ?? []) walk(c) }
  walk(json)
  return { chars, words: wordsN, blocks }
}
