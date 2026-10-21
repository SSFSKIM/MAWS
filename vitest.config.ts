import { resolve } from 'node:path';
import { configDefaults, defineConfig, type TestUserConfig } from 'vitest/config';
// C8a start
import react from '@vitejs/plugin-react';
// C8a end
// C8c start
import { createRequire } from 'node:module';
// C8c end
import { compiledRendererSuites } from './test/support/compiled-suites'; // P3-F

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
  'test/one-locale.test.ts', // the same pattern, for the one-locale rule over src/ and the desk's web app
];
const TIMING_RENDERER_TESTS = [
  'src/renderer/src/App.test.tsx',
  'src/renderer/src/sessions/resource.test.tsx', // a whole-tree mount switched across 20 sessions (gate offload, Decision Log 11)
];
// P3-B: the portable artifact layer's DOM suites (docs/doperpowers/plans/2026-10-12-p3-b-documents.md); P3-C M4 shares the
// project (the slide canvas, the deck editor).
const ARTIFACTS_DOM_TESTS = 'src/artifacts/**/*.dom.test.{ts,tsx}';
// Their stylesheets read as text: the document editor's sheets and the app's tokens (the theme suite), and the deck,
// design and comment sheets as `?raw` only (P3-F F3, the toolbar suite; P4-B1), never injected into their DOM suites (the
// plain `import './chrome.css'` stays blank: the pattern is read against the id's query).
const ARTIFACTS_DOM_CSS = { include: [/\/document\/editor\/.+\.css/, /\/renderer\/src\/styles\/tokens\.css/, /\/(slides|design)\/editor\/.+\.css\?raw$/, /\/artifacts\/comments\/.+\.css\?raw$/] };
// Every happy-dom project drops KaTeX's one quirks-mode advisory (happy-dom has no `document.compatMode`, so no doctype
// silences it); every other warning passes through.
const HAPPY_DOM_SETUP = ['test/support/artifacts-dom-setup.ts'];

// P4 Decision Log 4 (English throughout): the suites of the code that writes what the owner reads (the renderer, the
// artifacts, and main's and the host's display words in DISPLAY_NODE_TESTS) run under the owner's Korean system locale,
// so every age, date and time they expect in English is shown to be English whatever the machine's locale. Node's Intl
// default is read from LC_ALL, then LANG, when a worker starts, so it is set in the workers' environment; the rest of
// the node suites keep the machine's, their child processes (git, the shells) writing as they always have.
const OWNER_LOCALE = { LC_ALL: 'ko_KR.UTF-8', LANG: 'ko_KR.UTF-8' };
const DISPLAY_NODE_TESTS = ['src/shared/app/*.test.ts', 'src/engine-host/documents/restore.test.ts'];

// A project under the React Compiler as electron-vite builds the app, over happy-dom (C8a; the `renderer-compiled`
// projects), each with its own plugin instance.
const compiled = (test: { name: string; include: string[]; exclude?: string[]; testTimeout?: number; hookTimeout?: number; css?: typeof ARTIFACTS_DOM_CSS }) => ({
  resolve: { alias },
  plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } })],
  test: { environment: 'happy-dom' as const, env: { MAWS_REACT_COMPILER: '1', ...OWNER_LOCALE }, setupFiles: HAPPY_DOM_SETUP, ...test },
});

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

// ci-kit's test history (ci-kit docs/doperpowers/specs/2026-10-21-test-history-design.md): the gate's unit jobs set
// MAWS_TEST_JUNIT to a path, and the run also writes a JUnit report there, each case's classname `<project>:<file>`
// since the compiled projects run the renderer's files a second time. Vitest's own reporters stay what they are under
// GitHub Actions (default, github-actions); with the variable unset the config names no reporter at all.
const junit = process.env.MAWS_TEST_JUNIT;
const reporters: TestUserConfig['reporters'] = junit
  ? [
      'default',
      ...(process.env.GITHUB_ACTIONS === 'true' ? ['github-actions' as const] : []),
      ['junit', { outputFile: junit, classnameTemplate: '{displayName}:{filename}', includeConsoleOutput: false }],
    ]
  : undefined;

