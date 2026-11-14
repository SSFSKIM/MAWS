// Builds the viewer page's fixed file list into out/viewer (served by the maws-viewer: scheme, nothing else) and the
// window page into out/window. The list is fixed at build time: out/viewer/manifest.json names every file the scheme
// answers; no URL names a file outside it.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'viewer'), { recursive: true });

await build({
  absWorkingDir: here,
  entryPoints: {
    viewer: 'viewer/viewer.js', // the page's module script (condition 1)
    chunk: 'viewer/chunk.js', // the second chunk, loaded by import() (condition 2)
    hook: 'viewer/hook.js', // the spike's test hook: script of ours gone wrong
    docx: 'viewer/docx.js',
    pptx: 'viewer/pptx.js',
    xlsx: 'viewer/xlsx.js',
  },
  outdir: join(out, 'viewer'),
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

// The tiny module for condition 3: (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add)
const ADD_WASM = [0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11];
writeFileSync(join(out, 'viewer', 'engine.wasm'), Buffer.from(ADD_WASM));
// The spreadsheet library's own engine, from the same package build (its README: self-hosted wasm must match).
const require = createRequire(import.meta.url);
cpSync(require.resolve('@extend-ai/react-xlsx/duke_sheets_wasm_bg.wasm'), join(out, 'viewer', 'duke_sheets_wasm_bg.wasm'));
cpSync(join(here, 'viewer', 'viewer.html'), join(out, 'viewer', 'viewer.html'));
cpSync(join(here, 'viewer', 'paint.html'), join(out, 'viewer', 'paint.html'));
writeFileSync(join(out, 'viewer', 'manifest.json'), JSON.stringify(readdirSync(join(out, 'viewer')).filter((f) => f !== 'manifest.json').sort(), null, 1));
cpSync(join(here, 'window'), join(out, 'window'), { recursive: true });
console.log(`built ${readdirSync(join(out, 'viewer')).length} viewer files`);
