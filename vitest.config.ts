import { resolve } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';
// C8a start
import react from '@vitejs/plugin-react';
// C8a end

const alias = { '@shared': resolve(__dirname, 'src/shared') };
// Renderer suites that drive a real emulator without a DOM (C9: `@xterm/headless` round trips) run under Node.
const RENDERER_NODE_TESTS = 'src/renderer/src/terminal/**/*.node.test.ts';

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
          exclude: ['**/node_modules/**', 'test/live/**/*.live.test.ts'], // C3: live cases run only in the `live` project; their support's own tests run here
          // The compile-time suites (`identifiers are not interchangeable`) run through tsc on the node tsconfig.
          typecheck: { enabled: true, include: ['src/**/*.test-d.ts'], tsconfig: './tsconfig.node.json' },
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'renderer',
          environment: 'happy-dom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          exclude: [...configDefaults.exclude, RENDERER_NODE_TESTS],
        },
      },
      ...liveProjects, // C3
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
          ],
          env: { MAWS_REACT_COMPILER: '1' },
        },
      },
      // C8a end
    ],
  },
});
