// The vectors replayed in workerd, as the hub's Worker runs the package: bundled by esbuild with the Worker's
// conditions (test/support/workerd-entry.ts), loaded into Miniflare, and asked over fetch.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VECTORS } from '../vectors/index.ts';

let dir: string;
let mf: Miniflare;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'org-protocol-workerd-'));
  const outfile = join(dir, 'worker.js');
  await build({
    entryPoints: [resolve(import.meta.dirname, 'support/workerd-entry.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2024',
    conditions: ['workerd', 'worker', 'browser'],
    logLevel: 'error',
  });
  // Miniflare 5 takes its own option shape; the hub's suites write Miniflare 4's and convert it, as here.
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'org-protocol', modules: true, scriptPath: outfile, modulesRoot: dir, compatibilityDate: '2026-10-01' }] }));
  await mf.ready;
});

afterAll(async () => {
  await mf?.dispose();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('the vectors in workerd', () => {
  it('replay with no failure', async () => {
    const response = await mf.dispatchFetch('https://vectors.test/');
    const answer = (await response.json()) as { cases: number; failures: string[] };
    expect(answer).toEqual({ cases: VECTORS.cases.length, failures: [] });
  });
});
