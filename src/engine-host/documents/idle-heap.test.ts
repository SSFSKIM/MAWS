// The idle unload gives the host its memory back (the P3-A document's Decision Log 29b; parent Decision Log 37: S7b
// measured 8 to 9 MB retained per closed agent replica while the service never unloaded). A document opened by two
// replicas, edited until its copies hold tens of megabytes, closed, and left past the grace period leaves the heap
// within 5 MB of its pre-open value under forced GC. Its own file, so its worker's heap holds nothing of other suites.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { afterEach, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { DocumentService } from './service';
import { SqliteDocumentStorage } from './storage';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

const MB = 1024 * 1024;
const GRACE_MS = 100; // the mechanism of the 60 s period (service.test.ts proves the period itself on a fake clock)
const sid = (id: string) => id as AppSessionId;

let dir: string;
let storage: SqliteDocumentStorage | undefined;
let service: DocumentService | undefined;
afterEach(() => {
  service?.close();
  storage?.close();
  rmSync(dir, { recursive: true, force: true });
});

const turns = async (n: number) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};
const until = async (test: () => boolean) => {
  for (let i = 0; i < 400 && !test(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(test()).toBe(true);
};
const heapUsed = async () => {
  await turns(10); // closed ports and finished promises let go of what they held
  for (let i = 0; i < 3; i++) gc();
  return process.memoryUsage().heapUsed;
};

// Two replicas (an agent's and one standing for a renderer window, the same provider) open the doc and each writes
// `entries` map attributes, one struct apiece; answers the heap with everything loaded, then closes both.
async function openEditClose(artifactId: string, entries: number): Promise<number> {
  const writers = [service!.replica(sid('app-agent'), artifactId), service!.replica(sid('app-window'), artifactId)];
  await Promise.all(writers.map((writer) => writer.whenSynced()));
  for (const [n, writer] of writers.entries()) {
    writer.edit((doc) => {
      const node = doc.get(`m${n}`);
      for (let i = 0; i < entries; i++) node.setAttr(`k${i}`, `value ${i} of ${n}`);
    });
  }
  await Promise.all(writers.map((writer) => writer.whenSaved()));
  await until(() => writers.every((writer) => writer.doc.get('m0').getAttr(`k${entries - 1}`) !== undefined && writer.doc.get('m1').getAttr(`k${entries - 1}`) !== undefined));
  const loaded = await heapUsed();
  service!.closeSession(sid('app-agent'));
  service!.closeSession(sid('app-window'));
  return loaded;
}

it('returns the heap within 5 MB of its pre-open value once a closed document’s grace period passes', async () => {
  dir = mkdtempSync(join(tmpdir(), 'maws-heap-'));
  storage = SqliteDocumentStorage.open(join(dir, 'store.sqlite'), { log: () => {} });
  service = new DocumentService(storage, { log: () => {}, idleUnloadMs: GRACE_MS });
  // The same paths once on a small doc first, so one-time costs (compiled code, SQLite's statement cache) are not
  // counted against the document.
  await openEditClose('warm-up', 100);
  await until(() => service!.loaded('warm-up') === null);
  const before = await heapUsed();

  const loaded = await openEditClose('a1', 40_000);
  expect(loaded - before).toBeGreaterThan(20 * MB); // big enough that one retained copy would fail the bound
  await until(() => service!.loaded('a1') === null);
  const after = await heapUsed();
  expect(after - before).toBeLessThan(5 * MB);
}, 60_000);
