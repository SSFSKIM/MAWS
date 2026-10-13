// S7a: the compact month-by-month table across the final soak runs (the findings' table), and the bench rows.
// Usage: node spikes/p3-store/s7/soak/summary.mjs
import { readFileSync, existsSync } from 'node:fs'
const out = n => new URL(`../out/${n}`, import.meta.url)
const runs = ['doc-normal-delta', 'doc-heavy-delta', 'doc-heavySentence-delta', 'doc-normal-full', 'doc-normal-delta-turnskept', 'deck-normal-delta', 'deck-heavy-delta', 'deck-normal-full']
console.log('| run | m | live V2 KB (fresh import) | size | db file MB | of it versions / head / provenance / log MB | versions kept | assets MB | load ms | preview ms | restore ms | Show editors |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|')
const mb = b => (b / 1048576).toFixed(2)
for (const tag of runs) {
  if (!existsSync(out(tag + '.json'))) continue
  const r = JSON.parse(readFileSync(out(tag + '.json'), 'utf8'))
  for (const m of r.months) {
    const p = m.sizes.pages; const t = m.sizes.tables
    const size = m.text ? `${Math.round(m.text.words / 1000)}k words` : `${m.slides} slides`
    console.log(`| ${tag} | ${m.month} | ${Math.round(m.live.v2 / 1024)} (${Math.round(m.live.freshImport / 1024)}) | ${size} | ${mb(m.sizes.file)} | ${mb(p.versions)} / ${mb(p.head ?? 0)} / ${mb((p.provenance ?? 0) + (p.provenance_to ?? 0))} / ${mb(p.updates)} | ${m.versions.count} | ${mb(t.assets.bytes)} | ${m.load.ms} | ${m.preview?.ms.total ?? '—'} | ${m.restore?.ms ?? '—'}${m.restore?.equalsVersion === undefined ? '' : m.restore.equalsVersion ? ' (=v)' : ' (≠v)'} | ${m.showEditors?.summary ?? ''} |`)
  }
}
console.log('\nbench (6-month stores, medians; p90 in brackets)')
console.log('| store | load ms | preview ms (state / attributions / openDiff / render) | restore ms | Show editors: merge all provenance + per selection ms | load avg at start |')
console.log('|---|---|---|---|---|---|')
for (const tag of runs) {
  if (!existsSync(out(`bench-${tag}.json`))) continue
  const b = JSON.parse(readFileSync(out(`bench-${tag}.json`), 'utf8'))
  const s = b.preview.steps
  console.log(`| ${tag} | ${b.load.ms} [${b.load.p90}] | ${b.preview.totalMs} [${b.preview.p90}] (${s.state} / ${s.attributions} / ${s.openDiff ?? '—'} / ${s.render ?? '—'}) | ${b.restore.ms} [${b.restore.p90}] | ${b.showEditors.mergeAllProvenanceMs}${b.showEditors.perSelectionMedianMs !== undefined ? ' + ' + b.showEditors.perSelectionMedianMs : ''} | ${b.loadavgStart.map(x => x.toFixed(1)).join(' ')} |`)
}
for (const tag of runs) {
  if (!existsSync(out(tag + '.json'))) continue
  const r = JSON.parse(readFileSync(out(tag + '.json'), 'utf8'))
  console.log(`${tag}: maintenance median ${r.maintenance.medianMs} ms, max ${r.maintenance.maxMs} ms, step max ${JSON.stringify(r.maintenance.stepMaxMs)}; updates ${r.updates}; versions written ${r.counters.versions} (${mb(r.counters.versionBytesWritten)} MB), head rewrites ${r.counters.headWrites} (${mb(r.counters.headBytesWritten)} MB); sim ${r.simSeconds}s`)
}
