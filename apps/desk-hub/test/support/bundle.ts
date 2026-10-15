// vitest's global setup: bundles the Worker once per run, as wrangler does (ES modules, the workerd conditions,
// `cloudflare:*` left to the runtime), for test/support/hub.ts to load into Miniflare.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    hubScript: string;
  }
}

export default async function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), 'desk-hub-test-'));
  const outfile = join(dir, 'worker.js');
  await build({
    entryPoints: [resolve(import.meta.dirname, '../../src/worker.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2024',
    conditions: ['workerd', 'worker', 'browser'],
    external: ['cloudflare:*'],
    logLevel: 'error',
  });
  project.provide('hubScript', outfile);
  return () => rmSync(dir, { recursive: true, force: true });
}
