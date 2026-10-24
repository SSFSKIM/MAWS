import type { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SearchTextReader } from './search-text';

// The extraction worker is the external boundary here: deliberately stall or kill
// it, rather than relying on a giant fixture taking a particular amount of time.
const control = vi.hoisted(() => ({ worker: null as EventEmitter | null, started: null as ((id: string) => void) | null }));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return { Worker: class extends EventEmitter {
    constructor() { super(); control.worker = this; }
    unref() {}
    async terminate() { return 0; }
    postMessage(message: { type: string; id: string; file?: { close(): Promise<void> } }) {
      if (message.type === 'start') { void message.file!.close(); control.started?.(message.id); }
    }
  } };
});

let dir: string;
let path: string;
let reader: SearchTextReader;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'maws-search-lifecycle-'));
  path = join(dir, 'session.jsonl');
  await writeFile(path, '{}');
  reader = new SearchTextReader();
  vi.useFakeTimers();
});
afterEach(async () => { reader.stop(); vi.useRealTimers(); await rm(dir, { recursive: true }); });

it('answers progress before the command timeout, then rejects a stalled extraction instead of polling forever', async () => {
  const started = new Promise<string>((resolve) => { control.started = resolve; });
  let pending = reader.read(path);
  const cursor = await started;
  for (let second = 1; second < 8; second += 1) {
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ text: '', cursor });
    pending = reader.read(path, cursor);
  }
  await Promise.all([expect(pending).rejects.toThrow('stalled'), vi.advanceTimersByTimeAsync(1000)]);

  const restarted = new Promise<string>((resolve) => { control.started = resolve; });
  const recovered = reader.read(path);
  const id = await restarted;
  control.worker!.emit('message', { id, text: 'Recovered', done: true });
  expect(await recovered).toMatchObject({ text: 'Recovered', cursor: null });
});

it('rejects an unexpected worker exit so the source can retry the job', async () => {
  const started = new Promise<string>((resolve) => { control.started = resolve; });
  const pending = reader.read(path);
  await started;
  const exited = expect(pending).rejects.toThrow('worker exited');
  control.worker!.emit('exit', 1);
  await exited;
});
