// (6): the packaged driver, bundled the way MAWS bundles main (electron-vite 5, the repository's version; its main
// build is Vite in library mode producing CJS, with `dependencies` from the root package.json externalised and
// everything else bundled). The root is a scratch directory holding one of the variants' package.json files; the entry
// lives here in the repository.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'electron-vite';

const here = dirname(fileURLToPath(import.meta.url));
// Modules to externalise beyond the root package.json's `dependencies` (the bundled variant needs playwright-core's
// optional dynamic imports listed here; the harness passes them, and the findings record which).
const extraExternal = (process.env.PROBE_PACK_EXTERNAL ?? '').split(',').filter(Boolean);

export default defineConfig({
  main: {
    build: {
      lib: { entry: resolve(here, 'src/main/index.mjs') },
      rollupOptions: {
        external: extraExternal,
        // one output file, and a dynamic import compiled to require() (not a real import()) so that a failure to load
        // playwright-core inside the asar is caught by the app rather than thrown at module evaluation
        output: { inlineDynamicImports: true, dynamicImportInCjs: false },
        onwarn(warning, warn) {
          // keep every warning; the probe collects them from stderr
          warn(warning);
        },
      },
    },
  },
});
