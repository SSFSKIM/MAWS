// P3-H spike U2 (docs/doperpowers/plans/2026-10-12-p3-co-work.md §4.12 U2; parent pin blob 8474a047 at c73ba534).
// Builds the maws shim from src/ and runs every probe; results land in results/*.json.
//   pnpm -C spikes/p3-connectors install && node spikes/p3-connectors/run-all.mjs
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
execFileSync(join(root, 'node_modules', '.bin', 'esbuild'), [join(here, 'maws-shim.ts'), '--bundle', '--platform=node', '--format=esm', `--tsconfig=${join(root, 'tsconfig.base.json')}`, `--outfile=${join(here, 'build', 'maws-shim.mjs')}`, '--log-level=warning'], { stdio: 'inherit' });
execFileSync(process.execPath, [join(here, 'client-probe.mjs'), 'all'], { stdio: 'inherit' });
execFileSync(process.execPath, [join(here, 'discovery-probe.mjs')], { stdio: 'inherit' });
