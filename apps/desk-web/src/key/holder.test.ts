// The tab's key holder (the DC5 plan's M2): an unlocked key is kept as long as the owner chose — this tab's life, or
// the device's IndexedDB — and locking forgets it from both. A Lock wins over every unlock or restore still under way
// when it was pressed, and a stored key the device failed to forget stays reported until a retry forgets it.
import { beforeEach, describe, expect, it } from 'vitest';
import { VECTOR_KEY } from '../../test/vectors';
import { keyFingerprint } from './derive';
import { beginUnlock, loadDeviceKey, lock, unlock, useKeyHolder } from './holder';
import { memoryKeyStore, type KeyStore } from './org-key';

beforeEach(() => useKeyHolder.setState({ state: 'loading', key: null, kept: null, fingerprint: null, forgetError: null }));

const vector = () => Uint8Array.from(VECTOR_KEY);

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

/** A memory store whose next calls of `method` wait on the returned gate. */
function gatedStore(method: 'save' | 'load' | 'forget') {
  const inner = memoryKeyStore();
  const gate = deferred();
  const wait = async (which: typeof method) => {
    if (which === method) await gate.promise;
  };
  const store: KeyStore = {
    // A read answers with what was stored when it began, however late the answer comes.
    load: async (org) => {
      const key = await inner.load(org);
      await wait('load');
      return key;
    },
    save: async (org, key) => (await wait('save'), inner.save(org, key)),
    forget: async (org) => (await wait('forget'), inner.forget(org)),
  };
  return { store, inner, open: () => gate.resolve() };
}

describe('unlock', () => {
  it('kept for the session: the tab holds the key, the device keeps nothing', async () => {
    const store = memoryKeyStore();
    const raw = vector();
    await unlock('org', raw, 'session', store);
    const held = useKeyHolder.getState();
    expect(held).toMatchObject({ state: 'unlocked', kept: 'session' });
    expect(held.fingerprint).toBe(await keyFingerprint(held.key!));
    expect(raw.every((b) => b === 0)).toBe(true); // the bytes are wiped once held
    expect(await store.load('org')).toBeNull();
  });

  it('kept on the device: a later load finds it', async () => {
    const store = memoryKeyStore();
    await unlock('org', vector(), 'device', store);
    const fingerprint = useKeyHolder.getState().fingerprint;
    useKeyHolder.setState({ state: 'loading', key: null, kept: null, fingerprint: null });
    await loadDeviceKey('org', store);
    expect(useKeyHolder.getState()).toMatchObject({ state: 'unlocked', kept: 'device', fingerprint });
  });

  it('kept for the session after the device kept one: the device forgets it', async () => {
    const store = memoryKeyStore();
    await unlock('org', vector(), 'device', store);
    await unlock('org', vector(), 'session', store);
    expect(await store.load('org')).toBeNull();
  });
});

describe('lock', () => {
  it('forgets the key in the tab and on the device', async () => {
    const store = memoryKeyStore();
    await unlock('org', vector(), 'device', store);
    await lock('org', store);
    expect(useKeyHolder.getState()).toMatchObject({ state: 'locked', key: null, kept: null, fingerprint: null, forgetError: null });
    expect(await store.load('org')).toBeNull();
  });

  it('wins over an unlock begun before it (a derivation still running), which then holds and stores nothing', async () => {
    const store = memoryKeyStore();
    await unlock('org', vector(), 'session', store);
    const attempt = beginUnlock('org', store); // a form starts deriving
    await lock('org', store); // the owner presses Lock meanwhile
    const raw = vector();
    expect(await attempt.finish(raw, 'device')).toBe(false); // the derivation ends
    expect(useKeyHolder.getState()).toMatchObject({ state: 'locked', key: null });
    expect(await store.load('org')).toBeNull();
    expect(raw.every((b) => b === 0)).toBe(true);
  });

  it('wins over an unlock caught mid-way through storing the key on the device', async () => {
    const { store, inner, open } = gatedStore('save');
    const finishing = beginUnlock('org', store).finish(vector(), 'device');
    await new Promise((resolve) => setTimeout(resolve, 0)); // the save is under way
    const locking = lock('org', store);
    open();
    expect(await finishing).toBe(false);
    await locking;
    expect(useKeyHolder.getState()).toMatchObject({ state: 'locked', key: null });
    expect(await inner.load('org')).toBeNull();
  });

  it('wins over the device key being restored when the tab opened', async () => {
    const seeded = memoryKeyStore();
    await unlock('org', vector(), 'device', seeded);
    const { store, open } = gatedStore('load');
    await seeded.load('org').then((key) => store.save('org', key!));
    useKeyHolder.setState({ state: 'loading', key: null, kept: null, fingerprint: null });
    const restoring = loadDeviceKey('org', store);
    const locking = lock('org', store);
    open();
    await Promise.all([restoring, locking]);
    expect(useKeyHolder.getState()).toMatchObject({ state: 'locked', key: null });
  });

  it('a device that fails to forget the key: the tab drops it, the failure stays reported, and a retry forgets it', async () => {
    const inner = memoryKeyStore();
    let failing = true;
    const store: KeyStore = { ...inner, forget: async (org) => (failing ? Promise.reject(new Error('IndexedDB is unavailable')) : inner.forget(org)) };
    await unlock('org', vector(), 'device', store);

    await lock('org', store);
    expect(useKeyHolder.getState()).toMatchObject({ state: 'locked', key: null, forgetError: 'IndexedDB is unavailable' });
    expect(await inner.load('org')).not.toBeNull(); // still stored: a reload would load it

    failing = false;
    await lock('org', store);
    expect(useKeyHolder.getState()).toMatchObject({ state: 'locked', key: null, forgetError: null });
    expect(await inner.load('org')).toBeNull();
  });
});
