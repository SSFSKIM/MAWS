// X17's storage port (P2-A §5.5): the file beside the state file, merged per field, temp-then-rename, one chain per id;
// an unreadable file reads as unknown and stays where it is until the next write replaces it.
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyObservedFacts, type ObservedFacts } from '@shared/engine/observed-facts';
import type { AppSessionId } from '@shared/graph/ids';
import { FileObservedFactsStore, MemoryObservedFactsStore, observedFactsPath } from './observed-facts-store';

const ID = 'app-store' as AppSessionId;
const facts = (over: Partial<ObservedFacts> = {}): ObservedFacts => ({ ...emptyObservedFacts(ID, '2026-10-09T10:00:00.000Z', 'live'), ...over });

let userData: string;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-observed-'));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

describe('FileObservedFactsStore', () => {
  it('writes <userData>/engine-host/state/<id>.observed.json, merging each write into what is there', async () => {
    const store = new FileObservedFactsStore(userData);
    expect(await store.load(ID)).toBeNull();
    await store.merge(ID, facts({ launches: ['L1'], model: { value: 'm1', at: '2026-10-09T10:00:00.000Z', launchId: 'L1' } }));
    const merged = await store.merge(ID, facts({ launches: ['L2'], mode: { value: 'plan', at: '2026-10-09T11:00:00.000Z', launchId: 'L2' } }));
    expect(merged.model?.value).toBe('m1');
    expect(merged.mode?.value).toBe('plan');
    expect(merged.launches.sort()).toEqual(['L1', 'L2']);
    expect(await store.load(ID)).toEqual(merged);
    expect(observedFactsPath(userData, ID)).toBe(join(userData, 'engine-host', 'state', `${ID}.observed.json`));
    expect(await readdir(join(userData, 'engine-host', 'state'))).toEqual([`${ID}.observed.json`]); // no temp left behind
  });

  it('keeps only the launches a write names as current, when it names them', async () => {
    const store = new FileObservedFactsStore(userData);
    await store.merge(ID, facts({ launches: ['old', 'L1'] }));
    const merged = await store.merge(ID, facts({ launches: ['L2'] }), { keepLaunches: new Set(['L1', 'L2']) });
    expect(merged.launches.sort()).toEqual(['L1', 'L2']);
  });

  it('reads an unreadable file as unknown and leaves it in place; the next write replaces it', async () => {
    const store = new FileObservedFactsStore(userData);
    await mkdir(join(userData, 'engine-host', 'state'), { recursive: true });
    await writeFile(observedFactsPath(userData, ID), '{"version":1,"appSessionId":"app-st');
    expect(await store.load(ID)).toBeNull();
    expect(await readFile(observedFactsPath(userData, ID), 'utf8')).toBe('{"version":1,"appSessionId":"app-st');
    const written = await store.merge(ID, facts({ outputStyle: { value: 'default', at: '2026-10-09T10:00:00.000Z', launchId: 'L1' } }));
    expect(await store.load(ID)).toEqual(written);
  });

  it('runs one id’s operations in the order they were issued', async () => {
    const store = new FileObservedFactsStore(userData);
    const writes = [1, 2, 3].map((n) => store.merge(ID, facts({ contextUsage: { value: { percent: n, totalTokens: n, maxTokens: 10, autoCompactThreshold: null }, at: `2026-10-09T10:00:0${n}.000Z`, launchId: 'L1' } })));
    const loaded = store.load(ID);
    await Promise.all(writes);
    expect((await loaded)?.contextUsage?.value.percent).toBe(3);
  });

  it('forget removes the file; an unsafe id never reaches the filesystem', async () => {
    const store = new FileObservedFactsStore(userData);
    await store.merge(ID, facts());
    await store.forget(ID);
    expect(await store.load(ID)).toBeNull();
    await expect(store.load('../x' as AppSessionId)).rejects.toThrow(/invalid appSessionId/);
  });
});

describe('MemoryObservedFactsStore', () => {
  it('merges and forgets as the file store does, cloning in and out', async () => {
    const store = new MemoryObservedFactsStore();
    const written = await store.merge(ID, facts({ model: { value: 'm', at: '2026-10-09T10:00:00.000Z', launchId: 'L1' } }));
    written.model!.value = 'mutated';
    expect((await store.load(ID))?.model?.value).toBe('m');
    await store.forget(ID);
    expect(await store.load(ID)).toBeNull();
  });
});
