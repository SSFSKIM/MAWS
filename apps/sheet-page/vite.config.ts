import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The Markdown stack splits into chunks of its own, as desk-web's does (apps/desk-web/vite.config.ts, whose rule this
// is), so the diagram renderer and the highlighter's languages, which the stack loads only when a card needs them, stay
// apart from what every load carries. React and Vite's helpers have a chunk of their own.
const MARKDOWN = /^(streamdown|unified|bail|trough|marked|longest-streak|markdown-table|(remark|micromark|mdast)(-.*)?)$/;
const HTML = /^(parse5|entities|property-information|space-separated-tokens|comma-separated-tokens|html-url-attributes|web-namespaces|zwitch|trim-lines|devlop|ccount|decode-named-character-reference|character-entities.*|(rehype|hast|estree-util|unist|vfile)(-.*)?)$/;
const SHIKI = /^(shiki|@shikijs\/(core|types|vscode-textmate|engine-javascript)|oniguruma-to-es|oniguruma-parser|regex|regex-recursion|regex-utilities)$/;

function vendorChunk(id: string): string | undefined {
  if (id.startsWith('\0vite/preload-helper') || id.startsWith('\0commonjsHelpers')) return 'base';
  if (/\/node_modules\/.+\/node_modules\//.test(id.replace(/\/node_modules\/\.pnpm\/[^/]+/, ''))) return undefined; // a package's own copy stays with it
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

// The question sheet's local page (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §P; T23), built as
// desk-web is (apps/desk-web/vite.config.ts): the React plugin under the React Compiler, Tailwind's plugin, and the
// aliases MAWS's renderer modules need, so the page ships the same configuration of them. Built into the repository's
// out/sheet-page/, which the Mac app's archive includes and the Linux pack copies, and where `mawsd` finds it, one
// directory above its own entry. Not under out/main: the bundle guard reads every .js file there as a main-process
// file. No service worker (T19), no proxy, no source maps; the built index.html names its script and its stylesheet as
// files, since the page server's content policy allows no inline script.
export default defineConfig({
  plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } }), tailwindcss()],
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, '../../src/shared'),
      '@artifacts': resolve(import.meta.dirname, '../../src/artifacts'),
      'shiki/wasm': resolve(import.meta.dirname, 'src/vendor/shiki-wasm-unused.ts'),
      lowlight: resolve(import.meta.dirname, '../../src/renderer/src/tools/code/review/lowlight-no-grammars.mjs'),
      'lowlight-engine': resolve(createRequire(resolve(import.meta.dirname, '../../package.json')).resolve('lowlight'), '../lib/index.js'),
    },
  },
  build: { outDir: resolve(import.meta.dirname, '../../out/sheet-page'), emptyOutDir: true, sourcemap: false, rollupOptions: { output: { manualChunks: vendorChunk } } },
});
