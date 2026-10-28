import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { tempDir } from '../../../test/support/index-fixture';
import { intentFor } from '../../../test/support/session-host';
import { BootstrapNotes, FileIntentStore } from './intents';

const A = '11111111-1111-4111-8111-111111111111' as AppSessionId;
const B = '22222222-2222-4222-8222-222222222222' as AppSessionId;

describe('intents', () => {
  let dir: ReturnType<typeof tempDir>;
  beforeEach(() => {
    dir = tempDir('maws-intents-');
  });
  afterEach(() => dir.dispose());

  it('persists an intent under its id, whole, and a fresh store loads it back', async () => {
    const store = new FileIntentStore(join(dir.path, 'intents'));
    await store.load(); // no directory yet: nothing, no error
    const intent = intentFor(A, { model: 'sonnet' });
    await store.put(intent);
    expect(store.get(A)).toEqual(intent);
    expect(readdirSync(join(dir.path, 'intents'))).toEqual([`${A}.json`]); // no temp file left behind
    expect(JSON.parse(readFileSync(join(dir.path, 'intents', `${A}.json`), 'utf8'))).toEqual(intent);
    const again = new FileIntentStore(join(dir.path, 'intents'));
    await again.load();
    expect(again.list()).toEqual([intent]);
  });

  it('removes an intent from disk and memory, and removing twice is harmless', async () => {
    const store = new FileIntentStore(join(dir.path, 'intents'));
    await store.put(intentFor(A));
    await store.put(intentFor(B));
    await store.remove(A);
    await store.remove(A);
    expect(store.get(A)).toBeNull();
    expect(store.list().map((i) => i.appSessionId)).toEqual([B]);
    expect(readdirSync(join(dir.path, 'intents'))).toEqual([`${B}.json`]);
  });

  it('refuses to write what is not an intent, and keeps the previous copy', async () => {
    const store = new FileIntentStore(join(dir.path, 'intents'));
    const intent = intentFor(A);
    await store.put(intent);
    await expect(store.put({ ...intent, gateway: 'elsewhere' } as never)).rejects.toThrow();
    expect(store.get(A)).toEqual(intent);
  });

  it('skips, with a warning, a file that does not parse, is not an intent, or is filed under another id; ignores temp files', async () => {
    const intents = join(dir.path, 'intents');
    mkdirSync(intents);
    writeFileSync(join(intents, `${A}.json`), '{ torn');
    writeFileSync(join(intents, `${B}.json`), JSON.stringify(intentFor(A)));
    writeFileSync(join(intents, 'x.json'), JSON.stringify({ hello: 1 }));
    writeFileSync(join(intents, `.${A}.abc.tmp`), '');
    const warn = vi.fn();
    const store = new FileIntentStore(intents, warn);
    await store.load();
    expect(store.list()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(readdirSync(intents).sort()).toEqual([`.${A}.abc.tmp`, `${A}.json`, `${B}.json`, 'x.json'].sort()); // kept for a person
  });

  it('refuses an id that is not one plain path component', async () => {
    const store = new FileIntentStore(join(dir.path, 'intents'));
    await expect(store.remove('../escape' as AppSessionId)).rejects.toThrow('not a file-safe id');
  });

  it('keeps and lists resume bootstrap notes by bootstrap id', async () => {
    const notes = new BootstrapNotes(join(dir.path, 'bootstraps'));
    expect(await notes.list()).toEqual([]);
    await notes.put({ bootstrapId: B, appSessionId: A, at: '2026-09-29T00:00:00.000Z' });
    expect(await notes.list()).toEqual([{ bootstrapId: B, appSessionId: A, at: '2026-09-29T00:00:00.000Z' }]);
    await notes.remove(B);
    expect(await notes.list()).toEqual([]);
  });
});
