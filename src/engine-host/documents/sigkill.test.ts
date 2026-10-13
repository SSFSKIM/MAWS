// A host SIGKILLed mid-stream loses nothing it acknowledged (the P3-A document's M2 Proves; parent §4.2's durability
// rule). A Node child runs the real storage and document service and writes through an agent replica without waiting
// for each write; it reports every ack's revision and the last token the ack covers. The parent kills it with SIGKILL
// while writes are in flight, reopens the store, and checks every acknowledged token is there. The child is bundled
// with esbuild (a devDependency at vite's resolved version) since a forked Node cannot load the TypeScript sources.
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSync } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { applyV1, applyV2, newDoc } from '@artifacts/yjs';
import { SqliteDocumentStorage } from './storage';

const ROOT = resolve(__dirname, '../../..');
const WAIT_MS = 20_000; // the writer's 40 acks take well under a second
let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the document service under SIGKILL', () => {
  it('keeps every acknowledged write of a child killed mid-stream', async () => {
    dir = mkdtempSync(join(tmpdir(), 'maws-sigkill-'));
    const bundle = join(dir, 'writer.mjs');
    buildSync({
      entryPoints: [join(__dirname, 'sigkill-writer.fixture.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: bundle,
      alias: { '@shared': join(ROOT, 'src/shared'), '@artifacts': join(ROOT, 'src/artifacts') },
      logLevel: 'silent',
    });
    const store = join(dir, 'store.sqlite');
    const child = fork(bundle, [store], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: ['--disable-warning=ExperimentalWarning'] });
    let stderr = '';
    child.stderr!.on('data', (chunk) => (stderr += String(chunk)));
    const acks: { token: number; revision: number }[] = [];
    const exited = new Promise<NodeJS.Signals | null>((done) => child.on('exit', (_code, signal) => done(signal)));
    try {
      await new Promise<void>((done, fail) => {
        child.on('message', (message) => {
          acks.push(message as { token: number; revision: number });
          if (acks.length === 40) {
            child.kill('SIGKILL');
            done();
          }
        });
        child.on('exit', () => fail(new Error(`the writer exited before 40 acks: ${stderr}`)));
        // Inside the test's own 30 s timeout, which would abandon this body without running the `finally`.
        setTimeout(() => fail(new Error(`the writer sent ${acks.length} of 40 acks in ${WAIT_MS} ms: ${stderr}`)), WAIT_MS).unref();
      });
    } finally {
      // Whatever ended the wait (40 acks, an early exit, the deadline), the writer is dead before the store is read or
      // the directory removed.
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    }
    expect(await exited).toBe('SIGKILL');

    const last = acks.at(-1)!;
    const storage = SqliteDocumentStorage.open(store, { log: () => {} });
    try {
      const stored = storage.load('doc');
      const doc = newDoc();
      if (stored.head) applyV2(doc, stored.head.state);
      for (const row of stored.updates) applyV1(doc, row.bytes);
      const text = doc.get('t').toString();
      const missing = Array.from({ length: last.token + 1 }, (_, token) => token).filter((token) => !text.includes(`<${token}>`));
      expect(missing).toEqual([]);
      expect(storage.revision('doc')).toBeGreaterThanOrEqual(last.revision);
      expect(acks.every((ack, i) => i === 0 || ack.revision >= acks[i - 1].revision)).toBe(true);
    } finally {
      storage.close();
    }
  });
});
