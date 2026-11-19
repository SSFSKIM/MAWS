// The U5b-2 P5 cost run (uxwave-u5b-reads-cost.test.ts) under the repository's aliases, outside the suites:
//   node_modules/.bin/vitest run --config spikes/protocol-probe/uxwave-u5b-reads-cost.vitest.config.ts
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
const root = resolve(__dirname, '../..');
export default defineConfig({ root, resolve: { alias: { '@shared': resolve(root, 'src/shared') } }, test: { environment: 'node', include: ['spikes/protocol-probe/uxwave-u5b-reads-cost.test.ts'], testTimeout: 60 * 60_000 } });
