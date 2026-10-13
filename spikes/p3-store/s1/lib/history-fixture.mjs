// S1 scenario 3 fixture shared by v13 and v14: the seed document (v1), the expected attributed diff to v2, and a
// span extractor over the rendered ProseMirror JSON. Edits themselves are version-specific (Y op APIs differ).
// Throwaway spike code (P3-0, S1).

export const seedJSON = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2, id: 'h1' }, content: [{ type: 'text', text: 'Quarterly plan' }] },
    { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'The human wrote this opening sentence. It has a second sentence.' }] },
    { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'Agent will rewrite the middle of this paragraph soon.' }] },
    { type: 'codeBlock', attrs: { language: 'js', id: 'c1' }, content: [{ type: 'text', text: 'const a = 1\nconst b = 2' }] },
    {
      type: 'table', attrs: { id: 't1' }, content: [
        { type: 'tableRow', attrs: { id: 'r1' }, content: [
          { type: 'tableHeader', attrs: { id: 'th1' }, content: [{ type: 'paragraph', attrs: { id: 'th1p' }, content: [{ type: 'text', text: 'Name' }] }] },
          { type: 'tableHeader', attrs: { id: 'th2' }, content: [{ type: 'paragraph', attrs: { id: 'th2p' }, content: [{ type: 'text', text: 'Value' }] }] }
        ] },
        { type: 'tableRow', attrs: { id: 'r2' }, content: [
          { type: 'tableCell', attrs: { id: 'td1' }, content: [{ type: 'paragraph', attrs: { id: 'td1p' }, content: [{ type: 'text', text: 'alpha' }] }] },
          { type: 'tableCell', attrs: { id: 'td2' }, content: [{ type: 'paragraph', attrs: { id: 'td2p' }, content: [{ type: 'text', text: '1' }] }] }
        ] }
      ]
    },
    { type: 'paragraph', attrs: { id: 'p4' }, content: [{ type: 'text', text: 'Closing line.' }] }
  ]
}

// What a correct diff from v1 to v2 shows (the edits each version's script makes). `kind`: ins | del | fmt | attrs.
export const expected = [
  { id: 'human-ins-p1', kind: 'ins', who: 'human', text: ' Added by human.', where: 'paragraph#p1' },
  { id: 'agent-ins-p1', kind: 'ins', who: 'agent:session-1', text: ' (agent note)', where: 'paragraph#p1' },
  { id: 'human-bold-p1', kind: 'fmt', who: 'human', text: 'opening', where: 'paragraph#p1' },
  { id: 'agent-del-p2', kind: 'del', who: 'agent:session-1', text: 'the middle of', where: 'paragraph#p2' },
  { id: 'agent-ins-p2', kind: 'ins', who: 'agent:session-1', text: 'a part of', where: 'paragraph#p2' },
  { id: 'agent-new-para', kind: 'ins', who: 'agent:session-1', text: 'Agent inserted paragraph.', where: 'paragraph#pA' },
  { id: 'human-heading-level', kind: 'attrs', who: 'human', attr: 'level', where: 'heading#h1' },
  { id: 'agent-code-del', kind: 'del', who: 'agent:session-1', text: '2', where: 'codeBlock#c1' },
  { id: 'agent-code-ins', kind: 'ins', who: 'agent:session-1', text: '3\nconst c = 4', where: 'codeBlock#c1' },
  { id: 'agent-code-lang', kind: 'attrs', who: 'agent:session-1', attr: 'language', where: 'codeBlock#c1' },
  { id: 'agent-cell-del', kind: 'del', who: 'agent:session-1', text: '1', where: 'paragraph#td2p' },
  { id: 'agent-cell-ins', kind: 'ins', who: 'agent:session-1', text: '42', where: 'paragraph#td2p' },
  { id: 'human-del-p4', kind: 'del', who: 'human', text: 'Closing ', where: 'paragraph#p4' }
]

/**
 * Flatten a rendered PM JSON doc into attributed spans: text spans with their attribution kind and user, and node
 * spans for node-level attribution. `read` maps a mark to {kind, who, attr?} or null (version-specific mark shapes).
 */
export const spans = (json, read) => {
  const out = []
  const walk = (node, where) => {
    const here = node.type === 'doc' ? null : `${node.type}#${node.attrs?.id ?? '?'}`
    if (node.type !== 'text') for (const m of node.marks ?? []) for (const r of [].concat(read(m, node) ?? [])) out.push({ ...r, where: here, node: true, text: textOf(node) })
    if (node.type !== 'text' && node.attrs) for (const r of [].concat(read({ type: '__nodeattrs', attrs: node.attrs }, node) ?? [])) out.push({ ...r, where: here, node: true, text: textOf(node) })
    if (node.type === 'text') {
      const rs = (node.marks ?? []).flatMap(m => [].concat(read(m, node) ?? []))
      if (rs.length === 0) out.push({ kind: 'none', text: node.text, where })
      for (const r of rs) out.push({ ...r, text: node.text, where })
    }
    for (const c of node.content ?? []) walk(c, here ?? where)
  }
  walk(json, null)
  // merge adjacent spans of the same kind/who/where (the binding may split runs)
  const merged = []
  for (const s of out) {
    const last = merged[merged.length - 1]
    if (last && !s.node && !last.node && last.kind === s.kind && last.who === s.who && last.where === s.where && last.attr === s.attr) last.text += s.text
    else merged.push({ ...s })
  }
  return merged
}
const textOf = n => n.text ?? (n.content ?? []).map(textOf).join('')

/** Score a span list against `expected`: each expectation is met when a span of that kind/who/where contains the text (or names the attr). */
export const score = list => expected.map(e => {
  const hit = list.find(s => s.kind === e.kind && s.where === e.where && (e.attr ? s.attr === e.attr : (s.text ?? '').includes(e.text)))
  return { ...e, ok: !!hit && hit.who === e.who, got: hit ? `${hit.kind} by ${hit.who}${hit.at ? ' at ' + hit.at : ''}` : 'not rendered' }
})
