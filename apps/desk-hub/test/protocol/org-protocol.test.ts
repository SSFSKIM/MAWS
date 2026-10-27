// The protocol package (apps/org-protocol) as the hub consumes it: its vectors replayed in Node through the workspace,
// and in workerd from a bundle built as the Worker's is (test/support/bundle.ts), so the bundling path is proved; each
// dual-coded event's v1 mac verifies with DX1's `verify`, unchanged (M1's dual coding order).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { replayVectors, VECTORS } from 'org-protocol/vectors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base64urlDecode } from '../../src/protocol/base64url';
import { canonicalize } from '../../src/protocol/canonical';
import { importOrgKey, verify } from '../../src/protocol/codes';

describe('the protocol package, in Node', () => {
  it('replays its vectors with no failure', async () => {
    expect(await replayVectors(VECTORS)).toEqual([]);
  });

  it("dual-codes events DX1's verify accepts unchanged, and refuses once the v2 sig is touched", async () => {
    expect(VECTORS.dual.length).toBeGreaterThan(0);
    for (const { orgKey, project, event } of VECTORS.dual) {
      const key = await importOrgKey(base64urlDecode(orgKey));
      expect(await verify(key, 'log', project, event)).toBe(true);
      const sig = event.sig as { kid: string; value: string };
      const touched = { ...event, sig: { ...sig, value: `${sig.value.slice(0, -2)}AA` } };
      expect(await verify(key, 'log', project, touched)).toBe(false);
    }
  });

  it("is where desk-hub's canonical form now lives", async () => {
    const { canonicalize: packaged } = await import('org-protocol');
    expect(canonicalize).toBe(packaged);
  });
});

describe('the protocol package, bundled as the Worker is', () => {
  let dir: string;
  let mf: Miniflare;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'desk-hub-org-protocol-'));
    const outfile = join(dir, 'worker.js');
    await build({
      entryPoints: [resolve(import.meta.dirname, '../support/org-protocol-entry.ts')],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2024',
      conditions: ['workerd', 'worker', 'browser'],
      external: ['cloudflare:*'],
      logLevel: 'error',
    });
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'org-protocol', modules: true, scriptPath: outfile, modulesRoot: dir, compatibilityDate: '2026-10-01' }] }));
    await mf.ready;
  });

  afterAll(async () => {
    await mf?.dispose();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('replays its vectors in workerd, and DX1 verifies the dual-coded macs there', async () => {
    const answer = await (await mf.dispatchFetch('https://hub.test/')).json();
    expect(answer).toEqual({ cases: VECTORS.cases.length, failures: [], dual: VECTORS.dual.map(() => true) });
  });
});
