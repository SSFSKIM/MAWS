// The U8 folder probe's index reader (uxwave-folder-index.test.ts) under the repository's aliases, outside the suites:
//   node_modules/.bin/vitest run --config spikes/protocol-probe/uxwave-folder-index.vitest.config.ts
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
const root = resolve(__dirname, '../..');
export default defineConfig({ root, resolve: { alias: { '@shared': resolve(root, 'src/shared') } }, test: { environment: 'node', include: ['spikes/protocol-probe/uxwave-folder-index.test.ts'] } });
