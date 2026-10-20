// Bundles page/run.tsx (and, through it, MAWS's own document binding from src/) into out/.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, 'out'), { recursive: true });
await build({
  entryPoints: [join(here, 'page', 'run.tsx')],
  outfile: join(here, 'out', 'page.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome140',
  jsx: 'automatic',
  sourcemap: 'inline',
  define: { 'process.env.NODE_ENV': '"development"' }, // React's dev build: its warnings land in results/console.txt
  alias: { '@shared': join(here, '../../src/shared'), '@artifacts': join(here, '../../src/artifacts') }, // the app's own aliases
  logLevel: 'warning',
});
copyFileSync(join(here, 'page', 'index.html'), join(here, 'out', 'index.html'));
