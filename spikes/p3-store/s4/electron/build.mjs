// S4 harness build: bundles main and the page into /tmp/p3-s4/build (outside the repo) with the app's esbuild.
// Bare imports from S1's files resolve from S4's own node_modules (one copy of @y/y, Tiptap, ProseMirror).
// Run: node spikes/p3-store/s4/electron/build.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from '../../../../node_modules/esbuild/lib/main.js'

const here = dirname(fileURLToPath(import.meta.url))
const s4 = join(here, '..')
const out = process.env.S4_BUILD ?? '/tmp/p3-s4/build'
mkdirSync(out, { recursive: true })
const oneCopy = {
  name: 'one-copy',
  setup (b) {
    b.onResolve({ filter: /^[^./]/ }, async args => {
      if (args.pluginData?.s4 || !args.importer.includes('/s1/')) return undefined
      return b.resolve(args.path, { resolveDir: s4, kind: args.kind, pluginData: { s4: true } })
    })
  }
}
const common = { bundle: true, logLevel: 'warning', sourcemap: 'inline', target: 'es2023', plugins: [oneCopy] }
// the v13 comparison page resolves every bare import from the shared spikes/p3-store package (yjs 13, y-tiptap)
const v13 = {
  name: 'v13',
  setup (b) {
    b.onResolve({ filter: /^[^./]/ }, async args => {
      if (args.pluginData?.v13) return undefined
      if (!['/electron/page13', '/src/port-link', '/src/composition-hold', '/s1/'].some(p => args.importer.includes(p))) return undefined
      return b.resolve(args.path, { resolveDir: join(s4, '..'), kind: args.kind, pluginData: { v13: true } })
    })
  }
}
await Promise.all([
  build({ ...common, plugins: [v13], entryPoints: [join(here, 'page13.ts')], outfile: join(out, 'page13.js'), platform: 'browser', format: 'iife' }),
  build({ ...common, entryPoints: [join(here, 'main.ts')], outfile: join(out, 'main.cjs'), platform: 'node', format: 'cjs', external: ['electron'], define: { 'process.env.S4_OUT': JSON.stringify(join(s4, 'out')) } }),
  build({ ...common, entryPoints: [join(here, 'page.ts')], outfile: join(out, 'page.js'), platform: 'browser', format: 'iife' })
])
const html = readFileSync(join(here, 'index.html'), 'utf8')
writeFileSync(join(out, 'index.html'), html.replace('PAGE', 'page.js'))
writeFileSync(join(out, 'index13.html'), html.replace('PAGE', 'page13.js'))
console.log(`built into ${out}`)
