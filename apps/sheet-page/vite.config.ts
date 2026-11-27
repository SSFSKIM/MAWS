import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Every dynamic import of a chunk in the build calls the page's chunk gate instead (src/chunk-gate.ts; T28): the
// Markdown stack's lazy parts (a grammar, a theme, the diagram renderer and its kinds) are asked for only while the tab's
// connection is proven. Only an import of a chunk is rewritten: the gate's own import of a computed URL has no target,
// so it stays the browser's. Vite's dependency preloads would fetch a chunk's imports past the gate, so there are none
// (`modulePreload: false`); the browser fetches them as the gated import asks.
const CHUNK_GATE_GLOBAL = '__sheetChunk'; // chunk-gate.ts's, which installs it before any chunk can be asked for
const gateDynamicImports = (): Plugin => ({
  name: 'sheet-page:gate-dynamic-imports',
  apply: 'build',
  buildStart: () => void (startup = null), // each build reads its own graph
  renderDynamicImport: ({ targetModuleId }) => (targetModuleId === null ? null : { left: `${CHUNK_GATE_GLOBAL}(import.meta.url,`, right: ')' }),
});

// What the gate lets through is one fetch: a chunk the gate asks for imports, statically, only chunks already loaded
// with the page, so the browser fetches nothing more on its own once the gate has said yes. Rollup puts a module in one
// chunk only, so a module two gated chunks share (a grammar another grammar embeds, mermaid's core under its kinds) is
// put with the page's own code, in the chunk the entry loads; a module only one gated chunk reaches goes inside it.
type ChunkMeta = { getModuleIds(): IterableIterator<string>; getModuleInfo(id: string): { isEntry: boolean; importedIds: readonly string[]; dynamicImporters: readonly string[] } | null };
function startupOf(meta: ChunkMeta): Set<string> {
  const ids = [...meta.getModuleIds()];
  const staticClosure = (start: string, stop: Set<string>) => {
    const reached = new Set([start]);
    for (const todo = [start]; todo.length > 0; )
      for (const next of meta.getModuleInfo(todo.pop()!)?.importedIds ?? []) if (!stop.has(next) && !reached.has(next) && reached.add(next)) todo.push(next);
    return reached;
  };
  const startup = new Set(ids.filter((id) => meta.getModuleInfo(id)?.isEntry).flatMap((id) => [...staticClosure(id, new Set())]));
  const reachedBy = new Map<string, number>(); // how many gated chunks reach a module statically, themselves included
  for (const id of ids) {
    if (startup.has(id) || (meta.getModuleInfo(id)?.dynamicImporters.length ?? 0) === 0) continue;
    for (const reached of staticClosure(id, startup)) reachedBy.set(reached, (reachedBy.get(reached) ?? 0) + 1);
  }
  for (const [id, count] of reachedBy) if (count > 1) startup.add(id);
  return startup;
}
let startup: Set<string> | null = null;
const STARTUP_CHUNK = 'page';
const withThePage = (id: string, meta: ChunkMeta) => ((startup ??= startupOf(meta)).has(id) && !/\.css($|\?)/.test(id) ? STARTUP_CHUNK : undefined);

// The question sheet's local page (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §P; T23), built as
// desk-web is (apps/desk-web/vite.config.ts): the React plugin under the React Compiler, Tailwind's plugin, and the
// aliases MAWS's renderer modules need, so the page ships the same configuration of them. Built into the repository's
// out/sheet-page/, which the Mac app's archive includes and the Linux pack copies, and where `mawsd` finds it, one
// directory above its own entry. Not under out/main: the bundle guard reads every .js file there as a main-process
// file. No service worker (T19), no proxy, no source maps; the built index.html names its script and its stylesheet as
// files, since the page server's content policy allows no inline script.
export default defineConfig({
  plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } }), tailwindcss(), gateDynamicImports()],
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, '../../src/shared'),
      '@artifacts': resolve(import.meta.dirname, '../../src/artifacts'),
      'shiki/wasm': resolve(import.meta.dirname, 'src/vendor/shiki-wasm-unused.ts'),
      lowlight: resolve(import.meta.dirname, '../../src/renderer/src/tools/code/review/lowlight-no-grammars.mjs'),
      'lowlight-engine': resolve(createRequire(resolve(import.meta.dirname, '../../package.json')).resolve('lowlight'), '../lib/index.js'),
    },
  },
  build: { outDir: resolve(import.meta.dirname, '../../out/sheet-page'), emptyOutDir: true, sourcemap: false, modulePreload: false, rollupOptions: { output: { manualChunks: withThePage } } },
});
