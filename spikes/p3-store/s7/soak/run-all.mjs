// S7a: every soak run, one after another (each a child process so memory resets). Run under the slot:
//   /tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh node spikes/p3-store/s7/soak/run-all.mjs [filter]
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadavg } from 'node:os'
const soak = fileURLToPath(new URL('./soak.mjs', import.meta.url))
const runs = [
  ['--kind', 'doc', '--profile', 'normal', '--encoding', 'delta'],
  ['--kind', 'deck', '--profile', 'normal', '--encoding', 'delta'],
  ['--kind', 'deck', '--profile', 'heavy', '--encoding', 'delta'],
  ['--kind', 'doc', '--profile', 'heavy', '--encoding', 'delta'],
  ['--kind', 'doc', '--profile', 'normal', '--encoding', 'full'],
  ['--kind', 'deck', '--profile', 'normal', '--encoding', 'full'],
  ['--kind', 'doc', '--profile', 'normal', '--encoding', 'delta', '--suffix', 'turnskept', '--policy', '{"thinKinds":["auto"]}', '--no-truth']
]
// the second round, after revert.mjs fixed the restore: the delta runs again (same seeds, so the same simulated
// months) and the heavy document with the sentence-replacing writer
const second = [
  ['--kind', 'doc', '--profile', 'normal', '--encoding', 'delta'],
  ['--kind', 'deck', '--profile', 'normal', '--encoding', 'delta'],
  ['--kind', 'deck', '--profile', 'heavy', '--encoding', 'delta'],
  ['--kind', 'doc', '--profile', 'heavySentence', '--encoding', 'delta']
]
const filter = process.argv[2] === 'second' ? null : process.argv[2]
for (const a of process.argv[2] === 'second' ? second : runs) {
  if (filter && !a.join(' ').includes(filter)) continue
  const t0 = Date.now()
  console.log(`== ${a.join(' ')} (load ${loadavg()[0].toFixed(1)})`)
  const r = spawnSync(process.execPath, ['--no-warnings', soak, ...a], { stdio: 'inherit' })
  console.log(`== exit ${r.status} in ${Math.round((Date.now() - t0) / 1000)}s`)
}
