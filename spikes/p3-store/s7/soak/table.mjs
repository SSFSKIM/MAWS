// S7a: the month-by-month table of one or more soak outputs (s7/out/<tag>.json), as text.
// Usage: node spikes/p3-store/s7/soak/table.mjs doc-normal-delta [deck-heavy-delta …]
import { readFileSync } from 'node:fs'
const kb = b => (b / 1024).toFixed(0)
const mb = b => (b / 1048576).toFixed(2)
for (const tag of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(new URL(`../out/${tag}.json`, import.meta.url), 'utf8'))
  console.log(`\n${tag}: ${r.updates} updates, ${r.clients} clients, counts ${JSON.stringify(r.counts)}, sim ${r.simSeconds}s, versions written ${r.counters.versions} (${r.counters.keyframes} keyframes, ${mb(r.counters.versionBytesWritten)} MB), head writes ${r.counters.headWrites} (${mb(r.counters.headBytesWritten)} MB), land ${(r.counters.landMs / r.counters.lands * 1000).toFixed(0)} µs/update, version ${(r.counters.versionMs / r.counters.versions).toFixed(1)} ms each`)
  console.log('| m | live V2 KB (fresh import) | text | log rows / KB | versions n (full/delta) / KB | head KB | prov rows / KB (update/hour/day) | assets MB (n) | db file MB (+WAL) | load ms (tail) | preview ms vs (version) [state/attr/open/render] changes | restore ms / KB | Show editors | versions verified |')
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const m of r.months) {
    const s = m.sizes; const t = s.tables
    const tiers = ['update', 'hour', 'day'].map(k => s.tiers[k] ? `${s.tiers[k].n}` : '0').join('/')
    const encs = `${s.encs.full?.n ?? 0}/${s.encs.delta?.n ?? 0}`
    const pv = m.preview ? `${m.preview.ms.total} vs ${m.preview.versionAt.slice(0, 10)} ${m.preview.kind} [${m.preview.ms.state}/${m.preview.ms.attributions}/${m.preview.ms.openDiff}/${m.preview.ms.render}] ${m.preview.changes ?? JSON.stringify(m.preview.changed)}` : '—'
    const text = m.text ? `${(m.text.words / 1000).toFixed(0)}k words` : `${m.slides} slides`
    console.log(`| ${m.month} | ${kb(m.live.v2)} (${kb(m.live.freshImport)}) | ${text} | ${t.log.rows} / ${kb(t.log.bytes)} | ${s.kinds ? Object.values(s.kinds).reduce((a, b) => a + b, 0) : 0} (${encs}) / ${kb(t.versions.bytes)} | ${kb(t.head.bytes)} | ${t.provenance.rows} / ${kb(t.provenance.bytes)} (${tiers}) | ${mb(t.assets.bytes)} (${t.assets.rows}) | ${mb(s.file)} (+${kb(s.wal)} KB) | ${m.load.ms} (${m.load.tailRows}) | ${pv} | ${m.restore ? `${m.restore.ms} / ${kb(m.restore.bytes)}${m.restore.equalsVersion !== undefined ? (m.restore.equalsVersion ? ' =v' : ' ≠v') : ''}` : '—'} | ${m.showEditors?.summary ?? ''} | ${m.versionCheck} |`)
  }
  console.log('kinds at the end', JSON.stringify(r.months.at(-1).sizes.kinds), 'pages', JSON.stringify(r.months.at(-1).sizes.pages))
  console.log('maintenance', JSON.stringify({ runs: r.maintenance.runs, median: r.maintenance.medianMs, max: r.maintenance.maxMs, stepMax: r.maintenance.stepMaxMs }))
  console.log('restores in the sim', JSON.stringify(r.restores))
  const se = r.months.at(-1).showEditors
  if (se) for (const row of se.rows) console.log(`  SE ${row.ok ? 'ok ' : 'BAD'} ${row.group.padEnd(16)} ${row.block ?? row.element} stored ${row.stored.join('; ')} | truth ${row.truth.join('; ')}`)
}
