// Bundles the probe's render host (host/main.ts and the src/main/browser modules it composes, unmodified) into
// build/host.cjs with the repository's esbuild, `electron` left external. Run from anywhere: node build.mjs
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const result = await build({
  entryPoints: [resolve(here, 'host/main.ts')],
  outfile: resolve(here, 'build/host.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  alias: { '@shared': resolve(repo, 'src/shared'), '@artifacts': resolve(repo, 'src/artifacts') },
  sourcemap: 'inline',
  metafile: true,
  logLevel: 'warning',
});
const inputs = Object.keys(result.metafile.inputs);
const fromBrowser = inputs.filter((p) => p.includes('src/main/browser/'));
console.log(`build/host.cjs: ${inputs.length} inputs, ${fromBrowser.length} from src/main/browser/`);
