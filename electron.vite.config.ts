import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Rollup } from 'vite';
import { latin1Bundles } from './scripts/latin1-bundles';
// C8c start
import { createRequire } from 'node:module';
// C8c end

const alias = { '@shared': resolve(__dirname, 'src/shared'), '@artifacts': resolve(__dirname, 'src/artifacts') }; // P3-A: @artifacts
const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

// E11 §2.7: main's build stamp, the checkout's commit and the time this config was evaluated (a build's start; the dev
// server's under `serve`), logged at main's startup and shown in Diagnostics, so which main is answering can be read.
// A tree with no git reads `unknown`; a dirty tree is not marked (the stamp names the commit it was built from).
function buildStamp(): { commit: string; builtAt: string } {
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'unknown';
  } catch {
    // not a git checkout
  }
  return { commit, builtAt: new Date().toISOString() };
}

// C8c start: `lowlight` aliased to a grammar-less build (ruled 2026-09-29, the C8c document's M1 fold (2)): the diff
// view's core would otherwise ship every highlight.js grammar, unused since Review highlights through shiki. The shim
// takes lowlight's engine through `lowlight-engine`, its `lib/index.js`, which the package's exports do not name.
Object.assign(alias, {
  lowlight: resolve(__dirname, 'src/renderer/src/tools/code/review/lowlight-no-grammars.mjs'),
  'lowlight-engine': resolve(createRequire(__filename).resolve('lowlight'), '../lib/index.js'),
});
// C8c end

// zod 4.6.5's sources carry explanatory comments beside `@__PURE__` annotations that Rollup reports as
// INVALID_ANNOTATION on every bundle that includes zod (the preload and the renderer). Harmless; dropped so a real
// warning is not lost among them. Every other warning passes through.
const rollupOptions = {
  onwarn(warning: Rollup.RollupLog, warn: (warning: Rollup.RollupLog) => void) {
    if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('/node_modules/zod/')) return;
    warn(warning);
  },
};

export default defineConfig(({ command }) => {
  // Development CSP nonce: minted once per evaluation of this file and handed to both sides, to the dev server's
  // HTML (Vite stamps it on every script and style tag, including plugin-react's inline fast-refresh preamble) and
  // to main's CSP header. A build defines it as null and stamps nothing, so production carries no nonce at all.
  const devNonce = command === 'serve' ? randomBytes(16).toString('base64') : null;
  const build = buildStamp(); // E11 §2.7

  // C6: the development harness (src/renderer/harness.html) is a second renderer entry, built by the dev server or
  // under MAWS_HARNESS=1 only, so a production build never contains it; its fixtures are read from the repo root.
  const harnessInput =
    command === 'serve' || process.env.MAWS_HARNESS === '1'
      ? { index: resolve(__dirname, 'src/renderer/index.html'), harness: resolve(__dirname, 'src/renderer/harness.html') }
      : null;
  // end C6

  return {
    // The host entries are bundled with this config through `?modulePath` (src/main/hosts/index.ts), so they share
    // its aliases, defines and externals: node-pty stays a real file under node_modules, for `asarUnpack`.
    main: {
      resolve: { alias },
      // P5 O10 M10: `ws` is bundled (main's remote links, mawsd's endpoint) and its optional native helpers, `bufferutil`
      // and `utf-8-validate`, are installed nowhere. The bundler stands an empty object in for each, which `ws`'s
      // `try { require(...) }` takes as present, so its first masked frame of 48 bytes or more calls a `mask` that isn't
      // there. `ws`'s own switches, defined here, keep it on its JavaScript paths (bundle-guard.test.ts holds the graph to it).
      define: {
        __MAWS_DEV_CSP_NONCE__: JSON.stringify(devNonce),
        __MAWS_VERSION__: JSON.stringify(version),
        __MAWS_BUILD__: JSON.stringify(build),
        __MAWS_HARNESS_BUILD__: JSON.stringify(harnessInput !== null), // P5 O8 M4a Task 8: what only a harness build's main contains (index.ts)
        'process.env.WS_NO_BUFFER_UTIL': JSON.stringify('1'),
        'process.env.WS_NO_UTF_8_VALIDATE': JSON.stringify('1'),
      },
      // P5 O2 M5: `mawsd` (out/main/mawsd.js) is main's second input, so its `?modulePath` imports of the hosts emit the
      // files main's do and one build has one build id; src/engine-host/bundle-guard.test.ts holds its graph to Node's
      // builtins and the hosts' externals (no `electron`). P5 O3-C (D13): the services entry (out/main/services.js), the
      // library's one door, is the third, held by the same guard to mawsd's rule; O3-D's mawsd composes the spine from it.
      // P5 O5: the app's root (out/main/app.js), which the entry (index.js) loads by a deferred import, is an input of its
      // own so it lands beside index.js rather than under chunks/: its modules read `__dirname` for the preloads, the
      // renderer's page and mawsd.js. M3: the render host's root (src/render-host/root.ts) is a chunk the entry loads on
      // `--render-host`, reading no `__dirname`; the render library both roots compose lands in the chunks they share as
      // the bundler splits them. Not a `manualChunks` entry: a manual chunk takes in its modules' dependencies, mawsd's
      // shared ones among them, and mawsd.js would then require a chunk that requires electron (bundle-guard.test.ts).
      build: {
        rollupOptions: {
          input: { index: resolve(__dirname, 'src/main/index.ts'), app: resolve(__dirname, 'src/main/app.ts'), mawsd: resolve(__dirname, 'src/mawsd/index.ts'), services: resolve(__dirname, 'src/services/entry.ts') },
          // Every main-process file as Latin-1 text, so V8 holds its source at a byte a character (scripts/latin1-bundles.ts).
          // The `?modulePath` hosts' builds take this config's output options too, so their files are re-printed there;
          // here they arrive as assets, which the plugin's check reads with the rest.
          output: { plugins: [latin1Bundles()] },
        },
      },
    },
    preload: {
      resolve: { alias },
      // A sandboxed preload's `require` loads only `electron`, `events`, `timers` and `url`, so whatever it imports
      // (X2's zod-free name lists, `@shared/ipc/names`) is bundled into out/preload/index.js; only `electron` stays
      // external.
      // E4a start: a second entry, the browser view's preload (out/preload/browser.js); the two share no module, so
      // neither requires a chunk beside it (src/preload/bundle.test.ts).
      build: {
        externalizeDeps: false,
        rollupOptions: {
          ...rollupOptions,
          input: { index: resolve(__dirname, 'src/preload/index.ts'), browser: resolve(__dirname, 'src/preload/browser.ts') },
          output: { plugins: [latin1Bundles()] }, // as main's: each renderer process holds its preload's source too
        },
      },
      // E4a end
    },
    // gate-offload: MAWS_BUILD_RENDERER=0 (`pnpm build:main-preload`) builds main and the preloads alone, which is all the
    // unit gate's two build-reading suites read (the engine-host bundle guard, the preload bundle suite); static's full
    // `pnpm build` keeps the renderer and the apps proven.
    renderer:
      process.env.MAWS_BUILD_RENDERER === '0'
        ? undefined
        : {
            resolve: { alias },
            html: devNonce ? { cspNonce: devNonce } : undefined,
            build: { rollupOptions: harnessInput ? { ...rollupOptions, input: harnessInput } : rollupOptions }, // C6: harness input
            server: { fs: { allow: [__dirname] } }, // C6: harness fixtures under spikes/ and test/
            plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } }), tailwindcss()],
          },
  };
});
