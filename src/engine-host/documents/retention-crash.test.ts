// E3 M1 fix wave (the architect's ruling: crash, whole-batch loss and reopen, not a savepoint throw alone). Retention and
// holds over a real store whose writer dies: a child publishes snapshots, holds a retired one, then dies inside the frame
// of a publication that retires another; the reopened store has none of that frame (its snapshot row, its membership
// change, its retirement), collects the retired snapshot whose hold died with its process, and names no bytes it lacks.
// In process: a batch lost at its commit takes back the retirement it carried, and a capture read in that batch
// releases its hold and fails.
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSync } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDataset, setDataset } from '@artifacts/dashboard/datasets';
import type { Actor } from '@shared/artifacts/actor';
import { registerDashboards } from '../dashboards';
import { openDocuments, type Documents } from '.';
import { ArtifactFiles } from './bytes';

const ROOT = resolve(__dirname, '../../..');
const WAIT_MS = 20_000;
const human: Actor = { kind: 'human' };
let dir: string;
let documents: Documents | null = null;
afterEach(() => {
  documents?.close();
  documents = null;
  rmSync(dir, { recursive: true, force: true });
});

const managed = (docs: Documents, artifactId: string) =>
  (docs.storage.db.prepare("SELECT 'assets/' || name AS ref, retiredAt FROM artifact_assets WHERE artifactId = ? AND querySnapshot = 1 ORDER BY name").all(artifactId) as { ref: string; retiredAt: number | null }[]);
const members = (docs: Documents, artifactId: string) =>
  (docs.storage.db.prepare("SELECT 'assets/' || a.name AS ref FROM artifact_query_snapshots m JOIN artifact_assets a ON a.artifactId = m.artifactId AND a.assetId = m.assetId WHERE m.artifactId = ? ORDER BY m.lastUsedSeq").all(artifactId) as { ref: string }[]).map((row) => row.ref);
const everyRowHasItsBytes = (docs: Documents, artifactId: string) => docs.store.listAssets(artifactId).every((asset) => existsSync(join(docs.store.files.dirOf(artifactId), ArtifactFiles.assetPath(asset.sha256))));

describe('retention through a crash and a lost batch (E3)', () => {
  it('a writer killed inside a retiring frame leaves the reopened store as of its last commit, its dead hold gone', async () => {
    dir = mkdtempSync(join(tmpdir(), 'maws-retention-crash-'));
    const bundle = join(dir, 'writer.mjs');
    buildSync({
      entryPoints: [join(__dirname, 'retention-crash-writer.fixture.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: bundle,
      alias: { '@shared': join(ROOT, 'src/shared'), '@artifacts': join(ROOT, 'src/artifacts') },
      logLevel: 'silent',
    });
    const userData = join(dir, 'user');
    const child = fork(bundle, [userData], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: ['--disable-warning=ExperimentalWarning'] });
    let stderr = '';
    child.stderr!.on('data', (chunk) => (stderr += String(chunk)));
    const exited = new Promise<NodeJS.Signals | null>((done) => child.on('exit', (_code, signal) => done(signal)));
    let refs!: { id: string; x: string; a: string; b: string };
    try {
      refs = await new Promise((done, fail) => {
        child.once('message', (message) => {
          done(message as typeof refs);
          child.send('crash');
        });
        child.on('exit', () => fail(new Error(`the writer exited before reporting: ${stderr}`)));
        setTimeout(() => fail(new Error(`the writer did not report in ${WAIT_MS} ms: ${stderr}`)), WAIT_MS).unref();
      });
      expect(await exited).toBe('SIGKILL');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    }

    documents = openDocuments(userData, () => {})!; // the reopen collects
    registerDashboards({ documents });
    const { id, x, a, b } = refs;
    expect(managed(documents, id)).toEqual([a, b].sort().map((ref) => ({ ref, retiredAt: null }))); // the dying frame's snapshot and a's retirement: gone with it
    expect(members(documents, id)).toEqual([a, b]);
    expect(readDataset(documents.service.live(id), 'live')?.source).toMatchObject({ snapshot: { ref: b } });
    expect(managed(documents, id).some((row) => row.ref === x)).toBe(false); // retired, its hold died with its process
    expect(everyRowHasItsBytes(documents, id)).toBe(true);
  });

  it('a batch lost at its commit takes back the retirement it carried, and a capture read in it holds nothing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'maws-retention-lost-'));
    documents = openDocuments(dir, () => {})!;
    const dashboards = registerDashboards({ documents });
    const docs = documents;
    const refresh = (artifactId: string, content: string) => {
      let ref = '';
      const at = Date.now();
      const written = docs.store.writeWithAssets(
        artifactId,
        human,
        [{ bytes: new TextEncoder().encode(content), name: `query-${randomUUID()}.json`, mime: 'application/json', querySnapshot: true }],
        (doc, assets) => {
          ref = assets[0]!.ref;
          setDataset(doc, 'live', { title: 'Live', source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: { ref, at } }, columns: [{ name: 'v', type: 'number' }], rows: 1, updated: { at, by: human }, state: { status: 'ok', at } });
        },
        { inFrame: (revision) => docs.store.retainQuerySnapshots(artifactId, 'live', ref, revision) },
      );
      return { written, ref: () => ref };
    };
    try {
      const { id } = await docs.store.create({ kind: 'dashboard', title: 'Board' }, human);
      const a = refresh(id, '[{"v":1}]');
      await a.written;
      const b = refresh(id, '[{"v":2}]');
      await b.written;
      const commit = vi.spyOn(docs.storage, 'commit').mockImplementationOnce(() => {
        throw new Error('disk full');
      });
      const c = refresh(id, '[{"v":3}]'); // retires a, in the batch about to be lost
      const capture = docs.store.captureWithAssets(id, () => ({ value: null, refs: [c.ref(), a.ref()] }));
      docs.store.collectRetiredAssets(id); // asked in the batch: runs after it, lost or not
      await expect(c.written).rejects.toThrow();
      await expect(capture).rejects.toThrow();
      commit.mockRestore();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(managed(docs, id)).toEqual([a.ref(), b.ref()].sort().map((ref) => ({ ref, retiredAt: null })));
      expect(members(docs, id)).toEqual([a.ref(), b.ref()]);
      expect(readDataset(docs.service.live(id), 'live')?.source).toMatchObject({ snapshot: { ref: b.ref() } });
      // the failed capture left nothing held: a's later retirement and collection go through
      await refresh(id, '[{"v":4}]').written;
      docs.store.collectRetiredAssets(id);
      expect(managed(docs, id).some((row) => row.ref === a.ref())).toBe(false);
      expect(everyRowHasItsBytes(docs, id)).toBe(true);
    } finally {
      dashboards.close();
    }
  });
});
