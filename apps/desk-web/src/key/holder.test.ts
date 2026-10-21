// The tab's key holder (the DC5 plan's M2): an unlocked key is kept as long as the owner chose — this tab's life, or
// the device's IndexedDB — and locking forgets it from both. A Lock wins over every unlock or restore still under way
// when it was pressed, and a stored key the device failed to forget stays reported until a retry forgets it.
import { beforeEach, describe, expect, it } from 'vitest';
import { VECTOR_KEY } from '../../test/vectors';
import { holdKeyBytes, keyFingerprint } from './derive';
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

/** A memory store whose next calls of `method` wait on the returned gate; `entered` settles once one has begun. */
function gatedStore(method: 'save' | 'load' | 'forget') {
  const inner = memoryKeyStore();
  const gate = deferred();
  const entered = deferred();
  const wait = async (which: typeof method) => {
    if (which !== method) return;
    entered.resolve();
    await gate.promise;
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
  return { store, inner, open: () => gate.resolve(), entered: entered.promise };
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

  it('holds a key opened from its copy as it is, kept where the owner chose', async () => {
    const store = memoryKeyStore();
    const opened = await holdKeyBytes(vector());
    expect(await beginUnlock('org', store).finish(opened, 'device')).toBe(true);
    expect(useKeyHolder.getState()).toMatchObject({ state: 'unlocked', key: opened, kept: 'device', fingerprint: await keyFingerprint(opened) });
    expect(await store.load('org')).toBe(opened.hmac);
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

  it('a newer unlock begun while an older save and the Lock still settle keeps its key stored (an ordered store)', async () => {
    // As IndexedDB runs them: each write after the one before it, in the order they were asked for.
    const inner = memoryKeyStore();
    const first = deferred();
    let tail: Promise<unknown> = Promise.resolve();
    const inOrder = <T,>(run: () => Promise<T>) => (tail = tail.then(run, run)) as Promise<T>;
    let saves = 0;
    const store: KeyStore = {
      load: (org) => inner.load(org),
      save: (org, key) => {
        const held = ++saves === 1;
        return inOrder(async () => (held && (await first.promise), inner.save(org, key)));
      },
      forget: (org) => inOrder(() => inner.forget(org)),
    };
    const old = beginUnlock('org', store).finish(vector(), 'device'); // its save waits in the store
    await new Promise((resolve) => setTimeout(resolve, 0));
    const locking = lock('org', store);
    const newer = beginUnlock('org', store).finish(vector().reverse(), 'device');
    await new Promise((resolve) => setTimeout(resolve, 0));
    first.resolve();
    expect(await old).toBe(false);
    await locking;
    expect(await newer).toBe(true);
    await tail;
    expect(useKeyHolder.getState()).toMatchObject({ state: 'unlocked', kept: 'device' });
    expect(await inner.load('org')).toBe(useKeyHolder.getState().key!.hmac); // a reload unlocks with it
  });
});

describe('two unlocks with no Lock between them', () => {
  const fingerprintOf = async (raw: Uint8Array) => keyFingerprint(await holdKeyBytes(Uint8Array.from(raw)));

  it('the newer decides memory and storage alike, though the older one\'s save was already under way', async () => {
    // The project view's form and the key dialog's can both be unlocking: A asks to keep the key on the device, then B,
    // begun while A's save is still in the store, asks for this tab only.
    const { store, inner, open } = gatedStore('save');
    const a = beginUnlock('org', store).finish(vector(), 'device');
    await new Promise((resolve) => setTimeout(resolve, 0)); // A's save is in the store
    const bRaw = vector().reverse();
    const bFingerprint = await fingerprintOf(bRaw);
    const b = beginUnlock('org', store).finish(bRaw, 'session');
    open();
    expect(await b).toBe(true);
    expect(await a).toBe(false); // superseded: it publishes nothing
    expect(useKeyHolder.getState()).toMatchObject({ state: 'unlocked', kept: 'session', fingerprint: bFingerprint });
    expect(await inner.load('org')).toBeNull(); // B's deletion ran after A's save
  });

  it('a newer unlock abandoned while the older one saved leaves the device holding what the tab shows', async () => {
    // Locked; A asks to keep the key on the device; B begins while A's save is in the store, and its prompt is cancelled.
    const { store, inner, open, entered } = gatedStore('save');
    useKeyHolder.setState({ state: 'locked' });
    const a = beginUnlock('org', store).finish(vector(), 'device');
    await entered; // A's save is in the store
    beginUnlock('org', store); // never finishes
    open();
    expect(await a).toBe(false);
    expect(useKeyHolder.getState()).toMatchObject({ state: 'locked', key: null, kept: null, forgetError: null });
    expect(await inner.load('org')).toBeNull(); // a reload stays locked, as the tab shows
  });

  it('… and puts back the key the device kept before, when the tab still shows it kept there', async () => {
    const { store, inner, open, entered } = gatedStore('save');
    await unlock('org', vector(), 'device', inner); // the tab shows this key, kept on the device
    const kept = await inner.load('org');
    const a = beginUnlock('org', store).finish(vector().reverse(), 'device');
    await entered; // A's save is in the store
    beginUnlock('org', store); // abandoned
    open();
    expect(await a).toBe(false);
    expect(useKeyHolder.getState()).toMatchObject({ state: 'unlocked', kept: 'device' });
    expect(await inner.load('org')).toBe(kept); // the key the tab shows, as before A
  });

  it('a device that cannot read what it kept is not written: the kept key survives the unlock, which fails', async () => {
    const { store: gated, inner, open, entered } = gatedStore('save');
    await unlock('org', vector(), 'device', inner); // the tab shows this key, kept on the device
    const kept = await inner.load('org');
    const store: KeyStore = { ...gated, load: async () => Promise.reject(new Error('IndexedDB is unavailable')) };
    const a = beginUnlock('org', store).finish(vector().reverse(), 'device');
    const wrote = entered.then(() => beginUnlock('org', store)); // a newer unlock, abandoned, once A writes
    open();
    await expect(a).rejects.toThrow('IndexedDB is unavailable');
    await Promise.race([wrote, new Promise((r) => setTimeout(r, 20))]);
    expect(await inner.load('org')).toBe(kept);
    expect(useKeyHolder.getState()).toMatchObject({ state: 'unlocked', kept: 'device', forgetError: null });
  });

  it('a rollback that fails stands reported, though the unlock was superseded', async () => {
    const { store: gated, inner, open, entered } = gatedStore('save');
    const store: KeyStore = { ...gated, forget: async () => Promise.reject(new Error('IndexedDB is unavailable')) };
    useKeyHolder.setState({ state: 'locked' });
    const a = beginUnlock('org', store).finish(vector(), 'device');
    await entered;
    beginUnlock('org', store); // abandoned
    open();
    expect(await a).toBe(false);
    expect(await inner.load('org')).not.toBeNull(); // the rollback's deletion failed: a reload would load this key
    expect(useKeyHolder.getState()).toMatchObject({ state: 'locked', key: null, forgetError: 'IndexedDB is unavailable' });
  });

  it("the older one's write, not yet run when the newer one began, is skipped", async () => {
    const inner = memoryKeyStore();
    const held = deferred();
    let saves = 0;
    const store: KeyStore = {
      load: (org) => inner.load(org),
      save: async (org, key) => {
        saves++;
        return inner.save(org, key);
      },
      forget: async (org) => (await held.promise, inner.forget(org)),
    };
    const locking = lock('org', store); // its deletion holds the chain
    const aRaw = vector();
    const a = beginUnlock('org', store).finish(aRaw, 'device'); // A's save waits behind it
    await new Promise((resolve) => setTimeout(resolve, 0));
    const b = beginUnlock('org', store).finish(vector().reverse(), 'session');
    held.resolve();
    await locking;
    expect(await b).toBe(true);
    expect(await a).toBe(false);
    expect(saves).toBe(0); // A's save never reached the store
    expect(await inner.load('org')).toBeNull();
    expect(useKeyHolder.getState()).toMatchObject({ state: 'unlocked', kept: 'session' });
  });
});

describe('a failed deletion', () => {
  it('stays reported though an unlock began while it was pending and was cancelled', async () => {
    const inner = memoryKeyStore();
    const deletion = deferred();
    let failing = false;
    const store: KeyStore = {
      ...inner,
      forget: async (org) => {
        if (!failing) return inner.forget(org);
        await deletion.promise;
        throw new Error('IndexedDB is unavailable');
      },
    };
    await unlock('org', vector(), 'device', store);
    failing = true;
    const locking = lock('org', store); // its deletion is pending
    beginUnlock('org', store); // a form begins unlocking; its passkey prompt is cancelled, so it never finishes
    deletion.resolve();
    await locking;
    expect(useKeyHolder.getState()).toMatchObject({ state: 'locked', key: null, forgetError: 'IndexedDB is unavailable' });
    expect(await inner.load('org')).not.toBeNull(); // a reload would restore it, so it must stay reported
  });

  it('is cleared by a later deletion that succeeds, or a device save that replaces the key, and by nothing else', async () => {
    const inner = memoryKeyStore();
    let failing = true;
    const store: KeyStore = { ...inner, forget: async (org) => (failing ? Promise.reject(new Error('IndexedDB is unavailable')) : inner.forget(org)) };
    await unlock('org', vector(), 'device', store);
    await lock('org', store);
    expect(useKeyHolder.getState().forgetError).toBe('IndexedDB is unavailable');

    // A device unlock's save replaces the stored key with the one now held: nothing stale is left behind.
    expect(await unlock('org', vector().reverse(), 'device', store)).toBe(true);
    expect(useKeyHolder.getState()).toMatchObject({ state: 'unlocked', kept: 'device', forgetError: null });

    await lock('org', store);
    expect(useKeyHolder.getState().forgetError).toBe('IndexedDB is unavailable');
    // A session unlock whose own deletion fails leaves the report standing (the old key is still stored).
    await expect(unlock('org', vector(), 'session', store)).rejects.toThrow('IndexedDB is unavailable');
    expect(useKeyHolder.getState().forgetError).toBe('IndexedDB is unavailable');
    // One whose deletion succeeds clears it.
    failing = false;
    expect(await unlock('org', vector(), 'session', store)).toBe(true);
    expect(useKeyHolder.getState()).toMatchObject({ state: 'unlocked', kept: 'session', forgetError: null });
    expect(await inner.load('org')).toBeNull();
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