// Two projects: shared, main, preload and the hosts run under Node; the renderer runs under happy-dom.
export default defineConfig({
  test: {
    ...(reporters ? { reporters } : {}),
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/{shared,main,preload,engine-host,pty-host}/**/*.test.ts', 'test/**/*.test.ts', RENDERER_NODE_TESTS],
          exclude: ['**/node_modules/**', 'test/live/**/*.live.test.ts', ...TIMING_NODE_TESTS, ...DISPLAY_NODE_TESTS], // C3: live cases run only in the `live` project; their support's own tests run here
          css: { include: [/\/design_system\/defaults\/.+\.css/] }, // P3-D: the defaults' `document.css` as text (`?raw`) for the host's and main's tests, as in `artifacts`
          // The compile-time suites (`src/**/*.test-d.ts`) are checked by `pnpm typecheck` alone, tsconfig.node.json
          // including them; a second pass here only re-checked them (gate-offload Decision Log 35, P5).
        },
      },
      { resolve: { alias }, test: { name: 'node-timing', environment: 'node', include: TIMING_NODE_TESTS, ...TIMING_TIMEOUTS } },
      { resolve: { alias }, test: { name: 'node-display', environment: 'node', include: DISPLAY_NODE_TESTS, env: OWNER_LOCALE } }, // P4-W2L
      {
        resolve: { alias },
        test: {
          name: 'renderer',
          environment: 'happy-dom',
          include: ['src/renderer/**/*.test.{ts,tsx}', 'src/main/artifacts/*.dom.test.tsx'],
          exclude: [...configDefaults.exclude, RENDERER_NODE_TESTS, ...TIMING_RENDERER_TESTS],
          setupFiles: HAPPY_DOM_SETUP,
          env: OWNER_LOCALE, // P4-W2L
        },
      },
      { resolve: { alias }, test: { name: 'renderer-timing', environment: 'happy-dom', include: TIMING_RENDERER_TESTS, setupFiles: HAPPY_DOM_SETUP, env: OWNER_LOCALE, ...TIMING_TIMEOUTS } },
      ...liveProjects, // C3
      // P3-A start: the portable artifact layer (src/artifacts/, docs/doperpowers/plans/2026-10-12-p3-a-store.md) under
      // Node; its code imports no Node or Electron module (eslint.config.js), so it runs here as it will in a renderer.
      // P3-B M6: `css` reads the editor's stylesheets as text, so the HTML export (run in main, tested here under Node)
      // inlines theme.css rather than the blank vitest gives a `.css?raw` import outside `css.include`.
      // P3-D M5: a design system's `document.css` is bundled as text (`?raw`); vitest empties unprocessed CSS, raw included.
      { resolve: { alias }, test: { name: 'artifacts', environment: 'node', include: ['src/artifacts/**/*.test.ts'], exclude: [...configDefaults.exclude, ARTIFACTS_DOM_TESTS], env: OWNER_LOCALE /* P4-W2L */, css: { include: [/\/document\/editor\/.+\.css/, /\/design_system\/defaults\/.+\.css/ /* P3-D */] } } }, // P3-B: exclude, css
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
          setupFiles: HAPPY_DOM_SETUP,
          env: OWNER_LOCALE, // P4-W2L
          css: ARTIFACTS_DOM_CSS, // P3-F F3, P4-B1
        },
      },
      // P3-B end
      // C8a start: the renderer's component suites again under the React Compiler, as electron-vite builds the app, so a
      // render that reads mutable module state (the instance map, a tool's state, a module's cache) without selecting it
      // is caught in a test. C8a compiled the panel host; C8c, C8b, E6, E4a, P3-D, P3-H, P3-F1 and E3 each added their
      // own suites; P3-F widened it to every renderer component and hook suite, `.ts` ones that render or call hooks
      // included (test/support/compiled-suites.ts; the tracker's compiled-include row: the library's first Export of a
      // kind never showed, its formats read from the module's cache in render, while its uncompiled hook suite passed).
      // The whole-app suites keep their timing budget in a project of their own.
      compiled({ name: 'renderer-compiled', include: [...compiledRendererSuites(__dirname, TIMING_RENDERER_TESTS), 'src/artifacts/design-system/**/*.test.tsx' /* P3-D M4 */], exclude: [...configDefaults.exclude, ...TIMING_RENDERER_TESTS] }),
      compiled({ name: 'renderer-compiled-timing', include: TIMING_RENDERER_TESTS, ...TIMING_TIMEOUTS }),
      // C8a end
      // P4 (the tracker's portable compiled-coverage row): the portable artifact layer's React suites (its `.tsx` DOM
      // suites; its `.ts` ones render no React) again under the compiler, with artifacts-dom's sheets as text.
      compiled({ name: 'artifacts-dom-compiled', include: ['src/artifacts/**/*.dom.test.tsx'], css: ARTIFACTS_DOM_CSS }),
      // The desk's hub (apps/desk-hub, DC3 of docs/doperpowers/specs/2026-10-15-desk-design.md): its own config, under
      // this vitest, so `pnpm test` and the unit job's `--maxWorkers` reach it as they reach every project above.
      'apps/desk-hub/vitest.config.ts',
      'apps/desk-web/vitest.config.ts', // DC5: the web app's client, log, and key, against the DX3 double
    ],
  },
});
