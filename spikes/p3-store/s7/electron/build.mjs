// S7b harness build (adapted from S2's spikes/p3-store/electron/build.mjs and S4's one-copy resolver): bundles the
// seed, main, the host stand-in, the preload and the two pages into /tmp/p3-s7b/build with the app's esbuild.
// Every bare import from code outside this package's node_modules (this harness and the S2, S3 and S6 modules it
// imports in place) resolves from this package, so each bundle holds one @y/y, one lib0 and one prosemirror-model;
// the build fails if a bundle holds two (the `__ $YJS14$ __` guard would throw at run time anyway).
// Run: node spikes/p3-store/s7/electron/build.mjs
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../../../../node_modules/esbuild/lib/main.js';

const here = dirname(fileURLToPath(import.meta.url));
const own = join(here, 'node_modules');
const out = process.env.S7_BUILD ?? '/tmp/p3-s7b/build';
mkdirSync(out, { recursive: true });
const oneCopy = {
  name: 'one-copy',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.pluginData?.own || args.importer.startsWith(own) || args.path.startsWith('node:') || args.path === 'electron') return undefined;
      return b.resolve(args.path, { resolveDir: here, kind: args.kind, pluginData: { own: true } });
    });
  },
};
const common = { bundle: true, logLevel: 'warning', sourcemap: 'inline', target: 'es2023', plugins: [oneCopy], metafile: true };
const node = { ...common, platform: 'node', format: 'cjs', external: ['electron'] };
const only = process.env.S7_ONLY ? process.env.S7_ONLY.split(',') : null; // e.g. S7_ONLY=seed
const targets = [
  ['seed', { ...node, entryPoints: [join(here, 'seed.ts')], outfile: join(out, 'seed.cjs') }],
  ['main', { ...node, entryPoints: [join(here, 'main.ts')], outfile: join(out, 'main.cjs') }],
  ['host', { ...node, entryPoints: [join(here, 'host-entry.ts')], outfile: join(out, 'host.cjs') }],
  ['preload', { ...node, entryPoints: [join(here, 'preload.ts')], outfile: join(out, 'preload.cjs') }],
  ['editor', { ...common, entryPoints: [join(here, 'editor-page.ts')], outfile: join(out, 'editor.js'), platform: 'browser', format: 'iife' }],
  ['deck', { ...common, entryPoints: [join(here, 'deck-page.ts')], outfile: join(out, 'deck.js'), platform: 'browser', format: 'iife' }],
].filter(([name]) => !only || only.includes(name));
const results = await Promise.all(targets.map(([, options]) => build(options)));
// one copy each, checked from the metafiles: the package roots each bundle drew a file from
for (const r of results) {
  const roots = new Map();
  for (const input of Object.keys(r.metafile.inputs)) {
    const m = input.match(/^(.*node_modules\/(@y\/y|lib0|prosemirror-model))\//);
    if (!m) continue;
    if (!roots.has(m[2])) roots.set(m[2], new Set());
    roots.get(m[2]).add(m[1]);
  }
  for (const [pkg, dirs] of roots) if (dirs.size > 1) throw new Error(`two copies of ${pkg} in ${Object.keys(r.metafile.outputs)[0]}: ${[...dirs].join(', ')}`);
}
if (!only) for (const f of ['editor.html', 'deck.html']) copyFileSync(join(here, f), join(out, f));
console.log(`built into ${out} (${results.length} bundles; one @y/y, lib0, prosemirror-model each)`);
