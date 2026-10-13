// S2 harness build: bundles main, the host stand-in, the preload and the renderer outside the repo with the app's
// esbuild. Two generations from one harness source:
//   node spikes/p3-store/electron/build.mjs                → Yjs v13, /tmp/p3-s2/build/electron
//   S2_YJS=14 node spikes/p3-store/electron/build.mjs      → Yjs v14, /tmp/p3-s2/build/electron-v14
// For v14 the harness's imports of the v13 modules are redirected to their v14 siblings (s2/v14/), `yjs` to `@y/y`
// (s2/node_modules, one copy), and main is told its generation so it picks the v14 seeds and suffixes its outputs.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../../../node_modules/esbuild/lib/main.js';

const here = dirname(fileURLToPath(import.meta.url));
const v14 = process.env.S2_YJS === '14';
const out = process.env.S2_BUILD ?? (v14 ? '/tmp/p3-s2/build/electron-v14' : '/tmp/p3-s2/build/electron');
const s2 = join(here, '../s2');
const redirects = {
  '../s2/src/yjs-seam': join(s2, 'v14/yjs.ts'),
  '../s2/src/host/document-service': join(s2, 'v14/host/document-service.ts'),
  '../s2/src/host/storage': join(s2, 'v14/host/storage.ts'),
  '../s2/src/host/agent-replica': join(s2, 'v14/host/agent-replica.ts'),
  '../s2/src/provider/port': join(s2, 'v14/provider/port.ts'),
  './doc-model': join(here, 'doc-model-v14.ts'),
};
const generation = {
  name: 's2-generation',
  setup(b) {
    if (!v14) {
      // v13: s2/src's shared lib0 imports (frames.ts) take the v13 stack's lib0 0.2, not s2/node_modules' 1.0 rc
      b.onResolve({ filter: /^lib0(\/|$)/ }, (args) =>
        args.pluginData === 'inner' ? undefined : b.resolve(args.path, { resolveDir: join(here, '..'), kind: args.kind, pluginData: 'inner' }),
      );
      return;
    }
    b.onResolve({ filter: /.*/ }, (args) => {
      if (args.importer.startsWith(here) && redirects[args.path]) return { path: redirects[args.path] };
      if (args.pluginData === 'inner' || args.importer.startsWith(s2)) return undefined;
      if (args.path === 'yjs' || args.path.startsWith('@y/')) {
        return b.resolve(args.path === 'yjs' ? '@y/y' : args.path, { resolveDir: s2, kind: args.kind, pluginData: 'inner' });
      }
      return undefined;
    });
  },
};
mkdirSync(out, { recursive: true });
const common = { bundle: true, logLevel: 'warning', sourcemap: 'inline', target: 'es2023', plugins: [generation] };
await Promise.all([
  build({ ...common, entryPoints: [join(here, 'main.ts')], outfile: join(out, 'main.cjs'), platform: 'node', format: 'cjs', external: ['electron'], define: { 'process.env.S2_YJS': JSON.stringify(v14 ? '14' : '13') } }),
  build({ ...common, entryPoints: [join(here, 'host-entry.ts')], outfile: join(out, 'host.cjs'), platform: 'node', format: 'cjs' }),
  build({ ...common, entryPoints: [join(here, 'preload.ts')], outfile: join(out, 'preload.cjs'), platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: [join(here, 'renderer.ts')], outfile: join(out, 'renderer.js'), platform: 'browser', format: 'iife' }),
]);
copyFileSync(join(here, 'index.html'), join(out, 'index.html'));
console.log(`built ${v14 ? 'v14' : 'v13'} into ${out}`);
