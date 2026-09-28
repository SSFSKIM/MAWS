import { resolve } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

const alias = { '@shared': resolve(__dirname, 'src/shared') };
// Renderer suites that drive a real emulator without a DOM (C9: `@xterm/headless` round trips) run under Node.
const RENDERER_NODE_TESTS = 'src/renderer/src/terminal/**/*.node.test.ts';

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
    ],
  },
});
