// vitest's global setup: bundles the Worker once per run, as wrangler does (ES modules, the workerd conditions,
// `cloudflare:*` left to the runtime), for test/support/local.ts to load into Miniflare. Its entry is the Worker with
// the suites' one seam (worker-under-test.ts); the deployed Worker's entry stays src/worker.ts.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
  project.provide('hubScript', await bundleHub(join(dir, 'worker.js')));
  return () => rmSync(dir, { recursive: true, force: true });
}

/** Bundles the suites' Worker to `outfile` and answers its path (O10's endpoint suites call it for their own hub). */
export async function bundleHub(outfile: string): Promise<string> {
  // wrangler refuses a configured assets directory that does not exist; the web app (DC5) may not be built.
  mkdirSync(resolve(import.meta.dirname, '../../../desk-web/dist'), { recursive: true });
  await build({
    entryPoints: [resolve(import.meta.dirname, 'worker-under-test.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2024',
    conditions: ['workerd', 'worker', 'browser'],
    external: ['cloudflare:*'],
    logLevel: 'error',
  });
  return outfile;
}
