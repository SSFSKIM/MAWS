// S2 harness build: bundles main, the host stand-in, the preload and the renderer into /tmp/p3-s2/build/electron
// (outside the repo) with the app's esbuild. Run: node spikes/p3-store/electron/build.mjs
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../../../node_modules/esbuild/lib/main.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.S2_BUILD ?? '/tmp/p3-s2/build/electron';
mkdirSync(out, { recursive: true });
const common = { bundle: true, logLevel: 'warning', sourcemap: 'inline', target: 'es2023' };
await Promise.all([
  build({ ...common, entryPoints: [join(here, 'main.ts')], outfile: join(out, 'main.cjs'), platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: [join(here, 'host-entry.ts')], outfile: join(out, 'host.cjs'), platform: 'node', format: 'cjs' }),
  build({ ...common, entryPoints: [join(here, 'preload.ts')], outfile: join(out, 'preload.cjs'), platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: [join(here, 'renderer.ts')], outfile: join(out, 'renderer.js'), platform: 'browser', format: 'iife' }),
]);
copyFileSync(join(here, 'index.html'), join(out, 'index.html'));
console.log(`built into ${out}`);
