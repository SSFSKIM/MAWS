// S7a probe: does a restore (S3's revert, `revertUpdate`) of a deck version bring the version back exactly, by the
// version's age, on a finished deck soak store? Counts the files (deck.json and slides) that differ from the version,
// and tries S3's structural diff (`diffUpdate`, paired by name and id) on the same pairs.
// Usage: node spikes/p3-store/s7/soak/deck/probe-restore.ts [deck-normal-delta]
import * as Y from '@y/y'
import { Store, DAY, HOUR } from '../store.mjs'
import { revertUpdate, diffUpdate, byId } from '../doc/restore.mjs'
import { revertUpdateFixed } from '../revert.mjs'
import { deckFiles } from './model.ts'

const tag = process.argv[2] ?? 'deck-normal-delta'
const store: any = new Store(`/tmp/p3-s7a/${tag}.sqlite`, { encoding: 'delta' }, { fresh: false })
const { doc: live } = store.load()
const next = Y.encodeStateAsUpdateV2(live)
const vs = store.versions(); const newest = vs.at(-1)
const differing = (a: any, b: any) => { const fa = deckFiles(a); const fb = deckFiles(b); return [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter(k => fa[k] !== fb[k]) }
for (const age of [2 * HOUR, DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 60 * DAY, 90 * DAY, 150 * DAY]) {
  const target = [...vs].reverse().find((v: any) => v.at <= newest.at - age)
  if (!target) continue
  const prev = store.stateAt(target.seq).state
  const old: any = new Y.Doc(); Y.applyUpdateV2(old, prev)
  const row: any = { age: age / HOUR + 'h', kind: target.kind, files: Object.keys(deckFiles(old)).length }
  for (const [name, fn] of [['revert', () => revertUpdate(prev, next)], ['revertFixed', () => revertUpdateFixed(prev, next)], ['diffById', () => diffUpdate(prev, next, { compare: byId })]] as const) {
    try {
      const t0 = performance.now(); const R = (fn as () => Uint8Array)(); const ms = Math.round(performance.now() - t0)
      const d: any = new Y.Doc(); Y.applyUpdateV2(d, next); if (R) Y.applyUpdateV2(d, R)
      const bad = differing(d, old)
      row[name] = { differing: bad.length, ms }; if (bad.length) row[name + 'First'] = bad.slice(0, 3).join(' ')
    } catch (e) { row[name] = 'throws: ' + (e as Error).message.slice(0, 60) }
  }
  console.log(JSON.stringify(row))
}
process.exit(0)
