import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { build, defineConfig, type Plugin, type Rollup } from 'vite';

// The desk's web app, built to dist/ for the hub's Worker to serve as static assets (single-page fallback; the Worker
// first on /api/* and /machine/*). `pnpm --filter desk-web dev` proxies /api — the HTTP calls and the two sockets — to
// a local hub at DESK_HUB_URL (DC3's local runtime, or the DX3 double), so the app talks to it as it will in production.
const hub = process.env.DESK_HUB_URL ?? 'http://127.0.0.1:8787';

/**
 * The service worker, built apart from the app as one classic script at `/sw.js` (its scope the whole app): a bundle of
 * its own shares no chunk with the app, so it can never import a module that reaches the org key (§6), and it needs no
 * module-worker support. Built with the app; the dev server registers none.
 */
function serviceWorker(): Plugin {
  return {
    name: 'desk-service-worker',
    apply: 'build',
    async generateBundle() {
      const output = (await build({
        configFile: false,
        publicDir: false,
        logLevel: 'warn',
        build: {
          write: false,
          minify: true,
          lib: { entry: resolve(import.meta.dirname, 'src/sw/service-worker.ts'), formats: ['iife'], name: 'deskServiceWorker', fileName: () => 'sw.js' },
        },
      })) as Rollup.RollupOutput[];
      const [chunk] = output[0].output;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: chunk.code });
    },
  };
}

// The Markdown stack (MAWS's Markdown: Streamdown, its remark and rehype plugins, KaTeX, shiki's core) splits out of
// the project view's chunk into chunks of its own, each under Vite's 500 kB warning, loaded together when a project
// opens (App.tsx makes the project view lazy, so the grid's first load carries none of it). Each shiki grammar stays a
// chunk of its own, loaded when a fence names its language; a grammar a larger one embeds is split from it.
// Two layers, so neither chunk imports the other back: the syntax trees, HTML, and their utilities below; the Markdown
// parser and Streamdown above them.
const MARKDOWN = /^(streamdown|unified|bail|trough|marked|longest-streak|markdown-table|(remark|micromark|mdast)(-.*)?)$/;
const HTML = /^(parse5|entities|property-information|space-separated-tokens|comma-separated-tokens|html-url-attributes|web-namespaces|zwitch|trim-lines|devlop|ccount|decode-named-character-reference|character-entities.*|(rehype|hast|estree-util|unist|vfile)(-.*)?)$/;
const SHIKI = /^(shiki|@shikijs\/(core|types|vscode-textmate|engine-javascript)|oniguruma-to-es|oniguruma-parser|regex|regex-recursion|regex-utilities)$/;

function vendorChunk(id: string): string | undefined {
  // What every load needs has a chunk of its own — React, Vite's preload helper, the CommonJS interop: left unassigned,
  // a manual chunk importing it would take it in, and the entry would import that chunk (and the whole Markdown stack
  // with it) on the first load.
  if (id.startsWith('\0vite/preload-helper') || id.startsWith('\0commonjsHelpers')) return 'base';
  // A package's own copy of a dependency (mermaid's `marked`) stays with the package that loads it.
  if (/\/node_modules\/.+\/node_modules\//.test(id.replace(/\/node_modules\/\.pnpm\/[^/]+/, ''))) return undefined;
  const at = id.lastIndexOf('/node_modules/');
  if (at < 0) return undefined;
  const pkg = /^((?:@[^/]+\/)?[^/]+)/.exec(id.slice(at + '/node_modules/'.length))?.[1] ?? '';
  if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'base';
  if (pkg === 'katex') return 'katex';
  if (SHIKI.test(pkg)) return 'shiki';
  if (MARKDOWN.test(pkg)) return 'markdown';
  if (HTML.test(pkg)) return 'markdown-html';
  if (pkg === '@shikijs/langs') return `lang-${/([^/]+)\.mjs$/.exec(id)?.[1] ?? 'grammar'}`;
  return undefined;
}

export default defineConfig({
  // React as the Electron app builds its renderer (electron.vite.config.ts): under the React Compiler, with its defaults.
  // The desk ships MAWS's renderer modules, so both apps ship one configuration of them; vitest.config.ts builds the
  // suites with the same plugin, so they run the code that ships.
  plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } }), tailwindcss(), serviceWorker()],
  resolve: {
    alias: {
      // MAWS's renderer modules the desk imports as they stand (the renderer survey) name src/shared as `@shared`; the
      // depth column (DC6) imports MAWS's transcript and backfill, which also reach src/artifacts as `@artifacts`.
      '@shared': resolve(import.meta.dirname, '../../src/shared'),
      '@artifacts': resolve(import.meta.dirname, '../../src/artifacts'),
      'shiki/wasm': resolve(import.meta.dirname, 'src/vendor/shiki-wasm-unused.ts'),
      // The depth column's diff (DC6) draws through MAWS's ReviewView, whose diff library's core would ship every
      // highlight.js grammar, unused since the view highlights through shiki: MAWS's own aliases (its C8c block in
      // electron.vite.config.ts) hand lowlight's engine no grammar.
      lowlight: resolve(import.meta.dirname, '../../src/renderer/src/tools/code/review/lowlight-no-grammars.mjs'),
      'lowlight-engine': resolve(createRequire(resolve(import.meta.dirname, '../../package.json')).resolve('lowlight'), '../lib/index.js'),
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { output: { manualChunks: vendorChunk } } },
  // /machine too: an enrollment code made in dev names this origin as the hub, and the machine redeems it here.
  server: { proxy: { '/api': { target: hub, ws: true, changeOrigin: true }, '/machine': { target: hub, changeOrigin: true } } },
});
