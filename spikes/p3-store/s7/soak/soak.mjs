// S7a (P3-0) driver: one soak run, its JSON written to s7/out/<tag>.json and a log to s7/out/<tag>.txt.
// Usage: node spikes/p3-store/s7/soak/soak.mjs --kind doc|deck --profile normal|heavy --encoding delta|full [--months 6]
//        [--suffix x] [--policy '{"provDayGrain":3600000}'] [--no-truth] [--export <dir>]
// --export (deck only, P3-F): the final month's preview inputs (prev.bin, next.bin, attrs.bin, meta.json) written to <dir>,
// the stores under <dir>/db, for e2e/presentations-scale.spec.ts and src/engine-host/presentations/history-bench.test.ts.
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadavg } from 'node:os'

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => { if (x.startsWith('--')) a.push([x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return a }, []))
const kind = args.kind ?? 'doc'; const profile = args.profile ?? 'normal'; const encoding = args.encoding ?? 'delta'
const months = Number(args.months ?? 6)
const policy = args.policy ? JSON.parse(args.policy) : {}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'out')
mkdirSync(out, { recursive: true }); mkdirSync('/tmp/p3-s7a', { recursive: true })
const tag = `${kind}-${profile}-${encoding}${args.suffix ? '-' + args.suffix : ''}${months !== 6 ? `-${months}m` : ''}`
const txt = join(out, tag + '.txt')
writeFileSync(txt, `# S7a ${tag} started ${new Date().toISOString()} load ${loadavg().map(x => x.toFixed(1)).join(' ')} node ${process.version}\n`)
const log = s => { console.log(s); appendFileSync(txt, s + '\n') }
const run = kind === 'doc' ? (await import('./doc/sim.mjs')).runDoc : (await import('./deck/sim.ts')).runDeck
const exportDir = typeof args.export === 'string' ? args.export : null
if (args.export !== undefined && (kind !== 'deck' || !exportDir)) throw new Error('--export <dir> takes a directory and runs with --kind deck')
if (exportDir) mkdirSync(join(exportDir, 'db'), { recursive: true })
const res = await run({ profile, months, encoding, policy, log, truth: !args['no-truth'], suffix: args.suffix, ...(exportDir && { exportDir, dbDir: join(exportDir, 'db') }) })
res.loadavgEnd = loadavg()
writeFileSync(join(out, tag + '.json'), JSON.stringify(res, null, 1))
log(`done in ${res.simSeconds}s; updates ${res.updates}; counts ${JSON.stringify(res.counts)}; maintenance ${JSON.stringify({ median: res.maintenance.medianMs, max: res.maintenance.maxMs, steps: res.maintenance.stepMaxMs })}`)
process.exit(0)
