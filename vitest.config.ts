import { resolve } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';
// C8a start
import react from '@vitejs/plugin-react';
// C8a end
// C8c start
import { createRequire } from 'node:module';
// C8c end

const alias = { '@shared': resolve(__dirname, 'src/shared'), '@artifacts': resolve(__dirname, 'src/artifacts') }; // P3-A: @artifacts
// C8c start: `lowlight` aliased to a grammar-less build (ruled 2026-09-29, the C8c document's M1 fold (2)): the diff
// view's core would otherwise ship every highlight.js grammar, unused since Review highlights through shiki. The shim
// takes lowlight's engine through `lowlight-engine`, its `lib/index.js`, which the package's exports do not name.
Object.assign(alias, {
  lowlight: resolve(__dirname, 'src/renderer/src/tools/code/review/lowlight-no-grammars.mjs'),
  'lowlight-engine': resolve(createRequire(__filename).resolve('lowlight'), '../lib/index.js'),
});
// C8c end
// Renderer suites that drive a real emulator without a DOM (C9: `@xterm/headless` round trips) run under Node.
const RENDERER_NODE_TESTS = 'src/renderer/src/terminal/**/*.node.test.ts';

// Suites timed by real filesystem events and polls, or by a whole-app mount, overrun vitest's 5 s default once the
// machine's load average passes about 100 (and pass at 30 s). They run in `-timing` projects with 30 s; every other
// suite keeps 5 s, so a real hang still fails fast.
const TIMING_TIMEOUTS = { testTimeout: 30_000, hookTimeout: 30_000 };
const TIMING_NODE_TESTS = [
  'src/engine-host/binary-info.test.ts', // W13: every case runs real stand-in binaries for --version
  'src/engine-host/fs/follow.test.ts',
  'src/engine-host/fs/sidecars.test.ts', // its retry cases wait out the retry schedule against a real writer
  'src/engine-host/fs/watcher.test.ts',
  'src/engine-host/plugins/runner.test.ts', // E8: real /bin/sh children, process-group kills and a ~2 s SIGKILL escalation
  'src/main/git/watcher.test.ts',
  'src/main/index/source.test.ts', // its wired cases follow real transcripts through the fs service
  'src/main/sessions/pause-take-over.pty.test.ts', // real bash and zsh job control in a PTY, read through real `ps` calls
  'src/main/usage/claude-usage-reader.test.ts',
  'test/artifacts/portability.test.ts', // P3-A: loads the repository's whole ESLint config and lints through it
  'src/engine-host/documents/sigkill.test.ts', // P3-A: bundles and forks a writer, kills it mid-stream, reopens the store
  'test/artifacts/one-schema.test.ts', // P3-B: the portability test's pattern, for the one-schema rule
];
const TIMING_RENDERER_TESTS = ['src/renderer/src/App.test.tsx'];
// P3-B: the portable artifact layer's DOM suites (docs/doperpowers/plans/2026-10-12-p3-b-documents.md).
const ARTIFACTS_DOM_TESTS = 'src/artifacts/**/*.dom.test.{ts,tsx}';

// C3 start: the `live` project runs the engine-host suite against the pinned binary through the relay
// (`MAWS_LIVE=1 pnpm test:live`); it exists only under MAWS_LIVE=1 so `pnpm test` and `pnpm verify` never see it.
const liveProjects =
  process.env.MAWS_LIVE === '1'
    ? [
        {
          resolve: { alias },
          test: {
            name: 'live',
            environment: 'node',
            include: ['test/live/**/*.live.test.ts'],
            testTimeout: 120_000,
            hookTimeout: 60_000,
            fileParallelism: false,
            maxWorkers: 1,
          },
        },
      ]
    : [];
// C3 end

// Two projects: shared, main, preload and the hosts run under Node; the renderer runs under happy-dom.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/{shared,main,preload,engine-host,pty-host}/**/*.test.ts', 'test/**/*.test.ts', RENDERER_NODE_TESTS],
          exclude: ['**/node_modules/**', 'test/live/**/*.live.test.ts', ...TIMING_NODE_TESTS], // C3: live cases run only in the `live` project; their support's own tests run here
          // The compile-time suites (`identifiers are not interchangeable`) run through tsc on the node tsconfig.
          typecheck: { enabled: true, include: ['src/**/*.test-d.ts'], tsconfig: './tsconfig.node.json' },
        },
      },
      { resolve: { alias }, test: { name: 'node-timing', environment: 'node', include: TIMING_NODE_TESTS, ...TIMING_TIMEOUTS } },
      {
        resolve: { alias },
        test: {
          name: 'renderer',
          environment: 'happy-dom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          exclude: [...configDefaults.exclude, RENDERER_NODE_TESTS, ...TIMING_RENDERER_TESTS],
        },
      },
      { resolve: { alias }, test: { name: 'renderer-timing', environment: 'happy-dom', include: TIMING_RENDERER_TESTS, ...TIMING_TIMEOUTS } },
      ...liveProjects, // C3
      // P3-A start: the portable artifact layer (src/artifacts/, docs/doperpowers/plans/2026-10-12-p3-a-store.md) under
      // Node; its code imports no Node or Electron module (eslint.config.js), so it runs here as it will in a renderer.
      { resolve: { alias }, test: { name: 'artifacts', environment: 'node', include: ['src/artifacts/**/*.test.ts'], exclude: [...configDefaults.exclude, ARTIFACTS_DOM_TESTS] } }, // P3-B: exclude
      // P3-A end
      // P3-B start: the document kind's suites that need a DOM (a real Tiptap editor: UniqueID through split and paste,
      // the editor, comments, history) run under happy-dom; its model, markdown and writer stay in `artifacts` (Node).
      // M3: the editor's stylesheets and the app's tokens are read as text by the theme suite (vitest blanks `.css`
      // imports, `?raw` included, outside `css.include`).
      {
        resolve: { alias },
        // fix wave 1 of M4: the setup drops KaTeX's quirks-mode warning, happy-dom having no `document.compatMode`
        test: {
          name: 'artifacts-dom',
          environment: 'happy-dom',
          include: [ARTIFACTS_DOM_TESTS],
          setupFiles: ['test/support/artifacts-dom-setup.ts'],
          css: { include: [/\/document\/editor\/.+\.css/, /\/renderer\/src\/styles\/tokens\.css/] },
        },
      },
      // P3-B end
      // C8a start: the panel host's suites again under the React Compiler, as electron-vite builds the app, so a render
      // that reads mutable module state (the instance map, a tool's state) without selecting it is caught in a test.
      {
        resolve: { alias },
        plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } })],
        test: {
          name: 'renderer-compiled',
          environment: 'happy-dom',
          include: [
            'src/renderer/src/panel/**/*.test.tsx',
            'src/renderer/src/app/Shell.panel.test.tsx', // M3: the host inside C5's Shell
            // C8c start: the code tools render under the host's rule too (a tool's state is a store handle)
            'src/renderer/src/tools/code/**/*.test.tsx',
            // C8c end
            // C8b start: the agent tools' component suites, whose tools render from store handles as the panel's do
            'src/renderer/src/tools/agents/**/*.test.tsx',
            // C8b end
            // E6 start: the Source control tool renders from a store handle, as the panel's tools do
            'src/renderer/src/tools/scm/**/*.test.tsx',
            // E6 end
            // E4a start: the Browser tool and its pane render from the browser store and a placement controller held in refs
            'src/renderer/src/tools/browser/**/*.test.tsx',
            // E4a end
          ],
          env: { MAWS_REACT_COMPILER: '1' },
        },
      },
      // C8a end
    ],
  },
});
