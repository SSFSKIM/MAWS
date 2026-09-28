import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const alias = { '@shared': resolve(__dirname, 'src/shared') };

// Two projects: shared, main, preload and the hosts run under Node; the renderer runs under happy-dom.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/{shared,main,preload,engine-host,pty-host}/**/*.test.ts', 'test/**/*.test.ts'],
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
        },
      },
    ],
  },
});
