// P3-E2 M1 spike: builds what the export proof runs (on CI, by `pnpm e2e:dashboard-spike`; never locally):
//   out/spike-main.cjs     the spike's Electron main: MAWS's real `printHtmlToPdf` and request policy, bundled
//   out/spike-lib.mjs      the cases and both renderers for Node (the Playwright process)
//   out/spike-browser.js   the same for Chromium (an IIFE, `spikeLib`), so a render in the page can be compared
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const spike = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(spike, 'out');
const common = { bundle: true, tsconfig: join(spike, 'tsconfig.json'), loader: { '.csv': 'text' }, logLevel: 'warning', legalComments: 'none' };

await Promise.all([
  build({ ...common, entryPoints: [join(spike, 'e2e/main.ts')], outfile: join(out, 'spike-main.cjs'), platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] }),
  build({ ...common, entryPoints: [join(spike, 'src/lib.ts')], outfile: join(out, 'spike-lib.mjs'), platform: 'node', format: 'esm', target: 'node22' }),
  build({ ...common, entryPoints: [join(spike, 'src/lib.ts')], outfile: join(out, 'spike-browser.js'), platform: 'browser', format: 'iife', globalName: 'spikeLib', target: 'chrome140' }),
]);
console.log(`spike build: ${out}`);
